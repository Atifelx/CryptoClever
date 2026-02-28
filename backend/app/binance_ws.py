import asyncio
import json
import logging
import time
from collections import deque
from typing import Any, Callable

import httpx
import websockets

from app.config import (
    BINANCE_REST_BASE,
    BINANCE_WS_BASE,
    INTERVALS,
    SYMBOLS,
)
from app.redis_store import append_candle, set_candles, get_candles
from app.utils import normalize_interval, normalize_symbol
from app.ws_broadcast import broadcast_candle, broadcast_candle_proposal

logger = logging.getLogger(__name__)

# Interval string to seconds for gap detection
INTERVAL_SECONDS = {
    "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "2h": 7200, "4h": 14400, "6h": 21600, "8h": 28800, "12h": 43200,
    "1d": 86400, "3d": 259200, "1w": 604800,
}


def _interval_seconds(interval: str) -> int:
    """Return interval duration in seconds for gap-fill logic."""
    return INTERVAL_SECONDS.get(normalize_interval(interval), 60)


# Debug pipeline: stream connection state and last N candles from Binance WS
_binance_ws_connected = False
_last_received_at: float = 0.0
RECENT_STREAM_MAX = 20
_recent_stream_candles: deque = deque(maxlen=RECENT_STREAM_MAX)


def get_stream_status() -> dict[str, Any]:
    """Return stream status for /debug/binance-pipeline: connected, last_received_at, recent_candles."""
    return {
        "connected": _binance_ws_connected,
        "last_received_at": _last_received_at,
        "recent_candles": list(_recent_stream_candles),
    }


def _kline_to_candle(k: dict[str, Any]) -> dict[str, Any]:
    """Convert Binance kline payload to our candle format. Handles t as int or string. Includes is_closed from k['x']."""
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
    logger.info("[BOOTSTRAP_START] Symbols=%s | Intervals=%s", SYMBOLS, INTERVALS)
    tasks = [
        bootstrap_symbol_interval(sym, iv)
        for sym in SYMBOLS
        for iv in INTERVALS
    ]
    await asyncio.gather(*tasks, return_exceptions=True)
    for sym in SYMBOLS:
        for iv in INTERVALS:
            try:
                stored = await get_candles(sym, iv, 5)
                last_close = stored[-1].get("close") if stored else "EMPTY"
                logger.info("[BOOTSTRAP_VERIFY] Symbol=%s | Interval=%s | StoredCount=%d | LastClose=%s", sym, iv, len(stored), last_close)
            except Exception as e:
                logger.error("[BOOTSTRAP_ERROR] Symbol=%s | Interval=%s | Error=%s", sym, iv, e)
    logger.info("[BOOTSTRAP_COMPLETE]")


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
    global _binance_ws_connected, _last_received_at
    streams = _build_streams()
    url = f"{BINANCE_WS_BASE}/stream?streams={streams}"
    logger.info("Connecting to Binance: %s", url[:80] + "...")

    msg_count = 0
    last_log_time = time.time()

    while True:
        try:
            async with websockets.connect(url, ping_interval=20, ping_timeout=10) as ws:
                _binance_ws_connected = True
                try:
                    logger.info("[BINANCE_COMBINED] Connected to %d streams", len(SYMBOLS) * len(INTERVALS))
                    async for message in ws:
                        stream = ""
                        try:
                            now = time.time()
                            if now - last_log_time >= 60:
                                logger.info("Binance stream alive: %d updates in last 60s", msg_count)
                                msg_count = 0
                                last_log_time = now
                            msg = json.loads(message)
                            if "stream" not in msg:
                                continue
                            stream = msg.get("stream", "")
                            logger.info("[BINANCE_RAW] Stream='%s'", stream)
                            if "@kline_" not in stream:
                                logger.warning("[BINANCE_SKIP] Unknown stream format: %s", stream)
                                continue
                            parts = stream.split("@kline_", 1)
                            if len(parts) != 2:
                                logger.error("[BINANCE_PARSE_FAIL] Cannot split stream: %s", stream)
                                continue
                            symbol_raw = parts[0]
                            interval_raw = parts[1]
                            symbol = normalize_symbol(symbol_raw)
                            interval = normalize_interval(interval_raw)
                            # Combined stream: kline is under msg["data"]["k"]; single stream uses msg["k"]
                            k = (msg.get("data") or {}).get("k") or msg.get("k")
                            if not k:
                                logger.error("[BINANCE_NO_KLINE] Missing data.k in message for stream=%s", stream)
                                continue
                            candle = _kline_to_candle(k)
                            logger.info("[BINANCE_PARSED] RawSymbol='%s' | NormSymbol='%s' | RawInterval='%s' | NormInterval='%s' | Time=%s | Close=%s", symbol_raw, symbol, interval_raw, interval, candle.get("time"), candle.get("close"))
                            _last_received_at = time.time()
                            _recent_stream_candles.append({
                                "symbol": symbol,
                                "interval": interval,
                                "time": candle.get("time"),
                                "received_at": _last_received_at,
                                "candle": candle,
                            })
                            # Gap-fill: ensure store is continuous before appending (bootstrap if empty, fill gaps from REST)
                            try:
                                data = await get_candles(symbol, interval, limit=1000)
                                if not data:
                                    await bootstrap_symbol_interval(symbol, interval)
                                    data = await get_candles(symbol, interval, limit=1000)
                                if data:
                                    last_ts = int(data[-1].get("time", 0))
                                    new_ts = int(candle.get("time", 0))
                                    interval_sec = _interval_seconds(interval)
                                    if new_ts > last_ts + interval_sec:
                                        start_sec = last_ts + interval_sec
                                        end_sec = new_ts - interval_sec
                                        if end_sec >= start_sec:
                                            gap_candles = await fetch_klines_range(symbol, interval, start_sec, end_sec)
                                            for c in gap_candles:
                                                await append_candle(symbol, interval, c)
                            except Exception as sync_err:
                                logger.warning("Gap-fill for %s %s failed (appending anyway): %s", symbol, interval, sync_err)
                            await append_candle(symbol, interval, candle)
                            await broadcast_candle(symbol, interval, candle)
                            await broadcast_candle_proposal(symbol, interval, candle)
                            msg_count += 1
                        except json.JSONDecodeError as e:
                            logger.error("[BINANCE_JSON_ERROR] %s", e, exc_info=True)
                        except KeyError as e:
                            logger.error("[BINANCE_KEY_ERROR] Missing key %s in message", e, exc_info=True)
                        except Exception as e:
                            logger.error("[BINANCE_PARSE_ERROR] Stream='%s' | Error=%s", stream, e, exc_info=True)
                            import traceback
                            traceback.print_exc()
                finally:
                    _binance_ws_connected = False
        except asyncio.CancelledError:
            _binance_ws_connected = False
            break
        except Exception as e:
            _binance_ws_connected = False
            logger.warning("Binance WS error: %s; reconnecting in 5s", e)
            await asyncio.sleep(5)
