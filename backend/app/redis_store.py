import json
import logging
import time
from typing import Any, Optional

import redis.asyncio as aioredis

from app.config import BUFFER_SIZE, REDIS_URL, USE_MEMORY_STORE

logger = logging.getLogger(__name__)

_memory_store: dict[str, list] = {}
_memory_signals: dict[str, tuple] = {}

# Wall-clock time when we last appended/updated a candle (from Binance WebSocket). 0 = never.
_last_append_time: float = 0.0


def get_last_append_time() -> float:
    """Return Unix timestamp when a candle was last appended (0 if never). Use to show 'Store updated Xs ago'."""
    return _last_append_time

if USE_MEMORY_STORE:
    _redis = None
else:
    _redis: Optional[aioredis.Redis] = None


def _key(symbol: str, interval: str) -> str:
    return f"candles:{symbol.upper()}:{interval}"


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


async def get_candles(symbol: str, interval: str, limit: int = 500) -> list[dict[str, Any]]:
    """Read candles from Redis; return last `limit` candles. Always returns a copy to avoid shared references."""
    if USE_MEMORY_STORE:
        key = _key(symbol, interval)
        data = _memory_store.get(key)
        if data is None:
            return []
        if len(data) > limit:
            return list(data[-limit:])
        return list(data)
    try:
        r = await get_redis()
        key = _key(symbol, interval)
        raw = await r.get(key)
        if not raw:
            return []
        data = json.loads(raw)
        if not isinstance(data, list):
            return []
        if len(data) > limit:
            return list(data[-limit:])
        return list(data)
    except Exception as e:
        logger.warning("Redis get_candles error: %s", e)
        return []


async def append_candle(symbol: str, interval: str, candle: dict[str, Any]) -> None:
    """Append or update one candle; keep buffer at most BUFFER_SIZE (FIFO)."""
    global _last_append_time
    if USE_MEMORY_STORE:
        key = _key(symbol, interval)
        data = _memory_store.get(key)
        if data is None:
            data = []
        else:
            data = list(data)
        t = candle.get("time")
        if isinstance(t, float):
            t = int(t)
        found = False
        for i, c in enumerate(data):
            ct = c.get("time")
            if isinstance(ct, float):
                ct = int(ct)
            if ct == t:
                data[i] = candle
                found = True
                break
        if not found:
            data.append(candle)
            data.sort(key=lambda x: x.get("time", 0))
            if len(data) > BUFFER_SIZE:
                data = data[-BUFFER_SIZE:]
        _memory_store[key] = data
        _last_append_time = time.time()
        return
    try:
        r = await get_redis()
        key = _key(symbol, interval)
        raw = await r.get(key)
        data: list[dict] = json.loads(raw) if raw else []

        # Update existing candle with same time or append
        t = candle.get("time")
        if isinstance(t, float):
            t = int(t)
        found = False
        for i, c in enumerate(data):
            ct = c.get("time")
            if isinstance(ct, float):
                ct = int(ct)
            if ct == t:
                data[i] = candle
                found = True
                break
        if not found:
            data.append(candle)
            data.sort(key=lambda x: x.get("time", 0))
            if len(data) > BUFFER_SIZE:
                data = data[-BUFFER_SIZE:]

        await r.set(key, json.dumps(data))
        _last_append_time = time.time()
    except Exception as e:
        logger.warning("Redis append_candle error: %s", e)


async def set_candles(symbol: str, interval: str, candles: list[dict[str, Any]]) -> None:
    """Replace full buffer (e.g. after bootstrap)."""
    if USE_MEMORY_STORE:
        key = _key(symbol, interval)
        _memory_store[key] = candles[-BUFFER_SIZE:] if len(candles) > BUFFER_SIZE else list(candles)
        return
    try:
        r = await get_redis()
        key = _key(symbol, interval)
        if len(candles) > BUFFER_SIZE:
            candles = candles[-BUFFER_SIZE:]
        await r.set(key, json.dumps(candles))
    except Exception as e:
        logger.warning("Redis set_candles error: %s", e)


async def close_redis() -> None:
    global _redis
    if _redis:
        await _redis.close()
        _redis = None


SIGNALS_KEY_PREFIX = "indicators:"
SIGNALS_TTL = 60


async def get_signals(symbol: str, interval: str) -> Optional[dict[str, Any]]:
    if USE_MEMORY_STORE:
        key = f"{SIGNALS_KEY_PREFIX}{symbol.upper()}:{interval}"
        entry = _memory_signals.get(key)
        if entry and entry[1] > time.time():
            return entry[0]
        return None
    try:
        r = await get_redis()
        key = f"{SIGNALS_KEY_PREFIX}{symbol.upper()}:{interval}"
        raw = await r.get(key)
        if not raw:
            return None
        return json.loads(raw)
    except Exception as e:
        logger.warning("Redis get_signals error: %s", e)
        return None


async def set_signals(symbol: str, interval: str, data: dict[str, Any]) -> None:
    if USE_MEMORY_STORE:
        key = f"{SIGNALS_KEY_PREFIX}{symbol.upper()}:{interval}"
        _memory_signals[key] = (data, time.time() + SIGNALS_TTL)
        return
    try:
        r = await get_redis()
        key = f"{SIGNALS_KEY_PREFIX}{symbol.upper()}:{interval}"
        await r.setex(key, SIGNALS_TTL, json.dumps(data))
    except Exception as e:
        logger.warning("Redis set_signals error: %s", e)
