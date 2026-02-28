import json
import logging
import time
from typing import Any, Optional

import redis.asyncio as aioredis

from app.config import BUFFER_SIZE, REDIS_URL, USE_MEMORY_STORE
from app.utils import build_candle_key, normalize_interval, normalize_symbol

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
    return build_candle_key(symbol, interval)


async def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


async def get_candles(symbol: str, interval: str, limit: int = 500) -> list[dict[str, Any]]:
    """Read candles from Redis; return last `limit` candles. Always returns a copy to avoid shared references."""
    key = build_candle_key(symbol, interval)
    if USE_MEMORY_STORE:
        data = _memory_store.get(key)
        if data is None:
            logger.info("[GET_CANDLES] Key='%s' | Symbol='%s' | Interval='%s' | Count=0 | LastClose=EMPTY", key, symbol, interval)
            return []
        if len(data) > limit:
            result = list(data[-limit:])
        else:
            result = list(data)
        last_close = result[-1].get("close") if result else "EMPTY"
        logger.info("[GET_CANDLES] Key='%s' | Symbol='%s' | Interval='%s' | Count=%d | LastClose=%s", key, symbol, interval, len(result), last_close)
        return result
    try:
        r = await get_redis()
        raw = await r.get(key)
        if not raw:
            logger.info("[GET_CANDLES] Key='%s' | Symbol='%s' | Interval='%s' | Count=0 | LastClose=EMPTY", key, symbol, interval)
            return []
        data = json.loads(raw)
        if not isinstance(data, list):
            logger.info("[GET_CANDLES] Key='%s' | Symbol='%s' | Interval='%s' | Count=0 | LastClose=EMPTY", key, symbol, interval)
            return []
        if len(data) > limit:
            result = list(data[-limit:])
        else:
            result = list(data)
        last_close = result[-1].get("close") if result else "EMPTY"
        logger.info("[GET_CANDLES] Key='%s' | Symbol='%s' | Interval='%s' | Count=%d | LastClose=%s", key, symbol, interval, len(result), last_close)
        return result
    except Exception as e:
        logger.warning("Redis get_candles error: %s", e)
        return []


async def append_candle(symbol: str, interval: str, candle: dict[str, Any]) -> None:
    """Append or update one candle; keep buffer at most BUFFER_SIZE (FIFO)."""
    global _last_append_time
    key = build_candle_key(symbol, interval)
    if USE_MEMORY_STORE:
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
    key = build_candle_key(symbol, interval)
    last_close = candles[-1].get("close") if candles else "EMPTY"
    logger.info("[SET_CANDLES] Key='%s' | Symbol='%s' | Interval='%s' | Count=%d | LastClose=%s", key, symbol, interval, len(candles), last_close)
    if USE_MEMORY_STORE:
        _memory_store[key] = candles[-BUFFER_SIZE:] if len(candles) > BUFFER_SIZE else list(candles)
        return
    try:
        r = await get_redis()
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


async def get_store_keys_info() -> dict[str, dict[str, Any]]:
    """Return for each candles:* key: count, first_time, last_time. Used by /debug/store-keys."""
    result: dict[str, dict[str, Any]] = {}
    if USE_MEMORY_STORE:
        for key in _memory_store:
            if not key.startswith("candles:"):
                continue
            data = _memory_store.get(key) or []
            result[key] = {
                "count": len(data),
                "first_time": data[0].get("time") if data else None,
                "last_time": data[-1].get("time") if data else None,
            }
        return result
    try:
        r = await get_redis()
        keys = await r.keys("candles:*")
        for key in keys:
            raw = await r.get(key)
            data = json.loads(raw) if raw else []
            if not isinstance(data, list):
                data = []
            result[key] = {
                "count": len(data),
                "first_time": data[0].get("time") if data else None,
                "last_time": data[-1].get("time") if data else None,
            }
        return result
    except Exception as e:
        logger.warning("get_store_keys_info error: %s", e)
        return {}


async def get_signals(symbol: str, interval: str) -> Optional[dict[str, Any]]:
    if USE_MEMORY_STORE:
        key = f"{SIGNALS_KEY_PREFIX}{normalize_symbol(symbol)}:{normalize_interval(interval)}"
        entry = _memory_signals.get(key)
        if entry and entry[1] > time.time():
            return entry[0]
        return None
    try:
        r = await get_redis()
        key = f"{SIGNALS_KEY_PREFIX}{normalize_symbol(symbol)}:{normalize_interval(interval)}"
        raw = await r.get(key)
        if not raw:
            return None
        return json.loads(raw)
    except Exception as e:
        logger.warning("Redis get_signals error: %s", e)
        return None


async def set_signals(symbol: str, interval: str, data: dict[str, Any]) -> None:
    if USE_MEMORY_STORE:
        key = f"{SIGNALS_KEY_PREFIX}{normalize_symbol(symbol)}:{normalize_interval(interval)}"
        _memory_signals[key] = (data, time.time() + SIGNALS_TTL)
        return
    try:
        r = await get_redis()
        key = f"{SIGNALS_KEY_PREFIX}{normalize_symbol(symbol)}:{normalize_interval(interval)}"
        await r.setex(key, SIGNALS_TTL, json.dumps(data))
    except Exception as e:
        logger.warning("Redis set_signals error: %s", e)
