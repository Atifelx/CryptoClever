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
INTERVAL_SECONDS = {
    "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "2h": 7200, "4h": 14400, "6h": 21600, "8h": 28800, "12h": 43200,
    "1d": 86400, "3d": 259200, "1w": 604800,
}


def _interval_seconds(interval: str) -> int:
    """Return interval duration in seconds for gap-fill logic."""
    return INTERVAL_SECONDS.get(normalize_interval(interval), 60)


# Debug pipeline: per-symbol stream state and last N candles from Binance WS
_stream_status: dict[str, dict[str, Any]] = {}  # symbol -> { connected, last_received_at }
RECENT_STREAM_MAX = 20
_recent_stream_candles: deque = deque(maxlen=RECENT_STREAM_MAX)


def get_stream_status() -> dict[str, Any]:
    """Return stream status for /debug/binance-pipeline: per-symbol connected/last_received_at, recent_candles."""
    return {
        "connected": any(s.get("connected") for s in _stream_status.values()),
        "last_received_at": max((s.get("last_received_at") or 0) for s in _stream_status.values()) if _stream_status else 0,
        "per_symbol": dict(_stream_status),
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
    
    # Configure proxy if available
    proxies = {}
    if HTTPS_PROXY:
        proxies["https://"] = HTTPS_PROXY
    elif HTTP_PROXY:
        proxies["https://"] = HTTP_PROXY
    
    try:
        async with httpx.AsyncClient(proxies=proxies if proxies else None, timeout=10.0) as client:
            r = await client.get(url, params=params)
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
    """Bootstrap history for all symbols, 1m interval only."""
    BOOTSTRAP_INTERVAL = "5m"
    logger.info("[BOOTSTRAP_START] Symbols=%s | Interval=%s (5m only)", CRYPTO_SYMBOLS, BOOTSTRAP_INTERVAL)
    tasks = [
        bootstrap_symbol_interval(sym, BOOTSTRAP_INTERVAL)
        for sym in CRYPTO_SYMBOLS
    ]
    await asyncio.gather(*tasks, return_exceptions=True)
    for sym in CRYPTO_SYMBOLS:
        try:
            stored = await get_candles(sym, BOOTSTRAP_INTERVAL, 5)
            last_close = stored[-1].get("close") if stored else "EMPTY"
            logger.info("[BOOTSTRAP_VERIFY] Symbol=%s | Interval=%s | StoredCount=%d | LastClose=%s", sym, BOOTSTRAP_INTERVAL, len(stored), last_close)
        except Exception as e:
            logger.error("[BOOTSTRAP_ERROR] Symbol=%s | Interval=%s | Error=%s", sym, BOOTSTRAP_INTERVAL, e)
    logger.info("[BOOTSTRAP_COMPLETE]")


async def run_binance_ws_for_symbol(symbol: str) -> None:
    """Connect to Binance single-symbol kline stream (no combined stream) and push candles to store/broadcast."""
    WS_INTERVAL = "5m"
    interval = normalize_interval(WS_INTERVAL)
    symbol_norm = normalize_symbol(symbol)
    url = f"{BINANCE_WS_BASE}/ws/{symbol.lower()}@kline_{WS_INTERVAL}"
    logger.info("[BINANCE_WS] Connecting to %s", url)

    msg_count = 0
    last_log_time = time.time()

    while True:
        try:
            _stream_status[symbol_norm] = {"connected": False, "last_received_at": None}
            async with websockets.connect(url, ping_interval=20, ping_timeout=10) as ws:
                _stream_status[symbol_norm]["connected"] = True
                try:
                    logger.info("[BINANCE_WS] Connected for %s (5m)", symbol_norm)
                    async for message in ws:
                        try:
                            now = time.time()
                            if now - last_log_time >= 60:
                                logger.info("Binance stream %s alive: %d updates in last 60s", symbol_norm, msg_count)
                                msg_count = 0
                                last_log_time = now
                            msg = json.loads(message)
                            # Single-stream format: kline at msg["k"] (no "stream", no "data" wrapper)
                            k = msg.get("k")
                            if not k:
                                logger.error("[BINANCE_NO_KLINE] %s: missing k in message", symbol_norm)
                                continue
                            candle = _kline_to_candle(k)
                            _stream_status[symbol_norm]["last_received_at"] = now
                            _recent_stream_candles.append({
                                "symbol": symbol_norm,
                                "interval": interval,
                                "time": candle.get("time"),
                                "received_at": now,
                                "candle": candle,
                            })
                            # Gap-fill: ensure store is continuous before appending
                            try:
                                data = await get_candles(symbol_norm, interval, limit=1000)
                                if not data:
                                    await bootstrap_symbol_interval(symbol_norm, interval)
                                    data = await get_candles(symbol_norm, interval, limit=1000)
                                if data:
                                    last_ts = int(data[-1].get("time", 0))
                                    new_ts = int(candle.get("time", 0))
                                    interval_sec = _interval_seconds(interval)
                                    if new_ts > last_ts + interval_sec:
                                        start_sec = last_ts + interval_sec
                                        end_sec = new_ts - interval_sec
                                        if end_sec >= start_sec:
                                            gap_candles = await fetch_klines_range(symbol_norm, interval, start_sec, end_sec)
                                            for c in gap_candles:
                                                await append_candle(symbol_norm, interval, c)
                            except Exception as sync_err:
                                logger.warning("Gap-fill for %s %s failed (appending anyway): %s", symbol_norm, interval, sync_err)
                            await append_candle(symbol_norm, interval, candle)
                            await broadcast_candle(symbol_norm, interval, candle)
                            await broadcast_candle_proposal(symbol_norm, interval, candle)
                            msg_count += 1
                        except json.JSONDecodeError as e:
                            logger.error("[BINANCE_JSON_ERROR] %s: %s", symbol_norm, e, exc_info=True)
                        except KeyError as e:
                            logger.error("[BINANCE_KEY_ERROR] %s: missing key %s", symbol_norm, e, exc_info=True)
                        except Exception as e:
                            logger.error("[BINANCE_PARSE_ERROR] %s: %s", symbol_norm, e, exc_info=True)
                            import traceback
                            traceback.print_exc()
                finally:
                    _stream_status[symbol_norm]["connected"] = False
        except asyncio.CancelledError:
            if symbol_norm in _stream_status:
                _stream_status[symbol_norm]["connected"] = False
            break
        except Exception as e:
            if symbol_norm in _stream_status:
                _stream_status[symbol_norm]["connected"] = False
            logger.warning("Binance WS %s error: %s; reconnecting in 5s", symbol_norm, e)
            await asyncio.sleep(5)
