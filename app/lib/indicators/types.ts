/**
 * Type definitions for trading indicators
 * Reuses Candle type from binance.ts
 */

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface SemaforPoint {
  time: number;
  price: number;
  type: 'high' | 'low';
  strength: 1 | 2 | 3; // 1=weak, 2=medium, 3=strong
  barIndex: number;
  signal?: 'BUY' | 'SELL' | null; // Buy/sell signal based on price action
  signalStrength?: 1 | 2 | 3; // Strength of buy/sell signal
}

export interface FMCBRLevels {
  fibonacci: FibonacciLevel[];
  murrayMath: number[];
  camarilla: CamarillaLevels;
  bollinger: BollingerBands;
  keyLevels: KeyLevel[];
}

export interface FibonacciLevel {
  level: number;
  price: number;
  label: string;
}

export interface CamarillaLevels {
  R4: number;
  R3: number;
  R2: number;
  R1: number;
  PP: number;
  S1: number;
  S2: number;
  S3: number;
  S4: number;
}

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
}

export interface KeyLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: number;
  source: string;
}

export interface TradingSignal {
  signal: 'BUY' | 'SELL' | 'HOLD' | 'STRONG_BUY' | 'STRONG_SELL';
  confidence: number; // 0-100
  reasoning: string;
  priceTarget?: number;
  stopLoss?: number;
  timestamp: number;
}
