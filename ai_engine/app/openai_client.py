from __future__ import annotations

import json
import logging
from typing import Any, List, Dict

import httpx
from app.config import (
    AI_ENGINE_REQUEST_TIMEOUT_SECONDS,
    AZURE_OPENAI_API_KEY,
    AZURE_OPENAI_API_VERSION,
    AZURE_OPENAI_ENDPOINT,
    AZURE_OPENAI_MODEL,
    azure_openai_configured,
)
from app.market import compute_market_snapshot, analyze_price_action
from app.news import collect_market_intel

logger = logging.getLogger(__name__)

# ─── Senior Trend Analyst System Prompt ─────────────────────────────────────────
_SYSTEM_PROMPT = """\
You are a SENIOR PROFESSIONAL TREND ANALYST with 20+ years of institutional experience.
Your job is to provide high-fidelity trade signals (Scalp and Long) by deeply analyzing data.

═══ YOUR AGENTIC PROCESS ═══
You operate in a loop. You MUST use your tools to gather facts before making a final decision.

1. RESEARCH: Use `get_market_intel` to check live news and economic calendars (NFP, CPI, etc.).
2. TECHNICALS: Use `get_technical_analysis` to check EMAs, S/R levels, and ATR.
3. PRICE ACTION: Use `get_price_action` to identify candlestick patterns (Engulfing, Pin Bars, Dojis).
4. RESOLVE CONFLICTS: If indicators (FMCBR/Semafor) suggest one direction but price action or news suggests another, you MUST explain the discrepancy. Indicators are often lagging; Price Action and News are leading.

═══ CRITICAL RULES ═══
- NEVER flip-flop on minor noise. Stick to the major trend unless a clear reversal pattern is identified.
- ACCURACY is everything. If the signals are mixed, say so in your reasoning.
- Provide BOTH a Scalp (short-term) and Long (swing) trade plan.
- Use 'Order Flow' and 'Liquidity' concepts in your reasoning.

═══ OUTPUT FORMAT ═══
Return valid JSON only.
{
  "direction": "BUY" or "SELL",
  "tradeStyle": "SCALP" or "HOLD",
  "confidence": <number 35-95>,
  "summary": "<1-2 sentence trade call>",
  "reasoning": "<detailed multi-sentence analysis resolving any indicator conflicts>",
  "horizon": "<time horizon>",
  "chartLabel": "AI BUY/SELL",
  "expectedPath": "<describe move>",
  "newsBias": "bullish/bearish/neutral",
  "whyUp": "<reasons to rally>",
  "whyDown": "<reasons to drop>",
  "expectedDuration": "<duration>",
  "scalpTrade": { "direction": "BUY/SELL", "entry": 0, "target": 0, "stop": 0, "reasoning": "...", "confidence": 0 },
  "longTrade": { "direction": "BUY/SELL", "entry": 0, "target": 0, "stop": 0, "reasoning": "...", "confidence": 0 }
}
"""

# ─── Tool Definitions ─────────────────────────────────────────────────────────
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_raw_candles",
            "description": "Get the raw OHLCV candle data for the instrument to analyze trends and patterns.",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "description": "Number of candles to retrieve (default 80, max 200)"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_market_intel",
            "description": "Get live news, sentiment, and economic calendar events for the instrument.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "instrument": {"type": "string"}
                },
                "required": ["symbol", "instrument"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_technical_analysis",
            "description": "Get EMA trends, S/R levels, ATR, and volume analysis.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_price_action",
            "description": "Identify candlestick patterns (Engulfing, Doji, Pin Bars) in recent candles.",
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"}
                }
            }
        }
    }
]

async def execute_tool(name: str, args: dict, context: dict) -> str:
    """Execute tools for the agentic loop."""
    logger.info(f"Agent executing tool: {name} with args: {args}")
    try:
        if name == "get_raw_candles":
            limit = min(200, args.get("limit", 80))
            return json.dumps(context["allCandles"][-limit:])
            
        elif name == "get_market_intel":
            intel = await collect_market_intel(args.get("symbol", context["symbol"]), args.get("instrument", context["instrument"]))
            return json.dumps(intel)
        
        elif name == "get_technical_analysis":
            # Market snapshot is already computed in the main loop, we can just return it or recompute
            return json.dumps(context["marketSnapshot"])
            
        elif name == "get_price_action":
            pa = analyze_price_action(context["allCandles"])
            return json.dumps(pa)
            
        return f"Error: Tool {name} not found."
    except Exception as e:
        return f"Error executing tool: {str(e)}"

async def generate_ai_prediction(
    payload: dict[str, Any],
    fallback_prediction: dict[str, Any],
) -> dict[str, Any] | None:
    """Agentic entry point for AI prediction."""
    if not azure_openai_configured():
        return None

    # We need the full candle history for tools
    all_candles = payload.get("allCandles", [])
    
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": f"Perform a deep analysis for {payload['instrument']} ({payload['symbol']}) at {payload['interval']} interval. Indicators currently suggest {fallback_prediction['direction']}. Verify this and give me the final verdict."}
    ]

    async with httpx.AsyncClient(timeout=AI_ENGINE_REQUEST_TIMEOUT_SECONDS + 10) as client:
        # --- AGENTIC LOOP (Max 3 turns) ---
        for turn in range(3):
            response = await client.post(
                f"{AZURE_OPENAI_ENDPOINT}/openai/deployments/{AZURE_OPENAI_MODEL}/chat/completions?api-version={AZURE_OPENAI_API_VERSION}",
                headers={"api-key": AZURE_OPENAI_API_KEY, "Content-Type": "application/json"},
                json={
                    "messages": messages,
                    "tools": TOOLS,
                    "tool_choice": "auto" if turn < 2 else "none", # Force final answer on turn 3
                    "temperature": 0.1,
                }
            )
            response.raise_for_status()
            data = response.json()
            message = data["choices"][0]["message"]
            messages.append(message)

            if not message.get("tool_calls"):
                # No more tool calls, we have our final answer
                try:
                    content = message.get("content") or ""
                    # Clean up JSON if LLM added markdown blocks
                    if "```json" in content:
                        content = content.split("```json")[1].split("```")[0].strip()
                    elif "```" in content:
                        content = content.split("```")[1].split("```")[0].strip()
                    
                    parsed = json.loads(content)
                    return _post_process_prediction(parsed, fallback_prediction)
                except Exception as e:
                    logger.error(f"Failed to parse agent final response: {e}")
                    return None

            # Execute tool calls
            for tool_call in message["tool_calls"]:
                tool_name = tool_call["function"]["name"]
                
                # Robust argument parsing
                raw_args = tool_call["function"].get("arguments") or "{}"
                if isinstance(raw_args, str):
                    try:
                        tool_args = json.loads(raw_args)
                    except:
                        tool_args = {}
                else:
                    tool_args = raw_args
                
                tool_result = await execute_tool(tool_name, tool_args, {
                    "symbol": payload["symbol"],
                    "instrument": payload["instrument"],
                    "marketSnapshot": payload["marketSnapshot"],
                    "allCandles": all_candles
                })
                
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call["id"],
                    "name": tool_name,
                    "content": tool_result
                })

    return None

def _post_process_prediction(parsed: dict, fallback: dict) -> dict:
    """Normalize and clean the agent's output."""
    current_price = float(fallback.get("currentPrice", 0))
    
    def normalize_dir(v, f):
        return str(v or "").strip().upper() if str(v or "").strip().upper() in {"BUY", "SELL"} else f

    result = {
        "direction": normalize_dir(parsed.get("direction"), fallback["direction"]),
        "tradeStyle": str(parsed.get("tradeStyle") or fallback["tradeStyle"]).strip().upper(),
        "confidence": max(35.0, min(95.0, float(parsed.get("confidence", fallback["confidence"])))),
        "summary": str(parsed.get("summary") or fallback["summary"]).strip(),
        "reasoning": str(parsed.get("reasoning") or fallback["reasoning"]).strip(),
        "horizon": str(parsed.get("horizon") or fallback["horizon"]).strip(),
        "chartLabel": str(parsed.get("chartLabel") or fallback["chartLabel"]).strip(),
        "expectedPath": str(parsed.get("expectedPath") or fallback["expectedPath"]).strip(),
        "newsBias": str(parsed.get("newsBias") or fallback["newsBias"]).strip(),
        "whyUp": str(parsed.get("whyUp") or "").strip(),
        "whyDown": str(parsed.get("whyDown") or "").strip(),
        "expectedDuration": str(parsed.get("expectedDuration") or fallback.get("expectedDuration", "")).strip(),
    }

    for key in ["scalpTrade", "longTrade"]:
        if key in parsed and isinstance(parsed[key], dict):
            p = parsed[key]
            result[key] = {
                "direction": normalize_dir(p.get("direction"), result["direction"]),
                "entry": float(p.get("entry", current_price)),
                "target": float(p.get("target", current_price)),
                "stop": float(p.get("stop", current_price)),
                "reasoning": str(p.get("reasoning", "")).strip(),
                "confidence": float(p.get("confidence", result["confidence"])),
                "expectedDuration": str(p.get("expectedDuration", "unknown")).strip()
            }
    
    return result

