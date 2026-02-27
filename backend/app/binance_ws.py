import asyncio
import json
import logging
import time
from typing import Any, Callable

import httpx
import websockets

from app.config import (
    BINANCE_REST_BASE,
    BINANCE_WS_BASE,
    INTERVALS,
    SYMBOLS,
)
from app.redis_store import append_candle, set_candles
from app.ws_broadcast import broadcast_candle

logger = logging.getLogger(__name__)


def _kline_to_candle(k: dict[str, Any]) -> dict[str, Any]:
    """Convert Binance kline payload to our candle format."""
    return {
        "time": k["t"] // 1000,
        "open": float(k["o"]),
        "high": float(k["h"]),
        "low": float(k["l"]),
        "close": float(k["c"]),
        "volume": float(k["v"]),
    }


async def bootstrap_symbol_interval(symbol: str, interval: str) -> None:
    """Fetch last BUFFER_SIZE klines from Binance REST and write to Redis."""
    url = f"{BINANCE_REST_BASE}/klines"
    params = {"symbol": symbol, "interval": interval, "limit": 1000}
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, params=params, timeout=10.0)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        logger.warning("Bootstrap %s %s failed: %s", symbol, interval, e)
        return
    candles = []
    for k in data:
        candles.append({
            "time": k[0] // 1000,
            "open": float(k[1]),
            "high": float(k[2]),
            "low": float(k[3]),
            "close": float(k[4]),
            "volume": float(k[5]),
        })
    await set_candles(symbol, interval, candles)
    logger.info("Bootstrapped %s %s: %d candles", symbol, interval, len(candles))


async def fetch_klines_range(
    symbol: str, interval: str, start_time_sec: int, end_time_sec: int
) -> list[dict[str, Any]]:
    """Fetch klines from Binance REST for a time range (inclusive). Returns candles in store format (time in seconds)."""
    url = f"{BINANCE_REST_BASE}/klines"
    params = {
        "symbol": symbol,
        "interval": interval,
        "startTime": start_time_sec * 1000,
        "endTime": end_time_sec * 1000,
        "limit": 1000,
    }
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, params=params, timeout=10.0)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        logger.warning("Fetch klines range %s %s [%s..%s] failed: %s", symbol, interval, start_time_sec, end_time_sec, e)
        return []
    candles = []
    for k in data:
        candles.append({
            "time": k[0] // 1000,
            "open": float(k[1]),
            "high": float(k[2]),
            "low": float(k[3]),
            "close": float(k[4]),
            "volume": float(k[5]),
        })
    return candles


async def bootstrap_all() -> None:
    """Bootstrap all symbol/interval combinations."""
    tasks = [
        bootstrap_symbol_interval(sym, iv)
        for sym in SYMBOLS
        for iv in INTERVALS
    ]
    await asyncio.gather(*tasks, return_exceptions=True)
    logger.info("Bootstrapped %d symbols x %d intervals", len(SYMBOLS), len(INTERVALS))


def _build_streams() -> str:
    # Combined stream: stream1/stream2/stream3
    parts = []
    for sym in SYMBOLS:
        s = sym.lower()
        for iv in INTERVALS:
            parts.append(f"{s}@kline_{iv}")
    return "/".join(parts)


async def run_binance_ws() -> None:
    """Connect to Binance combined kline stream and push candles to Redis."""
    streams = _build_streams()
    url = f"{BINANCE_WS_BASE}/stream?streams={streams}"
    logger.info("Connecting to Binance: %s", url[:80] + "...")

    msg_count = 0
    last_log_time = time.time()

    while True:
        try:
            async with websockets.connect(url, ping_interval=20, ping_timeout=10) as ws:
                async for message in ws:
                    try:
                        now = time.time()
                        if now - last_log_time >= 60:
                            logger.info("Binance stream alive: %d updates in last 60s", msg_count)
                            msg_count = 0
                            last_log_time = now
                        msg = json.loads(message)
                        stream = msg.get("stream", "")
                        if "@" not in stream:
                            continue
                        symbol_raw, kline_part = stream.rsplit("@", 1)
                        symbol = symbol_raw.upper()
                        # kline_1m -> 1m
                        interval = kline_part.replace("kline_", "") if kline_part.startswith("kline_") else kline_part
                        k = msg.get("k")
                        if not k:
                            continue
                        candle = _kline_to_candle(k)
                        await append_candle(symbol, interval, candle)
                        await broadcast_candle(symbol, interval, candle)
                        msg_count += 1
                    except Exception as e:
                        logger.debug("Parse error: %s", e)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning("Binance WS error: %s; reconnecting in 5s", e)
            await asyncio.sleep(5)
