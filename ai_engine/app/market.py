from __future__ import annotations

from typing import Any


def ema(values: list[float], period: int) -> list[float]:
    if not values or period < 1:
        return []
    multiplier = 2 / (period + 1)
    result: list[float] = []
    ema_value = values[0]
    for value in values:
        ema_value = (value * multiplier) + (ema_value * (1 - multiplier))
        result.append(ema_value)
    return result


def average_true_range(candles: list[dict[str, Any]], period: int = 14) -> float:
    if len(candles) < 2:
        return 0.0
    true_ranges: list[float] = []
    previous_close = float(candles[0]["close"])
    for candle in candles[1:]:
        high = float(candle["high"])
        low = float(candle["low"])
        close = float(candle["close"])
        true_range = max(high - low, abs(high - previous_close), abs(low - previous_close))
        true_ranges.append(true_range)
        previous_close = close
    if not true_ranges:
        return 0.0
    window = true_ranges[-period:]
    return sum(window) / len(window)


def detect_pivots(candles: list[dict[str, Any]], span: int = 3) -> list[dict[str, Any]]:
    pivots: list[dict[str, Any]] = []
    if len(candles) < (span * 2) + 1:
        return pivots

    for index in range(span, len(candles) - span):
        center = candles[index]
        center_high = float(center["high"])
        center_low = float(center["low"])

        left = candles[index - span : index]
        right = candles[index + 1 : index + span + 1]

        if all(center_high >= float(item["high"]) for item in left + right):
            pivots.append(
                {
                    "type": "HIGH",
                    "price": round(center_high, 4),
                    "index": index,
                    "time": int(center["time"]),
                }
            )

        if all(center_low <= float(item["low"]) for item in left + right):
            pivots.append(
                {
                    "type": "LOW",
                    "price": round(center_low, 4),
                    "index": index,
                    "time": int(center["time"]),
                }
            )

    return pivots


def _cluster_levels(prices: list[float], tolerance: float, reverse: bool = False) -> list[float]:
    ordered = sorted(prices, reverse=reverse)
    clusters: list[list[float]] = []
    for price in ordered:
        if not clusters:
            clusters.append([price])
            continue
        if abs(clusters[-1][-1] - price) <= tolerance:
            clusters[-1].append(price)
        else:
            clusters.append([price])
    return [round(sum(cluster) / len(cluster), 4) for cluster in clusters]


def derive_support_resistance(
    candles: list[dict[str, Any]],
    pivots: list[dict[str, Any]],
    current_price: float,
    atr_value: float,
) -> dict[str, Any]:
    tolerance = max(atr_value * 0.35, current_price * 0.0015)
    low_prices = [float(pivot["price"]) for pivot in pivots if pivot["type"] == "LOW"]
    high_prices = [float(pivot["price"]) for pivot in pivots if pivot["type"] == "HIGH"]

    supports = _cluster_levels([price for price in low_prices if price <= current_price], tolerance, reverse=True)[:3]
    resistances = _cluster_levels([price for price in high_prices if price >= current_price], tolerance, reverse=False)[:3]

    if not supports:
        supports = [round(min(float(candle["low"]) for candle in candles[-40:]), 4)]
    if not resistances:
        resistances = [round(max(float(candle["high"]) for candle in candles[-40:]), 4)]

    last_swing_low = supports[0] if supports else None
    last_swing_high = resistances[0] if resistances else None
    return {
        "supportLevels": supports,
        "resistanceLevels": resistances,
        "lastSwingLow": last_swing_low,
        "lastSwingHigh": last_swing_high,
    }


def compute_market_snapshot(candles: list[dict[str, Any]]) -> dict[str, Any]:
    closes = [float(candle["close"]) for candle in candles]
    current_price = closes[-1]
    ema20_series = ema(closes, 20)
    ema50_series = ema(closes, 50)
    ema20 = ema20_series[-1] if ema20_series else current_price
    ema50 = ema50_series[-1] if ema50_series else current_price
    atr_value = average_true_range(candles, 14)

    slope_6 = 0.0 if len(closes) < 7 else (current_price - closes[-7]) / closes[-7]
    slope_20 = 0.0 if len(closes) < 21 else (current_price - closes[-21]) / closes[-21]
    ema_gap = (ema20 - ema50) / current_price if current_price else 0.0

    if ema20 > ema50 and slope_6 >= -0.0015:
        structure = "Bullish"
        trend = "BULLISH"
    elif ema20 < ema50 and slope_6 <= 0.0015:
        structure = "Bearish"
        trend = "BEARISH"
    else:
        structure = "Range"
        trend = "NEUTRAL"

    atr_ratio = atr_value / current_price if current_price else 0.0
    if abs(ema_gap) > 0.004 and abs(slope_20) > 0.007:
        regime = "TREND"
    elif atr_ratio < 0.008:
        regime = "COMPRESSION"
    else:
        regime = "RANGE"

    impulse_score = min(100.0, max(0.0, (abs(slope_20) * 4000) + (abs(ema_gap) * 7000)))
    confidence = min(92.0, max(42.0, 48 + (abs(ema_gap) * 4500) + (abs(slope_6) * 2500)))

    pivots = detect_pivots(candles)
    support_resistance = derive_support_resistance(candles, pivots, current_price, atr_value)
    short_momentum = 0.0 if len(closes) < 4 else (current_price - closes[-4]) / closes[-4]
    resistance_distance_atr = (
        (support_resistance["lastSwingHigh"] - current_price) / atr_value
        if atr_value > 0 and support_resistance["lastSwingHigh"] is not None
        else 99.0
    )
    support_distance_atr = (
        (current_price - support_resistance["lastSwingLow"]) / atr_value
        if atr_value > 0 and support_resistance["lastSwingLow"] is not None
        else 99.0
    )

    reversal_bias = 0.0
    reversal_risk = "low"
    if structure == "Bullish" and resistance_distance_atr < 1.1 and short_momentum < -0.001:
        reversal_bias -= 1.35
        reversal_risk = "bearish-reversal-watch"
    elif structure == "Bearish" and support_distance_atr < 1.1 and short_momentum > 0.001:
        reversal_bias += 1.35
        reversal_risk = "bullish-reversal-watch"

    return {
        "currentPrice": round(current_price, 4),
        "ema20": round(ema20, 4),
        "ema50": round(ema50, 4),
        "atr": round(atr_value, 4),
        "structure": structure,
        "trend": trend,
        "regime": regime,
        "impulseScore": round(impulse_score, 2),
        "confidence": round(confidence, 2),
        "pivots": pivots[-12:],
        "supportResistance": support_resistance,
        "shortMomentum": round(short_momentum, 5),
        "reversalRisk": reversal_risk,
        "biasScore": (1.5 if structure == "Bullish" else -1.5 if structure == "Bearish" else 0.0)
        + (1.2 if regime == "TREND" and structure == "Bullish" else -1.2 if regime == "TREND" and structure == "Bearish" else 0.0)
        + (0.8 if slope_6 > 0 else -0.8 if slope_6 < 0 else 0.0)
        + reversal_bias,
    }


def build_trade_zone(
    direction: str,
    trade_style: str,
    current_price: float,
    support_resistance: dict[str, Any],
    atr_value: float,
    confidence: float,
    timestamp: int,
) -> dict[str, Any]:
    supports = support_resistance.get("supportLevels", [])
    resistances = support_resistance.get("resistanceLevels", [])
    buy = direction.upper() == "BUY"
    atr_value = max(atr_value, current_price * 0.003)

    if buy:
        target = next((level for level in resistances if level > current_price), current_price + (atr_value * 1.8))
        if trade_style.upper() == "HOLD":
            target = resistances[1] if len(resistances) > 1 else max(target, current_price + (atr_value * 3))
        stop = next((level for level in supports if level < current_price), current_price - (atr_value * 1.2))
        stop = min(stop, current_price - (atr_value * 0.8))
        zone_type = "BUY"
        reasoning = f"AI BUY setup with target {target:.2f} and stop {stop:.2f}."
    else:
        target = next((level for level in reversed(supports) if level < current_price), current_price - (atr_value * 1.8))
        if trade_style.upper() == "HOLD":
            target = supports[1] if len(supports) > 1 else min(target, current_price - (atr_value * 3))
        stop = next((level for level in resistances if level > current_price), current_price + (atr_value * 1.2))
        stop = max(stop, current_price + (atr_value * 0.8))
        zone_type = "SELL"
        reasoning = f"AI SELL setup with target {target:.2f} and stop {stop:.2f}."

    return {
        "type": zone_type,
        "entryPrice": round(current_price, 4),
        "profitTarget": round(target, 4),
        "stopLoss": round(stop, 4),
        "confidence": round(confidence, 2),
        "reasoning": reasoning,
        "time": timestamp,
    }


def build_prediction_markers(prediction: dict[str, Any], zone: dict[str, Any], timestamp: int) -> list[dict[str, Any]]:
    marker_color = "#00c853" if prediction["direction"] == "BUY" else "#ff5252"
    marker_position = "belowBar" if prediction["direction"] == "BUY" else "aboveBar"
    return [
        {
            "time": timestamp,
            "position": marker_position,
            "color": marker_color,
            "shape": "arrowUp" if prediction["direction"] == "BUY" else "arrowDown",
            "text": prediction["chartLabel"],
            "price": zone["entryPrice"],
        }
    ]


def build_fallback_prediction(
    market_snapshot: dict[str, Any],
    news_bias: dict[str, Any],
    support_resistance: dict[str, Any],
    news_summary: str,
) -> dict[str, Any]:
    combined_bias = market_snapshot["biasScore"] + (news_bias["score"] * 0.9)
    direction = "BUY" if combined_bias >= 0 else "SELL"
    trade_style = "HOLD" if market_snapshot["regime"] == "TREND" and abs(combined_bias) >= 1.8 else "SCALP"
    confidence = max(45.0, min(90.0, market_snapshot["confidence"] + (abs(news_bias["score"]) * 4)))
    current_price = market_snapshot["currentPrice"]

    if direction == "BUY":
        target = next((level for level in support_resistance["resistanceLevels"] if level > current_price), current_price + (market_snapshot["atr"] * 2))
        if trade_style == "HOLD" and len(support_resistance["resistanceLevels"]) > 1:
            target = support_resistance["resistanceLevels"][1]
        stop = next((level for level in support_resistance["supportLevels"] if level < current_price), current_price - (market_snapshot["atr"] * 1.2))
        expected_path = f"Likely dip-hold above {support_resistance['lastSwingLow'] or stop:.2f} before pushing toward {target:.2f}."
    else:
        target = next((level for level in reversed(support_resistance["supportLevels"]) if level < current_price), current_price - (market_snapshot["atr"] * 2))
        if trade_style == "HOLD" and len(support_resistance["supportLevels"]) > 1:
            target = support_resistance["supportLevels"][1]
        stop = next((level for level in support_resistance["resistanceLevels"] if level > current_price), current_price + (market_snapshot["atr"] * 1.2))
        expected_path = f"Likely rejection below {support_resistance['lastSwingHigh'] or stop:.2f} before rotating toward {target:.2f}."

    summary = f"{direction} for {trade_style.lower()}: {expected_path}"
    reasoning = (
        f"Technical structure is {market_snapshot['structure']} with regime {market_snapshot['regime']} and "
        f"news bias {news_bias['label']}. Reversal risk is {market_snapshot['reversalRisk']}. "
        f"{news_summary} The higher-probability move is {direction} with a {trade_style.lower()} setup."
    )
    return {
        "direction": direction,
        "tradeStyle": trade_style,
        "confidence": round(confidence, 2),
        "summary": summary,
        "reasoning": reasoning,
        "horizon": "next 2-6 candles" if trade_style == "SCALP" else "next 1-3 sessions",
        "currentPrice": round(current_price, 4),
        "targetPrice": round(target, 4),
        "stopLoss": round(stop, 4),
        "chartLabel": f"AI {direction} {trade_style}",
        "expectedPath": expected_path,
        "newsBias": news_bias["label"],
    }
