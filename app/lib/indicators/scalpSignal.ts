/**
 * Scalp Signal Indicator
 *
 * Reads candles from Zustand, runs generateScalpSignal on last closed candle only.
 * No repainting: uses only confirmed (closed) candle closes.
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

/** One item for chart: either a LONG/SHORT marker or a WAIT status (so we always show something when Scalp is on) */
export type ScalpDisplayItem =
  | ScalpSignalMarker
  | { time: number; signal: 'WAIT'; reason: string };

export interface ScalpPosition {
  type: 'LONG' | 'SHORT';
  entry: number;
  entryTime: number;
}

// ─── Helper: EMA (spec: first value = data[0], then EMA recurrence) ───
function calculateEMA(data: number[], period: number): number[] {
  const multiplier = 2 / (period + 1);
  const ema: number[] = [data[0]];

  for (let i = 1; i < data.length; i++) {
    const value = (data[i] - ema[i - 1]) * multiplier + ema[i - 1];
    ema.push(value);
  }

  return ema;
}

// ─── Helper: SMA ───
function calculateSMA(data: number[], period: number): number[] {
  const sma: number[] = [];

  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma.push(sum / period);
  }

  return sma;
}

// ─── Helper: ATR (TR then SMA(tr, period)) ───
function calculateATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const tr: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];
    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    tr.push(Math.max(tr1, tr2, tr3));
  }

  return calculateSMA(tr, period);
}

// ─── Helper: Supertrend (ATR aligned to closes length) ───
function calculateSupertrend(
  highs: number[],
  lows: number[],
  closes: number[],
  atr: number[],
  multiplier: number
): { value: number; direction: 'UP' | 'DOWN' }[] {
  const period = closes.length - atr.length; // atr length = closes.length - period
  const supertrend: { value: number; direction: 'UP' | 'DOWN' }[] = [];
  let direction = 1; // 1 = UP, -1 = DOWN
  let upperBand: number;
  let lowerBand: number;

  for (let i = 0; i < closes.length; i++) {
    const hl2 = (highs[i] + lows[i]) / 2;
    const atrIndex = Math.max(0, i - period);
    const atrValue = atr[atrIndex] ?? atr[atr.length - 1] ?? 0;

    upperBand = hl2 + multiplier * atrValue;
    lowerBand = hl2 - multiplier * atrValue;

    if (closes[i] > upperBand) {
      direction = 1;
    } else if (closes[i] < lowerBand) {
      direction = -1;
    }

    const value = direction === 1 ? lowerBand : upperBand;

    supertrend.push({
      value,
      direction: direction === 1 ? 'UP' : 'DOWN',
    });
  }

  return supertrend;
}

// ─── Helper: RSI (spec: first RSI at index period, then smoothed) ───
function calculateRSI(data: number[], period: number): number[] {
  const rsi: number[] = [];
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = data[i] - data[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  rsi.push(100 - 100 / (1 + rs));

  for (let i = period + 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    const rsNext = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi.push(100 - 100 / (1 + rsNext));
  }

  return rsi;
}

// ─── Helper: VWAP with daily reset ───
function calculateVWAP(candles: Candle[]): number[] {
  const vwap: number[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  let currentDay = new Date(candles[0].time * 1000).getUTCDate();

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const day = new Date(candle.time * 1000).getUTCDate();

    if (day !== currentDay) {
      cumulativeTPV = 0;
      cumulativeVolume = 0;
      currentDay = day;
    }

    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const vol = candle.volume ?? 0;
    cumulativeTPV += typicalPrice * vol;
    cumulativeVolume += vol;

    vwap.push(cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice);
  }

  return vwap;
}

/**
 * Generate scalp signal from candle array.
 * Uses only closed candles (excludes forming candle) to avoid repainting.
 */
export function generateScalpSignal(candles: Candle[]): ScalpSignalResult {
  const closedCandles = candles.slice(0, candles.length - 1);
  if (closedCandles.length < 100) {
    return { signal: 'WAIT', reason: 'Insufficient data' };
  }

  const data = closedCandles.length > 800 ? closedCandles.slice(-800) : closedCandles;

  const closes = data.map((c) => c.close);
  const highs = data.map((c) => c.high);
  const lows = data.map((c) => c.low);
  const volumes = data.map((c) => c.volume ?? 0);

  const ema8 = calculateEMA(closes, 8);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const atr = calculateATR(highs, lows, closes, 10);
  const supertrend = calculateSupertrend(highs, lows, closes, atr, 3);
  const rsi5 = calculateRSI(closes, 5);
  const volumeMA = calculateSMA(volumes, 20);
  const vwap = calculateVWAP(data);

  const current = data[data.length - 1];
  const currentClose = current.close;
  const currentOpen = current.open;
  const currentVolume = current.volume ?? 0;

  const currentEMA8 = ema8[ema8.length - 1];
  const currentEMA21 = ema21[ema21.length - 1];
  const currentEMA50 = ema50[ema50.length - 1];
  const currentRSI = rsi5[rsi5.length - 1];
  const currentSupertrend = supertrend[supertrend.length - 1];
  const currentVolumeMA = volumeMA[volumeMA.length - 1];
  const currentVWAP = vwap[vwap.length - 1];

  // Time filter: 13:00–22:00 UTC (disabled so indicator can show signals anytime)
  // const currentHour = new Date(current.time * 1000).getUTCHours();
  // const isValidTime = currentHour >= 13 && currentHour < 22;
  // if (!isValidTime) {
  //   return { signal: 'WAIT', reason: 'Outside trading hours (13–22 UTC)' };
  // }

  // Trend
  const isBullishTrend = currentEMA8 > currentEMA21 && currentEMA21 > currentEMA50;
  const isBearishTrend = currentEMA8 < currentEMA21 && currentEMA21 < currentEMA50;
  const isChoppy = !isBullishTrend && !isBearishTrend;

  if (isChoppy) {
    return { signal: 'WAIT', reason: 'Choppy market - EMAs tangled' };
  }

  // Volume confirmation: relaxed thresholds
  // Strong surge: > 1.2× MA (for high confidence)
  // Moderate: > 0.9× MA (acceptable if other conditions are strong)
  const volumeSurgeStrong = currentVolumeMA > 0 && currentVolume > currentVolumeMA * 1.2;
  const volumeSurgeModerate = currentVolumeMA > 0 && currentVolume > currentVolumeMA * 0.9;
  const volumeSurge = volumeSurgeStrong; // For backward compatibility

  // LONG
  if (isBullishTrend) {
    const condition1 = currentClose > currentEMA21;
    const condition2 = currentSupertrend.direction === 'UP';
    const condition3 = currentRSI > 50 && currentRSI < 75;
    const condition4 = currentClose >= currentVWAP * 0.998;
    const condition5 = currentClose > currentOpen;
    // Volume: accept if strong surge OR (moderate + all other conditions perfect)
    const condition6 = volumeSurgeStrong || (volumeSurgeModerate && condition1 && condition2 && condition3 && condition4 && condition5);

    if (condition1 && condition2 && condition3 && condition4 && condition5 && condition6) {
      const stopLoss = currentSupertrend.value;
      const takeProfit1 = currentClose * 1.002;
      const takeProfit2 = currentClose * 1.003;

      // Adjust confidence based on volume strength
      const confidence = volumeSurgeStrong ? 85 : 75;
      
      return {
        signal: 'LONG',
        entry: currentClose,
        stopLoss,
        takeProfit1,
        takeProfit2,
        confidence,
        reason: volumeSurgeStrong ? 'All bullish conditions met' : 'Bullish trend with moderate volume',
      };
    }
  }

  // SHORT
  if (isBearishTrend) {
    const condition1 = currentClose < currentEMA21;
    const condition2 = currentSupertrend.direction === 'DOWN';
    const condition3 = currentRSI < 50 && currentRSI > 25;
    const condition4 = currentClose <= currentVWAP * 1.002;
    const condition5 = currentClose < currentOpen;
    // Volume: accept if strong surge OR (moderate + all other conditions perfect)
    const condition6 = volumeSurgeStrong || (volumeSurgeModerate && condition1 && condition2 && condition3 && condition4 && condition5);

    if (condition1 && condition2 && condition3 && condition4 && condition5 && condition6) {
      const stopLoss = currentSupertrend.value;
      const takeProfit1 = currentClose * 0.998;
      const takeProfit2 = currentClose * 0.997;

      // Adjust confidence based on volume strength
      const confidence = volumeSurgeStrong ? 85 : 75;
      
      return {
        signal: 'SHORT',
        entry: currentClose,
        stopLoss,
        takeProfit1,
        takeProfit2,
        confidence,
        reason: volumeSurgeStrong ? 'All bearish conditions met' : 'Bearish trend with moderate volume',
      };
    }
  }

  // If we have a clear trend but volume is too low, provide more helpful feedback
  if ((isBullishTrend || isBearishTrend) && !volumeSurgeModerate) {
    const volumeRatio = currentVolumeMA > 0 ? (currentVolume / currentVolumeMA).toFixed(2) : '0';
    return {
      signal: 'WAIT',
      reason: `Low volume (${volumeRatio}x avg) - need >0.9x`,
      marketState: isBullishTrend ? 'BULLISH_TREND' : 'BEARISH_TREND',
      rsi: currentRSI,
      volume: 'LOW',
    };
  }

  return {
    signal: 'WAIT',
    reason: 'Conditions not fully met',
    marketState: isBullishTrend ? 'BULLISH_TREND' : 'BEARISH_TREND',
    rsi: currentRSI,
    volume: volumeSurgeStrong ? 'SURGE' : volumeSurgeModerate ? 'MODERATE' : 'NORMAL',
  };
}

/**
 * Check exit signal when in a position (for position management).
 */
export function checkExitSignal(candles: Candle[], position: ScalpPosition): { exit: boolean; reason?: string } {
  if (candles.length < 50) return { exit: false };

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume ?? 0);

  const ema8 = calculateEMA(closes, 8);
  const ema21 = calculateEMA(closes, 21);
  const atr = calculateATR(highs, lows, closes, 10);
  const supertrend = calculateSupertrend(highs, lows, closes, atr, 3);
  const rsi5 = calculateRSI(closes, 5);
  const volumeMA = calculateSMA(volumes, 20);

  const current = candles[candles.length - 1];
  const currentEMA8 = ema8[ema8.length - 1];
  const currentEMA21 = ema21[ema21.length - 1];
  const currentRSI = rsi5[rsi5.length - 1];
  const currentSupertrend = supertrend[supertrend.length - 1];
  const currentVolume = current.volume ?? 0;
  const currentVolumeMA = volumeMA[volumeMA.length - 1];

  const candlesSinceEntry = Math.floor((current.time - position.entryTime) / 60);

  if (position.type === 'LONG') {
    if (currentSupertrend.direction === 'DOWN') {
      return { exit: true, reason: 'Supertrend flipped bearish' };
    }
    if (currentRSI > 80) {
      return { exit: true, reason: 'RSI overbought' };
    }
    if (currentEMA8 < currentEMA21) {
      return { exit: true, reason: 'EMA bearish crossover' };
    }
    const profitPercent = ((current.close - position.entry) / position.entry) * 100;
    if (profitPercent >= 0.3) {
      return { exit: true, reason: 'Take profit hit (0.3%)' };
    }
    if (candlesSinceEntry >= 10) {
      return { exit: true, reason: 'Max hold time (10 candles)' };
    }
    if (currentVolume < currentVolumeMA) {
      return { exit: true, reason: 'Volume declining' };
    }
  }

  if (position.type === 'SHORT') {
    if (currentSupertrend.direction === 'UP') {
      return { exit: true, reason: 'Supertrend flipped bullish' };
    }
    if (currentRSI < 20) {
      return { exit: true, reason: 'RSI oversold' };
    }
    if (currentEMA8 > currentEMA21) {
      return { exit: true, reason: 'EMA bullish crossover' };
    }
    const profitPercent = ((position.entry - current.close) / position.entry) * 100;
    if (profitPercent >= 0.3) {
      return { exit: true, reason: 'Take profit hit (0.3%)' };
    }
    if (candlesSinceEntry >= 10) {
      return { exit: true, reason: 'Max hold time (10 candles)' };
    }
    if (currentVolume < currentVolumeMA) {
      return { exit: true, reason: 'Volume declining' };
    }
  }

  return { exit: false };
}

/**
 * Convert ScalpSignalResult + last closed candle time to an array for chart.
 * Always returns one item when we have enough data: either LONG/SHORT marker or WAIT status,
 * so the chart can always show a Scalp marker when the indicator is on.
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
