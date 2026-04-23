import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any

import httpx

from app.config import (
    MASSIVE_API_KEY,
    MASSIVE_REST_BASE,
    FOREX_SYMBOLS,
)
from app.redis_store import append_candle, set_candles, get_candles
from app.ws_broadcast import broadcast_candle, broadcast_candle_proposal

logger = logging.getLogger(__name__)

# Track partial 15m candle per symbol for aggregation
# symbol -> { "time": ts, "open": o, "high": h, "low": l, "close": c, "volume": v, "count": n }
_partial_candles: dict[str, dict[str, Any]] = {}

_HISTORICAL_TARGET_BARS = 720
_BOOTSTRAP_LOOKBACK_DAYS = 16
_BOOTSTRAP_RETRIES = 4
_BOOTSTRAP_BACKOFF_SECONDS = 12
_POLLER_LOOKBACK_DAYS = 2
_BOOTSTRAP_FETCH_LIMIT = 900
_POLL_BUFFER_SECONDS = 20
_FOREX_INTERVAL = "15m"

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


def _merge_candle_lists(*lists: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge candle lists by timestamp, preferring later lists on collisions."""
    merged: dict[int, dict[str, Any]] = {}
    for candles in lists:
        for candle in candles:
            ts = int(candle.get("time", 0))
            merged[ts] = candle
    return [merged[ts] for ts in sorted(merged.keys())]


async def _fetch_massive_range(
    symbol: str,
    *,
    multiplier: int = 15,
    timespan: str = "minute",
    days: int = _BOOTSTRAP_LOOKBACK_DAYS,
    limit: int = _BOOTSTRAP_FETCH_LIMIT,
    sort: str = "desc",
    retries: int = _BOOTSTRAP_RETRIES,
) -> list[dict[str, Any]]:
    """Fetch aggregate bars with retry/backoff for provider rate limits."""
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    from_str = start_date.strftime("%Y-%m-%d")
    to_str = end_date.strftime("%Y-%m-%d")
    url = f"{MASSIVE_REST_BASE}/v2/aggs/ticker/{symbol}/range/{multiplier}/{timespan}/{from_str}/{to_str}"
    params = {"apiKey": MASSIVE_API_KEY, "limit": limit, "adjusted": "true", "sort": sort}

    async with httpx.AsyncClient() as client:
        for attempt in range(1, retries + 1):
            try:
                r = await client.get(url, params=params, timeout=20.0)
                if r.status_code == 429:
                    if attempt == retries:
                        logger.warning(
                            "[MASSIVE_FETCH] Rate limit (429) for %s after %d attempts",
                            symbol,
                            retries,
                        )
                        return []
                    wait_seconds = _BOOTSTRAP_BACKOFF_SECONDS * attempt
                    logger.warning(
                        "[MASSIVE_FETCH] Rate limit for %s, retrying in %ss (%d/%d)",
                        symbol,
                        wait_seconds,
                        attempt,
                        retries,
                    )
                    await asyncio.sleep(wait_seconds)
                    continue
                r.raise_for_status()
                data = r.json()
                return data.get("results", [])
            except Exception as e:
                if attempt == retries:
                    logger.warning("[MASSIVE_FETCH] %s failed after %d attempts: %s", symbol, retries, e)
                    return []
                wait_seconds = min(5 * attempt, 15)
                logger.warning(
                    "[MASSIVE_FETCH] %s error on attempt %d/%d: %s. Retrying in %ss",
                    symbol,
                    attempt,
                    retries,
                    e,
                    wait_seconds,
                )
                await asyncio.sleep(wait_seconds)
    return []


def _seconds_until_next_15m_close(buffer_seconds: int = _POLL_BUFFER_SECONDS) -> float:
    """Sleep until just after the next 15m bar should be available."""
    now = datetime.utcnow()
    next_minute = ((now.minute // 15) + 1) * 15
    if next_minute >= 60:
        next_bar = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    else:
        next_bar = now.replace(minute=next_minute, second=0, microsecond=0)
    wake_at = next_bar + timedelta(seconds=buffer_seconds)
    return max((wake_at - now).total_seconds(), 5.0)

async def bootstrap_forex_symbol(symbol: str) -> None:
    """Fetch last 1000 15m aggregates from Massive REST and write to Redis."""
    logger.info("[MASSIVE_BOOTSTRAP] Fetching %s history", symbol)
    all_results = await _fetch_massive_range(symbol)
    if not all_results:
        logger.warning("[MASSIVE_BOOTSTRAP] %s: No historical candles fetched", symbol)
        return

    # Keep only the most recent bars the chart actually needs.
    all_results = all_results[:_HISTORICAL_TARGET_BARS]
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
        existing = await get_candles(symbol, _FOREX_INTERVAL, limit=1000)
        merged = _merge_candle_lists(existing, candles)
        if len(merged) > 1000:
            merged = merged[-1000:]
        await set_candles(symbol, _FOREX_INTERVAL, merged)
        logger.info(
            "[MASSIVE_BOOTSTRAP] %s: loaded=%d merged_total=%d",
            symbol,
            len(candles),
            len(merged),
        )
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
            # If startup bootstrap was rate limited, recover lazily on the first successful poll.
            existing = await get_candles(symbol, _FOREX_INTERVAL, limit=1000)
            if not existing:
                await bootstrap_forex_symbol(symbol)
                existing = await get_candles(symbol, _FOREX_INTERVAL, limit=1000)

            # Fetch the latest closed 15m candle only once per 15m boundary.
            results = await _fetch_massive_range(
                symbol,
                days=_POLLER_LOOKBACK_DAYS,
                limit=1,
                retries=2,
            )
            if results:
                newest = results[0] # desc = newest is first element
                latest_store_ts = int(existing[-1].get("time", 0)) if existing else 0
                newest_ts = int(newest["t"]) // 1000
                if latest_store_ts and newest_ts < latest_store_ts:
                    logger.warning(
                        "[MASSIVE_REST_POLLER] %s returned stale candle ts=%s < store ts=%s",
                        symbol,
                        newest_ts,
                        latest_store_ts,
                    )
                msg = {
                    "time": newest_ts,
                    "open": float(newest["o"]),
                    "high": float(newest["h"]),
                    "low": float(newest["l"]),
                    "close": float(newest["c"]),
                    "volume": float(newest["v"]),
                    "is_closed": True,
                }

                await broadcast_candle_proposal(symbol, _FOREX_INTERVAL, msg)
                await append_candle(symbol, _FOREX_INTERVAL, msg)
                await broadcast_candle(symbol, _FOREX_INTERVAL, msg)
                    
        except Exception as e:
            logger.warning("[MASSIVE_REST_POLLER] Polling error (%s): %s", symbol, e)
        
        await asyncio.sleep(_seconds_until_next_15m_close())
