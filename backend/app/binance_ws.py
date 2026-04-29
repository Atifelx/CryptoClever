import asyncio
import json
import logging
import time
from collections import deque
from typing import Any

import httpx
import websockets

from app.config import (
    BINANCE_REST_BASE,
    BINANCE_WS_BASE,
    CRYPTO_SYMBOLS,
    HTTP_PROXY,
    HTTPS_PROXY,
)
from app.redis_store import append_candle, set_candles, get_candles
from app.utils import normalize_interval, normalize_symbol
from app.ws_broadcast import broadcast_candle, broadcast_candle_proposal

logger = logging.getLogger(__name__)

# Interval string to seconds for gap detection
_INTERVAL_SECONDS = {
    "1m": 60, "5m": 300
}

def _interval_seconds(interval: str) -> int:
    return _INTERVAL_SECONDS.get(normalize_interval(interval), 60)

_stream_status: dict[str, dict[str, Any]] = {}  # symbol_interval -> { connected, last_received_at }
_recent_stream_candles: deque = deque(maxlen=20)

def get_stream_status() -> dict[str, Any]:
    return {
        "connected": any(s.get("connected") for s in _stream_status.values()),
        "last_received_at": max((s.get("last_received_at") or 0) for s in _stream_status.values()) if _stream_status else 0,
        "per_stream": dict(_stream_status),
        "recent_candles": list(_recent_stream_candles),
    }

def _kline_to_candle(k: dict[str, Any]) -> dict[str, Any]:
    return {
        "time": int(k["t"]) // 1000,
        "open": float(k["o"]),
        "high": float(k["h"]),
        "low": float(k["l"]),
        "close": float(k["c"]),
        "volume": float(k["v"]),
        "is_closed": bool(k.get("x", False)),
    }

async def bootstrap_symbol_interval(symbol: str, interval: str) -> None:
    url = f"{BINANCE_REST_BASE}/klines"
    
    # Binance limit is 1000 per request. To get 2000, we fetch twice.
    all_raw = []
    try:
        async with httpx.AsyncClient() as client:
            # 1. Fetch most recent 1000
            r1 = await client.get(url, params={"symbol": symbol, "interval": interval, "limit": 1000}, timeout=10.0)
            r1.raise_for_status()
            batch1 = r1.json()
            if batch1:
                all_raw = batch1
                # 2. Fetch older 1000 using the first candle's timestamp as endTime
                first_ts = batch1[0][0]
                r2 = await client.get(url, params={"symbol": symbol, "interval": interval, "limit": 1000, "endTime": first_ts - 1}, timeout=10.0)
                r2.raise_for_status()
                batch2 = r2.json()
                if batch2:
                    all_raw = batch2 + all_raw # Join older + newer
            
            if not all_raw:
                logger.warning("[BINANCE_BOOTSTRAP] No candles fetched for %s %s", symbol, interval)
                return

            candles = []
            for k in all_raw:
                candles.append({
                    "time": k[0] // 1000,
                    "open": float(k[1]),
                    "high": float(k[2]),
                    "low": float(k[3]),
                    "close": float(k[4]),
                    "volume": float(k[5]),
                    "is_closed": True,
                })
            
            await set_candles(symbol, interval, candles)
            logger.info("[BINANCE_BOOTSTRAP] %s %s: loaded=%d", symbol, interval, len(candles))
            
    except Exception as e:
        logger.error("[BINANCE_BOOTSTRAP] Error for %s %s: %s", symbol, interval, e)

async def bootstrap_all() -> None:
    logger.info("[BOOTSTRAP_START] Binance Symbols=%s | Intervals=[1m, 5m]", CRYPTO_SYMBOLS)
    tasks = []
    for sym in CRYPTO_SYMBOLS:
        tasks.append(bootstrap_symbol_interval(sym, "1m"))
        tasks.append(bootstrap_symbol_interval(sym, "5m"))
    await asyncio.gather(*tasks, return_exceptions=True)
    logger.info("[BOOTSTRAP_COMPLETE] Binance")

async def run_binance_combined_ws() -> None:
    """Connect to Binance combined stream for all symbols and intervals (1m, 5m)."""
    streams = []
    for sym in CRYPTO_SYMBOLS:
        streams.append(f"{sym.lower()}@kline_1m")
        streams.append(f"{sym.lower()}@kline_5m")
    
    url = f"{BINANCE_WS_BASE}/stream?streams={'/'.join(streams)}"
    logger.info("[BINANCE_WS] Connecting to %s", url)

    while True:
        try:
            async with websockets.connect(url, ping_interval=20, ping_timeout=10) as ws:
                logger.info("[BINANCE_WS] Connected to combined stream")
                async for message in ws:
                    msg = json.loads(message)
                    stream_name = msg.get("stream")
                    data = msg.get("data")
                    if not data: continue
                    
                    k = data.get("k")
                    if not k: continue
                    
                    symbol = normalize_symbol(data.get("s", ""))
                    interval = normalize_interval(k.get("i", ""))
                    candle = _kline_to_candle(k)
                    
                    key = f"{symbol}_{interval}"
                    _stream_status[key] = {"connected": True, "last_received_at": time.time()}
                    
                    await append_candle(symbol, interval, candle)
                    await broadcast_candle(symbol, interval, candle)
                    await broadcast_candle_proposal(symbol, interval, candle)
                    
                    if len(_recent_stream_candles) > 20: _recent_stream_candles.popleft()
                    _recent_stream_candles.append({"symbol": symbol, "interval": interval, "time": candle["time"]})

        except Exception as e:
            logger.warning("[BINANCE_WS] Error: %s; reconnecting in 5s", e)
            await asyncio.sleep(5)
