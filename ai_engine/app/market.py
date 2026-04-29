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


def _compute_volume_analysis(candles: list[dict[str, Any]]) -> dict[str, Any]:
    """Analyze volume patterns for confirmation/divergence signals."""
    if len(candles) < 20:
        return {
            "avgVolume20": 0,
            "currentVolume": 0,
            "volumeRatio": 1.0,
            "volumeTrend": "flat",
            "buyVolumeRatio": 0.5,
            "volumeConfirmation": "neutral",
        }

    volumes = [float(c.get("volume", 0)) for c in candles]
    closes = [float(c["close"]) for c in candles]

    avg_vol_20 = sum(volumes[-20:]) / 20 if volumes[-20:] else 1
    current_vol = volumes[-1] if volumes else 0
    vol_ratio = current_vol / avg_vol_20 if avg_vol_20 > 0 else 1.0

    # Volume trend: compare avg of last 5 to avg of previous 15
    recent_avg = sum(volumes[-5:]) / 5 if len(volumes) >= 5 else avg_vol_20
    earlier_avg = sum(volumes[-20:-5]) / 15 if len(volumes) >= 20 else avg_vol_20
    if earlier_avg > 0 and recent_avg / earlier_avg > 1.15:
        vol_trend = "increasing"
    elif earlier_avg > 0 and recent_avg / earlier_avg < 0.85:
        vol_trend = "decreasing"
    else:
        vol_trend = "flat"

    # Buy volume estimation: count candles where close > open in last 10
    buy_candles = sum(1 for c in candles[-10:] if float(c["close"]) >= float(c["open"]))
    buy_vol_ratio = buy_candles / 10.0

    # Volume confirmation: is volume supporting the price direction?
    price_direction = "up" if closes[-1] > closes[-5] else "down" if closes[-1] < closes[-5] else "flat"
    if price_direction == "up" and vol_trend == "increasing":
        vol_confirm = "bullish_confirmation"
    elif price_direction == "down" and vol_trend == "increasing":
        vol_confirm = "bearish_confirmation"
    elif price_direction == "up" and vol_trend == "decreasing":
        vol_confirm = "bullish_divergence_warning"
    elif price_direction == "down" and vol_trend == "decreasing":
        vol_confirm = "bearish_divergence_warning"
    else:
        vol_confirm = "neutral"

    return {
        "avgVolume20": round(avg_vol_20, 2),
        "currentVolume": round(current_vol, 2),
        "volumeRatio": round(vol_ratio, 2),
        "volumeTrend": vol_trend,
        "buyVolumeRatio": round(buy_vol_ratio, 2),
        "volumeConfirmation": vol_confirm,
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

    # Volume analysis
    volume_analysis = _compute_volume_analysis(candles)

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
        "volume": volume_analysis,
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


def _build_scalp_trade(
    direction: str,
    current_price: float,
    support_resistance: dict[str, Any],
    atr_value: float,
    confidence: float,
    volume_analysis: dict[str, Any],
) -> dict[str, Any]:
    """Build a ~20 minute scalp trade setup with tight stops."""
    atr = max(atr_value, current_price * 0.003)
    supports = support_resistance.get("supportLevels", [])
    resistances = support_resistance.get("resistanceLevels", [])
    buy = direction.upper() == "BUY"

    if buy:
        target = current_price + (atr * 0.9)
        nearest_resistance = next((r for r in resistances if r > current_price), None)
        if nearest_resistance and (nearest_resistance - current_price) < atr * 1.5:
            target = min(target, nearest_resistance - (atr * 0.05))
        stop = current_price - (atr * 0.45)
        reasoning = f"Scalp BUY: enter at {current_price:.2f}, target {target:.2f} (+{((target-current_price)/current_price)*100:.2f}%), stop {stop:.2f}."
    else:
        target = current_price - (atr * 0.9)
        nearest_support = next((s for s in reversed(supports) if s < current_price), None)
        if nearest_support and (current_price - nearest_support) < atr * 1.5:
            target = max(target, nearest_support + (atr * 0.05))
        stop = current_price + (atr * 0.45)
        reasoning = f"Scalp SELL: enter at {current_price:.2f}, target {target:.2f} ({((target-current_price)/current_price)*100:.2f}%), stop {stop:.2f}."

    # Adjust confidence based on volume
    vol_confirm = volume_analysis.get("volumeConfirmation", "neutral")
    scalp_conf = confidence
    if "confirmation" in vol_confirm:
        scalp_conf = min(95, scalp_conf + 5)
    elif "divergence" in vol_confirm:
        scalp_conf = max(35, scalp_conf - 10)

    return {
        "direction": direction.upper(),
        "entry": round(current_price, 4),
        "target": round(target, 4),
        "stop": round(stop, 4),
        "expectedDuration": "~15-25 minutes",
        "reasoning": reasoning,
        "confidence": round(scalp_conf, 2),
    }


def _build_long_trade(
    direction: str,
    current_price: float,
    support_resistance: dict[str, Any],
    atr_value: float,
    confidence: float,
    volume_analysis: dict[str, Any],
) -> dict[str, Any]:
    """Build a ~2-4 hour swing trade setup with wider targets."""
    atr = max(atr_value, current_price * 0.003)
    supports = support_resistance.get("supportLevels", [])
    resistances = support_resistance.get("resistanceLevels", [])
    buy = direction.upper() == "BUY"

    if buy:
        target = current_price + (atr * 2.5)
        if len(resistances) > 1:
            target = max(target, resistances[1])
        elif resistances:
            target = max(target, resistances[0] + (atr * 0.5))
        stop = current_price - (atr * 1.2)
        nearest_support = next((s for s in supports if s < current_price), None)
        if nearest_support:
            stop = min(stop, nearest_support - (atr * 0.15))
        reasoning = f"Long BUY: enter at {current_price:.2f}, target {target:.2f} (+{((target-current_price)/current_price)*100:.2f}%), stop {stop:.2f}. Wider stops to ride the trend."
    else:
        target = current_price - (atr * 2.5)
        if len(supports) > 1:
            target = min(target, supports[1])
        elif supports:
            target = min(target, supports[0] - (atr * 0.5))
        stop = current_price + (atr * 1.2)
        nearest_resistance = next((r for r in resistances if r > current_price), None)
        if nearest_resistance:
            stop = max(stop, nearest_resistance + (atr * 0.15))
        reasoning = f"Long SELL: enter at {current_price:.2f}, target {target:.2f} ({((target-current_price)/current_price)*100:.2f}%), stop {stop:.2f}. Wider stops to ride the trend."

    # Adjust confidence based on volume trend alignment
    vol_trend = volume_analysis.get("volumeTrend", "flat")
    long_conf = confidence
    if vol_trend == "increasing":
        long_conf = min(95, long_conf + 3)
    elif vol_trend == "decreasing":
        long_conf = max(35, long_conf - 5)

    return {
        "direction": direction.upper(),
        "entry": round(current_price, 4),
        "target": round(target, 4),
        "stop": round(stop, 4),
        "expectedDuration": "~2-4 hours",
        "reasoning": reasoning,
        "confidence": round(long_conf, 2),
    }


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
    atr = market_snapshot["atr"]
    volume_analysis = market_snapshot.get("volume", {})

    if direction == "BUY":
        target = next((level for level in support_resistance["resistanceLevels"] if level > current_price), current_price + (atr * 2))
        if trade_style == "HOLD" and len(support_resistance["resistanceLevels"]) > 1:
            target = support_resistance["resistanceLevels"][1]
        stop = next((level for level in support_resistance["supportLevels"] if level < current_price), current_price - (atr * 1.2))
        expected_path = f"Likely dip-hold above {support_resistance['lastSwingLow'] or stop:.2f} before pushing toward {target:.2f}."
        why_up = f"EMA20 above EMA50 ({market_snapshot['structure']}), momentum is positive. " + (f"Volume is {volume_analysis.get('volumeTrend', 'flat')} confirming the move. " if volume_analysis else "") + (f"{news_summary}" if news_bias["label"] == "bullish" else "")
        why_down = f"Nearest resistance at {support_resistance.get('lastSwingHigh', target):.2f} could reject price. " + (f"Volume shows {volume_analysis.get('volumeConfirmation', 'neutral')}. " if volume_analysis else "") + (f"{news_summary}" if news_bias["label"] == "bearish" else "Reversal risk: " + market_snapshot.get("reversalRisk", "low") + ".")
    else:
        target = next((level for level in reversed(support_resistance["supportLevels"]) if level < current_price), current_price - (atr * 2))
        if trade_style == "HOLD" and len(support_resistance["supportLevels"]) > 1:
            target = support_resistance["supportLevels"][1]
        stop = next((level for level in support_resistance["resistanceLevels"] if level > current_price), current_price + (atr * 1.2))
        expected_path = f"Likely rejection below {support_resistance['lastSwingHigh'] or stop:.2f} before rotating toward {target:.2f}."
        why_up = f"Nearest support at {support_resistance.get('lastSwingLow', target):.2f} could bounce price. " + (f"{news_summary}" if news_bias["label"] == "bullish" else "")
        why_down = f"EMA20 below EMA50 ({market_snapshot['structure']}), bearish momentum. " + (f"Volume is {volume_analysis.get('volumeTrend', 'flat')} confirming selling. " if volume_analysis else "") + (f"{news_summary}" if news_bias["label"] == "bearish" else "")

    summary = f"{direction} for {trade_style.lower()}: {expected_path}"
    reasoning = (
        f"Technical structure is {market_snapshot['structure']} with regime {market_snapshot['regime']} and "
        f"news bias {news_bias['label']}. Reversal risk is {market_snapshot['reversalRisk']}. "
        f"Volume trend: {volume_analysis.get('volumeTrend', 'unknown')}, confirmation: {volume_analysis.get('volumeConfirmation', 'neutral')}. "
        f"{news_summary} The higher-probability move is {direction} with a {trade_style.lower()} setup."
    )

    expected_duration = "~15-25 minutes" if trade_style == "SCALP" else "~2-4 hours"

    # Build both trade plans
    scalp_trade = _build_scalp_trade(direction, current_price, support_resistance, atr, confidence, volume_analysis)
    long_trade = _build_long_trade(direction, current_price, support_resistance, atr, confidence, volume_analysis)

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
        "whyUp": why_up.strip(),
        "whyDown": why_down.strip(),
        "expectedDuration": expected_duration,
        "scalpTrade": scalp_trade,
        "longTrade": long_trade,
    }
def analyze_price_action(candles: list[dict[str, Any]]) -> dict[str, Any]:
    """Detect high-probability candlestick patterns for the AI Agent."""
    if len(candles) < 10:
        return {"patterns": [], "bias": "neutral"}
    
    last_10 = candles[-10:]
    patterns = []
    bullish_weight = 0
    bearish_weight = 0

    for i in range(1, len(last_10)):
        curr = last_10[i]
        prev = last_10[i-1]
        
        c_open, c_close = float(curr["open"]), float(curr["close"])
        c_high, c_low = float(curr["high"]), float(curr["low"])
        p_open, p_close = float(prev["open"]), float(prev["close"])
        
        body_size = abs(c_close - c_open)
        wick_size = (c_high - max(c_open, c_close)) + (min(c_open, c_close) - c_low)
        range_size = c_high - c_low if c_high > c_low else 0.0001
        
        # 1. Bullish Engulfing
        if c_close > c_open and p_close < p_open and c_close > p_open and c_open < p_close:
            patterns.append(f"Bullish Engulfing at candle {i}")
            bullish_weight += 2
            
        # 2. Bearish Engulfing
        if c_close < c_open and p_close > p_open and c_close < p_open and c_open > p_close:
            patterns.append(f"Bearish Engulfing at candle {i}")
            bearish_weight += 2
            
        # 3. Pin Bar / Hammer (Reversal)
        if body_size < (range_size * 0.3):
            # Bullish Hammer
            if (min(c_open, c_close) - c_low) > (body_size * 2) and (c_high - max(c_open, c_close)) < (body_size * 0.5):
                patterns.append(f"Bullish Hammer / Pin Bar at candle {i}")
                bullish_weight += 1.5
            # Bearish Shooting Star
            if (c_high - max(c_open, c_close)) > (body_size * 2) and (min(c_open, c_close) - c_low) < (body_size * 0.5):
                patterns.append(f"Bearish Shooting Star / Pin Bar at candle {i}")
                bearish_weight += 1.5
                
        # 4. Doji (Indecision)
        if body_size < (range_size * 0.1):
            patterns.append(f"Doji (Indecision) at candle {i}")

    bias = "bullish" if bullish_weight > bearish_weight + 1 else "bearish" if bearish_weight > bullish_weight + 1 else "neutral"
    
    return {
        "patterns": patterns[-4:], # Last 4 patterns
        "bias": bias,
        "strength": max(bullish_weight, bearish_weight),
        "recent_sentiment": "Buying pressure identified" if bullish_weight > 0 else "Selling pressure identified" if bearish_weight > 0 else "Low momentum"
    }
