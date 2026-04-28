from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class NewsItem(BaseModel):
    title: str
    snippet: str = ""
    url: str = ""
    source: str = "unknown"
    publishedAt: Optional[str] = None


class PivotPoint(BaseModel):
    type: Literal["HIGH", "LOW"]
    price: float
    index: int
    time: int


class TradingZone(BaseModel):
    type: Literal["BUY", "SELL"]
    entryPrice: float
    profitTarget: float
    stopLoss: float
    confidence: float
    reasoning: str
    time: int


class TradeSetup(BaseModel):
    """Individual trade plan for a specific horizon (scalp or long)."""
    direction: Literal["BUY", "SELL"]
    entry: float
    target: float
    stop: float
    expectedDuration: str  # e.g. "~20 minutes", "~2-4 hours"
    reasoning: str
    confidence: float = 50.0


class Prediction(BaseModel):
    direction: Literal["BUY", "SELL"]
    tradeStyle: Literal["SCALP", "HOLD"]
    confidence: float
    summary: str
    reasoning: str
    horizon: str
    currentPrice: float
    targetPrice: float
    stopLoss: float
    chartLabel: str
    expectedPath: str
    newsBias: str
    # New deep-analysis fields
    whyUp: str = ""
    whyDown: str = ""
    expectedDuration: str = ""
    scalpTrade: Optional[TradeSetup] = None
    longTrade: Optional[TradeSetup] = None


class SupportResistance(BaseModel):
    supportLevels: list[float] = Field(default_factory=list)
    resistanceLevels: list[float] = Field(default_factory=list)
    lastSwingLow: Optional[float] = None
    lastSwingHigh: Optional[float] = None


class AnalysisResponse(BaseModel):
    structure: str
    regime: str
    impulseScore: float
    confidence: float
    trend: str
    ema20: float
    ema50: float
    pivots: list[PivotPoint]
    zones: list[TradingZone]
    reasoning: str
    prediction: Prediction
    supportResistance: SupportResistance
    news: list[NewsItem]
    markers: list[dict[str, Any]] = Field(default_factory=list)
    aiPowered: bool
    analysisSource: str = "ai-engine"
    model: Optional[str] = None
