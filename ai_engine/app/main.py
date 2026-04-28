from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException

from app.config import (
    AI_ENGINE_CANDLE_LIMIT,
    AI_ENGINE_REQUEST_TIMEOUT_SECONDS,
    BACKEND_MARKET_DATA_URL,
    AZURE_OPENAI_MODEL,
    NEWSAPI_KEY,
    azure_openai_configured,
)
from app.market import (
    build_fallback_prediction,
    build_prediction_markers,
    build_trade_zone,
    compute_market_snapshot,
)
from app.news import collect_market_intel
from app.openai_client import generate_ai_prediction
from app.schemas import AnalysisResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="SmartTrade AI Engine")


def _normalize_interval(interval: str) -> str:
    return "1d" if interval.upper() == "1D" else interval.lower()


def _instrument_label(symbol: str) -> str:
    mapping = {
        "BTCUSDT": "Bitcoin",
        "ETHUSDT": "Ethereum",
        "SOLUSDT": "Solana",
        "BNBUSDT": "BNB",
        "XRPUSDT": "XRP",
        "C:XAUUSD": "Gold",
        "C:EURUSD": "EUR/USD",
        "C:USDJPY": "USD/JPY",
    }
    return mapping.get(symbol.upper(), symbol.upper())


async def _fetch_candles(symbol: str, interval: str, limit: int) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=AI_ENGINE_REQUEST_TIMEOUT_SECONDS) as client:
        response = await client.get(
            f"{BACKEND_MARKET_DATA_URL}/candles/{symbol}/{interval}",
            params={"limit": limit},
        )
        response.raise_for_status()
        payload = response.json()
    candles = payload.get("candles", [])
    if not isinstance(candles, list):
        return []
    return candles


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "azureConfigured": azure_openai_configured(),
        "newsApiConfigured": bool(NEWSAPI_KEY),
        "backendMarketDataUrl": BACKEND_MARKET_DATA_URL,
    }


@app.get("/analyze/{symbol}/{interval}")
async def analyze(symbol: str, interval: str, limit: int = AI_ENGINE_CANDLE_LIMIT) -> dict[str, Any]:
    normalized_symbol = symbol.upper()
    normalized_interval = _normalize_interval(interval)

    try:
        candles = await _fetch_candles(normalized_symbol, normalized_interval, limit)
    except Exception as exc:
        logger.warning("Failed to fetch candles from backend: %s", exc)
        raise HTTPException(status_code=502, detail="Unable to fetch candles from backend") from exc

    if len(candles) < 120:
        raise HTTPException(status_code=404, detail="Insufficient candles for AI analysis")

    market_snapshot = compute_market_snapshot(candles)
    support_resistance = market_snapshot["supportResistance"]
    market_intel = await collect_market_intel(normalized_symbol, _instrument_label(normalized_symbol))
    fallback_prediction = build_fallback_prediction(
        market_snapshot,
        market_intel["bias"],
        support_resistance,
        market_intel["summary"],
    )

    ai_prediction = None
    ai_powered = False
    if azure_openai_configured():
        try:
            ai_prediction = await generate_ai_prediction(
                {
                    "symbol": normalized_symbol,
                    "interval": normalized_interval,
                    "instrument": _instrument_label(normalized_symbol),
                    "marketSnapshot": market_snapshot,
                    "supportResistance": support_resistance,
                    "latestCandles": [
                        {
                            "time": c["time"],
                            "open": c["open"],
                            "high": c["high"],
                            "low": c["low"],
                            "close": c["close"],
                            "volume": c.get("volume", 0),
                        }
                        for c in candles[-80:]
                    ],
                    "news": market_intel["items"],
                    "newsSummary": market_intel["summary"],
                    "defaultRecommendation": fallback_prediction,
                },
                fallback_prediction,
            )
            ai_powered = ai_prediction is not None
        except Exception as exc:
            logger.warning("Azure OpenAI prediction failed, using fallback: %s", exc)

    prediction = {**fallback_prediction, **(ai_prediction or {})}
    zone = build_trade_zone(
        prediction["direction"],
        prediction["tradeStyle"],
        market_snapshot["currentPrice"],
        support_resistance,
        market_snapshot["atr"],
        prediction["confidence"],
        int(candles[-1]["time"]),
    )
    markers = build_prediction_markers(prediction, zone, int(candles[-1]["time"]))

    prediction["currentPrice"] = zone["entryPrice"]
    prediction["targetPrice"] = zone["profitTarget"]
    prediction["stopLoss"] = zone["stopLoss"]

    response = AnalysisResponse(
        structure=market_snapshot["structure"],
        regime=market_snapshot["regime"],
        impulseScore=market_snapshot["impulseScore"],
        confidence=prediction["confidence"],
        trend=market_snapshot["trend"],
        ema20=market_snapshot["ema20"],
        ema50=market_snapshot["ema50"],
        pivots=market_snapshot["pivots"],
        zones=[zone],
        reasoning=prediction["reasoning"],
        prediction=prediction,
        supportResistance=support_resistance,
        news=market_intel["items"],
        markers=markers,
        aiPowered=ai_powered,
        model=AZURE_OPENAI_MODEL if ai_powered else None,
    )
    return response.model_dump()
