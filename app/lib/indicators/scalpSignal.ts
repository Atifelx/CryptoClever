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

/** Aggregate 15m (base) candles to 1h: every 4 consecutive bars → one bar. */
function aggregateTo1h(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + 4 <= candles.length; i += 4) {
    const chunk = candles.slice(i, i + 4);
    const open = chunk[0].open;
    const high = Math.max(...chunk.map(c => c.high));
    const low = Math.min(...chunk.map(c => c.low));
    const close = chunk[chunk.length - 1].close;
    const volume = chunk.reduce((s, c) => s + (c.volume ?? 0), 0);
    const time = chunk[chunk.length - 1].time;
    out.push({ time, open, high, low, close, volume });
  }
  return out;
}

/** ATR (Average True Range) calculation */
function calculateATR(candles: Candle[], period: number): number[] {
  if (candles.length < period + 1) return [];
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const d1 = high - low;
    const d2 = Math.abs(high - prevClose);
    const d3 = Math.abs(low - prevClose);
    tr.push(Math.max(d1, d2, d3));
  }
  const atr: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  atr.push(sum / period);
  for (let i = period; i < tr.length; i++) {
    const prevAtr = atr[atr.length - 1];
    atr.push((prevAtr * (period - 1) + tr[i]) / period);
  }
  return atr;
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
  const atr = calculateATR(data, 14);

  // 1-HOUR TREND CALCULATION (15m → 1h)
  const data1h = aggregateTo1h(data);
  let htfTrend: 'BULL' | 'BEAR' | 'NEUTRAL' = 'NEUTRAL';
  if (data1h.length >= 50) {
    const htfCloses = data1h.map(c => c.close);
    const ema20 = calculateEMA(htfCloses, 20);
    const ema50 = calculateEMA(htfCloses, 50);
    const e20 = ema20[ema20.length - 1];
    const e50 = ema50[ema50.length - 1];
    if (e20 > e50) htfTrend = 'BULL';
    else if (e20 < e50) htfTrend = 'BEAR';
  }

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
    currentMomentum == null ||
    atr.length === 0
  ) {
    return { signal: 'WAIT', reason: 'Calculating indicators...' };
  }
  
  const currentATR = atr[atr.length - 1];

  // ──── TREND FILTERING (Prevent counter-trend signals) ────
  // Analyze last 15 candles to detect clear trend direction
  const trendLookback = Math.min(15, data.length);
  const trendCandles = data.slice(-trendLookback);
  const trendCloses = trendCandles.map(c => c.close);
  
  // Count bullish vs bearish candles
  let bullishCandles = 0;
  let bearishCandles = 0;
  let priceChange = 0;
  
  for (let i = 1; i < trendCandles.length; i++) {
    const prevClose = trendCloses[i - 1];
    const currClose = trendCloses[i];
    if (currClose > prevClose) {
      bullishCandles++;
      priceChange += (currClose - prevClose) / prevClose;
    } else if (currClose < prevClose) {
      bearishCandles++;
      priceChange -= (prevClose - currClose) / prevClose;
    }
  }
  
  // Determine trend consensus (70% threshold for clear trend)
  const totalCandles = trendLookback - 1;
  const bullishRatio = bullishCandles / totalCandles;
  const bearishRatio = bearishCandles / totalCandles;
  const netPriceChange = (trendCloses[trendCloses.length - 1] - trendCloses[0]) / trendCloses[0];
  
  const isClearUptrend = bullishRatio >= 0.7 && netPriceChange > 0.001; // 70% bullish + price up >0.1%
  const isClearDowntrend = bearishRatio >= 0.7 && netPriceChange < -0.001; // 70% bearish + price down >0.1%

  // ──── RECENT FALL SWING (1m: block LONG after sudden drop) ────
  // Last 4 candles: if ≥3 bearish and net change < -0.1%, do not show LONG; prefer WAIT or SHORT
  const recentLookback = 4;
  let recentFallSwing = false;
  if (data.length >= recentLookback) {
    const last4 = data.slice(-recentLookback);
    const last4Closes = last4.map(c => c.close);
    let bearishCount = 0;
    for (let i = 1; i < last4Closes.length; i++) {
      if (last4Closes[i] < last4Closes[i - 1]) bearishCount++;
    }
    const netChange4 = (last4Closes[last4Closes.length - 1] - last4Closes[0]) / last4Closes[0];
    if (bearishCount >= 3 && netChange4 < -0.001) {
      recentFallSwing = true;
    }
    // Also: last 3 candles all red (strong fall)
    if (!recentFallSwing && data.length >= 3) {
      const last3 = data.slice(-3);
      const last3Closes = last3.map(c => c.close);
      const all3Red = last3Closes[1] < last3Closes[0] && last3Closes[2] < last3Closes[1];
      const drop3 = (last3Closes[2] - last3Closes[0]) / last3Closes[0];
      if (all3Red && drop3 < -0.0015) recentFallSwing = true;
    }
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
    
    // Detect swing high reversal (potential SHORT) - ONLY if not in clear uptrend
    if (!isClearUptrend) {
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
  }

  // LONG signal conditions (RELAXED for 1-minute scalping)
  // For 1-minute candles, we need faster signals - relaxed thresholds
  // ENFORCE: Only allow LONG if NOT in clear downtrend
  const longConditions = [
    !isClearDowntrend, // CRITICAL: Block LONG signals during clear downtrends
    currentEMAFast > currentEMASlow || isClearUptrend, // Uptrend OR clear uptrend from candles
    prevEMAFast <= prevEMASlow || (currentEMAFast > currentEMASlow && Math.abs(currentEMAFast - currentEMASlow) / currentEMASlow > 0.0005) || isClearUptrend, // EMA crossover OR strong trend OR clear uptrend
    currentRSI > 35 && currentRSI < 75, // RSI relaxed range (was 40-70)
    currentClose > currentVWAP * 0.9995 || isClearUptrend, // Price near or above VWAP OR clear uptrend
    volumeRatio > 0.8, // Volume relaxed: >0.8x average (was >1.2x) for 1-minute scalping
    currentMomentum > -0.1 || isClearUptrend, // Positive or slightly negative momentum OR clear uptrend
  ];

  // SHORT signal conditions (RELAXED for 1-minute scalping)
  // ENFORCE: Only allow SHORT if NOT in clear uptrend
  const shortConditions = [
    !isClearUptrend, // CRITICAL: Block SHORT signals during clear uptrends
    currentEMAFast < currentEMASlow || isClearDowntrend, // Downtrend OR clear downtrend from candles
    prevEMAFast >= prevEMASlow || (currentEMAFast < currentEMASlow && Math.abs(currentEMAFast - currentEMASlow) / currentEMASlow > 0.0005) || isClearDowntrend, // EMA crossover OR strong trend OR clear downtrend
    currentRSI < 65 && currentRSI > 25, // RSI relaxed range (was 30-60)
    currentClose < currentVWAP * 1.0005 || isClearDowntrend, // Price near or below VWAP OR clear downtrend
    volumeRatio > 0.8, // Volume relaxed: >0.8x average (was >1.2x)
    currentMomentum < 0.1 || isClearDowntrend, // Negative or slightly positive momentum OR clear downtrend
  ];

  // Bollinger Band mean reversion signals (more aggressive)
  // ENFORCE trend filtering: BB signals only valid if aligned with trend
  const bbLong = currentClose < currentBBLower && currentRSI < 40 && !isClearDowntrend; // Relaxed from 35, but block in downtrend
  const bbShort = currentClose > currentBBUpper && currentRSI > 60 && !isClearUptrend; // Relaxed from 65, but block in uptrend

  // Strong momentum signals (for fast 1-minute scalping)
  // ENFORCE trend filtering: Momentum signals must align with trend
  const strongMomentumLong = currentMomentum > 0.3 && (currentEMAFast > currentEMASlow || isClearUptrend) && volumeRatio > 0.6 && !isClearDowntrend;
  const strongMomentumShort = currentMomentum < -0.3 && (currentEMAFast < currentEMASlow || isClearDowntrend) && volumeRatio > 0.6 && !isClearUptrend;

  // Generate signal
  const longScore = longConditions.filter(Boolean).length;
  const shortScore = shortConditions.filter(Boolean).length;

  // ATR-based dynamic risk management
  const TAKE_PROFIT_1_MULT = 1.5;
  const TAKE_PROFIT_2_MULT = 3.0;
  const STOP_LOSS_MULT = 1.5;

  // TIGHTER THRESHOLD: Require 5/6 conditions (was 4/6) AND 1h Trend Alignment
  if (
    !recentFallSwing &&
    htfTrend !== 'BEAR' && // 1h Trend MUST NOT be Bearish for LONG
    (longScore >= 5 || (longScore >= 4 && (bbLong || strongMomentumLong || swingReversalLong)))
  ) {
    // LONG signal
    const stopLoss = currentClose - (currentATR * STOP_LOSS_MULT);
    const takeProfit1 = currentClose + (currentATR * TAKE_PROFIT_1_MULT);
    const takeProfit2 = currentClose + (currentATR * TAKE_PROFIT_2_MULT);

    // Calculate confidence based on conditions met
    let confidence = 75;
    if (longScore >= 6) confidence = 95;
    else if (longScore >= 5) confidence = 85;
    else confidence = 75;

    return {
      signal: 'LONG',
      entry: currentClose,
      stopLoss,
      takeProfit1,
      takeProfit2,
      confidence,
      reason: htfTrend === 'BULL' 
        ? `Aligned with 1h BULL trend | ${longScore}/6 conditions met`
        : `Recovery signal | ${longScore}/6 conditions met`,
      marketState: htfTrend === 'BULL' ? 'BULLISH_TREND' : 'NEUTRAL',
      rsi: currentRSI,
      volume: volumeRatio > 1.5 ? 'HIGH' : volumeRatio > 1.0 ? 'MODERATE' : 'NORMAL',
    };
  } else if (
    htfTrend !== 'BULL' && // 1h Trend MUST NOT be Bullish for SHORT
    !isClearUptrend &&
    (shortScore >= 5 || (shortScore >= 4 && (bbShort || strongMomentumShort || swingReversalShort)))
  ) {
    // SHORT signal
    const stopLoss = currentClose + (currentATR * STOP_LOSS_MULT);
    const takeProfit1 = currentClose - (currentATR * TAKE_PROFIT_1_MULT);
    const takeProfit2 = currentClose - (currentATR * TAKE_PROFIT_2_MULT);

    // Calculate confidence
    let confidence = 75;
    if (shortScore >= 6) confidence = 95;
    else if (shortScore >= 5) confidence = 85;
    else confidence = 75;

    return {
      signal: 'SHORT',
      entry: currentClose,
      stopLoss,
      takeProfit1,
      takeProfit2,
      confidence,
      reason: htfTrend === 'BEAR'
        ? `Aligned with 1h BEAR trend | ${shortScore}/6 conditions met`
        : `Rejection signal | ${shortScore}/6 conditions met`,
      marketState: htfTrend === 'BEAR' ? 'BEARISH_TREND' : 'NEUTRAL',
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
