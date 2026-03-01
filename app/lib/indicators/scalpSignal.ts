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
 * 
 * Strategy: Read 1000 candles for calibration, but analyze last 5 candles for fast swing reversal detection
 */
export function generateScalpSignal(candles: Candle[]): ScalpSignalResult {
  const closedCandles = candles.slice(0, candles.length - 1);
  if (closedCandles.length < 100) {
    return { signal: 'WAIT', reason: 'Insufficient data (need at least 100 candles)' };
  }

  // Use last 1000 candles for better swing detection and calibration (was 500)
  const data = closedCandles.length > 1000 ? closedCandles.slice(-1000) : closedCandles;
  
  // Analyze last 5 closed candles for quick swing reversal detection
  const recentCandles = data.slice(-5);

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

  // ──── SWING REVERSAL DETECTION (Last 5 candles) ────
  // Fast detection for quick trade entry
  let swingReversalLong = false;
  let swingReversalShort = false;
  
  if (recentCandles.length >= 5) {
    // Detect swing low reversal (potential LONG)
    const lows = recentCandles.map(c => c.low);
    const closes = recentCandles.map(c => c.close);
    const minLowIndex = lows.indexOf(Math.min(...lows));
    
    // Swing low reversal: lowest point in middle, then price moves up
    if (minLowIndex >= 1 && minLowIndex <= 3) {
      const swingLow = lows[minLowIndex];
      const afterSwing = closes.slice(minLowIndex + 1);
      // Check if price recovered after swing low
      if (afterSwing.length > 0 && afterSwing[afterSwing.length - 1] > swingLow * 1.001) {
        swingReversalLong = true;
      }
    }
    
    // Detect swing high reversal (potential SHORT)
    const highs = recentCandles.map(c => c.high);
    const maxHighIndex = highs.indexOf(Math.max(...highs));
    
    // Swing high reversal: highest point in middle, then price moves down
    if (maxHighIndex >= 1 && maxHighIndex <= 3) {
      const swingHigh = highs[maxHighIndex];
      const afterSwing = closes.slice(maxHighIndex + 1);
      // Check if price dropped after swing high
      if (afterSwing.length > 0 && afterSwing[afterSwing.length - 1] < swingHigh * 0.999) {
        swingReversalShort = true;
      }
    }
  }

  // LONG signal conditions (RELAXED for 1-minute scalping)
  // For 1-minute candles, we need faster signals - relaxed thresholds
  const longConditions = [
    currentEMAFast > currentEMASlow, // Uptrend
    prevEMAFast <= prevEMASlow || (currentEMAFast > currentEMASlow && Math.abs(currentEMAFast - currentEMASlow) / currentEMASlow > 0.0005), // EMA crossover OR strong trend (>0.05% separation)
    currentRSI > 35 && currentRSI < 75, // RSI relaxed range (was 40-70)
    currentClose > currentVWAP * 0.9995, // Price near or above VWAP (relaxed from exact >)
    volumeRatio > 0.8, // Volume relaxed: >0.8x average (was >1.2x) for 1-minute scalping
    currentMomentum > -0.1, // Positive or slightly negative momentum (was >0)
  ];

  // SHORT signal conditions (RELAXED for 1-minute scalping)
  const shortConditions = [
    currentEMAFast < currentEMASlow, // Downtrend
    prevEMAFast >= prevEMASlow || (currentEMAFast < currentEMASlow && Math.abs(currentEMAFast - currentEMASlow) / currentEMASlow > 0.0005), // EMA crossover OR strong trend
    currentRSI < 65 && currentRSI > 25, // RSI relaxed range (was 30-60)
    currentClose < currentVWAP * 1.0005, // Price near or below VWAP (relaxed)
    volumeRatio > 0.8, // Volume relaxed: >0.8x average (was >1.2x)
    currentMomentum < 0.1, // Negative or slightly positive momentum (was <0)
  ];

  // Bollinger Band mean reversion signals (more aggressive)
  const bbLong = currentClose < currentBBLower && currentRSI < 40; // Relaxed from 35
  const bbShort = currentClose > currentBBUpper && currentRSI > 60; // Relaxed from 65

  // Strong momentum signals (for fast 1-minute scalping)
  const strongMomentumLong = currentMomentum > 0.3 && currentEMAFast > currentEMASlow && volumeRatio > 0.6;
  const strongMomentumShort = currentMomentum < -0.3 && currentEMAFast < currentEMASlow && volumeRatio > 0.6;

  // Generate signal
  const longScore = longConditions.filter(Boolean).length;
  const shortScore = shortConditions.filter(Boolean).length;

  // Risk management parameters
  const TAKE_PROFIT_PCT = 0.008; // 0.8%
  const STOP_LOSS_PCT = 0.004; // 0.4%

  // RELAXED THRESHOLD: Require 4/6 conditions (was 5/6) OR strong momentum OR BB mean reversion
  if (longScore >= 4 || bbLong || strongMomentumLong) {
    // LONG signal
    const stopLoss = currentClose * (1 - STOP_LOSS_PCT);
    const takeProfit1 = currentClose * (1 + TAKE_PROFIT_PCT);
    const takeProfit2 = currentClose * (1 + TAKE_PROFIT_PCT * 1.5); // Extended TP

    // Calculate confidence based on conditions met
    let confidence = 70;
    if (longScore >= 6) confidence = 90;
    else if (strongMomentumLong) confidence = 85; // Strong momentum
    else if (bbLong) confidence = 75; // BB mean reversion
    else if (longScore >= 5) confidence = 80;
    else if (longScore === 4) confidence = 70; // Relaxed threshold

    return {
      signal: 'LONG',
      entry: currentClose,
      stopLoss,
      takeProfit1,
      takeProfit2,
      confidence,
      reason: swingReversalLong
        ? `Swing reversal detected (last 5 candles)`
        : strongMomentumLong 
        ? `Strong momentum (${currentMomentum.toFixed(2)}%)`
        : bbLong 
        ? 'Bollinger Band mean reversion (oversold)' 
        : `EMA trend + momentum (${longScore}/6 conditions, vol: ${volumeRatio.toFixed(2)}x)`,
      marketState: 'BULLISH_TREND',
      rsi: currentRSI,
      volume: volumeRatio > 1.5 ? 'HIGH' : volumeRatio > 1.0 ? 'MODERATE' : 'NORMAL',
    };
  } else if (shortScore >= 4 || bbShort || strongMomentumShort) {
    // SHORT signal
    const stopLoss = currentClose * (1 + STOP_LOSS_PCT);
    const takeProfit1 = currentClose * (1 - TAKE_PROFIT_PCT);
    const takeProfit2 = currentClose * (1 - TAKE_PROFIT_PCT * 1.5); // Extended TP

    // Calculate confidence based on conditions met
    let confidence = 70;
    if (shortScore >= 6) confidence = 90;
    else if (strongMomentumShort) confidence = 85; // Strong momentum
    else if (bbShort) confidence = 75; // BB mean reversion
    else if (shortScore >= 5) confidence = 80;
    else if (shortScore === 4) confidence = 70; // Relaxed threshold

    return {
      signal: 'SHORT',
      entry: currentClose,
      stopLoss,
      takeProfit1,
      takeProfit2,
      confidence,
      reason: swingReversalShort
        ? `Swing reversal detected (last 5 candles)`
        : strongMomentumShort 
        ? `Strong momentum (${currentMomentum.toFixed(2)}%)`
        : bbShort 
        ? 'Bollinger Band mean reversion (overbought)' 
        : `EMA trend + momentum (${shortScore}/6 conditions, vol: ${volumeRatio.toFixed(2)}x)`,
      marketState: 'BEARISH_TREND',
      rsi: currentRSI,
      volume: volumeRatio > 1.5 ? 'HIGH' : volumeRatio > 1.0 ? 'MODERATE' : 'NORMAL',
    };
  }

  // No signal - provide detailed feedback
  const trend = currentEMAFast > currentEMASlow ? 'BULLISH' : 'BEARISH';
  
  let reason = 'Waiting for signal conditions';
  if (trend === 'BULLISH' && longScore < 4) {
    reason = `Bullish trend but only ${longScore}/6 conditions met (need 4+)`;
    if (volumeRatio < 0.8) reason += ` (volume: ${volumeRatio.toFixed(2)}x, need >0.8x)`;
    else if (currentMomentum <= -0.1) reason += ` (momentum: ${currentMomentum.toFixed(2)}%, need >-0.1%)`;
  } else if (trend === 'BEARISH' && shortScore < 4) {
    reason = `Bearish trend but only ${shortScore}/6 conditions met (need 4+)`;
    if (volumeRatio < 0.8) reason += ` (volume: ${volumeRatio.toFixed(2)}x, need >0.8x)`;
    else if (currentMomentum >= 0.1) reason += ` (momentum: ${currentMomentum.toFixed(2)}%, need <0.1%)`;
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
