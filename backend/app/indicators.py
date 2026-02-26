"""
Minimal indicator engine: EMAs + simple structure from candles.
Results are stored in Redis for GET /signals.
Full Semafor/Core Engine can be ported from TypeScript later.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def _ema(values: list[float], period: int) -> list[float]:
    if not values or period < 1:
        return []
    k = 2 / (period + 1)
    out: list[float] = []
    ema_val = sum(values[:period]) / period if len(values) >= period else values[0]
    for i, v in enumerate(values):
        if i < period - 1:
            out.append(values[i] if i == 0 else (values[i] * k + out[-1] * (1 - k)))
        else:
            if i == period - 1:
                ema_val = sum(values[i - period + 1 : i + 1]) / period
            else:
                ema_val = v * k + ema_val * (1 - k)
            out.append(ema_val)
    return out


def compute_signals(candles: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute a minimal signal payload from candle list."""
    if not candles or len(candles) < 50:
        return {
            "structure": "Range",
            "regime": "RANGE",
            "confidence": 0,
            "ema20": 0,
            "ema50": 0,
            "trend": "NEUTRAL",
            "pivots": [],
            "zones": [],
            "reasoning": "Insufficient candles",
        }
    closes = [float(c["close"]) for c in candles]
    ema20_list = _ema(closes, 20)
    ema50_list = _ema(closes, 50)
    ema20 = ema20_list[-1] if ema20_list else 0
    ema50 = ema50_list[-1] if ema50_list else 0
    current = closes[-1]

    if ema20 > ema50 * 1.002:
        trend = "BULLISH"
        structure = "Impulse"
        regime = "TREND"
        confidence = min(90, 50 + int((ema20 - ema50) / ema50 * 1000))
    elif ema20 < ema50 * 0.998:
        trend = "BEARISH"
        structure = "Impulse"
        regime = "TREND"
        confidence = min(90, 50 + int((ema50 - ema20) / ema50 * 1000))
    else:
        trend = "NEUTRAL"
        structure = "Range"
        regime = "RANGE"
        confidence = 40

    return {
        "structure": structure,
        "regime": regime,
        "confidence": confidence,
        "ema20": round(ema20, 4),
        "ema50": round(ema50, 4),
        "trend": trend,
        "pivots": [],
        "zones": [],
        "reasoning": f"EMA20 {ema20:.2f} vs EMA50 {ema50:.2f}; trend {trend}.",
    }
