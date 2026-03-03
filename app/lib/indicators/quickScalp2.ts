/**
 * QuickScalp 2.0 Indicator - 1-minute BTC scalping
 *
 * Designed for 1m BTC. Research-based logic:
 * - RSI 7 (fast) + RSI 21 (reliable), 30/70; confluence when both agree
 * - EMA 9/21/50 + fresh 9/21 crossover for momentum
 * - VWAP (60) fair value; pullback bounce when price near VWAP
 * - MACD 12/26/9, Stoch 14/3, BB 20 + %B; squeeze then breakout + volume
 * Only uses CLOSED candles (no repainting).
 */

import type { Candle } from '../../store/candlesStore';

export interface SignalBreakdown {
  trend: {
    score: number;
    status: string;
    emaAlignment: string;
  };
  momentum: {
    score: number;
    status: string;
    rsi: number;
  };
  volume: {
    score: number;
    status: string;
    ratio: number;
  };
  orderFlow: {
    score: number;
    status: string;
    bodyStatus: string;
    buyPressure: number;
  };
  vwap: {
    score: number;
    status: string;
  };
  volatility: {
    multiplier: number;
    status: string;
    atrPercent: number;
  };
}

export interface QuickScalp2Result {
  signal: 'LONG' | 'SHORT' | 'WAIT';
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  confidence?: number;
  signalStrength?: number; // -100 to +100
  reason: string;
  regime?: string;
  rsi?: number;
  adx?: number;
  breakdown?: SignalBreakdown; // Detailed breakdown per LiveSignalAnalyzer
}

export interface QuickScalp2Marker {
  time: number;
  signal: 'LONG' | 'SHORT';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  signalStrength: number;
  reason: string;
  regime?: string;
}

export type QuickScalp2DisplayItem =
  | QuickScalp2Marker
  | { time: number; signal: 'WAIT'; reason: string };

// ─── Helper Functions ───

function calculateEMA(data: number[], period: number): number[] {
  if (data.length === 0) return [];
  
  const multiplier = 2 / (period + 1);
  const ema: number[] = [data[0]];

  for (let i = 1; i < data.length; i++) {
    const value = (data[i] - ema[i - 1]) * multiplier + ema[i - 1];
    ema.push(value);
  }

  return ema;
}

function calculateSMA(data: number[], period: number): number[] {
  if (data.length < period) return [];
  
  const sma: number[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma.push(sum / period);
  }
  return sma;
}

function calculateRSI(data: number[], period: number): number[] {
  if (data.length < period + 1) return [];
  
  const rsi: number[] = [];
  const deltas: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    deltas.push(data[i] - data[i - 1]);
  }
  
  let gains = 0;
  let losses = 0;
  for (let i = 0; i < period; i++) {
    if (deltas[i] > 0) gains += deltas[i];
    else losses += Math.abs(deltas[i]);
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  if (avgLoss === 0) {
    rsi.push(100);
  } else {
    const rs = avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));
  }
  
  for (let i = period; i < deltas.length; i++) {
    const delta = deltas[i];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    
    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }
  }
  
  return rsi;
}

function calculateATR(candles: Candle[], period: number): number[] {
  if (candles.length < period + 1) return [];
  
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    
    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    
    tr.push(Math.max(tr1, tr2, tr3));
  }
  
  const atr: number[] = [];
  for (let i = period - 1; i < tr.length; i++) {
    const sum = tr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    atr.push(sum / period);
  }
  
  return atr;
}

function calculateBollingerBands(
  closes: number[],
  period: number,
  stdDev: number
): { middle: number[]; upper: number[]; lower: number[] } {
  const middle = calculateSMA(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  
  for (let i = period - 1; i < closes.length; i++) {
    const window = closes.slice(i - period + 1, i + 1);
    const mean = middle[middle.length - (closes.length - i)];
    const variance = window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    
    upper.push(mean + std * stdDev);
    lower.push(mean - std * stdDev);
  }
  
  return { middle, upper, lower };
}

function calculateVWAP(candles: Candle[]): number[] {
  const vwap: number[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const vol = candle.volume ?? 0;
    cumulativeTPV += typicalPrice * vol;
    cumulativeVolume += vol;
    
    vwap.push(cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice);
  }
  
  return vwap;
}

/** MACD: 12/26/9. Needs 35+ candles min, 50+ for full histogram. */
function calculateMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { macd: number[]; signal: number[]; histogram: number[] } {
  if (closes.length < slowPeriod + signalPeriod) {
    return { macd: [], signal: [], histogram: [] };
  }
  const emaFast = calculateEMA(closes, fastPeriod);
  const emaSlow = calculateEMA(closes, slowPeriod);
  const macdRaw: number[] = [];
  const start = Math.max(emaFast.length - (closes.length - emaSlow.length), 0);
  const n = Math.min(emaFast.length, emaSlow.length);
  for (let i = 0; i < n; i++) {
    const f = emaFast[emaFast.length - n + i];
    const s = emaSlow[emaSlow.length - n + i];
    macdRaw.push(f - s);
  }
  const signalLine = calculateEMA(macdRaw, signalPeriod);
  const histogram: number[] = [];
  for (let i = 0; i < signalLine.length; i++) {
    const idx = macdRaw.length - signalLine.length + i;
    if (idx >= 0) histogram.push(macdRaw[idx] - signalLine[i]);
    else histogram.push(0);
  }
  return { macd: macdRaw, signal: signalLine, histogram };
}

/** Stochastic %K (14) and %D (3). 20+ candles for reliable crossovers. */
function calculateStochastic(
  candles: Candle[],
  kPeriod = 14,
  dPeriod = 3
): { k: number[]; d: number[] } {
  if (candles.length < kPeriod) return { k: [], d: [] };
  const k: number[] = [];
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const window = candles.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...window.map(c => c.high));
    const low = Math.min(...window.map(c => c.low));
    const close = candles[i].close;
    const range = high - low;
    k.push(range > 0 ? ((close - low) / range) * 100 : 50);
  }
  const d = calculateSMA(k, dPeriod);
  return { k, d };
}

function calculateRollingVWAP(candles: Candle[], window: number): number[] {
  const vwap: number[] = [];
  
  for (let i = window - 1; i < candles.length; i++) {
    const windowCandles = candles.slice(i - window + 1, i + 1);
    let tpv = 0;
    let vol = 0;
    
    for (const candle of windowCandles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume ?? 0;
      tpv += typicalPrice * volume;
      vol += volume;
    }
    
    vwap.push(vol > 0 ? tpv / vol : candles[i].close);
  }
  
  return vwap;
}

function calculateADX(candles: Candle[], period: number): number[] {
  if (candles.length < period * 2) return [];
  
  const atr = calculateATR(candles, period);
  if (atr.length === 0) return [];
  
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const highDiff = candles[i].high - candles[i - 1].high;
    const lowDiff = candles[i - 1].low - candles[i].low;
    
    if (highDiff > lowDiff && highDiff > 0) {
      plusDM.push(highDiff);
    } else {
      plusDM.push(0);
    }
    
    if (lowDiff > highDiff && lowDiff > 0) {
      minusDM.push(lowDiff);
    } else {
      minusDM.push(0);
    }
  }
  
  const plusDI: number[] = [];
  const minusDI: number[] = [];
  
  for (let i = period - 1; i < plusDM.length; i++) {
    const plusDMSum = plusDM.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const minusDMSum = minusDM.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const atrValue = atr[i - period + 1];
    
    if (atrValue > 0) {
      plusDI.push(100 * (plusDMSum / period) / atrValue);
      minusDI.push(100 * (minusDMSum / period) / atrValue);
    } else {
      plusDI.push(0);
      minusDI.push(0);
    }
  }
  
  const dx: number[] = [];
  for (let i = 0; i < plusDI.length; i++) {
    const sum = plusDI[i] + minusDI[i];
    if (sum > 0) {
      dx.push(100 * Math.abs(plusDI[i] - minusDI[i]) / sum);
    } else {
      dx.push(0);
    }
  }
  
  const adx: number[] = [];
  for (let i = period - 1; i < dx.length; i++) {
    const sum = dx.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    adx.push(sum / period);
  }
  
  return adx;
}

interface IndicatorData {
  ema5: number[];
  ema10: number[];
  ema20: number[];
  ema50: number[];
  ema100: number[];
  ema200: number[];
  emaAlignment: number[];
  buyPressure: number[];
  buyPressureMA: number[];
  bodyRatio: number[];
  wickRatio: number[];
  volumeRatio: number[];
  vwap: number[];
  vwap50: number[];
  atr: number[];
  atrPercent: number[];
  bbMiddle: number[];
  bbUpper: number[];
  bbLower: number[];
  bbPosition: number[];
  rsi: number[];
  stochRSI: number[];
  roc5: number[];
  roc10: number[];
  adx: number[];
  swingHigh: number[];
  swingLow: number[];
}

function calculateAdvancedIndicators(candles: Candle[]): IndicatorData {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const opens = candles.map(c => c.open);
  const volumes = candles.map(c => c.volume ?? 0);
  
  // EMAs
  const ema5 = calculateEMA(closes, 5);
  const ema10 = calculateEMA(closes, 10);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema100 = calculateEMA(closes, 100);
  const ema200 = calculateEMA(closes, 200);
  
  // EMA Alignment Score
  const emaAlignment: number[] = [];
  const minLength = Math.min(ema5.length, ema10.length, ema20.length, ema50.length, ema100.length, ema200.length);
  for (let i = 0; i < minLength; i++) {
    const idx5 = ema5.length - minLength + i;
    const idx10 = ema10.length - minLength + i;
    const idx20 = ema20.length - minLength + i;
    const idx50 = ema50.length - minLength + i;
    const idx100 = ema100.length - minLength + i;
    const idx200 = ema200.length - minLength + i;
    
    let score = 0;
    if (ema5[idx5] > ema10[idx10]) score++;
    if (ema10[idx10] > ema20[idx20]) score++;
    if (ema20[idx20] > ema50[idx50]) score++;
    if (ema50[idx50] > ema100[idx100]) score++;
    if (ema100[idx100] > ema200[idx200]) score++;
    emaAlignment.push(score);
  }
  
  // Buy Pressure
  const buyPressure: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const range = highs[i] - lows[i];
    if (range > 0) {
      buyPressure.push((closes[i] - lows[i]) / range);
    } else {
      buyPressure.push(0.5);
    }
  }
  const buyPressureMA = calculateSMA(buyPressure, 10);
  
  // Body Ratio
  const bodyRatio: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const bodySize = Math.abs(closes[i] - opens[i]);
    const totalRange = highs[i] - lows[i];
    bodyRatio.push(totalRange > 0 ? bodySize / totalRange : 0);
  }
  
  // Wick Ratio
  const wickRatio: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const upperWick = highs[i] - Math.max(opens[i], closes[i]);
    const lowerWick = Math.min(opens[i], closes[i]) - lows[i];
    const totalRange = highs[i] - lows[i];
    wickRatio.push(totalRange > 0 ? (upperWick - lowerWick) / totalRange : 0);
  }
  
  // Volume Ratio
  const volumeMA10 = calculateSMA(volumes, 10);
  const volumeMA20 = calculateSMA(volumes, 20);
  const volumeRatio: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const volMA20Idx = volumeMA20.length - (candles.length - i);
    if (volMA20Idx >= 0 && volumeMA20[volMA20Idx] > 0) {
      volumeRatio.push(volumes[i] / volumeMA20[volMA20Idx]);
    } else {
      volumeRatio.push(1);
    }
  }
  
  // VWAP
  const vwap = calculateVWAP(candles);
  const vwap50 = calculateRollingVWAP(candles, 50);
  
  // ATR
  const atr = calculateATR(candles, 14);
  const atrPercent: number[] = [];
  for (let i = 0; i < atr.length; i++) {
    const closeIdx = closes.length - atr.length + i;
    atrPercent.push((atr[i] / closes[closeIdx]) * 100);
  }
  
  // Bollinger Bands
  const bb = calculateBollingerBands(closes, 20, 2);
  const bbPosition: number[] = [];
  for (let i = 0; i < bb.middle.length; i++) {
    const closeIdx = closes.length - bb.middle.length + i;
    const range = bb.upper[i] - bb.lower[i];
    if (range > 0) {
      bbPosition.push((closes[closeIdx] - bb.lower[i]) / range);
    } else {
      bbPosition.push(0.5);
    }
  }
  
  // RSI
  const rsi = calculateRSI(closes, 14);
  
  // Stochastic RSI
  const stochRSI: number[] = [];
  for (let i = 13; i < rsi.length; i++) {
    const rsiWindow = rsi.slice(i - 13, i + 1);
    const rsiMin = Math.min(...rsiWindow);
    const rsiMax = Math.max(...rsiWindow);
    const range = rsiMax - rsiMin;
    stochRSI.push(range > 0 ? (rsi[i] - rsiMin) / range : 0.5);
  }
  
  // ROC
  const roc5: number[] = [];
  const roc10: number[] = [];
  for (let i = 5; i < closes.length; i++) {
    roc5.push(((closes[i] - closes[i - 5]) / closes[i - 5]) * 100);
  }
  for (let i = 10; i < closes.length; i++) {
    roc10.push(((closes[i] - closes[i - 10]) / closes[i - 10]) * 100);
  }
  
  // ADX
  const adx = calculateADX(candles, 14);
  
  // Swing High/Low
  const swingHigh: number[] = [];
  const swingLow: number[] = [];
  for (let i = 5; i < candles.length - 5; i++) {
    const window = candles.slice(i - 5, i + 6);
    swingHigh.push(Math.max(...window.map(c => c.high)));
    swingLow.push(Math.min(...window.map(c => c.low)));
  }
  
  return {
    ema5,
    ema10,
    ema20,
    ema50,
    ema100,
    ema200,
    emaAlignment,
    buyPressure,
    buyPressureMA,
    bodyRatio,
    wickRatio,
    volumeRatio,
    vwap,
    vwap50,
    atr,
    atrPercent,
    bbMiddle: bb.middle,
    bbUpper: bb.upper,
    bbLower: bb.lower,
    bbPosition,
    rsi,
    stochRSI,
    roc5,
    roc10,
    adx,
    swingHigh,
    swingLow,
  };
}

function detectMarketRegime(
  indicators: IndicatorData,
  candles: Candle[],
  idx: number
): { regime: string; confidence: number } {
  if (idx < 100) {
    return { regime: 'neutral', confidence: 0.5 };
  }
  
  const lookbackStart = Math.max(0, idx - 100);
  const lookbackEnd = idx;
  
  // Get ADX
  const adxIdx = indicators.adx.length - (candles.length - idx);
  const adx = adxIdx >= 0 ? indicators.adx[adxIdx] : 20;
  
  // Get ATR
  const atrIdx = indicators.atr.length - (candles.length - idx);
  const atr = atrIdx >= 0 ? indicators.atr[atrIdx] : 0;
  
  // Average ATR
  const atrWindow = indicators.atr.slice(Math.max(0, atrIdx - 19), atrIdx + 1);
  const avgATR = atrWindow.length > 0 ? atrWindow.reduce((a, b) => a + b, 0) / atrWindow.length : atr;
  const volatilityRatio = avgATR > 0 ? atr / avgATR : 1;
  
  // Get EMAs
  const ema20Idx = indicators.ema20.length - (candles.length - idx);
  const ema50Idx = indicators.ema50.length - (candles.length - idx);
  const ema20 = ema20Idx >= 0 ? indicators.ema20[ema20Idx] : candles[idx].close;
  const ema50 = ema50Idx >= 0 ? indicators.ema50[ema50Idx] : candles[idx].close;
  const price = candles[idx].close;
  
  // Price range
  const lookbackCandles = candles.slice(lookbackStart, lookbackEnd);
  const high100 = Math.max(...lookbackCandles.map(c => c.high));
  const low100 = Math.min(...lookbackCandles.map(c => c.low));
  const rangePosition = high100 !== low100 ? (price - low100) / (high100 - low100) : 0.5;
  
  // Determine regime
  if (adx > 25 && ema20 > ema50 && rangePosition > 0.6) {
    return { regime: 'trending_up', confidence: Math.min(adx / 40, 1.0) };
  } else if (adx > 25 && ema20 < ema50 && rangePosition < 0.4) {
    return { regime: 'trending_down', confidence: Math.min(adx / 40, 1.0) };
  } else if (volatilityRatio > 1.5) {
    return { regime: 'volatile', confidence: Math.min(volatilityRatio / 2, 1.0) };
  } else if (adx < 20) {
    return { regime: 'ranging', confidence: 1.0 - (adx / 20) };
  } else {
    return { regime: 'neutral', confidence: 0.5 };
  }
}

function detectPricePatterns(candles: Candle[], idx: number): Record<string, boolean> {
  if (idx < 2) return {};
  
  const patterns: Record<string, boolean> = {};
  const c0 = candles[idx];
  const c1 = candles[idx - 1];
  const c2 = idx >= 2 ? candles[idx - 2] : null;
  
  const bodyC0 = Math.abs(c0.close - c0.open);
  const lowerWickC0 = Math.min(c0.open, c0.close) - c0.low;
  const upperWickC0 = c0.high - Math.max(c0.open, c0.close);
  
  // Hammer
  if (lowerWickC0 > bodyC0 * 2 && upperWickC0 < bodyC0 * 0.5) {
    patterns['hammer'] = true;
  }
  
  // Bullish engulfing
  if (c1.close < c1.open && c0.close > c0.open && c0.open < c1.close && c0.close > c1.open) {
    patterns['bullish_engulfing'] = true;
  }
  
  // Three white soldiers
  if (c2 && c2.close > c2.open && c1.close > c1.open && c0.close > c0.open &&
      c1.close > c2.close && c0.close > c1.close) {
    patterns['three_white_soldiers'] = true;
  }
  
  // Shooting star
  if (upperWickC0 > bodyC0 * 2 && lowerWickC0 < bodyC0 * 0.5) {
    patterns['shooting_star'] = true;
  }
  
  // Bearish engulfing
  if (c1.close > c1.open && c0.close < c0.open && c0.open > c1.close && c0.close < c1.open) {
    patterns['bearish_engulfing'] = true;
  }
  
  // Three black crows
  if (c2 && c2.close < c2.open && c1.close < c1.open && c0.close < c0.open &&
      c1.close < c2.close && c0.close < c1.close) {
    patterns['three_black_crows'] = true;
  }
  
  return patterns;
}

/**
 * Calculate detailed signal breakdown (per LiveSignalAnalyzer)
 */
function calculateDetailedBreakdown(
  indicators: IndicatorData,
  candles: Candle[],
  idx: number
): SignalBreakdown {
  const c = candles[idx];
  
  // Get indicator indices
  const ema5Idx = indicators.ema5.length - (candles.length - idx);
  const ema10Idx = indicators.ema10.length - (candles.length - idx);
  const ema20Idx = indicators.ema20.length - (candles.length - idx);
  const ema50Idx = indicators.ema50.length - (candles.length - idx);
  const ema100Idx = indicators.ema100.length - (candles.length - idx);
  const rsiIdx = indicators.rsi.length - (candles.length - idx);
  const volRatioIdx = indicators.volumeRatio.length - (candles.length - idx);
  const buyPressIdx = idx;
  const bodyRatioIdx = idx;
  const vwap50Idx = indicators.vwap50.length - (candles.length - idx);
  const atrIdx = indicators.atrPercent.length - (candles.length - idx);
  
  // 1. TREND ANALYSIS
  let emaAlignment = 0;
  const ema5 = ema5Idx >= 0 ? indicators.ema5[ema5Idx] : c.close;
  const ema10 = ema10Idx >= 0 ? indicators.ema10[ema10Idx] : c.close;
  const ema20 = ema20Idx >= 0 ? indicators.ema20[ema20Idx] : c.close;
  const ema50 = ema50Idx >= 0 ? indicators.ema50[ema50Idx] : c.close;
  const ema100 = ema100Idx >= 0 ? indicators.ema100[ema100Idx] : c.close;
  
  if (ema5 > ema10) emaAlignment++;
  if (ema10 > ema20) emaAlignment++;
  if (ema20 > ema50) emaAlignment++;
  if (ema50 > ema100) emaAlignment++;
  
  let trendScore = (emaAlignment - 2) * 6.25; // -12.5 to +12.5
  
  let trendStatus: string;
  if (c.close > ema20 && c.close > ema50) {
    trendScore += 12;
    trendStatus = "BULLISH (above key EMAs)";
  } else if (c.close < ema20 && c.close < ema50) {
    trendScore -= 12;
    trendStatus = "BEARISH (below key EMAs)";
  } else {
    trendStatus = "NEUTRAL (mixed EMAs)";
  }
  
  // 2. MOMENTUM
  const rsi = rsiIdx >= 0 ? indicators.rsi[rsiIdx] : 50;
  let momentumScore = 0;
  let rsiStatus: string;
  
  if (rsi > 30 && rsi < 45) {
    momentumScore += 10;
    rsiStatus = "BULLISH (oversold recovery)";
  } else if (rsi > 55 && rsi < 70) {
    momentumScore -= 10;
    rsiStatus = "BEARISH (overbought)";
  } else if (rsi < 25) {
    momentumScore += 15;
    rsiStatus = "EXTREME OVERSOLD";
  } else if (rsi > 75) {
    momentumScore -= 15;
    rsiStatus = "EXTREME OVERBOUGHT";
  } else {
    rsiStatus = `NEUTRAL (RSI: ${rsi.toFixed(1)})`;
  }
  
  // 3. ORDER FLOW (before volume so baseSignalDirection can use it)
  const buyPressure = buyPressIdx >= 0 ? indicators.buyPressure[buyPressIdx] : 0.5;
  const bodyRatio = bodyRatioIdx >= 0 ? indicators.bodyRatio[bodyRatioIdx] : 0.5;
  
  let orderFlowScore = 0;
  let flowStatus: string;
  let bodyStatus: string;
  
  if (buyPressure > 0.7) {
    orderFlowScore += 12;
    flowStatus = `BUYERS IN CONTROL (${buyPressure.toFixed(2)})`;
  } else if (buyPressure < 0.3) {
    orderFlowScore -= 12;
    flowStatus = `SELLERS IN CONTROL (${buyPressure.toFixed(2)})`;
  } else {
    flowStatus = `NEUTRAL (${buyPressure.toFixed(2)})`;
  }
  
  if (bodyRatio > 0.6) {
    if (c.close > c.open) {
      orderFlowScore += 8;
      bodyStatus = "STRONG BULLISH CANDLE";
    } else {
      orderFlowScore -= 8;
      bodyStatus = "STRONG BEARISH CANDLE";
    }
  } else {
    bodyStatus = "Weak candle (indecision)";
  }
  
  // 4. VWAP
  const vwap50 = vwap50Idx >= 0 ? indicators.vwap50[vwap50Idx] : c.close;
  let vwapScore = 0;
  let vwapStatus: string;
  
  if (c.close > vwap50) {
    vwapScore += 7;
    vwapStatus = "ABOVE VWAP (bullish)";
  } else {
    vwapScore -= 7;
    vwapStatus = "BELOW VWAP (bearish)";
  }
  
  const vwapDist = ((c.close - vwap50) / vwap50) * 100;
  if (Math.abs(vwapDist) > 0.3) {
    vwapStatus += ` | ${Math.abs(vwapDist).toFixed(2)}% away (mean reversion zone)`;
  }
  
  // 5. VOLUME (per LiveSignalAnalyzer)
  const volumeRatio = volRatioIdx >= 0 ? indicators.volumeRatio[volRatioIdx] : 1;
  let volumeScore = 0;
  let volStatus: string;
  
  const baseSignalDirection = trendScore + momentumScore + orderFlowScore + vwapScore;
  
  if (volumeRatio > 1.5) {
    const volMultiplier = Math.min(volumeRatio / 2, 1.0);
    const volBoost = 15 * volMultiplier;
    if (baseSignalDirection > 0) {
      volumeScore = volBoost;
      volStatus = `STRONG CONFIRMATION (${volumeRatio.toFixed(1)}x avg)`;
    } else if (baseSignalDirection < 0) {
      volumeScore = -volBoost;
      volStatus = `STRONG CONFIRMATION (${volumeRatio.toFixed(1)}x avg)`;
    } else {
      volStatus = "High volume but no direction";
    }
  } else if (volumeRatio > 1.2) {
    volStatus = `MODERATE (${volumeRatio.toFixed(1)}x avg)`;
  } else {
    volStatus = `WEAK (${volumeRatio.toFixed(1)}x avg) - AVOID`;
  }
  
  // 6. VOLATILITY
  const atrPercent = atrIdx >= 0 ? indicators.atrPercent[atrIdx] : 0.5;
  let volatilityMult = 1.0;
  let volContext: string;
  
  if (atrPercent > 0.6) {
    volatilityMult = 0.7;
    volContext = `HIGH VOLATILITY (${atrPercent.toFixed(2)}%) - Reduce position size`;
  } else if (atrPercent < 0.3) {
    volContext = `LOW VOLATILITY (${atrPercent.toFixed(2)}%) - Normal size`;
  } else {
    volContext = `NORMAL VOLATILITY (${atrPercent.toFixed(2)}%)`;
  }
  
  return {
    trend: {
      score: Math.round(trendScore * 10) / 10,
      status: trendStatus,
      emaAlignment: `${emaAlignment}/4 EMAs aligned`,
    },
    momentum: {
      score: Math.round(momentumScore * 10) / 10,
      status: rsiStatus,
      rsi: Math.round(rsi * 10) / 10,
    },
    volume: {
      score: Math.round(volumeScore * 10) / 10,
      status: volStatus,
      ratio: Math.round(volumeRatio * 100) / 100,
    },
    orderFlow: {
      score: Math.round(orderFlowScore * 10) / 10,
      status: flowStatus,
      bodyStatus: bodyStatus,
      buyPressure: Math.round(buyPressure * 100) / 100,
    },
    vwap: {
      score: Math.round(vwapScore * 10) / 10,
      status: vwapStatus,
    },
    volatility: {
      multiplier: volatilityMult,
      status: volContext,
      atrPercent: Math.round(atrPercent * 100) / 100,
    },
  };
}

function calculateSignalStrength(
  indicators: IndicatorData,
  candles: Candle[],
  idx: number,
  regime: string,
  regimeConfidence: number
): { signalStrength: number; explanation: string } {
  if (idx < 200) {
    return { signalStrength: 0, explanation: 'insufficient_data' };
  }
  
  let signalScore = 0;
  const components: string[] = [];
  
  const c = candles[idx];
  
  // Get indicator values at current index
  const emaAlignIdx = indicators.emaAlignment.length - (candles.length - idx);
  const ema20Idx = indicators.ema20.length - (candles.length - idx);
  const ema50Idx = indicators.ema50.length - (candles.length - idx);
  const buyPressIdx = idx;
  const bodyRatioIdx = idx;
  const wickRatioIdx = idx;
  const volRatioIdx = idx;
  const vwap50Idx = indicators.vwap50.length - (candles.length - idx);
  const bbPosIdx = indicators.bbPosition.length - (candles.length - idx);
  const rsiIdx = indicators.rsi.length - (candles.length - idx);
  const stochRSIIdx = indicators.stochRSI.length - (candles.length - idx);
  const adxIdx = indicators.adx.length - (candles.length - idx);
  
  // 1. TREND ALIGNMENT (25 points) - Per Python algo
  const emaAlignment = emaAlignIdx >= 0 ? indicators.emaAlignment[emaAlignIdx] : 2.5;
  
  // Python algo: (ema_alignment - 2.5) * 5  # -12.5 to +12.5
  const emaScore = (emaAlignment - 2.5) * 5;
  signalScore += emaScore;
  components.push(`EMA_Align: ${emaScore.toFixed(1)}`);
  
  // Price vs key EMAs (per Python algo)
  const ema20 = ema20Idx >= 0 ? indicators.ema20[ema20Idx] : c.close;
  const ema50 = ema50Idx >= 0 ? indicators.ema50[ema50Idx] : c.close;
  
  if (c.close > ema20 && c.close > ema50) {
    signalScore += 7;
    components.push('Above_EMAs: +7');
  } else if (c.close < ema20 && c.close < ema50) {
    signalScore -= 7;
    components.push('Below_EMAs: -7');
  }
  
  // 2. MOMENTUM (20 points)
  const rsi = rsiIdx >= 0 ? indicators.rsi[rsiIdx] : 50;
  if (rsi > 30 && rsi < 45) {
    signalScore += 8;
    components.push('RSI_Bullish: +8');
  } else if (rsi > 55 && rsi < 70) {
    signalScore -= 8;
    components.push('RSI_Bearish: -8');
  } else if (rsi < 25) {
    signalScore += 12;
    components.push('RSI_Extreme_Bull: +12');
  } else if (rsi > 75) {
    signalScore -= 12;
    components.push('RSI_Extreme_Bear: -12');
  }
  
  const stochRSI = stochRSIIdx >= 0 ? indicators.stochRSI[stochRSIIdx] : 0.5;
  if (stochRSI < 0.2) {
    signalScore += 6;
    components.push('StochRSI_Bull: +6');
  } else if (stochRSI > 0.8) {
    signalScore -= 6;
    components.push('StochRSI_Bear: -6');
  }
  
  // 3. VOLUME CONFIRMATION (15 points) - Per Python algo
  const volumeRatio = volRatioIdx >= 0 ? indicators.volumeRatio[volRatioIdx] : 1;
  
  // Python algo: Only gives boost if volume_ratio > 1.5, amplifies existing signal
  if (volumeRatio > 1.5) {
    // High volume - amplify existing signal (per Python algo)
    const volMultiplier = Math.min(volumeRatio / 2, 1.0);
    const volBoost = 10 * volMultiplier; // Per Python: 10 * multiplier (max 10 points)
    if (signalScore > 0) {
      signalScore += volBoost;
      components.push(`Vol_Conf: +${volBoost.toFixed(1)}`);
    } else if (signalScore < 0) {
      signalScore -= volBoost;
      components.push(`Vol_Conf: -${volBoost.toFixed(1)}`);
    }
  }
  
  // 4. ORDER FLOW / PRICE ACTION (20 points) - Per Python algo
  const buyPressure = buyPressIdx >= 0 ? indicators.buyPressure[buyPressIdx] : 0.5;
  const buyPressureMA = buyPressIdx >= 0 && buyPressIdx < indicators.buyPressureMA.length
    ? indicators.buyPressureMA[buyPressIdx] : 0.5;
  
  // Buy/Sell pressure (per Python algo)
  if (buyPressure > 0.7 && buyPressureMA > 0.6) {
    signalScore += 10;
    components.push('Buy_Pressure: +10');
  } else if (buyPressure < 0.3 && buyPressureMA < 0.4) {
    signalScore -= 10;
    components.push('Sell_Pressure: -10');
  }
  
  // Body strength (per Python algo)
  const bodyRatio = bodyRatioIdx >= 0 ? indicators.bodyRatio[bodyRatioIdx] : 0.5;
  if (bodyRatio > 0.7) {
    if (c.close > c.open) {
      signalScore += 5;
      components.push('Strong_Bull_Candle: +5');
    } else {
      signalScore -= 5;
      components.push('Strong_Bear_Candle: -5');
    }
  }
  
  // Wick analysis (per Python algo)
  const wickRatio = wickRatioIdx >= 0 ? indicators.wickRatio[wickRatioIdx] : 0;
  if (wickRatio < -0.3) {
    signalScore += 5;
    components.push('Long_Lower_Wick: +5');
  } else if (wickRatio > 0.3) {
    signalScore -= 5;
    components.push('Long_Upper_Wick: -5');
  }
  
  // 5. VWAP RELATIONSHIP (10 points)
  const vwap50 = vwap50Idx >= 0 ? indicators.vwap50[vwap50Idx] : c.close;
  if (c.close > vwap50) {
    signalScore += 5;
    components.push('Above_VWAP: +5');
  } else {
    signalScore -= 5;
    components.push('Below_VWAP: -5');
  }
  
  const vwapDist = ((c.close - vwap50) / vwap50) * 100;
  if (Math.abs(vwapDist) > 0.5) {
    if (vwapDist > 0) {
      signalScore -= 5;
      components.push('Far_Above_VWAP: -5');
    } else {
      signalScore += 5;
      components.push('Far_Below_VWAP: +5');
    }
  }
  
  // 6. BOLLINGER BANDS (10 points)
  const bbPosition = bbPosIdx >= 0 ? indicators.bbPosition[bbPosIdx] : 0.5;
  if (bbPosition < 0.2) {
    signalScore += 8;
    components.push('BB_Oversold: +8');
  } else if (bbPosition > 0.8) {
    signalScore -= 8;
    components.push('BB_Overbought: -8');
  }
  
  // 7. CANDLESTICK PATTERNS (15 points)
  const patterns = detectPricePatterns(candles, idx);
  if (patterns['hammer'] || patterns['bullish_engulfing']) {
    signalScore += 10;
    components.push('Bullish_Pattern: +10');
  } else if (patterns['three_white_soldiers']) {
    signalScore += 15;
    components.push('3_White_Soldiers: +15');
  } else if (patterns['shooting_star'] || patterns['bearish_engulfing']) {
    signalScore -= 10;
    components.push('Bearish_Pattern: -10');
  } else if (patterns['three_black_crows']) {
    signalScore -= 15;
    components.push('3_Black_Crows: -15');
  }
  
  // 8. TREND STRENGTH (ADX) (10 points)
  const adx = adxIdx >= 0 ? indicators.adx[adxIdx] : 20;
  if (adx > 25) {
    const trendBoost = Math.min((adx - 25) / 5, 10);
    if (signalScore > 0) {
      signalScore += trendBoost;
      components.push(`Trend_Boost: +${trendBoost.toFixed(1)}`);
    } else if (signalScore < 0) {
      signalScore -= trendBoost;
      components.push(`Trend_Boost: -${trendBoost.toFixed(1)}`);
    }
  }
  
  // 9. MARKET REGIME ADJUSTMENT (More aggressive for 1-minute scalping)
  if (regime === 'trending_up') {
    if (signalScore > 0) {
      const regimeBoost = 8 * regimeConfidence; // Increased from 5
      signalScore += regimeBoost;
      components.push(`Trend_Up_Boost: +${regimeBoost.toFixed(1)}`);
    } else if (signalScore < 0) {
      // Even negative signals get a boost during uptrend
      const regimeBoost = 5 * regimeConfidence;
      signalScore += regimeBoost; // Add boost to reduce negativity
      components.push(`Trend_Up_Recovery: +${regimeBoost.toFixed(1)}`);
    }
  } else if (regime === 'trending_down') {
    if (signalScore < 0) {
      const regimeBoost = 8 * regimeConfidence; // Increased from 5
      signalScore -= regimeBoost;
      components.push(`Trend_Down_Boost: -${regimeBoost.toFixed(1)}`);
    } else if (signalScore > 0) {
      // Even positive signals get adjusted during downtrend
      const regimeBoost = 5 * regimeConfidence;
      signalScore -= regimeBoost; // Reduce positivity
      components.push(`Trend_Down_Adjust: -${regimeBoost.toFixed(1)}`);
    }
  } else if (regime === 'ranging') {
    // Per Python algo: reduce by 30%
    signalScore *= 0.7;
    components.push('Ranging_Reduce: -30%');
  } else if (regime === 'volatile') {
    // Per Python algo: reduce by 40%
    signalScore *= 0.6;
    components.push('Volatile_Reduce: -40%');
  }
  
  // Cap signal at -100 to +100
  signalScore = Math.max(-100, Math.min(100, signalScore));
  
  const explanation = components.slice(0, 5).join(' | ');
  
  return { signalStrength: signalScore, explanation };
}

function calculateDynamicRiskParams(
  indicators: IndicatorData,
  candles: Candle[],
  idx: number,
  signalStrength: number
): { stopLossPct: number; takeProfitPct: number; riskRewardRatio: number } {
  const atrIdx = indicators.atrPercent.length - (candles.length - idx);
  const atrPercent = atrIdx >= 0 ? indicators.atrPercent[atrIdx] : 0.5;
  
  // Per Python algo: Base parameters
  let baseSL = 0.35; // 0.35%
  let baseTP = 0.70; // 0.70% (2:1 ratio)
  
  // Adjust based on volatility (per Python algo)
  // volatility_multiplier = atr_percent / 0.5  # Normalize to 0.5% ATR
  const volatilityMultiplier = atrPercent / 0.5;
  const clampedVolatilityMultiplier = Math.max(0.5, Math.min(2.0, volatilityMultiplier));
  
  // Adjust based on signal strength (per Python algo)
  // signal_multiplier = abs(signal_strength) / 50  # Normalize
  const signalMultiplier = Math.abs(signalStrength) / 50;
  const clampedSignalMultiplier = Math.max(0.8, Math.min(1.5, signalMultiplier));
  
  // Calculate final parameters (per Python algo)
  // Note: Python algo also adjusts based on recent performance (win rate),
  // but we don't track that in indicator calculation, so we skip that part
  let finalSL = baseSL * clampedVolatilityMultiplier;
  let finalTP = baseTP * clampedVolatilityMultiplier * clampedSignalMultiplier;
  
  // Ensure minimum risk/reward ratio of 1.5:1 (per Python algo)
  if (finalTP / finalSL < 1.5) {
    finalTP = finalSL * 1.5;
  }
  
  return {
    stopLossPct: finalSL / 100,
    takeProfitPct: finalTP / 100,
    riskRewardRatio: finalTP / finalSL,
  };
}

/**
 * Generate QuickScalp 2.0 signal - Fast Scalping Algorithm
 * Based on Python FastScalpingSignal class
 * Designed for REAL-TIME 1-minute trading
 * Focuses on: TREND + VOLUME + MOMENTUM
 * 
 * Uses 700+ candles to identify trend; last 3 candles define final movement.
 * Only gives LONG/SHORT when trend + last 3 candles form a strong core (no repainting).
 */
export function generateQuickScalp2Signal(candles: Candle[]): QuickScalp2Result {
  // CRITICAL: Only use closed candles to prevent repainting
  const closedCandles = candles.slice(0, candles.length - 1);
  
  const MINIMUM_CANDLES = 120;
  if (closedCandles.length < MINIMUM_CANDLES) {
    return { 
      signal: 'WAIT', 
      reason: `Need at least ${MINIMUM_CANDLES} candles (have ${closedCandles.length})`,
      signalStrength: 0,
    };
  }
  
  // Use last 120 candles (RSI 21, MACD 50+, Stoch 20+, VWAP 60, BB 50+)
  const data = closedCandles.slice(-120);
  const closes = data.map(c => c.close);
  const opens = data.map(c => c.open);
  const highs = data.map(c => c.high);
  const lows = data.map(c => c.low);
  const volumes = data.map(c => c.volume ?? 0);
  
  // RSI 21 (reliable) + RSI 7 (1m scalping: faster reaction per research)
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const rsi = calculateRSI(closes, 21);
  const rsi7 = calculateRSI(closes, 7);
  const { macd: macdLine, signal: macdSignal, histogram: macdHist } = calculateMACD(closes, 12, 26, 9);
  const stoch = calculateStochastic(data, 14, 3);
  const vwap60 = calculateRollingVWAP(data, 60);
  const bb = calculateBollingerBands(closes, 20, 2);
  const volumeMA = calculateSMA(volumes, 20);
  
  const currentIndex = data.length - 1;
  const prevIndex = currentIndex - 1;
  
  const c = data[currentIndex];
  const prev = data[prevIndex];
  const currentEMA9 = ema9[ema9.length - 1];
  const currentEMA21 = ema21[ema21.length - 1];
  const currentEMA50 = ema50[ema50.length - 1];
  const currentRSI = rsi.length > 0 ? rsi[rsi.length - 1] : 50;
  const currentRSI7 = rsi7.length > 0 ? rsi7[rsi7.length - 1] : 50;
  const prevEMA9 = ema9.length >= 2 ? ema9[ema9.length - 2] : currentEMA9;
  const prevEMA21 = ema21.length >= 2 ? ema21[ema21.length - 2] : currentEMA21;
  const currentMacdHist = macdHist.length > 0 ? macdHist[macdHist.length - 1] : 0;
  const currentMacd = macdLine.length > 0 ? macdLine[macdLine.length - 1] : 0;
  const currentMacdSignal = macdSignal.length > 0 ? macdSignal[macdSignal.length - 1] : 0;
  const currentStochK = stoch.k.length > 0 ? stoch.k[stoch.k.length - 1] : 50;
  const currentStochD = stoch.d.length > 0 ? stoch.d[stoch.d.length - 1] : 50;
  const currentVwap = vwap60.length > 0 ? vwap60[vwap60.length - 1] : c.close;
  let currentBBPercentB = 0.5;
  let bbBandwidth = 0;
  if (bb.middle.length > 0) {
    const i = bb.middle.length - 1;
    const closeVal = closes[closes.length - bb.middle.length + i];
    const range = bb.upper[i] - bb.lower[i];
    if (range > 0) currentBBPercentB = (closeVal - bb.lower[i]) / range;
    if (bb.middle[i] > 0) bbBandwidth = range / bb.middle[i];
  }
  const volumeRatio = volumeMA.length > 0 && volumeMA[volumeMA.length - 1] > 0
    ? volumes[currentIndex] / volumeMA[volumeMA.length - 1] : 1;
  
  const body = Math.abs(c.close - c.open);
  const rangeTotal = c.high - c.low;
  
  // ─── STRUCTURAL TREND + PULLBACK/BOUNCE (signal before the move) ───
  const structuralUptrend = currentEMA9 > currentEMA21 && currentEMA21 > currentEMA50;
  const structuralDowntrend = currentEMA9 < currentEMA21 && currentEMA21 < currentEMA50;
  const lookback5 = currentIndex >= 4;
  const close5Ago = lookback5 ? closes[currentIndex - 4] : c.close;
  const shortTermDown = lookback5 && c.close < close5Ago;
  const shortTermUp = lookback5 && c.close > close5Ago;
  const pullback = structuralUptrend && shortTermDown;   // uptrend, recent bars down → expect bounce
  const bounce = structuralDowntrend && shortTermUp;     // downtrend, recent bars up → expect drop
  
  let score = 0;
  const reasons: string[] = [];
  
  if (pullback) {
    score += 22;
    reasons.push('Uptrend pullback → expect up');
  }
  if (bounce) {
    score -= 22;
    reasons.push('Downtrend bounce → expect down');
  }
  
  // 1. RSI 21 + RSI 7 (1m scalping: RSI 7 for faster reaction, 30/70 levels)
  if (currentRSI < 30) { score += 12; reasons.push('RSI(21) oversold (bullish)'); }
  else if (currentRSI > 70) { score -= 12; reasons.push('RSI(21) overbought (bearish)'); }
  else if (currentRSI > 40 && currentRSI < 60) { score += 4; reasons.push('RSI neutral'); }
  else if (currentRSI < 40) score += 6;
  else score -= 6;
  
  if (currentRSI7 < 30) { score += 6; reasons.push('RSI(7) oversold'); }
  else if (currentRSI7 > 70) { score -= 6; reasons.push('RSI(7) overbought'); }
  if (currentRSI7 < 35 && currentRSI < 40) { score += 4; reasons.push('RSI7+21 confluence oversold'); }
  else if (currentRSI7 > 65 && currentRSI > 60) { score -= 4; reasons.push('RSI7+21 confluence overbought'); }
  
  // 2. MACD
  if (currentMacdHist > 0) { score += 10; reasons.push('MACD histogram bullish'); }
  else if (currentMacdHist < 0) { score -= 10; reasons.push('MACD histogram bearish'); }
  if (currentMacd > currentMacdSignal) score += 6;
  else if (currentMacd < currentMacdSignal) score -= 6;
  
  // 3. Stochastic
  if (currentStochK > currentStochD) { score += 8; reasons.push('Stoch %K > %D (bullish)'); }
  else if (currentStochK < currentStochD) { score -= 8; reasons.push('Stoch %K < %D (bearish)'); }
  if (currentStochK < 20) { score += 6; reasons.push('Stoch oversold'); }
  else if (currentStochK > 80) { score -= 6; reasons.push('Stoch overbought'); }
  
  // 4. VWAP (60) — essential for scalping; price above = bullish bias
  if (c.close > currentVwap) { score += 10; reasons.push('Price above VWAP'); }
  else if (c.close < currentVwap) { score -= 10; reasons.push('Price below VWAP'); }
  
  const vwapDistPct = currentVwap > 0 ? Math.abs((c.close - currentVwap) / currentVwap) * 100 : 0;
  if (vwapDistPct < 0.12 && rangeTotal > 0) {
    if (c.close > c.open) { score += 5; reasons.push('VWAP pullback bounce (bull)'); }
    else if (c.close < c.open) { score -= 5; reasons.push('VWAP pullback bounce (bear)'); }
  }
  
  // 5. Bollinger %B + squeeze/breakout (1m: squeeze then breakout with volume)
  if (currentBBPercentB < 0) { score += 8; reasons.push('BB %B oversold'); }
  else if (currentBBPercentB > 1) { score -= 8; reasons.push('BB %B overbought'); }
  else if (currentBBPercentB > 0.2 && currentBBPercentB < 0.8) score += 3;
  
  if (bb.middle.length >= 5 && bb.upper.length >= 5) {
    const recentBW = bbBandwidth;
    const avgBW = bb.middle.slice(-5).reduce((acc, _, i) => {
      const j = bb.middle.length - 5 + i;
      const r = bb.upper[j] - bb.lower[j];
      return acc + (bb.middle[j] > 0 ? r / bb.middle[j] : 0);
    }, 0) / 5;
    const isSqueeze = avgBW > 0 && recentBW < avgBW * 0.85;
    if (isSqueeze && currentBBPercentB > 1 && c.close > c.open && volumeRatio > 1.2) {
      score += 10;
      reasons.push('BB breakout up + vol');
    } else if (isSqueeze && currentBBPercentB < 0 && c.close < c.open && volumeRatio > 1.2) {
      score -= 10;
      reasons.push('BB breakout down + vol');
    }
  }
  
  // 6. Trend EMAs (9/21/50 — standard for 1m scalping)
  if (currentEMA9 > currentEMA21 && currentEMA21 > currentEMA50) { score += 12; reasons.push('EMAs aligned up'); }
  else if (currentEMA9 < currentEMA21 && currentEMA21 < currentEMA50) { score -= 12; reasons.push('EMAs aligned down'); }
  if (c.close > currentEMA9 && c.close > currentEMA21) score += 6;
  else if (c.close < currentEMA9 && c.close < currentEMA21) score -= 6;
  
  const bullishCross = prevEMA9 <= prevEMA21 && currentEMA9 > currentEMA21;
  const bearishCross = prevEMA9 >= prevEMA21 && currentEMA9 < currentEMA21;
  if (bullishCross) { score += 8; reasons.push('EMA 9/21 bullish cross'); }
  if (bearishCross) { score -= 8; reasons.push('EMA 9/21 bearish cross'); }
  
  // 7. Volume
  if (volumeRatio > 1.5) { if (score > 0) score += 8; else if (score < 0) score -= 8; }
  
  // 8. LAST CANDLE WEIGHT (fire on the move — avoid 2–3 candle lag)
  const lastCandleBodyRatio = rangeTotal > 0 ? body / rangeTotal : 0;
  const lastCandleStrong = lastCandleBodyRatio > 0.5;
  if (c.close > c.open) {
    if (bounce) {
      score -= 6;
      reasons.push('Bounce green (fade up)');
    } else {
      score += lastCandleStrong ? 18 : 6;
      if (lastCandleStrong) reasons.push('Strong green close');
    }
  } else if (c.close < c.open) {
    if (pullback) {
      score += 4;
      reasons.push('Pullback red (expect bounce)');
    } else if (bounce) {
      score -= 4;
      reasons.push('Bounce green (expect drop)');
    } else {
      score -= lastCandleStrong ? 18 : 6;
      if (lastCandleStrong) reasons.push('Strong red close');
    }
  }
  if (prev.close > prev.open && c.close > c.open) {
    if (bounce) { score -= 6; reasons.push('Bounce 2 green (fade)'); }
    else { score += 10; reasons.push('2 bars green'); }
  } else if (prev.close < prev.open && c.close < c.open) {
    if (!pullback && !bounce) score -= 10;
    else if (pullback) score += 4;
    else if (bounce) score -= 4;
    if (!pullback && !bounce) reasons.push('2 bars red');
  }
  
  // Last 3 candles: need at least 1 strong same-direction (or last candle itself is strong)
  const last3 = data.slice(-3);
  const STRONG_BODY = 0.35;
  let last3StrongBull = 0, last3StrongBear = 0;
  for (const candle of last3) {
    const r = candle.high - candle.low;
    const b = Math.abs(candle.close - candle.open);
    const br = r > 0 ? b / r : 0;
    if (candle.close > candle.open && br >= STRONG_BODY) last3StrongBull++;
    if (candle.close < candle.open && br >= STRONG_BODY) last3StrongBear++;
  }
  const strongCoreBull = last3StrongBull >= 1 || (c.close > c.open && lastCandleBodyRatio > 0.5);
  const strongCoreBear = last3StrongBear >= 1 || (c.close < c.open && lastCandleBodyRatio > 0.5);
  
  let trendFromHistory: 1 | -1 | 0 = 0;
  if (currentEMA9 > currentEMA21 && currentEMA21 > currentEMA50) trendFromHistory = 1;
  else if (currentEMA9 < currentEMA21 && currentEMA21 < currentEMA50) trendFromHistory = -1;
  
  const LONG_THRESHOLD = 3;
  const SHORT_THRESHOLD = -3;
  const STRONG_THRESHOLD = 14;
  
  const currentPrice = c.close;
  const stopLossPct = 0.004;
  const takeProfitPct = 0.008;
  
  // Determine raw signal from score
  let rawSignal: 'LONG' | 'SHORT' | 'WAIT' = 'WAIT';
  let confidence = 0;
  
  if (score >= STRONG_THRESHOLD) {
    rawSignal = 'LONG';
    confidence = 90;
  } else if (score >= LONG_THRESHOLD) {
    rawSignal = 'LONG';
    confidence = 75;
  } else if (score <= -STRONG_THRESHOLD) {
    rawSignal = 'SHORT';
    confidence = 90;
  } else if (score <= SHORT_THRESHOLD) {
    rawSignal = 'SHORT';
    confidence = 75;
  } else {
    if (pullback && score > -6) {
      rawSignal = 'LONG';
      confidence = 72;
    } else if (bounce && score < 6) {
      rawSignal = 'SHORT';
      confidence = 72;
    } else {
      rawSignal = 'WAIT';
      confidence = 0;
    }
  }
  
  // Fire on the move: if last closed candle is strong impulse, skip trend filter (avoid 2–3 bar lag)
  const lastCandleImpulse = lastCandleBodyRatio > 0.55;
  let finalSignal: 'LONG' | 'SHORT' | 'WAIT' = rawSignal;
  
  if (rawSignal === 'LONG') {
    if (pullback) {
      // Uptrend pullback: allow LONG on last red candle (anticipate bounce), no strongCore needed
    } else if (score < STRONG_THRESHOLD && !strongCoreBull) {
      finalSignal = 'WAIT';
      reasons.push('Last 3 need 1+ strong green');
    } else if (!lastCandleImpulse && trendFromHistory === -1 && score < STRONG_THRESHOLD) {
      finalSignal = 'WAIT';
      reasons.push('Downtrend - need stronger reversal');
    }
  }
  
  if (rawSignal === 'SHORT') {
    if (bounce) {
      // Downtrend bounce: allow SHORT on last green candle (anticipate drop), no strongCore needed
    } else if (score > -STRONG_THRESHOLD && !strongCoreBear) {
      finalSignal = 'WAIT';
      reasons.push('Last 3 need 1+ strong red');
    } else if (!lastCandleImpulse && trendFromHistory === 1 && score > -STRONG_THRESHOLD) {
      finalSignal = 'WAIT';
      reasons.push('Uptrend - need stronger reversal');
    }
  }
  
  const lastCandleBearish = c.close < c.open;
  const lastCandleBullish = c.close > c.open;
  const LAST_CANDLE_VETO = 22;
  
  if (lastCandleBearish && lastCandleBodyRatio > 0.4 && finalSignal === 'LONG' && score < LAST_CANDLE_VETO) {
    if (!pullback) {
      finalSignal = 'WAIT';
      reasons.push('Last candle bearish');
    }
  }
  if (lastCandleBullish && lastCandleBodyRatio > 0.4 && finalSignal === 'SHORT' && score > -LAST_CANDLE_VETO) {
    if (!bounce) {
      finalSignal = 'WAIT';
      reasons.push('Last candle bullish');
    }
  }
  
  // Generate final signal
  if (finalSignal === 'LONG') {
    return {
      signal: 'LONG',
      entry: currentPrice,
      stopLoss: currentPrice * (1 - stopLossPct),
      takeProfit: currentPrice * (1 + takeProfitPct),
      confidence: confidence,
      signalStrength: score,
      reason: `${score >= STRONG_THRESHOLD ? 'STRONG ' : ''}LONG | Score: ${score.toFixed(1)} | ${reasons.slice(0, 3).join(' | ')}`,
      regime: 'trending_up',
      rsi: currentRSI,
    };
  } else if (finalSignal === 'SHORT') {
    return {
      signal: 'SHORT',
      entry: currentPrice,
      stopLoss: currentPrice * (1 + stopLossPct),
      takeProfit: currentPrice * (1 - takeProfitPct),
      confidence: confidence,
      signalStrength: score,
      reason: `${score <= -STRONG_THRESHOLD ? 'STRONG ' : ''}SHORT | Score: ${score.toFixed(1)} | ${reasons.slice(0, 3).join(' | ')}`,
      regime: 'trending_down',
      rsi: currentRSI,
    };
  }
  
  return {
    signal: 'WAIT',
    reason: `WAIT | Score: ${score.toFixed(1)}${score > 2 ? ' | Bias: bullish' : score < -2 ? ' | Bias: bearish' : ''}${reasons.length > 0 ? ` | ${reasons.slice(0, 2).join(' | ')}` : ''}`,
    signalStrength: score,
    regime: 'neutral',
    rsi: currentRSI,
  };
}

/**
 * Convert QuickScalp2Result to marker for chart rendering
 */
export function toQuickScalp2Marker(
  result: QuickScalp2Result,
  time: number
): QuickScalp2Marker | null {
  if (result.signal !== 'LONG' && result.signal !== 'SHORT') return null;
  if (
    result.entry == null ||
    result.stopLoss == null ||
    result.takeProfit == null ||
    result.confidence == null ||
    result.signalStrength == null
  ) {
    return null;
  }
  
  // Validate time - ensure it's never 0 or invalid
  let validTime = time;
  if (!validTime || validTime === 0 || !Number.isFinite(validTime)) {
    validTime = Math.floor(Date.now() / 1000);
    if (process.env.NODE_ENV === 'development') {
      console.warn('[QuickScalp2.0] Invalid time in marker, using fallback:', validTime);
    }
  }
  
  return {
    time: validTime,
    signal: result.signal,
    entry: result.entry,
    stopLoss: result.stopLoss,
    takeProfit: result.takeProfit,
    confidence: result.confidence,
    signalStrength: result.signalStrength,
    reason: result.reason,
    regime: result.regime,
  };
}

/**
 * Get display items for chart
 * Always returns at least one item (WAIT if no signal)
 */
export function getQuickScalp2DisplayItems(
  result: QuickScalp2Result,
  time: number
): QuickScalp2DisplayItem[] {
  // Validate and fix time value - ensure it's never 0 or invalid
  let validTime = time;
  if (!validTime || validTime === 0 || !Number.isFinite(validTime)) {
    // Use current timestamp as fallback
    validTime = Math.floor(Date.now() / 1000);
    if (process.env.NODE_ENV === 'development') {
      console.warn('[QuickScalp2.0] Invalid time provided, using fallback:', validTime);
    }
  }
  
  if (result.signal === 'LONG' || result.signal === 'SHORT') {
    const marker = toQuickScalp2Marker(result, validTime);
    if (marker) {
      // Ensure marker has valid time
      if (!marker.time || marker.time === 0) {
        marker.time = validTime;
      }
      return [marker];
    }
  }
  
  // Always return WAIT signal with valid time
  return [{ time: validTime, signal: 'WAIT', reason: result.reason }];
}
