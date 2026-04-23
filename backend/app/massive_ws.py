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
    
    # Use limit=50000 to fetch ALL candles in ONE request, avoiding the 429 pagination loop.
    url = f"{MASSIVE_REST_BASE}/v2/aggs/ticker/{symbol}/range/15/minute/{from_str}/{to_str}"
    params = {"apiKey": MASSIVE_API_KEY, "limit": 50000, "adjusted": "true", "sort": "desc"}
    
    logger.info("[MASSIVE_BOOTSTRAP] Fetching %s history from %s", symbol, from_str)
    all_results = []
    
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, params=params, timeout=20.0)
            if r.status_code == 429:
                logger.warning("[MASSIVE_BOOTSTRAP] Rate limit (429) for %s. Backend may be rate limited.", symbol)
                return
            r.raise_for_status()
            data = r.json()
            all_results = data.get("results", [])
    except Exception as e:
        logger.warning("[MASSIVE_BOOTSTRAP] %s failed fetching history: %s", symbol, e)
        return

    # Keep only exactly the most recent 1000 items (they are sorted desc)
    all_results = all_results[:1000]
    # Reverse back to asc (oldest first) so indicators process sequentially
    all_results.reverse()
    
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
            # Fetch latest 15m candle (past 2 days range to be safe over weekends)
            now = datetime.now()
            start = now - timedelta(days=2)
            from_str = start.strftime("%Y-%m-%d")
            to_str = now.strftime("%Y-%m-%d")
            
            url = f"{MASSIVE_REST_BASE}/v2/aggs/ticker/{symbol}/range/15/minute/{from_str}/{to_str}"
            params = {
                "apiKey": MASSIVE_API_KEY, 
                "limit": 1, 
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
                        # Reformat for the aggregation function directly
                        msg = {
                            "time": int(newest["t"]) // 1000,
                            "open": float(newest["o"]),
                            "high": float(newest["h"]),
                            "low": float(newest["l"]),
                            "close": float(newest["c"]),
                            "volume": float(newest["v"]),
                            "is_closed": False # Treat it as the live updating candle
                        }
                        
                        # We bypassed _handle_minute_aggregate since we're pulling 15m directly!
                        # Send live proposal update
                        await broadcast_candle_proposal(symbol, "15m", msg)
                        
                        # Append to store so historical charts include it immediately
                        msg["is_closed"] = True 
                        await append_candle(symbol, "15m", msg)
                        await broadcast_candle(symbol, "15m", msg)
                        
                elif r.status_code == 429:
                    logger.debug("[MASSIVE_REST_POLLER] Rate limit hit for %s, skipping cycle", symbol)
                else:
                    logger.debug("[MASSIVE_REST_POLLER] API error %s: %s", r.status_code, r.text)
                    
        except Exception as e:
            logger.warning("[MASSIVE_REST_POLLER] Polling error (%s): %s", symbol, e)
        
        # Paced at 60 seconds. 3 symbols * 1 req/min = 3 total calls/min. 
        # Safely under the Polygon Free Tier limit of 5.
        await asyncio.sleep(60)

