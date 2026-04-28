from __future__ import annotations

import json
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


async def generate_ai_prediction(
    payload: dict[str, Any],
    fallback_prediction: dict[str, Any],
) -> dict[str, Any] | None:
    if not azure_openai_configured():
        return None

    response_payload = {
        "model": AZURE_OPENAI_MODEL,
        "temperature": 0.1,
        "max_output_tokens": 320,
        "text": {"format": {"type": "json_object"}},
        "instructions": (
            "You are a market analyst for a live trading dashboard. "
            "Use only the supplied JSON data. "
            "Return json only with these keys: direction, tradeStyle, confidence, summary, reasoning, horizon, chartLabel, expectedPath, newsBias. "
            "direction must be BUY or SELL. tradeStyle must be SCALP or HOLD. "
            "Give one clear call, not a hedge. "
            "Prefer early reversal detection near support or resistance instead of waiting for a move to fully complete. "
            "Explain whether the move is mostly driven by price action, news, or a mix of both. "
            "Do not invent prices or levels that are not in the payload."
        ),
        "input": f"Return json only.\n{json.dumps(payload)}",
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

    return {
        "direction": _normalize_direction(parsed.get("direction"), fallback_prediction["direction"]),
        "tradeStyle": _normalize_trade_style(parsed.get("tradeStyle"), fallback_prediction["tradeStyle"]),
        "confidence": max(35.0, min(95.0, float(parsed.get("confidence", fallback_prediction["confidence"])))),
        "summary": str(parsed.get("summary") or fallback_prediction["summary"]).strip(),
        "reasoning": str(parsed.get("reasoning") or fallback_prediction["reasoning"]).strip(),
        "horizon": str(parsed.get("horizon") or fallback_prediction["horizon"]).strip(),
        "chartLabel": str(parsed.get("chartLabel") or fallback_prediction["chartLabel"]).strip(),
        "expectedPath": str(parsed.get("expectedPath") or fallback_prediction["expectedPath"]).strip(),
        "newsBias": str(parsed.get("newsBias") or fallback_prediction["newsBias"]).strip(),
    }
