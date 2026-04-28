from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.config import (
    AI_ENGINE_REQUEST_TIMEOUT_SECONDS,
    AZURE_OPENAI_API_KEY,
    AZURE_OPENAI_API_VERSION,
    AZURE_OPENAI_ENDPOINT,
    AZURE_OPENAI_MODEL,
    azure_openai_configured,
)

logger = logging.getLogger(__name__)


def _extract_output_text(response: dict[str, Any]) -> str:
    chunks: list[str] = []
    for item in response.get("output", []):
        for content in item.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                chunks.append(str(content["text"]).strip())
    return "\n".join(chunk for chunk in chunks if chunk)


def _normalize_direction(value: Any, fallback: str) -> str:
    candidate = str(value or "").strip().upper()
    return candidate if candidate in {"BUY", "SELL"} else fallback


def _normalize_trade_style(value: Any, fallback: str) -> str:
    candidate = str(value or "").strip().upper()
    return candidate if candidate in {"SCALP", "HOLD"} else fallback


def _parse_trade_setup(raw: Any, fallback_entry: float) -> dict[str, Any] | None:
    """Parse a scalpTrade or longTrade sub-object from AI output."""
    if not isinstance(raw, dict):
        return None
    return {
        "direction": _normalize_direction(raw.get("direction"), "BUY"),
        "entry": float(raw.get("entry", fallback_entry)),
        "target": float(raw.get("target", fallback_entry)),
        "stop": float(raw.get("stop", fallback_entry)),
        "expectedDuration": str(raw.get("expectedDuration", "unknown")).strip(),
        "reasoning": str(raw.get("reasoning", "")).strip(),
        "confidence": max(30.0, min(95.0, float(raw.get("confidence", 50)))),
    }


# ─── Deep analysis system prompt ──────────────────────────────────────────────
_SYSTEM_PROMPT = """\
You are a SENIOR PROFESSIONAL TRADER with 20+ years of experience analyzing charts.
A real trader with real money is waiting on YOUR signal RIGHT NOW to enter a trade.
This is NOT a game — accuracy determines whether someone profits or loses.

═══ YOUR ANALYSIS PROCESS (follow this EXACTLY) ═══

STEP 1 — CHART DEEP DIVE:
• Study the OHLCV candle data thoroughly: identify the prevailing trend (higher highs / lower lows)
• Check EMA20 vs EMA50 crossover and slope — is trend accelerating or fading?
• Analyze VOLUME: is volume increasing on moves in the trend direction? (confirmation)
  Or is volume spiking on counter-trend moves? (potential reversal)
• Identify key support and resistance levels from the pivot data
• Check if price is near support (potential bounce/buy) or resistance (potential rejection/sell)
• Look for candlestick patterns: engulfing, doji, hammer, shooting star in recent candles

STEP 2 — NEWS & CATALYST ANALYSIS:
• Read EVERY news item provided — headlines and snippets
• Identify specific catalysts that could drive price UP or DOWN
• Check for high-impact economic events (NFP, CPI, FOMC, etc.)
• Weight news bias: are headlines overwhelmingly bullish, bearish, or mixed?

STEP 3 — RISK ASSESSMENT:
• Identify what could go WRONG with a buy (whyDown)
• Identify what could go RIGHT with a buy (whyUp)
• Check the ATR for realistic stop-loss and target placement
• Consider if the reward-to-risk ratio is favorable (minimum 1.5:1)

STEP 4 — TRADE PLANS (provide BOTH):
• scalpTrade: A SHORT-TERM trade (~15-25 minutes)
  - Tight stop loss (0.3-0.5x ATR)
  - Conservative target (0.8-1.2x ATR)
  - Higher confidence required (need clear momentum)
  
• longTrade: A SWING trade (~2-4 hours)
  - Wider stop loss (1.0-1.5x ATR)
  - Larger target (2-3x ATR or next major S/R level)
  - Can ride trends with more room to breathe

═══ CRITICAL RULES ═══

1. NEVER flip-flop: If the trend is clearly bullish, your primary direction MUST be BUY
   unless there is OVERWHELMING evidence of reversal (breakdown below support + volume spike)
2. Confidence MUST reflect reality: 
   - 85-95%: Crystal clear setup with trend + volume + news alignment
   - 70-84%: Good setup but one factor is uncertain  
   - 55-69%: Mixed signals, trade with caution
   - Below 55%: Don't recommend the trade, mark as low confidence
3. Both scalpTrade and longTrade should generally agree on direction.
   Only disagree if there's a clear short-term pullback within a larger trend.
4. ALWAYS include expectedDuration: "~15-25 minutes" for scalp, "~2-4 hours" for long
5. Give SPECIFIC reasons in whyUp and whyDown — not generic statements

═══ OUTPUT FORMAT ═══

Return ONLY valid JSON with these keys:
{
  "direction": "BUY" or "SELL",
  "tradeStyle": "SCALP" or "HOLD",
  "confidence": <number 35-95>,
  "summary": "<1-2 sentence trade call>",
  "reasoning": "<detailed multi-sentence analysis>",
  "horizon": "<time horizon description>",
  "chartLabel": "AI BUY SCALP" or "AI SELL HOLD" etc,
  "expectedPath": "<describe expected price movement>",
  "newsBias": "bullish" or "bearish" or "neutral",
  "whyUp": "<specific reasons price could rally>",
  "whyDown": "<specific reasons price could drop>",
  "expectedDuration": "<primary trade duration>",
  "scalpTrade": {
    "direction": "BUY" or "SELL",
    "entry": <price>,
    "target": <price>,
    "stop": <price>,
    "expectedDuration": "~15-25 minutes",
    "reasoning": "<why this scalp setup>",
    "confidence": <number>
  },
  "longTrade": {
    "direction": "BUY" or "SELL",
    "entry": <price>,
    "target": <price>,
    "stop": <price>,
    "expectedDuration": "~2-4 hours",
    "reasoning": "<why this swing setup>",
    "confidence": <number>
  }
}
"""


async def generate_ai_prediction(
    payload: dict[str, Any],
    fallback_prediction: dict[str, Any],
) -> dict[str, Any] | None:
    if not azure_openai_configured():
        return None

    response_payload = {
        "model": AZURE_OPENAI_MODEL,
        "temperature": 0.15,
        "max_output_tokens": 900,
        "text": {"format": {"type": "json_object"}},
        "instructions": _SYSTEM_PROMPT,
        "input": f"Analyze this data and return json only.\n{json.dumps(payload)}",
    }

    async with httpx.AsyncClient(timeout=AI_ENGINE_REQUEST_TIMEOUT_SECONDS) as client:
        response = await client.post(
            f"{AZURE_OPENAI_ENDPOINT}/openai/responses?api-version={AZURE_OPENAI_API_VERSION}",
            headers={
                "Content-Type": "application/json",
                "api-key": AZURE_OPENAI_API_KEY,
            },
            json=response_payload,
        )
        data = response.json()
        response.raise_for_status()

    raw_text = _extract_output_text(data)
    if not raw_text:
        return None

    parsed = json.loads(raw_text)
    if not isinstance(parsed, dict):
        return None

    current_price = float(fallback_prediction.get("currentPrice", 0))
    result = {
        "direction": _normalize_direction(parsed.get("direction"), fallback_prediction["direction"]),
        "tradeStyle": _normalize_trade_style(parsed.get("tradeStyle"), fallback_prediction["tradeStyle"]),
        "confidence": max(35.0, min(95.0, float(parsed.get("confidence", fallback_prediction["confidence"])))),
        "summary": str(parsed.get("summary") or fallback_prediction["summary"]).strip(),
        "reasoning": str(parsed.get("reasoning") or fallback_prediction["reasoning"]).strip(),
        "horizon": str(parsed.get("horizon") or fallback_prediction["horizon"]).strip(),
        "chartLabel": str(parsed.get("chartLabel") or fallback_prediction["chartLabel"]).strip(),
        "expectedPath": str(parsed.get("expectedPath") or fallback_prediction["expectedPath"]).strip(),
        "newsBias": str(parsed.get("newsBias") or fallback_prediction["newsBias"]).strip(),
        "whyUp": str(parsed.get("whyUp") or "").strip(),
        "whyDown": str(parsed.get("whyDown") or "").strip(),
        "expectedDuration": str(parsed.get("expectedDuration") or fallback_prediction.get("expectedDuration", "")).strip(),
    }

    # Parse scalp and long trade setups
    scalp_raw = parsed.get("scalpTrade")
    long_raw = parsed.get("longTrade")

    if scalp_raw:
        result["scalpTrade"] = _parse_trade_setup(scalp_raw, current_price)
    if long_raw:
        result["longTrade"] = _parse_trade_setup(long_raw, current_price)

    return result
