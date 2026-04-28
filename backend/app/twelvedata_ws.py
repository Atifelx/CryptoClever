import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx

from app.config import FOREX_SYMBOLS, TWELVEDATA_API_KEY, TWELVEDATA_REST_BASE
from app.redis_store import append_candle, get_candles, set_candles
from app.ws_broadcast import broadcast_candle, broadcast_candle_proposal

logger = logging.getLogger(__name__)

_FOREX_INTERVAL = "5m"
_TWELVEDATA_INTERVAL = "5min"
_FOREX_OUTPUTSIZE = 500
_POLL_BUFFER_SECONDS = 20
_FETCH_RETRIES = 3
_FETCH_BACKOFF_SECONDS = 5

_TWELVEDATA_SYMBOL_MAP = {
    "C:XAUUSD": "XAU/USD",
    "C:USDJPY": "USD/JPY",
    "C:GBPJPY": "GBP/JPY",
}


def _provider_symbol(symbol: str) -> str:
    return _TWELVEDATA_SYMBOL_MAP.get(symbol, symbol)


def _parse_twelvedata_time(value: str) -> int:
    dt = datetime.strptime(value, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def _merge_candle_lists(*lists: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[int, dict[str, Any]] = {}
    for candles in lists:
        for candle in candles:
            merged[int(candle["time"])] = candle
    return [merged[ts] for ts in sorted(merged.keys())]


async def _fetch_twelvedata_series(
    symbol: str,
    *,
    outputsize: int,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    retries: int = _FETCH_RETRIES,
) -> list[dict[str, Any]]:
    if not TWELVEDATA_API_KEY:
        logger.warning("[TWELVEDATA_FETCH] Missing API key for %s", symbol)
        return []

    params = {
        "symbol": _provider_symbol(symbol),
        "interval": _TWELVEDATA_INTERVAL,
        "timezone": "UTC",
        "apikey": TWELVEDATA_API_KEY,
    }
    if outputsize:
        params["outputsize"] = outputsize
    if start_date:
        params["start_date"] = start_date
    if end_date:
        params["end_date"] = end_date

    async with httpx.AsyncClient() as client:
        for attempt in range(1, retries + 1):
            try:
                r = await client.get(f"{TWELVEDATA_REST_BASE}/time_series", params=params, timeout=20.0)
                r.raise_for_status()
                data = r.json()
                if data.get("status") == "error":
                    raise RuntimeError(data.get("message") or "Unknown Twelve Data error")
                values = data.get("values", [])
                return list(values) if isinstance(values, list) else []
            except Exception as e:
                if attempt == retries:
                    logger.warning("[TWELVEDATA_FETCH] %s failed after %d attempts: %s", symbol, retries, e)
                    return []
                wait_seconds = _FETCH_BACKOFF_SECONDS * attempt
                logger.warning(
                    "[TWELVEDATA_FETCH] %s attempt %d/%d failed: %s. Retrying in %ss",
                    symbol,
                    attempt,
                    retries,
                    e,
                    wait_seconds,
                )
                await asyncio.sleep(wait_seconds)
    return []


def _rows_to_candles(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candles: list[dict[str, Any]] = []
    # Twelve Data returns newest first; reverse to ascending.
    for row in reversed(rows):
        candles.append(
            {
                "time": _parse_twelvedata_time(row["datetime"]),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row.get("volume") or 0),
                "is_closed": True,
            }
        )
    return candles


def _seconds_until_next_5m_close(buffer_seconds: int = _POLL_BUFFER_SECONDS) -> float:
    now = datetime.now(timezone.utc)
    next_minute = ((now.minute // 5) + 1) * 5
    if next_minute >= 60:
        next_bar = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    else:
        next_bar = now.replace(minute=next_minute, second=0, microsecond=0)
    wake_at = next_bar + timedelta(seconds=buffer_seconds)
    return max((wake_at - now).total_seconds(), 5.0)


async def bootstrap_forex_symbol(symbol: str) -> None:
    logger.info("[TWELVEDATA_BOOTSTRAP] Fetching %s history via %s", symbol, _provider_symbol(symbol))
    rows = await _fetch_twelvedata_series(symbol, outputsize=_FOREX_OUTPUTSIZE)
    if not rows:
        logger.warning("[TWELVEDATA_BOOTSTRAP] %s: No historical candles fetched", symbol)
        return

    candles = _rows_to_candles(rows)
    existing = await get_candles(symbol, _FOREX_INTERVAL, limit=_FOREX_OUTPUTSIZE)
    merged = _merge_candle_lists(existing, candles)
    if len(merged) > _FOREX_OUTPUTSIZE:
        merged = merged[-_FOREX_OUTPUTSIZE:]
    await set_candles(symbol, _FOREX_INTERVAL, merged)
    logger.info(
        "[TWELVEDATA_BOOTSTRAP] %s: loaded=%d merged_total=%d",
        symbol,
        len(candles),
        len(merged),
    )


async def bootstrap_all_forex() -> None:
    if not TWELVEDATA_API_KEY:
        logger.warning("[TWELVEDATA_BOOTSTRAP] No API key found. Skipping.")
        return
    logger.info("[TWELVEDATA_BOOTSTRAP] Starting for %s", FOREX_SYMBOLS)
    for sym in FOREX_SYMBOLS:
        try:
            await bootstrap_forex_symbol(sym)
            await asyncio.sleep(1)
        except Exception as e:
            logger.error("[TWELVEDATA_BOOTSTRAP] Error in sequence for %s: %s", sym, e)


async def run_twelvedata_poll_for_symbol(symbol: str) -> None:
    if not TWELVEDATA_API_KEY:
        logger.error("[TWELVEDATA_POLLER] No API key for %s", symbol)
        return

    logger.info("[TWELVEDATA_POLLER] Starting REST poller for %s", symbol)

    while True:
        try:
            existing = await get_candles(symbol, _FOREX_INTERVAL, limit=_FOREX_OUTPUTSIZE)
            if not existing:
                await bootstrap_forex_symbol(symbol)
                existing = await get_candles(symbol, _FOREX_INTERVAL, limit=_FOREX_OUTPUTSIZE)

            rows = await _fetch_twelvedata_series(symbol, outputsize=2, retries=2)
            if rows:
                candles = _rows_to_candles(rows)
                latest_store_ts = int(existing[-1]["time"]) if existing else 0
                fresh = [c for c in candles if int(c["time"]) >= latest_store_ts]
                if not fresh:
                    fresh = candles[-1:]
                for candle in fresh:
                    await append_candle(symbol, _FOREX_INTERVAL, candle)
                    await broadcast_candle_proposal(symbol, _FOREX_INTERVAL, candle)
                    await broadcast_candle(symbol, _FOREX_INTERVAL, candle)
        except Exception as e:
            logger.warning("[TWELVEDATA_POLLER] Polling error (%s): %s", symbol, e)

        await asyncio.sleep(_seconds_until_next_5m_close())
