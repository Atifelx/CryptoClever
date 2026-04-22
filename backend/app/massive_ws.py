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
    # Polygon/Massive format: /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}
    # For 1000 15m candles, we need ~15 days of data.
    end_date = datetime.now()
    start_date = end_date - timedelta(days=20)
    
    from_str = start_date.strftime("%Y-%m-%d")
    to_str = end_date.strftime("%Y-%m-%d")
    
    url = f"{MASSIVE_REST_BASE}/v2/aggs/ticker/{symbol}/range/15/minute/{from_str}/{to_str}"
    params = {"apiKey": MASSIVE_API_KEY, "limit": 1000, "adjusted": "true"}
    
    logger.info("[MASSIVE_BOOTSTRAP] Fetching %s history from %s to %s", symbol, from_str, to_str)
    
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, params=params, timeout=20.0)
            r.raise_for_status()
            data = r.json()
            results = data.get("results", [])
    except Exception as e:
        logger.warning("[MASSIVE_BOOTSTRAP] %s failed: %s", symbol, e)
        return

    candles = []
    for res in results:
        candles.append({
            "time": int(res["t"]) // 1000,
            "open": float(res["o"]),
            "high": float(res["h"]),
            "low": float(res["l"]),
            "close": float(res["c"]),
            "volume": float(res["v"]),
        })
    
    if candles:
        await set_candles(symbol, "15m", candles)
        logger.info("[MASSIVE_BOOTSTRAP] %s: %d candles loaded", symbol, len(candles))
    else:
        logger.warning("[MASSIVE_BOOTSTRAP] %s: No candles found in range", symbol)

async def bootstrap_all_forex() -> None:
    """Bootstrap history for all Forex symbols."""
    if not MASSIVE_API_KEY:
        logger.warning("[MASSIVE_BOOTSTRAP] No API key found. Skipping.")
        return
    logger.info("[MASSIVE_BOOTSTRAP] Starting for %s", FOREX_SYMBOLS)
    tasks = [bootstrap_forex_symbol(sym) for sym in FOREX_SYMBOLS]
    await asyncio.gather(*tasks, return_exceptions=True)

async def run_massive_ws_for_symbol(symbol: str) -> None:
    """Connect to Massive Forex WebSocket, authenticate, and stream 15m aggregates."""
    if not MASSIVE_API_KEY:
        logger.error("[MASSIVE_WS] No API key for %s", symbol)
        return

    url = MASSIVE_WS_BASE 
    logger.info("[MASSIVE_WS] Connecting to %s for %s", url, symbol)

    while True:
        try:
            async with websockets.connect(url, ping_interval=20, ping_timeout=10) as ws:
                # 1. Authenticate
                auth_msg = {"action": "auth", "params": MASSIVE_API_KEY}
                await ws.send(json.dumps(auth_msg))
                
                # 2. Wait for auth success
                resp = await ws.recv()
                auth_resp = json.loads(resp)
                if isinstance(auth_resp, list): auth_resp = auth_resp[0]
                
                if auth_resp.get("status") != "auth_success":
                    logger.error("[MASSIVE_WS] Auth failed for %s: %s", symbol, auth_resp)
                    await asyncio.sleep(10)
                    continue
                
                logger.info("[MASSIVE_WS] Auth success for %s", symbol)
                
                # 3. Subscribe to 1m aggregates (we will aggregate to 15m)
                # Format: AM.C:EURUSD
                sub_msg = {"action": "subscribe", "params": f"AM.{symbol}"}
                await ws.send(json.dumps(sub_msg))
                
                # 4. Stream data
                async for message in ws:
                    try:
                        data_list = json.loads(message)
                        if not isinstance(data_list, list): data_list = [data_list]
                        
                        for msg in data_list:
                            if msg.get("ev") == "AM":
                                await _handle_minute_aggregate(symbol, msg)
                            elif msg.get("ev") == "status":
                                logger.info("[MASSIVE_WS] Status (%s): %s", symbol, msg.get("message"))
                    except Exception as e:
                        logger.error("[MASSIVE_WS] Parse error (%s): %s", symbol, e)
        except Exception as e:
            logger.warning("[MASSIVE_WS] Connection error (%s): %s; reconnecting...", symbol, e)
            await asyncio.sleep(5)

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
