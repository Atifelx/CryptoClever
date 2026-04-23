import asyncio
import json
import logging
import time
from datetime import datetime, timedelta
from typing import Any

import httpx
import websockets

from app.config import (
    MASSIVE_API_KEY,
    MASSIVE_WS_BASE,
    MASSIVE_REST_BASE,
    FOREX_SYMBOLS,
)
from app.redis_store import append_candle, set_candles, get_candles
from app.ws_broadcast import broadcast_candle, broadcast_candle_proposal

logger = logging.getLogger(__name__)

# Track partial 15m candle per symbol for aggregation
# symbol -> { "time": ts, "open": o, "high": h, "low": l, "close": c, "volume": v, "count": n }
_partial_candles: dict[str, dict[str, Any]] = {}

def _massive_to_candle(m: dict[str, Any]) -> dict[str, Any]:
    """Convert Massive aggregate minute (AM) payload to our candle format."""
    return {
        "time": int(m["s"]) // 1000,
        "open": float(m["o"]),
        "high": float(m["h"]),
        "low": float(m["l"]),
        "close": float(m["c"]),
        "volume": float(m["v"]),
        "is_closed": True, # Massive AM messages are closed 1m bars
    }

async def bootstrap_forex_symbol(symbol: str) -> None:
    """Fetch last 1000 15m aggregates from Massive REST and write to Redis."""
    end_date = datetime.now()
    start_date = end_date - timedelta(days=30)
    
    from_str = start_date.strftime("%Y-%m-%d")
    to_str = end_date.strftime("%Y-%m-%d")
    
    url = f"{MASSIVE_REST_BASE}/v2/aggs/ticker/{symbol}/range/15/minute/{from_str}/{to_str}"
    params = {"apiKey": MASSIVE_API_KEY, "limit": 1000, "adjusted": "true", "sort": "asc"}
    
    logger.info("[MASSIVE_BOOTSTRAP] Fetching %s history from %s", symbol, from_str)
    all_results = []
    
    # Follow next_url pagination until we get 1000 candles
    while url and len(all_results) < 1000:
        max_retries = 3
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient() as client:
                    r = await client.get(url, params=params, timeout=20.0)
                    if r.status_code == 429:
                        wait_time = (attempt + 1) * 15 # Wait 15s, 30s, 45s
                        logger.warning("[MASSIVE_BOOTSTRAP] Rate limit (429) for %s. Retrying in %ds...", symbol, wait_time)
                        await asyncio.sleep(wait_time)
                        continue
                    r.raise_for_status()
                    data = r.json()
                    results = data.get("results", [])
                    all_results.extend(results)
                    
                    next_url = data.get("next_url")
                    if next_url and len(all_results) < 1000:
                        url = next_url + "&apiKey=" + MASSIVE_API_KEY
                        params = {} # Clear params since they are embedded in next_url
                    else:
                        url = None
                    break # Success
            except Exception as e:
                if attempt == max_retries - 1:
                    logger.warning("[MASSIVE_BOOTSTRAP] %s failed after %d attempts: %s", symbol, max_retries, e)
                    url = None
                    break
                await asyncio.sleep(5)
        else:
            url = None # Failed after retries

    # Keep only the most recent 1000 if we overfetched
    all_results = all_results[-1000:]
    
    candles = []
    for res in all_results:
        candles.append({
            "time": int(res["t"]) // 1000,
            "open": float(res["o"]),
            "high": float(res["h"]),
            "low": float(res["l"]),
            "close": float(res["c"]),
            "volume": float(res["v"]),
            "is_closed": True, # CRITICAL: explicitly set for indicators (Semafor) to accept it
        })
    
    if candles:
        await set_candles(symbol, "15m", candles)
        logger.info("[MASSIVE_BOOTSTRAP] %s: %d historical candles loaded", symbol, len(candles))
    else:
        logger.warning("[MASSIVE_BOOTSTRAP] %s: No candles found in range", symbol)

async def bootstrap_all_forex() -> None:
    """Bootstrap history for all Forex symbols."""
    if not MASSIVE_API_KEY:
        logger.warning("[MASSIVE_BOOTSTRAP] No API key found. Skipping.")
        return
    logger.info("[MASSIVE_BOOTSTRAP] Starting for %s", FOREX_SYMBOLS)
    # Sequential bootstrap to avoid 429 Rate Limit
    for sym in FOREX_SYMBOLS:
        try:
            await bootstrap_forex_symbol(sym)
            await asyncio.sleep(2) # Small gap between symbols
        except Exception as e:
            logger.error("[MASSIVE_BOOTSTRAP] Error in sequence for %s: %s", sym, e)

async def run_massive_ws_for_symbol(symbol: str) -> None:
    """Fallback REST Poller since Massive Free Tier denies WS access for Forex."""
    if not MASSIVE_API_KEY:
        logger.error("[MASSIVE_REST_POLLER] No API key for %s", symbol)
        return

    logger.info("[MASSIVE_REST_POLLER] Starting fallback poller for %s", symbol)

    while True:
        try:
            # Fetch latest 1m candle (past 2 days range to be safe over weekends)
            now = datetime.now()
            start = now - timedelta(days=2)
            from_str = start.strftime("%Y-%m-%d")
            to_str = now.strftime("%Y-%m-%d")
            
            url = f"{MASSIVE_REST_BASE}/v2/aggs/ticker/{symbol}/range/1/minute/{from_str}/{to_str}"
            params = {
                "apiKey": MASSIVE_API_KEY, 
                "limit": 3, 
                "adjusted": "true",
                "sort": "desc" # Get newest first
            }
            
            async with httpx.AsyncClient() as client:
                r = await client.get(url, params=params, timeout=10.0)
                if r.status_code == 200:
                    data = r.json()
                    results = data.get("results", [])
                    if results:
                        newest = results[0] # desc = newest is first element
                        # Reformat for the aggregation function
                        msg = {
                            "s": int(newest["t"]),
                            "o": float(newest["o"]),
                            "h": float(newest["h"]),
                            "l": float(newest["l"]),
                            "c": float(newest["c"]),
                            "v": float(newest["v"])
                        }
                        # Pass to aggregator (handles building 15m candle & broadcasting)
                        await _handle_minute_aggregate(symbol, msg)
                elif r.status_code == 429:
                    logger.debug("[MASSIVE_REST_POLLER] Rate limit hit for %s, skipping cycle", symbol)
                else:
                    logger.debug("[MASSIVE_REST_POLLER] API error %s: %s", r.status_code, r.text)
                    
        except Exception as e:
            logger.warning("[MASSIVE_REST_POLLER] Polling error (%s): %s", symbol, e)
        
        # Poll every 15-20 seconds to provide near-live updates without hitting standard API limits
        await asyncio.sleep(20)

async def _handle_minute_aggregate(symbol: str, msg: dict[str, Any]) -> None:
    """Aggregate 1m Massive bars into 15m candles and broadcast."""
    ts_ms = msg["s"]
    ts_sec = ts_ms // 1000
    
    # 15m alignment
    period = 15 * 60
    candle_ts = (ts_sec // period) * period
    
    if symbol not in _partial_candles:
        _partial_candles[symbol] = {
            "time": candle_ts,
            "open": float(msg["o"]),
            "high": float(msg["h"]),
            "low": float(msg["l"]),
            "close": float(msg["c"]),
            "volume": float(msg["v"]),
            "last_ms": ts_ms
        }
    else:
        curr = _partial_candles[symbol]
        # If new time bucket, finalize and start new
        if candle_ts > curr["time"]:
            # Finalize old candle (is_closed = True)
            final_candle = {
                "time": curr["time"],
                "open": curr["open"],
                "high": curr["high"],
                "low": curr["low"],
                "close": curr["close"],
                "volume": curr["volume"],
                "is_closed": True
            }
            await append_candle(symbol, "15m", final_candle)
            await broadcast_candle(symbol, "15m", final_candle)
            
            # Start new candle
            _partial_candles[symbol] = {
                "time": candle_ts,
                "open": float(msg["o"]),
                "high": float(msg["h"]),
                "low": float(msg["l"]),
                "close": float(msg["c"]),
                "volume": float(msg["v"]),
                "last_ms": ts_ms
            }
        else:
            # Update existing candle (is_closed = False for broadcast)
            curr["high"] = max(curr["high"], float(msg["h"]))
            curr["low"] = min(curr["low"], float(msg["l"]))
            curr["close"] = float(msg["c"])
            curr["volume"] += float(msg["v"])
            curr["last_ms"] = ts_ms
            
            # Send live proposal update
            live_candle = {
                "time": curr["time"],
                "open": curr["open"],
                "high": curr["high"],
                "low": curr["low"],
                "close": curr["close"],
                "volume": curr["volume"],
                "is_closed": False
            }
            await broadcast_candle_proposal(symbol, "15m", live_candle)
