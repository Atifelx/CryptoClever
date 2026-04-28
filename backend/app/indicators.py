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
            "impulseScore": 0,
            "confidence": 0,
            "ema20": 0,
            "ema50": 0,
            "trend": "NEUTRAL",
            "pivots": [],
            "zones": [],
            "reasoning": "Insufficient candles",
            "prediction": {
                "direction": "BUY",
                "tradeStyle": "SCALP",
                "confidence": 0,
                "summary": "Insufficient candles for prediction.",
                "reasoning": "Insufficient candles for prediction.",
                "horizon": "n/a",
                "currentPrice": 0,
                "targetPrice": 0,
                "stopLoss": 0,
                "chartLabel": "AI WAIT",
                "expectedPath": "Waiting for more data.",
                "newsBias": "neutral",
            },
            "supportResistance": {
                "supportLevels": [],
                "resistanceLevels": [],
                "lastSwingLow": None,
                "lastSwingHigh": None,
            },
            "markers": [],
            "news": [],
            "aiPowered": False,
            "analysisSource": "backend-fallback",
        }
    closes = [float(c["close"]) for c in candles]
    highs = [float(c["high"]) for c in candles]
    lows = [float(c["low"]) for c in candles]
    ema20_list = _ema(closes, 20)
    ema50_list = _ema(closes, 50)
    ema20 = ema20_list[-1] if ema20_list else 0
    ema50 = ema50_list[-1] if ema50_list else 0
    current = closes[-1]
    support = min(lows[-20:])
    resistance = max(highs[-20:])
    price_span = max(resistance - support, current * 0.004)

    if ema20 > ema50 * 1.002:
        trend = "BULLISH"
        structure = "Bullish"
        regime = "TREND"
        confidence = min(90, 50 + int((ema20 - ema50) / ema50 * 1000))
    elif ema20 < ema50 * 0.998:
        trend = "BEARISH"
        structure = "Bearish"
        regime = "TREND"
        confidence = min(90, 50 + int((ema50 - ema20) / ema50 * 1000))
    else:
        trend = "NEUTRAL"
        structure = "Range"
        regime = "RANGE"
        confidence = 40

    direction = "BUY" if trend != "BEARISH" else "SELL"
    trade_style = "HOLD" if regime == "TREND" and confidence >= 65 else "SCALP"
    if direction == "BUY":
        target = current + (price_span * (0.75 if trade_style == "SCALP" else 1.15))
        stop = max(support, current - (price_span * 0.35))
        chart_label = f"AI BUY {trade_style}"
        expected_path = f"Price is likely to defend {support:.2f} and rotate toward {target:.2f}."
    else:
        target = current - (price_span * (0.75 if trade_style == "SCALP" else 1.15))
        stop = min(resistance, current + (price_span * 0.35))
        chart_label = f"AI SELL {trade_style}"
        expected_path = f"Price is likely to reject below {resistance:.2f} and rotate toward {target:.2f}."

    zone = {
        "type": direction,
        "entryPrice": round(current, 4),
        "profitTarget": round(target, 4),
        "stopLoss": round(stop, 4),
        "confidence": confidence,
        "reasoning": f"Fallback {direction} setup from EMA trend.",
        "time": int(candles[-1]["time"]),
    }
    impulse_score = min(100, abs(current - closes[-20]) / closes[-20] * 2500) if len(closes) > 20 else 0

    return {
        "structure": structure,
        "regime": regime,
        "impulseScore": round(impulse_score, 2),
        "confidence": confidence,
        "ema20": round(ema20, 4),
        "ema50": round(ema50, 4),
        "trend": trend,
        "pivots": [],
        "zones": [zone],
        "reasoning": f"EMA20 {ema20:.2f} vs EMA50 {ema50:.2f}; trend {trend}. {expected_path}",
        "prediction": {
            "direction": direction,
            "tradeStyle": trade_style,
            "confidence": confidence,
            "summary": f"{direction} for {trade_style.lower()}: {expected_path}",
            "reasoning": f"Fallback prediction based on EMA trend and 20-candle range. {expected_path}",
            "horizon": "next 2-6 candles" if trade_style == "SCALP" else "next 1-3 sessions",
            "currentPrice": round(current, 4),
            "targetPrice": round(target, 4),
            "stopLoss": round(stop, 4),
            "chartLabel": chart_label,
            "expectedPath": expected_path,
            "newsBias": "neutral",
        },
        "supportResistance": {
            "supportLevels": [round(support, 4)],
            "resistanceLevels": [round(resistance, 4)],
            "lastSwingLow": round(support, 4),
            "lastSwingHigh": round(resistance, 4),
        },
        "markers": [
            {
                "time": int(candles[-1]["time"]),
                "position": "belowBar" if direction == "BUY" else "aboveBar",
                "color": "#00c853" if direction == "BUY" else "#ff5252",
                "shape": "arrowUp" if direction == "BUY" else "arrowDown",
                "text": chart_label,
            }
        ],
        "news": [],
        "aiPowered": False,
        "analysisSource": "backend-fallback",
    }
