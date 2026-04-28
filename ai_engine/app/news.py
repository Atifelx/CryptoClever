from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote_plus
from typing import Any
from xml.etree import ElementTree

import httpx
from langchain_core.tools import tool

from app.config import (
    AI_ENGINE_NEWS_LOOKBACK_DAYS,
    AI_ENGINE_NEWS_RESULTS_LIMIT,
    AI_ENGINE_SEARCH_RESULTS_LIMIT,
    NEWSAPI_KEY,
)

logger = logging.getLogger(__name__)

POSITIVE_WORDS = {
    "approval",
    "adoption",
    "bullish",
    "breakout",
    "demand",
    "gain",
    "growth",
    "inflow",
    "record",
    "surge",
    "rally",
    "pump",
    "milestone",
    "upgrade",
    "institutional",
    "etf",
    "accumulation",
}

NEGATIVE_WORDS = {
    "ban",
    "bearish",
    "drop",
    "hack",
    "lawsuit",
    "liquidation",
    "outflow",
    "selloff",
    "slump",
    "weak",
    "crash",
    "dump",
    "regulation",
    "crackdown",
    "investigation",
    "bankruptcy",
    "fraud",
}


def _normalize_news_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": str(item.get("title") or item.get("headline") or "Untitled").strip(),
        "snippet": str(item.get("snippet") or item.get("body") or item.get("description") or "").strip()[:240],
        "url": str(item.get("url") or item.get("href") or item.get("link") or "").strip(),
        "source": str(item.get("source") or item.get("provider") or item.get("source_name") or "unknown").strip(),
        "publishedAt": str(item.get("publishedAt") or item.get("date") or item.get("published") or "") or None,
    }


def _fetch_google_news(query: str, limit: int) -> list[dict[str, Any]]:
    url = f"https://news.google.com/rss/search?q={quote_plus(query)}&hl=en-US&gl=US&ceid=US:en"
    response = httpx.get(url, timeout=10.0)
    response.raise_for_status()

    root = ElementTree.fromstring(response.text)
    items: list[dict[str, Any]] = []
    for item in root.findall("./channel/item")[:limit]:
        items.append(
            _normalize_news_item(
                {
                    "title": item.findtext("title"),
                    "url": item.findtext("link"),
                    "publishedAt": item.findtext("pubDate"),
                    "source": item.findtext("source"),
                    "description": item.findtext("description"),
                }
            )
        )
    return items


def _fetch_forex_factory_calendar() -> list[dict[str, Any]]:
    """Scrape Forex Factory calendar for high-impact economic events.
    
    Returns upcoming/recent events that could move markets.
    Falls back gracefully if Forex Factory is unreachable.
    """
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml",
        }
        response = httpx.get(
            "https://www.forexfactory.com/calendar?day=today",
            headers=headers,
            timeout=12.0,
            follow_redirects=True,
        )
        if response.status_code != 200:
            logger.info("Forex Factory returned %s, skipping calendar", response.status_code)
            return []

        text = response.text
        events: list[dict[str, Any]] = []

        # Parse high/medium impact events from the HTML
        # Look for impact indicators and event text
        high_impact_pattern = re.compile(
            r'class="[^"]*calendar__impact[^"]*high[^"]*".*?'
            r'class="[^"]*calendar__event-title[^"]*">([^<]+)<',
            re.DOTALL | re.IGNORECASE,
        )
        medium_impact_pattern = re.compile(
            r'class="[^"]*calendar__impact[^"]*medium[^"]*".*?'
            r'class="[^"]*calendar__event-title[^"]*">([^<]+)<',
            re.DOTALL | re.IGNORECASE,
        )

        for match in high_impact_pattern.finditer(text):
            events.append({
                "title": f"[HIGH IMPACT] {match.group(1).strip()}",
                "snippet": "High-impact economic event from Forex Factory calendar",
                "source": "ForexFactory",
                "url": "https://www.forexfactory.com/calendar",
                "publishedAt": datetime.now(timezone.utc).isoformat(),
            })

        for match in medium_impact_pattern.finditer(text):
            events.append({
                "title": f"[MEDIUM IMPACT] {match.group(1).strip()}",
                "snippet": "Medium-impact economic event from Forex Factory calendar",
                "source": "ForexFactory",
                "url": "https://www.forexfactory.com/calendar",
                "publishedAt": datetime.now(timezone.utc).isoformat(),
            })

        if not events:
            # Fallback: try to extract any event-title class content
            title_pattern = re.compile(
                r'calendar__event-title[^>]*>([^<]+)<', re.IGNORECASE
            )
            for i, match in enumerate(title_pattern.finditer(text)):
                if i >= 8:
                    break
                events.append({
                    "title": f"[ECON] {match.group(1).strip()}",
                    "snippet": "Economic event from Forex Factory",
                    "source": "ForexFactory",
                    "url": "https://www.forexfactory.com/calendar",
                    "publishedAt": datetime.now(timezone.utc).isoformat(),
                })

        logger.info("Forex Factory: found %d calendar events", len(events))
        return events[:8]

    except Exception as exc:
        logger.info("Forex Factory calendar fetch failed (non-critical): %s", exc)
        return []


def _dedupe(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    output: list[dict[str, Any]] = []
    for item in items:
        key = item.get("url") or item.get("title")
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(item)
    return output


@tool("market_news_search")
def market_news_search(query: str) -> str:
    """Search live market news headlines for the requested instrument."""
    if NEWSAPI_KEY:
        params = {
            "q": query,
            "language": "en",
            "sortBy": "publishedAt",
            "pageSize": AI_ENGINE_NEWS_RESULTS_LIMIT,
            "from": (datetime.now(timezone.utc) - timedelta(days=AI_ENGINE_NEWS_LOOKBACK_DAYS)).date().isoformat(),
        }
        response = httpx.get(
            "https://newsapi.org/v2/everything",
            params=params,
            headers={"X-Api-Key": NEWSAPI_KEY},
            timeout=10.0,
        )
        response.raise_for_status()
        payload = response.json()
        articles = [_normalize_news_item(article) for article in payload.get("articles", [])]
        return json.dumps(_dedupe(articles)[:AI_ENGINE_NEWS_RESULTS_LIMIT])

    articles = _fetch_google_news(query, AI_ENGINE_NEWS_RESULTS_LIMIT)
    return json.dumps(_dedupe(articles)[:AI_ENGINE_NEWS_RESULTS_LIMIT])


@tool("market_web_search")
def market_web_search(query: str) -> str:
    """Search the live web for catalysts, macro drivers, and recent discussion relevant to the instrument."""
    results = _fetch_google_news(query, AI_ENGINE_SEARCH_RESULTS_LIMIT)
    return json.dumps(_dedupe(results)[:AI_ENGINE_SEARCH_RESULTS_LIMIT])


@tool("forex_factory_calendar")
def forex_factory_calendar(query: str = "") -> str:
    """Fetch today's high-impact economic events from Forex Factory calendar.
    
    Use this to check for upcoming or recent economic releases
    (NFP, CPI, FOMC, GDP, etc.) that could cause sudden price movements.
    The query parameter is ignored — always returns today's calendar.
    """
    events = _fetch_forex_factory_calendar()
    if not events:
        return json.dumps([{"title": "No high-impact events found for today", "source": "ForexFactory"}])
    return json.dumps(events)


def _estimate_news_bias(items: list[dict[str, Any]]) -> dict[str, Any]:
    score = 0
    for item in items:
        haystack = f"{item.get('title', '')} {item.get('snippet', '')}".lower()
        score += sum(1 for word in POSITIVE_WORDS if word in haystack)
        score -= sum(1 for word in NEGATIVE_WORDS if word in haystack)

    if score > 1:
        label = "bullish"
    elif score < -1:
        label = "bearish"
    else:
        label = "neutral"

    return {"score": score, "label": label}


def _summarize_news(items: list[dict[str, Any]], bias: dict[str, Any]) -> str:
    if not items:
        return "No meaningful fresh headlines were found, so price action should carry more weight."

    sources = [item.get("source") for item in items[:3] if item.get("source")]
    lead_titles = [item.get("title") for item in items[:2] if item.get("title")]
    if bias["label"] == "bullish":
      tone = "Headlines lean bullish"
    elif bias["label"] == "bearish":
      tone = "Headlines lean bearish"
    else:
      tone = "Headlines are mixed"

    source_text = f" from {', '.join(sources)}" if sources else ""
    title_text = f" Key themes: {' | '.join(lead_titles)}." if lead_titles else ""
    return f"{tone}{source_text}.{title_text}"


def _safe_parse_tool_output(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return []
    else:
        parsed = raw
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, dict)]


async def collect_market_intel(symbol: str, instrument_label: str) -> dict[str, Any]:
    """Collect market intelligence from multiple sources: NewsAPI/Google News, web search, and Forex Factory."""
    headline_query = f"{instrument_label} market news OR {symbol} price action"
    macro_query = f"{instrument_label} macro catalyst support resistance news"

    # Run all three data sources in parallel
    raw_news, raw_web, raw_ff = await asyncio.gather(
        asyncio.to_thread(market_news_search.invoke, {"query": headline_query}),
        asyncio.to_thread(market_web_search.invoke, {"query": macro_query}),
        asyncio.to_thread(forex_factory_calendar.invoke, {"query": ""}),
    )

    combined = _dedupe(
        _safe_parse_tool_output(raw_news)
        + _safe_parse_tool_output(raw_web)
        + _safe_parse_tool_output(raw_ff)
    )
    bias = _estimate_news_bias(combined)
    return {
        "items": combined[: AI_ENGINE_NEWS_RESULTS_LIMIT + 5],
        "bias": bias,
        "summary": _summarize_news(combined, bias),
    }
