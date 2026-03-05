/**
 * TrendScalp Indicator - 1-minute BTC scalping
 *
 * Swing-point, multi-timeframe algorithm. Uses last 1000 closed 1m bars:
 * - 5m/15m aggregation for trend (EMA 20/50); 1m EMAs 9/21/50/200, RSI 14, MACD, Stoch, ATR, session VWAP, BB, volume MA, delta/CVD.
 * - 5-bar swing high/low; S/R zones; pullback (0.382–0.618 at key levels); simplified RSI/MACD divergence.
 * - Score-based signal; LONG only when score ≥ 40, 5m UPTREND, at support; SHORT when score ≤ -40, 5m DOWNTREND, at resistance.
 * - SL/TP from ATR and nearest swing; minimum R:R 1.5. Only uses CLOSED candles (no repainting).
 * - Display: 1 support + 1 resistance from 9-bar swings (less noise), 0.4% zone clustering, min gap 0.6%/ATR so levels don't overlap.
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

export interface TrendScalpResult {
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
  /** Support zone price levels (for drawing horizontal lines) */
  supportZones?: number[];
  /** Resistance zone price levels (for drawing horizontal lines) */
  resistanceZones?: number[];
  /** Last swing high price (key level / swing spot expected) */
  lastSwingHigh?: number;
  /** Last swing low price (key level / swing spot expected) */
  lastSwingLow?: number;
  /** Last swing high bar time (seconds) for marker */
  lastSwingHighTime?: number;
  /** Last swing low bar time (seconds) for marker */
  lastSwingLowTime?: number;
}

export interface TrendScalpMarker {
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

export type TrendScalpDisplayItem =
  | TrendScalpMarker
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

/** Aggregate 1m candles to 5m: every 5 consecutive bars → one bar (open first, high max, low min, close last, volume sum, time last). */
function aggregateTo5m(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + 5 <= candles.length; i += 5) {
    const chunk = candles.slice(i, i + 5);
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

/** Aggregate 1m candles to 15m: every 15 consecutive bars → one bar. */
function aggregateTo15m(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + 15 <= candles.length; i += 15) {
    const chunk = candles.slice(i, i + 15);
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

/** Estimate delta per candle: buyVol = volume * (close - low) / (high - low), sellVol = volume - buyVol, delta = buyVol - sellVol. */
function estimateDelta(candle: Candle): number {
  const vol = candle.volume ?? 0;
  const range = candle.high - candle.low;
  if (range <= 0) return 0;
  const buyVol = (vol * (candle.close - candle.low)) / range;
  const sellVol = vol - buyVol;
  return buyVol - sellVol;
}

/** CVD over last N bars and slope of last 5 CVD values (linear regression slope). */
function getCvdAndSlope(candles: Candle[], nBars: number, slopeBars: number): { cvd: number[]; slope: number } {
  const deltas: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    deltas.push(estimateDelta(candles[i]));
  }
  const cvd: number[] = [];
  let sum = 0;
  for (let i = 0; i < deltas.length; i++) {
    sum += deltas[i];
    cvd.push(sum);
  }
  const lastN = cvd.slice(-nBars);
  if (lastN.length < slopeBars) return { cvd, slope: 0 };
  const lastSlopeValues = lastN.slice(-slopeBars);
  // Linear regression slope: slope = (n*sum(xy) - sum(x)*sum(y)) / (n*sum(x^2) - sum(x)^2), x = 0..slopeBars-1
  const n = lastSlopeValues.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += lastSlopeValues[i];
    sumXY += i * lastSlopeValues[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  return { cvd, slope };
}

/** 5-bar swing high: center at i, window [i-2, i-1, i, i+1, i+2]; bar[i].high strictly greater than the other four. */
function isSwingHigh(bars: Candle[], i: number): boolean {
  if (i < 2 || i > bars.length - 3) return false;
  const h = bars[i].high;
  return h > bars[i - 2].high && h > bars[i - 1].high && h > bars[i + 1].high && h > bars[i + 2].high;
}

/** 5-bar swing low: center at i; bar[i].low strictly less than the other four. */
function isSwingLow(bars: Candle[], i: number): boolean {
  if (i < 2 || i > bars.length - 3) return false;
  const l = bars[i].low;
  return l < bars[i - 2].low && l < bars[i - 1].low && l < bars[i + 1].low && l < bars[i + 2].low;
}

/** 9-bar swing high: center at i, 4 bars each side; bar[i].high strictly greater than all 8. Used for S/R display only (less noise). */
function isSwingHigh9(bars: Candle[], i: number): boolean {
  if (i < 4 || i > bars.length - 5) return false;
  const h = bars[i].high;
  for (let j = i - 4; j <= i + 4; j++) if (j !== i && bars[j].high >= h) return false;
  return true;
}

/** 9-bar swing low: center at i; bar[i].low strictly less than all 8. Used for S/R display only. */
function isSwingLow9(bars: Candle[], i: number): boolean {
  if (i < 4 || i > bars.length - 5) return false;
  const l = bars[i].low;
  for (let j = i - 4; j <= i + 4; j++) if (j !== i && bars[j].low <= l) return false;
  return true;
}

/** Collect last 50 swing highs as [price, index] (5-bar). */
function getLastSwingHighs(bars: Candle[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 2; i <= bars.length - 3; i++) {
    if (isSwingHigh(bars, i)) out.push([bars[i].high, i]);
  }
  return out.slice(-50);
}

/** Collect last 50 swing lows as [price, index] (5-bar). */
function getLastSwingLows(bars: Candle[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 2; i <= bars.length - 3; i++) {
    if (isSwingLow(bars, i)) out.push([bars[i].low, i]);
  }
  return out.slice(-50);
}

/** Collect last 50 swing highs (9-bar) for S/R display. */
function getLastSwingHighs9(bars: Candle[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 4; i <= bars.length - 5; i++) {
    if (isSwingHigh9(bars, i)) out.push([bars[i].high, i]);
  }
  return out.slice(-50);
}

/** Collect last 50 swing lows (9-bar) for S/R display. */
function getLastSwingLows9(bars: Candle[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 4; i <= bars.length - 5; i++) {
    if (isSwingLow9(bars, i)) out.push([bars[i].low, i]);
  }
  return out.slice(-50);
}

/** Cluster swing prices within tolerance (0.002 = 0.2%); return list of zone prices (e.g. average per cluster). */
function findSrZones(swings: [number, number][], tolerance = 0.002): number[] {
  if (swings.length === 0) return [];
  const prices = swings.map(s => s[0]).slice();
  prices.sort((a, b) => a - b);
  const zones: number[] = [];
  let i = 0;
  while (i < prices.length) {
    const ref = prices[i];
    const cluster: number[] = [ref];
    i++;
    while (i < prices.length && (prices[i] - ref) / ref <= tolerance) {
      cluster.push(prices[i]);
      i++;
    }
    zones.push(cluster.reduce((a, b) => a + b, 0) / cluster.length);
  }
  return zones;
}

/** 5m trend: EMA 20 and 50 on 5m closes. UPTREND / DOWNTREND / NEUTRAL. */
function get5mTrend(bars: Candle[]): 'UPTREND' | 'DOWNTREND' | 'NEUTRAL' {
  const agg = aggregateTo5m(bars);
  if (agg.length < 50) return 'NEUTRAL';
  const closes = agg.map(c => c.close);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const e20 = ema20[ema20.length - 1];
  const e50 = ema50[ema50.length - 1];
  if (e20 > e50) return 'UPTREND';
  if (e20 < e50) return 'DOWNTREND';
  return 'NEUTRAL';
}

/** 15m trend: EMA 20 and 50 on 15m closes. */
function get15mTrend(bars: Candle[]): 'UPTREND' | 'DOWNTREND' | 'NEUTRAL' {
  const agg = aggregateTo15m(bars);
  if (agg.length < 50) return 'NEUTRAL';
  const closes = agg.map(c => c.close);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const e20 = ema20[ema20.length - 1];
  const e50 = ema50[ema50.length - 1];
  if (e20 > e50) return 'UPTREND';
  if (e20 < e50) return 'DOWNTREND';
  return 'NEUTRAL';
}

/** Within 0.3% of a level. */
function nearLevel(price: number, level: number): boolean {
  if (level <= 0) return false;
  return Math.abs(price - level) / level <= 0.003;
}

/** Pullback (long setup): retracement from last swing high 0.382–0.618 and price near EMA21, EMA50, VWAP, or any support zone. */
function detectPullback(
  bars: Candle[],
  swingHighs: [number, number][],
  swingLows: [number, number][],
  supportZones: number[],
  ema21: number,
  ema50: number,
  vwap: number
): { type: 'PULLBACK'; retracement_pct: number; key_level: string } | null {
  if (swingHighs.length === 0 || swingLows.length === 0) return null;
  const lastHigh = swingHighs[swingHighs.length - 1][0];
  const lastLow = swingLows[swingLows.length - 1][0];
  const impulse = lastHigh - lastLow;
  if (impulse <= 0) return null;
  const currentPrice = bars[bars.length - 1].close;
  const retracement = lastHigh - currentPrice;
  const retracement_pct = retracement / impulse;
  if (retracement_pct < 0.382 || retracement_pct > 0.618) return null;
  const keyLevels: string[] = [];
  if (nearLevel(currentPrice, ema21)) keyLevels.push('EMA21');
  if (nearLevel(currentPrice, ema50)) keyLevels.push('EMA50');
  if (nearLevel(currentPrice, vwap)) keyLevels.push('VWAP');
  for (const z of supportZones) {
    if (nearLevel(currentPrice, z)) {
      keyLevels.push('support');
      break;
    }
  }
  if (keyLevels.length === 0) return null;
  return { type: 'PULLBACK', retracement_pct, key_level: keyLevels[0] };
}

/** Simplified RSI divergence: last two swing lows – price lower low, RSI higher low = bullish (+25). Opposite = bearish (-25). */
function detectRsiDivergence(
  bars: Candle[],
  swingLows: [number, number][],
  swingHighs: [number, number][],
  rsi: number[]
): 'BULLISH' | 'BEARISH' | null {
  const len = bars.length;
  if (rsi.length < len) return null;
  if (swingLows.length >= 2) {
    const [, i1] = swingLows[swingLows.length - 2];
    const [, i2] = swingLows[swingLows.length - 1];
    if (!Number.isFinite(rsi[i1]) || !Number.isFinite(rsi[i2])) return null;
    const p1 = bars[i1].low;
    const p2 = bars[i2].low;
    const r1 = rsi[i1];
    const r2 = rsi[i2];
    if (p2 < p1 && r2 > r1) return 'BULLISH';
  }
  if (swingHighs.length >= 2) {
    const [, i1] = swingHighs[swingHighs.length - 2];
    const [, i2] = swingHighs[swingHighs.length - 1];
    if (!Number.isFinite(rsi[i1]) || !Number.isFinite(rsi[i2])) return null;
    const p1 = bars[i1].high;
    const p2 = bars[i2].high;
    const r1 = rsi[i1];
    const r2 = rsi[i2];
    if (p2 > p1 && r2 < r1) return 'BEARISH';
  }
  return null;
}

/** Simplified MACD divergence: last two swing lows/highs vs MACD line. */
function detectMacdDivergence(
  bars: Candle[],
  swingLows: [number, number][],
  swingHighs: [number, number][],
  macdLine: number[]
): 'BULLISH' | 'BEARISH' | null {
  const len = bars.length;
  if (macdLine.length < len) return null;
  if (swingLows.length >= 2) {
    const [, i1] = swingLows[swingLows.length - 2];
    const [, i2] = swingLows[swingLows.length - 1];
    if (!Number.isFinite(macdLine[i1]) || !Number.isFinite(macdLine[i2])) return null;
    const m1 = macdLine[i1];
    const m2 = macdLine[i2];
    const p1 = bars[i1].low;
    const p2 = bars[i2].low;
    if (p2 < p1 && m2 > m1) return 'BULLISH';
  }
  if (swingHighs.length >= 2) {
    const [, i1] = swingHighs[swingHighs.length - 2];
    const [, i2] = swingHighs[swingHighs.length - 1];
    if (!Number.isFinite(macdLine[i1]) || !Number.isFinite(macdLine[i2])) return null;
    const m1 = macdLine[i1];
    const m2 = macdLine[i2];
    const p1 = bars[i1].high;
    const p2 = bars[i2].high;
    if (p2 > p1 && m2 < m1) return 'BEARISH';
  }
  return null;
}

interface NewIndicatorSnapshot {
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  rsi: number;
  macdLine: number;
  macdSignal: number;
  macdHist: number;
  stochK: number;
  stochD: number;
  vwap: number;
  bbUpper: number;
  bbLower: number;
  bbMiddle: number;
  volumeMA: number;
  atr: number;
  price: number;
  volume: number;
  delta: number;
  cvdSlope: number;
  bodyRatio: number; // last candle body / range
}

function calculateScore(
  bars: Candle[],
  ind: NewIndicatorSnapshot,
  pullback: { type: 'PULLBACK' } | null,
  rsiDiv: 'BULLISH' | 'BEARISH' | null,
  macdDiv: 'BULLISH' | 'BEARISH' | null
): number {
  let score = 0;
  const c = bars[bars.length - 1];

  // RSI 14: <30 (+20), >70 (-20), 40–60 (+5). RSI divergence: BULLISH +25, BEARISH -25.
  if (ind.rsi < 30) score += 20;
  else if (ind.rsi > 70) score -= 20;
  else if (ind.rsi >= 40 && ind.rsi <= 60) score += 5;
  if (rsiDiv === 'BULLISH') score += 25;
  if (rsiDiv === 'BEARISH') score -= 25;

  // MACD: line > signal (+12), else (-12). Histogram >0 (+8), else (-8). MACD divergence: BULLISH +20, BEARISH -20.
  if (ind.macdLine > ind.macdSignal) score += 12;
  else score -= 12;
  if (ind.macdHist > 0) score += 8;
  else score -= 8;
  if (macdDiv === 'BULLISH') score += 20;
  if (macdDiv === 'BEARISH') score -= 20;

  // Stochastic: K > D (+10), else (-10). K <20 (+15), K >80 (-15).
  if (ind.stochK > ind.stochD) score += 10;
  else score -= 10;
  if (ind.stochK < 20) score += 15;
  else if (ind.stochK > 80) score -= 15;

  // EMAs (1m): 9>21>50 (+15), 9<21<50 (-15). Price > EMA9 (+8), else (-8). Price > EMA200 (+10), else (-10).
  if (ind.ema9 > ind.ema21 && ind.ema21 > ind.ema50) score += 15;
  else if (ind.ema9 < ind.ema21 && ind.ema21 < ind.ema50) score -= 15;
  if (ind.price > ind.ema9) score += 8;
  else score -= 8;
  if (ind.price > ind.ema200) score += 10;
  else score -= 10;

  // VWAP: price > VWAP (+12), else (-12).
  if (ind.price > ind.vwap) score += 12;
  else score -= 12;

  // BB: price < lower (+15), price > upper (-15).
  if (ind.price < ind.bbLower) score += 15;
  else if (ind.price > ind.bbUpper) score -= 15;

  // Volume: >2x MA (+15), >1.5x MA (+8), <0.5x MA (-5).
  if (ind.volumeMA > 0) {
    const ratio = ind.volume / ind.volumeMA;
    if (ratio > 2) score += 15;
    else if (ratio > 1.5) score += 8;
    else if (ratio < 0.5) score -= 5;
  }

  // Delta/CVD: delta >0 (+10), else (-10). CVD slope >0 (+8), else (-8).
  if (ind.delta > 0) score += 10;
  else score -= 10;
  if (ind.cvdSlope > 0) score += 8;
  else score -= 8;

  // Last candle body ratio: strong green (+12/+6), strong red (-12/-6). Plan: body_ratio thresholds.
  if (c.high !== c.low) {
    const bodyRatio = Math.abs(c.close - c.open) / (c.high - c.low);
    if (bodyRatio > 0.6) {
      if (c.close > c.open) score += 12;
      else score -= 12;
    } else if (bodyRatio > 0.35) {
      if (c.close > c.open) score += 6;
      else score -= 6;
    }
  }

  // Pullback: +25.
  if (pullback) score += 25;

  return score;
}

function generateSignalInternal(
  bars: Candle[],
  score: number,
  indicators: NewIndicatorSnapshot,
  swingHighs: [number, number][],
  swingLows: [number, number][],
  supportZones: number[],
  resistanceZones: number[],
  atr: number
): TrendScalpResult {
  const entry = bars[bars.length - 1].close;
  const price = entry;
  const fiveMTrend = get5mTrend(bars);

  // LONG: score >= 40, 5m UPTREND, at support (within 0.3% of EMA50, VWAP, or support zone).
  if (score >= 40 && fiveMTrend === 'UPTREND') {
    const atSupport =
      nearLevel(price, indicators.ema50) ||
      nearLevel(price, indicators.vwap) ||
      supportZones.some(z => nearLevel(price, z));
    if (!atSupport) {
      return {
        signal: 'WAIT',
        reason: `Score ${score.toFixed(0)} but not at key support (EMA50/VWAP/support zone)`,
        signalStrength: Math.max(-100, Math.min(100, score)),
        regime: 'neutral',
        rsi: indicators.rsi,
      };
    }
    // SL = max(entry - 2*ATR, nearest swing low below - 0.05%, entry*0.992)
    const swingLowsBelow = swingLows.filter(([p]) => p < entry).map(([p]) => p);
    const nearestSwingBelow = swingLowsBelow.length ? Math.max(...swingLowsBelow) : 0;
    let sl = entry - 2 * atr;
    if (nearestSwingBelow > 0) sl = Math.max(sl, nearestSwingBelow * (1 - 0.0005));
    sl = Math.max(sl, entry * 0.992);
    // TP = min(entry + 3*ATR, nearest resistance above). If no resistance, entry + 3*ATR.
    const resAbove = resistanceZones.filter(z => z > entry);
    const nearestRes = resAbove.length ? Math.min(...resAbove) : 0;
    let tp = entry + 3 * atr;
    if (nearestRes > 0) tp = Math.min(tp, nearestRes);
    const risk = entry - sl;
    const reward = tp - entry;
    const rr = risk > 0 ? reward / risk : 0;
    if (rr < 1.5) {
      return {
        signal: 'WAIT',
        reason: `Risk:Reward too low (${rr.toFixed(2)})`,
        signalStrength: Math.max(-100, Math.min(100, score)),
        regime: 'neutral',
        rsi: indicators.rsi,
      };
    }
    const confidence = Math.abs(score) >= 60 ? 95 : Math.abs(score) >= 50 ? 85 : 75;
    return {
      signal: 'LONG',
      entry,
      stopLoss: sl,
      takeProfit: tp,
      confidence,
      signalStrength: Math.max(-100, Math.min(100, score)),
      reason: `Swing low bounce, 5m UPTREND, score ${score.toFixed(0)}`,
      regime: 'trending_up',
      rsi: indicators.rsi,
    };
  }

  // SHORT: score <= -40, 5m DOWNTREND, at resistance.
  if (score <= -40 && fiveMTrend === 'DOWNTREND') {
    const atResistance =
      nearLevel(price, indicators.ema50) ||
      resistanceZones.some(z => nearLevel(price, z));
    if (!atResistance) {
      return {
        signal: 'WAIT',
        reason: `Score ${score.toFixed(0)} but not at key resistance (EMA50/resistance zone)`,
        signalStrength: Math.max(-100, Math.min(100, score)),
        regime: 'neutral',
        rsi: indicators.rsi,
      };
    }
    // SL = min(entry + 2*ATR, nearest swing high above + 0.05%, entry*1.008)
    const swingHighsAbove = swingHighs.filter(([p]) => p > entry).map(([p]) => p);
    const nearestSwingAbove = swingHighsAbove.length ? Math.min(...swingHighsAbove) : 0;
    let sl = entry + 2 * atr;
    if (nearestSwingAbove > 0) sl = Math.min(sl, nearestSwingAbove * (1 + 0.0005));
    sl = Math.min(sl, entry * 1.008);
    // TP = max(entry - 3*ATR, nearest support below).
    const suppBelow = supportZones.filter(z => z < entry);
    const nearestSupp = suppBelow.length ? Math.max(...suppBelow) : 0;
    let tp = entry - 3 * atr;
    if (nearestSupp > 0) tp = Math.max(tp, nearestSupp);
    const risk = sl - entry;
    const reward = entry - tp;
    const rr = risk > 0 ? reward / risk : 0;
    if (rr < 1.5) {
      return {
        signal: 'WAIT',
        reason: `Risk:Reward too low (${rr.toFixed(2)})`,
        signalStrength: Math.max(-100, Math.min(100, score)),
        regime: 'neutral',
        rsi: indicators.rsi,
      };
    }
    const confidence = Math.abs(score) >= 60 ? 95 : Math.abs(score) >= 50 ? 85 : 75;
    return {
      signal: 'SHORT',
      entry,
      stopLoss: sl,
      takeProfit: tp,
      confidence,
      signalStrength: Math.max(-100, Math.min(100, score)),
      reason: `Swing high rejection, 5m DOWNTREND, score ${score.toFixed(0)}`,
      regime: 'trending_down',
      rsi: indicators.rsi,
    };
  }

  // WAIT
  const reasons: string[] = [];
  if (score >= 40 && fiveMTrend !== 'UPTREND') reasons.push('5m trend not aligned for LONG');
  if (score <= -40 && fiveMTrend !== 'DOWNTREND') reasons.push('5m trend not aligned for SHORT');
  if (Math.abs(score) < 40) reasons.push(`Score below threshold (±40): ${score.toFixed(0)}`);
  const reasonStr = reasons.length ? reasons.join('; ') : `Score ${score.toFixed(0)}`;
  return {
    signal: 'WAIT',
    reason: reasonStr,
    signalStrength: Math.max(-100, Math.min(100, score)),
    regime: 'neutral',
    rsi: indicators.rsi,
  };
}

const MINIMUM_CANDLES_TRENDSCALP = 720;

/**
 * Generate TrendScalp signal - Swing-point, multi-timeframe algorithm.
 * Uses last 720 bars; when we have 720 total we use all as closed; when we have 721+ we exclude the last (forming) and use 720 closed.
 */
export function generateTrendScalpSignal(candles: Candle[]): TrendScalpResult {
  const inputLen = candles.length;
  const closedCandles = inputLen > 720
    ? candles.slice(0, inputLen - 1).slice(-720)
    : candles.slice(-720);
  if (closedCandles.length < MINIMUM_CANDLES_TRENDSCALP) {
    return {
      signal: 'WAIT',
      reason: `Need at least ${MINIMUM_CANDLES_TRENDSCALP} candles (have ${inputLen})`,
      signalStrength: 0,
      regime: 'neutral',
    };
  }
  const bars = closedCandles;
  const closes = bars.map(c => c.close);
  const volumes = bars.map(c => c.volume ?? 0);
  const n = bars.length;

  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsiRaw = calculateRSI(closes, 14);
  const { macd: macdLineRaw, signal: macdSignalRaw, histogram: macdHist } = calculateMACD(closes, 12, 26, 9);
  const stoch = calculateStochastic(bars, 14, 3);
  const vwapArr = calculateVWAP(bars);
  const bb = calculateBollingerBands(closes, 20, 2);
  const volumeMA = calculateSMA(volumes, 20);
  const atrArr = calculateATR(bars, 14);

  const rsiAligned: number[] = Array(n).fill(NaN);
  for (let i = 14; i < n; i++) rsiAligned[i] = rsiRaw[i - 14];
  const currentRSI = Number.isFinite(rsiAligned[n - 1]) ? rsiAligned[n - 1] : 50;

  const macdLen = macdLineRaw.length;
  const macdOffset = n - macdLen;
  const macdLineAligned: number[] = Array(n).fill(NaN);
  const macdSignalAligned: number[] = Array(n).fill(NaN);
  for (let i = macdOffset; i < n; i++) {
    macdLineAligned[i] = macdLineRaw[i - macdOffset];
    macdSignalAligned[i] = macdSignalRaw[i - macdOffset];
  }

  const lastDelta = estimateDelta(bars[n - 1]);
  const { slope: cvdSlope } = getCvdAndSlope(bars, 100, 5);

  const swingHighs = getLastSwingHighs(bars);
  const swingLows = getLastSwingLows(bars);
  const supportZones = findSrZones(swingLows, 0.002);
  const resistanceZones = findSrZones(swingHighs, 0.002);

  const ema21Last = ema21[ema21.length - 1];
  const ema50Last = ema50[ema50.length - 1];
  const vwapLast = vwapArr[vwapArr.length - 1];
  const pullbackResult = detectPullback(bars, swingHighs, swingLows, supportZones, ema21Last, ema50Last, vwapLast);
  const rsiDiv = detectRsiDivergence(bars, swingLows, swingHighs, rsiAligned);
  const macdDiv = detectMacdDivergence(bars, swingLows, swingHighs, macdLineAligned);

  const bbUpperLast = bb.upper[bb.upper.length - 1];
  const bbLowerLast = bb.lower[bb.lower.length - 1];
  const bbMiddleLast = bb.middle[bb.middle.length - 1];
  const lastCandle = bars[n - 1];
  const rangeLast = lastCandle.high - lastCandle.low;
  const bodyRatioLast = rangeLast > 0 ? Math.abs(lastCandle.close - lastCandle.open) / rangeLast : 0;
  const atrLast = atrArr.length > 0 ? atrArr[atrArr.length - 1] : 0;

  const ind: NewIndicatorSnapshot = {
    ema9: ema9[ema9.length - 1],
    ema21: ema21Last,
    ema50: ema50Last,
    ema200: ema200[ema200.length - 1],
    rsi: currentRSI,
    macdLine: Number.isFinite(macdLineAligned[n - 1]) ? macdLineAligned[n - 1] : 0,
    macdSignal: Number.isFinite(macdSignalAligned[n - 1]) ? macdSignalAligned[n - 1] : 0,
    macdHist: macdHist.length > 0 ? macdHist[macdHist.length - 1] : 0,
    stochK: stoch.k.length > 0 ? stoch.k[stoch.k.length - 1] : 50,
    stochD: stoch.d.length > 0 ? stoch.d[stoch.d.length - 1] : 50,
    vwap: vwapLast,
    bbUpper: bbUpperLast,
    bbLower: bbLowerLast,
    bbMiddle: bbMiddleLast,
    volumeMA: volumeMA.length > 0 ? volumeMA[volumeMA.length - 1] : 0,
    atr: atrLast,
    price: lastCandle.close,
    volume: lastCandle.volume ?? 0,
    delta: lastDelta,
    cvdSlope,
    bodyRatio: bodyRatioLast,
  };

  const score = calculateScore(bars, ind, pullbackResult, rsiDiv, macdDiv);
  const internal = generateSignalInternal(bars, score, ind, swingHighs, swingLows, supportZones, resistanceZones, atrLast);

  // Drawn S/R: use 9-bar swings (less noise) and wider zone clustering; enforce minimum gap so resistance doesn't sit on top of support.
  const swingHighs9 = getLastSwingHighs9(bars);
  const swingLows9 = getLastSwingLows9(bars);
  const supportZonesDisplay = findSrZones(swingLows9, 0.004); // 0.4% clustering = fewer, stronger levels
  const resistanceZonesDisplay = findSrZones(swingHighs9, 0.004);
  const price = lastCandle.close;
  const breakThreshold = 0.002;
  const minGapPct = 0.006; // minimum 0.6% between support and resistance (so they don't overlap visually)
  const minGap = Math.max(price * minGapPct, atrLast); // at least ATR or 0.6% of price

  // 1 support: nearest at or below price; if broken, next support down.
  const supportsAtOrBelow = supportZonesDisplay.filter(z => z <= price).sort((a, b) => b - a);
  const nearestSupportBelow = supportsAtOrBelow[0];
  let displaySupport: number | undefined =
    nearestSupportBelow == null
      ? supportZonesDisplay.length > 0
        ? supportZonesDisplay.reduce((a, b) => (Math.abs(a - price) <= Math.abs(b - price) ? a : b))
        : undefined
      : price >= nearestSupportBelow * (1 - breakThreshold)
        ? nearestSupportBelow
        : (supportZonesDisplay.filter(z => z < price).sort((a, b) => b - a)[0] ?? nearestSupportBelow);

  // 1 resistance: nearest at or above price; if broken, next resistance up.
  const resistancesAtOrAbove = resistanceZonesDisplay.filter(z => z >= price).sort((a, b) => a - b);
  const nearestResistanceAbove = resistancesAtOrAbove[0];
  let displayResistance: number | undefined =
    nearestResistanceAbove == null
      ? resistanceZonesDisplay.length > 0
        ? resistanceZonesDisplay.reduce((a, b) => (Math.abs(a - price) <= Math.abs(b - price) ? a : b))
        : undefined
      : price <= nearestResistanceAbove * (1 + breakThreshold)
        ? nearestResistanceAbove
        : (resistanceZonesDisplay.filter(z => z > price).sort((a, b) => a - b)[0] ?? nearestResistanceAbove);

  // Enforce minimum gap: if resistance - support < minGap, push resistance up or support down until gap is meaningful.
  if (displaySupport != null && displayResistance != null && displayResistance - displaySupport < minGap) {
    const supportsBelow = supportZonesDisplay.filter(z => z < price).sort((a, b) => b - a);
    const resistancesAbove = resistanceZonesDisplay.filter(z => z > price).sort((a, b) => a - b);
    // Prefer moving resistance up (next ceiling) to get gap; else move support down (next floor).
    const nextResUp = resistancesAbove.find(r => r - displaySupport! >= minGap);
    const nextSuppDown = supportsBelow.find(s => displayResistance! - s >= minGap);
    if (nextResUp != null) {
      displayResistance = nextResUp;
    } else if (nextSuppDown != null) {
      displaySupport = nextSuppDown;
    } else {
      // Can't get both with min gap; show only the one price is closer to (more relevant).
      const distToSupp = price - displaySupport;
      const distToRes = displayResistance - price;
      if (distToSupp <= distToRes) displayResistance = undefined;
      else displaySupport = undefined;
    }
  }

  return {
    ...internal,
    supportZones: displaySupport != null ? [displaySupport] : undefined,
    resistanceZones: displayResistance != null ? [displayResistance] : undefined,
    lastSwingHigh: undefined,
    lastSwingLow: undefined,
    lastSwingHighTime: undefined,
    lastSwingLowTime: undefined,
  };
}

/**
 * Convert TrendScalpResult to marker for chart rendering
 */
export function toTrendScalpMarker(
  result: TrendScalpResult,
  time: number
): TrendScalpMarker | null {
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
      console.warn('[TrendScalp] Invalid time in marker, using fallback:', validTime);
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
export function getTrendScalpDisplayItems(
  result: TrendScalpResult,
  time: number
): TrendScalpDisplayItem[] {
  // Validate and fix time value - ensure it's never 0 or invalid
  let validTime = time;
  if (!validTime || validTime === 0 || !Number.isFinite(validTime)) {
    // Use current timestamp as fallback
    validTime = Math.floor(Date.now() / 1000);
    if (process.env.NODE_ENV === 'development') {
      console.warn('[TrendScalp] Invalid time provided, using fallback:', validTime);
    }
  }
  
  if (result.signal === 'LONG' || result.signal === 'SHORT') {
    const marker = toTrendScalpMarker(result, validTime);
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
