import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
import websockets

from app.config import FOREX_SYMBOLS, TWELVEDATA_API_KEY, TWELVEDATA_REST_BASE
from app.redis_store import append_candle, get_candles, set_candles
from app.ws_broadcast import broadcast_candle, broadcast_candle_proposal

logger = logging.getLogger(__name__)

_TWELVEDATA_SYMBOL_MAP = {
    "C:XAUUSD": "XAU/USD",
}

# In-memory storage for building candles: { symbol: { "1m": candle, "5m": candle } }
_current_candles: dict[str, dict[str, Any]] = {}

def _provider_symbol(symbol: str) -> str:
    return _TWELVEDATA_SYMBOL_MAP.get(symbol, symbol)

def _parse_twelvedata_time(value: str) -> int:
    try:
        dt = datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return int(time.time())

async def _fetch_twelvedata_series(symbol: str, interval: str, outputsize: int) -> list[dict[str, Any]]:
    if not TWELVEDATA_API_KEY: return []
    params = {
        "symbol": _provider_symbol(symbol),
        "interval": "1min" if interval == "1m" else "5min",
        "timezone": "UTC",
        "apikey": TWELVEDATA_API_KEY,
        "outputsize": outputsize
    }
    async with httpx.AsyncClient() as client:
        try:
            r = await client.get(f"{TWELVEDATA_REST_BASE}/time_series", params=params, timeout=20.0)
            r.raise_for_status()
            data = r.json()
            if data.get("status") == "error": return []
            values = data.get("values", [])
            return list(values) if isinstance(values, list) else []
        except Exception:
            return []

def _rows_to_candles(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candles: list[dict[str, Any]] = []
    for row in reversed(rows):
        try:
            o = float(row["open"])
            h = float(row["high"])
            l = float(row["low"])
            c = float(row["close"])
            
            # SANITIZATION: Skip garbage candles with 0 or negative prices
            if o <= 0 or h <= 0 or l <= 0 or c <= 0:
                continue
                
            candles.append({
                "time": _parse_twelvedata_time(row["datetime"]),
                "open": o,
                "high": h,
                "low": l,
                "close": c,
                "volume": float(row.get("volume") or 0),
                "is_closed": True,
            })
        except (ValueError, KeyError):
            continue
    return candles

async def bootstrap_forex_symbol(symbol: str) -> None:
    logger.info("[TWELVEDATA_BOOTSTRAP] Fetching %s history (1m & 5m)", symbol)
    for interval in ["1m", "5m"]:
        rows = await _fetch_twelvedata_series(symbol, interval, 2000)
        if rows:
            candles = _rows_to_candles(rows)
            await set_candles(symbol, interval, candles)
            logger.info("[TWELVEDATA_BOOTSTRAP] %s %s: Loaded %d candles", symbol, interval, len(candles))

async def bootstrap_all_forex() -> None:
    if not TWELVEDATA_API_KEY: return
    for sym in FOREX_SYMBOLS:
        await bootstrap_forex_symbol(sym)
        await asyncio.sleep(1)

async def run_twelvedata_ws() -> None:
    if not TWELVEDATA_API_KEY: return
    url = f"wss://ws.twelvedata.com/v1/quotes/price?apikey={TWELVEDATA_API_KEY}"
    logger.info("[TWELVEDATA_WS] Connecting to %s", url)

    while True:
        try:
            async with websockets.connect(url, ping_interval=20, ping_timeout=10) as ws:
                async def heartbeat():
                    while True:
                        try:
                            await ws.send(json.dumps({"action": "heartbeat"}))
                            await asyncio.sleep(10)
                        except:
                            break

                # Subscribe to all forex symbols
                symbols_to_sub = [_provider_symbol(s) for s in FOREX_SYMBOLS]
                await ws.send(json.dumps({"action": "subscribe", "params": {"symbols": ",".join(symbols_to_sub)}}))
                logger.info("[TWELVEDATA_WS] Subscribed to %s", symbols_to_sub)

                # Run listener and heartbeat
                heartbeat_task = asyncio.create_task(heartbeat())
                try:
                    async for message in ws:
                        data = json.loads(message)
                        if data.get("event") == "price":
                            symbol_prov = data.get("symbol")
                            price = float(data.get("price"))
                            ts = int(data.get("timestamp"))
                            
                            # Normalize timestamp: TwelveData can send ms or seconds
                            # If > 10^11, it's almost certainly milliseconds (as of year 2024+)
                            if ts > 10**11:
                                ts = ts // 2000
                            
                            symbol = next((k for k, v in _TWELVEDATA_SYMBOL_MAP.items() if v == symbol_prov), symbol_prov)
                            
                            if symbol not in _current_candles: _current_candles[symbol] = {}
                            
                            for interval in ["1m", "5m"]:
                                period = 60 if interval == "1m" else 300
                                candle_time = (ts // period) * period
                                current = _current_candles[symbol].get(interval)
                                
                                # DETECT NEW CANDLE START
                                if current and current["time"] != candle_time:
                                    # CLOSE OLD CANDLE
                                    current["is_closed"] = True
                                    await append_candle(symbol, interval, current)
                                    await broadcast_candle(symbol, interval, current)
                                    current = None
                                
                                if not current:
                                    # INITIALIZE NEW CANDLE with continuity
                                    prev_candles = await get_candles(symbol, interval)
                                    base_open = price
                                    if prev_candles:
                                        base_open = prev_candles[-1]["close"]
                                    
                                    current = {
                                        "time": candle_time, 
                                        "open": base_open, 
                                        "high": max(base_open, price), 
                                        "low": min(base_open, price), 
                                        "close": price, 
                                        "volume": 0, 
                                        "is_closed": False
                                    }
                                else:
                                    # UPDATE HIGH/LOW only if current tick is valid
                                    current["high"] = max(current["high"], price)
                                    current["low"] = min(current["low"], price)
                                    current["close"] = price
                                
                                _current_candles[symbol][interval] = current
                                
                                # BROADCAST PROPOSAL (The 'Forming' Candle)
                                # We only send this if it's NOT flat, to avoid indicator noise
                                if current["high"] > current["low"]:
                                    await broadcast_candle_proposal(symbol, interval, current)
                                
                                # TICK REPAIR: Trigger official sync for the just-closed candle
                                if current["is_closed"] == False and not current.get("_synced"):
                                    async def sync_prev(s, iv, ct):
                                        await asyncio.sleep(3) # Wait for REST to settle
                                        rows = await _fetch_twelvedata_series(s, iv, 5)
                                        if rows:
                                            oc = _rows_to_candles(rows)
                                            for c in oc:
                                                if c["time"] < ct:
                                                    await append_candle(s, iv, c)
                                                    await broadcast_candle(s, iv, c)
                                    asyncio.create_task(sync_prev(symbol, interval, candle_time))
                                    current["_synced"] = True
                        elif data.get("event") == "heartbeat":
                            pass # logger.debug("[TWELVEDATA_WS] Heartbeat OK")
                        elif data.get("event") == "error":
                            logger.error("[TWELVEDATA_WS] Error: %s", data.get("message"))
                finally:
                    heartbeat_task.cancel()
        except Exception as e:
            logger.warning("[TWELVEDATA_WS] Error: %s; reconnecting in 5s", e)
            await asyncio.sleep(5)
