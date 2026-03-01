/**
 * Scalp Signal Indicator - BTC Scalping Algorithm
 * 
 * Strategy: Combined momentum + mean reversion with volume confirmation
 * Based on Python algorithm provided by user
 * 
 * Parameters:
 * - EMA Fast: 9, EMA Slow: 21
 * - RSI: 14 period
 * - Bollinger Bands: 20 period, 2 std
 * - Volume MA: 20 period
 * - Take Profit: 0.8% (0.008)
 * - Stop Loss: 0.4% (0.004)
 */

import type { Candle } from '../../store/candlesStore';

export interface ScalpSignalResult {
  signal: 'LONG' | 'SHORT' | 'WAIT';
  entry?: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  confidence?: number;
  reason: string;
  marketState?: string;
  rsi?: number;
  volume?: string;
}

/** Marker-friendly result with time for chart rendering */
export interface ScalpSignalMarker {
  time: number;
  signal: 'LONG' | 'SHORT';
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  confidence: number;
  reason: string;
  rsi?: number;
}

/** One item for chart: either a LONG/SHORT marker or a WAIT status */
export type ScalpDisplayItem =
  | ScalpSignalMarker
  | { time: number; signal: 'WAIT'; reason: string };

export interface ScalpPosition {
  type: 'LONG' | 'SHORT';
  entry: number;
  entryTime: number;
}

// ─── Helper: EMA (Exponential Moving Average) ───
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

// ─── Helper: SMA (Simple Moving Average) ───
function calculateSMA(data: number[], period: number): number[] {
  if (data.length < period) return [];
  
  const sma: number[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma.push(sum / period);
  }
  return sma;
}

// ─── Helper: RSI (Relative Strength Index) ───
function calculateRSI(data: number[], period: number): number[] {
  if (data.length < period + 1) return [];
  
  const rsi: number[] = [];
  const deltas: number[] = [];
  
  // Calculate price changes
  for (let i = 1; i < data.length; i++) {
    deltas.push(data[i] - data[i - 1]);
  }
  
  // Calculate initial average gain and loss
  let gains = 0;
  let losses = 0;
  for (let i = 0; i < period; i++) {
    if (deltas[i] > 0) gains += deltas[i];
    else losses += Math.abs(deltas[i]);
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  // First RSI value
  if (avgLoss === 0) {
    rsi.push(100);
  } else {
    const rs = avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));
  }
  
  // Calculate subsequent RSI values
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

// ─── Helper: Bollinger Bands ───
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

// ─── Helper: VWAP (Volume Weighted Average Price) ───
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

// ─── Helper: Momentum (percentage change over N periods) ───
function calculateMomentum(closes: number[], period: number): number[] {
  const momentum: number[] = [];
  
  for (let i = period; i < closes.length; i++) {
    const change = (closes[i] - closes[i - period]) / closes[i - period];
    momentum.push(change * 100); // Convert to percentage
  }
  
  return momentum;
}

/**
 * Generate scalp signal using the new algorithm
 * Uses only closed candles (excludes forming candle) to avoid repainting.
 */
export function generateScalpSignal(candles: Candle[]): ScalpSignalResult {
  const closedCandles = candles.slice(0, candles.length - 1);
  if (closedCandles.length < 50) {
    return { signal: 'WAIT', reason: 'Insufficient data (need at least 50 candles)' };
  }

  // Use last 500 candles if available, otherwise use all
  const data = closedCandles.length > 500 ? closedCandles.slice(-500) : closedCandles;

  const closes = data.map((c) => c.close);
  const highs = data.map((c) => c.high);
  const lows = data.map((c) => c.low);
  const volumes = data.map((c) => c.volume ?? 0);

  // Strategy parameters
  const EMA_FAST = 9;
  const EMA_SLOW = 21;
  const RSI_PERIOD = 14;
  const BB_PERIOD = 20;
  const BB_STD = 2;
  const VOLUME_MA_PERIOD = 20;
  const MOMENTUM_PERIOD = 5;

  // Calculate indicators
  const emaFast = calculateEMA(closes, EMA_FAST);
  const emaSlow = calculateEMA(closes, EMA_SLOW);
  const rsi = calculateRSI(closes, RSI_PERIOD);
  const bb = calculateBollingerBands(closes, BB_PERIOD, BB_STD);
  const volumeMA = calculateSMA(volumes, VOLUME_MA_PERIOD);
  const vwap = calculateVWAP(data);
  const momentum = calculateMomentum(closes, MOMENTUM_PERIOD);

  // Get current values (last index)
  const currentIndex = data.length - 1;
  const prevIndex = currentIndex - 1;

  // Need enough data for all indicators
  const minRequired = Math.max(EMA_SLOW, BB_PERIOD, RSI_PERIOD + 1, VOLUME_MA_PERIOD, MOMENTUM_PERIOD);
  if (currentIndex < minRequired || prevIndex < 0) {
    return { signal: 'WAIT', reason: `Need at least ${minRequired} candles for indicators` };
  }

  // Get indicator values
  const currentEMAFast = emaFast[currentIndex];
  const currentEMASlow = emaSlow[currentIndex];
  const prevEMAFast = emaFast[prevIndex];
  const prevEMASlow = emaSlow[prevIndex];
  
  const rsiIndex = currentIndex - (closes.length - rsi.length);
  const currentRSI = rsiIndex >= 0 ? rsi[rsiIndex] : null;
  
  const bbIndex = currentIndex - (closes.length - bb.middle.length);
  const currentBBMiddle = bbIndex >= 0 ? bb.middle[bbIndex] : null;
  const currentBBUpper = bbIndex >= 0 ? bb.upper[bbIndex] : null;
  const currentBBLower = bbIndex >= 0 ? bb.lower[bbIndex] : null;
  
  const volumeMAIndex = currentIndex - (closes.length - volumeMA.length);
  const currentVolumeMA = volumeMAIndex >= 0 ? volumeMA[volumeMAIndex] : null;
  const currentVolume = volumes[currentIndex];
  const volumeRatio = currentVolumeMA && currentVolumeMA > 0 ? currentVolume / currentVolumeMA : 0;
  
  const vwapIndex = currentIndex;
  const currentVWAP = vwap[vwapIndex];
  
  const momentumIndex = currentIndex - (closes.length - momentum.length);
  const currentMomentum = momentumIndex >= 0 ? momentum[momentumIndex] : null;

  const currentClose = closes[currentIndex];
  const currentOpen = data[currentIndex].open;

  // Validate all indicators are available
  if (
    currentEMAFast == null || currentEMASlow == null ||
    prevEMAFast == null || prevEMASlow == null ||
    currentRSI == null ||
    currentBBMiddle == null || currentBBUpper == null || currentBBLower == null ||
    currentVolumeMA == null ||
    currentVWAP == null ||
    currentMomentum == null
  ) {
    return { signal: 'WAIT', reason: 'Calculating indicators...' };
  }

  // LONG signal conditions (from Python algorithm)
  const longConditions = [
    currentEMAFast > currentEMASlow, // Uptrend
    prevEMAFast <= prevEMASlow, // EMA crossover (fast was <= slow, now >)
    currentRSI > 40 && currentRSI < 70, // RSI not overbought
    currentClose > currentVWAP, // Price above VWAP
    volumeRatio > 1.2, // Volume confirmation (>1.2x average)
    currentMomentum > 0, // Positive momentum
  ];

  // SHORT signal conditions
  const shortConditions = [
    currentEMAFast < currentEMASlow, // Downtrend
    prevEMAFast >= prevEMASlow, // EMA crossover (fast was >= slow, now <)
    currentRSI < 60 && currentRSI > 30, // RSI not oversold
    currentClose < currentVWAP, // Price below VWAP
    volumeRatio > 1.2, // Volume confirmation (>1.2x average)
    currentMomentum < 0, // Negative momentum
  ];

  // Bollinger Band mean reversion signals
  const bbLong = currentClose < currentBBLower && currentRSI < 35;
  const bbShort = currentClose > currentBBUpper && currentRSI > 65;

  // Generate signal
  const longScore = longConditions.filter(Boolean).length;
  const shortScore = shortConditions.filter(Boolean).length;

  // Risk management parameters
  const TAKE_PROFIT_PCT = 0.008; // 0.8%
  const STOP_LOSS_PCT = 0.004; // 0.4%

  if (longScore >= 5 || bbLong) {
    // LONG signal
    const stopLoss = currentClose * (1 - STOP_LOSS_PCT);
    const takeProfit1 = currentClose * (1 + TAKE_PROFIT_PCT);
    const takeProfit2 = currentClose * (1 + TAKE_PROFIT_PCT * 1.5); // Extended TP

    // Calculate confidence based on conditions met
    let confidence = 70;
    if (longScore >= 6) confidence = 90;
    else if (bbLong) confidence = 75; // BB mean reversion
    else if (longScore === 5) confidence = 75;

    return {
      signal: 'LONG',
      entry: currentClose,
      stopLoss,
      takeProfit1,
      takeProfit2,
      confidence,
      reason: bbLong 
        ? 'Bollinger Band mean reversion (oversold)' 
        : `EMA crossover + momentum (${longScore}/6 conditions)`,
      marketState: 'BULLISH_TREND',
      rsi: currentRSI,
      volume: volumeRatio > 1.5 ? 'HIGH' : volumeRatio > 1.2 ? 'MODERATE' : 'NORMAL',
    };
  } else if (shortScore >= 5 || bbShort) {
    // SHORT signal
    const stopLoss = currentClose * (1 + STOP_LOSS_PCT);
    const takeProfit1 = currentClose * (1 - TAKE_PROFIT_PCT);
    const takeProfit2 = currentClose * (1 - TAKE_PROFIT_PCT * 1.5); // Extended TP

    // Calculate confidence based on conditions met
    let confidence = 70;
    if (shortScore >= 6) confidence = 90;
    else if (bbShort) confidence = 75; // BB mean reversion
    else if (shortScore === 5) confidence = 75;

    return {
      signal: 'SHORT',
      entry: currentClose,
      stopLoss,
      takeProfit1,
      takeProfit2,
      confidence,
      reason: bbShort 
        ? 'Bollinger Band mean reversion (overbought)' 
        : `EMA crossover + momentum (${shortScore}/6 conditions)`,
      marketState: 'BEARISH_TREND',
      rsi: currentRSI,
      volume: volumeRatio > 1.5 ? 'HIGH' : volumeRatio > 1.2 ? 'MODERATE' : 'NORMAL',
    };
  }

  // No signal - provide detailed feedback
  const trend = currentEMAFast > currentEMASlow ? 'BULLISH' : 'BEARISH';
  const missingLong = longConditions.map((cond, i) => !cond ? i : -1).filter(i => i >= 0);
  const missingShort = shortConditions.map((cond, i) => !cond ? i : -1).filter(i => i >= 0);

  let reason = 'Waiting for signal conditions';
  if (trend === 'BULLISH' && longScore < 5) {
    reason = `Bullish trend but only ${longScore}/6 conditions met`;
    if (volumeRatio < 1.2) reason += ` (volume: ${volumeRatio.toFixed(2)}x, need >1.2x)`;
  } else if (trend === 'BEARISH' && shortScore < 5) {
    reason = `Bearish trend but only ${shortScore}/6 conditions met`;
    if (volumeRatio < 1.2) reason += ` (volume: ${volumeRatio.toFixed(2)}x, need >1.2x)`;
  } else {
    reason = 'No clear trend or conditions not met';
  }

  return {
    signal: 'WAIT',
    reason,
    marketState: trend === 'BULLISH' ? 'BULLISH_TREND' : 'BEARISH_TREND',
    rsi: currentRSI,
    volume: volumeRatio > 1.2 ? 'MODERATE' : 'LOW',
  };
}

/**
 * Check exit signal when in a position (for position management).
 */
export function checkExitSignal(candles: Candle[], position: ScalpPosition): { exit: boolean; reason?: string } {
  if (candles.length < 50) return { exit: false };

  const closes = candles.map((c) => c.close);
  const currentPrice = closes[closes.length - 1];
  const TAKE_PROFIT_PCT = 0.008; // 0.8%
  const STOP_LOSS_PCT = 0.004; // 0.4%

  if (position.type === 'LONG') {
    // Check stop loss
    if (currentPrice <= position.entry * (1 - STOP_LOSS_PCT)) {
      return { exit: true, reason: 'Stop loss hit (0.4%)' };
    }
    // Check take profit
    if (currentPrice >= position.entry * (1 + TAKE_PROFIT_PCT)) {
      return { exit: true, reason: 'Take profit hit (0.8%)' };
    }
  } else {
    // SHORT position
    // Check stop loss
    if (currentPrice >= position.entry * (1 + STOP_LOSS_PCT)) {
      return { exit: true, reason: 'Stop loss hit (0.4%)' };
    }
    // Check take profit
    if (currentPrice <= position.entry * (1 - TAKE_PROFIT_PCT)) {
      return { exit: true, reason: 'Take profit hit (0.8%)' };
    }
  }

  return { exit: false };
}

/**
 * Convert ScalpSignalResult + last closed candle time to an array for chart.
 * Always returns one item when we have enough data: either LONG/SHORT marker or WAIT status.
 */
export function getScalpDisplayItems(result: ScalpSignalResult, time: number): ScalpDisplayItem[] {
  if (result.signal === 'LONG' || result.signal === 'SHORT') {
    const marker = toScalpSignalMarker(result, time);
    if (marker) return [marker];
  }
  return [{ time, signal: 'WAIT', reason: result.reason }];
}

/**
 * Convert ScalpSignalResult + last closed candle time to ScalpSignalMarker for chart.
 */
export function toScalpSignalMarker(result: ScalpSignalResult, time: number): ScalpSignalMarker | null {
  if (result.signal !== 'LONG' && result.signal !== 'SHORT') return null;
  if (
    result.entry == null ||
    result.stopLoss == null ||
    result.takeProfit1 == null ||
    result.takeProfit2 == null ||
    result.confidence == null
  ) {
    return null;
  }
  return {
    time,
    signal: result.signal,
    entry: result.entry,
    stopLoss: result.stopLoss,
    takeProfit1: result.takeProfit1,
    takeProfit2: result.takeProfit2,
    confidence: result.confidence,
    reason: result.reason,
    rsi: result.rsi,
  };
}
