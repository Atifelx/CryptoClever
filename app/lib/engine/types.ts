/**
 * Core types for Deep Market Structure Engine
 * All types are deterministic and pure
 */

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: number;
}

export interface Pivot {
  type: 'HIGH' | 'LOW';
  price: number;
  index: number;
  time: number;
}

export type MarketStructure = 'Bullish' | 'Bearish' | 'Range';

export type MarketRegime = 'EXPANSION' | 'COMPRESSION' | 'TREND' | 'RANGE';

export interface TradingZone {
  type: 'BUY' | 'SELL';
  entryPrice: number;
  profitTarget: number;
  stopLoss: number;
  confidence: number;
  reasoning: string;
  time: number;
}

export interface AnalysisResult {
  structure: MarketStructure;
  regime: MarketRegime;
  impulseScore: number;
  confidence: number;
  pivots: Pivot[];
  reasoning: string; // Human-readable explanation
  zones: TradingZone[]; // Buy/sell zones with profit targets
}
