/**
 * FMCBR 3.0 - Official Algorithm
 * Fibo Musang Candle Break Retest
 *
 * Tuned for the app's current usage:
 * - 1m charts: prefer 900 candles
 * - 15m charts: prefer 500 candles
 * - Uses swing highs/lows + breakout/retest instead of the older opposing-candle heuristic
 */

import type { Candle } from '../../store/candlesStore';

const DEFAULT_INTERVAL_SECONDS = 15 * 60;
const RETEST_TOLERANCE_ATR = 0.35;
const BREAK_BUFFER_ATR = 0.12;
const PIVOT_WINDOW = 2;
const SR_MAX_LEVELS = 2;

/**
 * Aggregate candles into higher timeframe structure bars.
 * OHLC: open=first open, high=max high, low=min low, close=last close; time=period start.
 */
function aggregateCandles(candles: Candle[], periodSeconds: number): Candle[] {
  if (!candles.length) return [];
  const buckets = new Map<number, Candle[]>();
  for (const c of candles) {
    const bucketTime = Math.floor(c.time / periodSeconds) * periodSeconds;
    if (!buckets.has(bucketTime)) buckets.set(bucketTime, []);
    buckets.get(bucketTime)!.push(c);
  }
  const result: Candle[] = [];
  const sortedTimes = [...buckets.keys()].sort((a, b) => a - b);
  for (const t of sortedTimes) {
    const group = buckets.get(t)!;
    const first = group[0];
    const last = group[group.length - 1];
    let high = first.high;
    let low = first.low;
    let volume = 0;
    for (const c of group) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume ?? 0;
    }
    result.push({
      time: t,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
    });
  }
  return result;
}

// ──── FIBONACCI SETTINGS ────
const FIBONACCI_RATIOS = {
  // Entry Levels
  BASE: 0.000,
  MINOR_ENTRY: 0.382,
  MAJOR_ENTRY: 0.236,
  SETUP: 1.000,
  
  // Take Profit Levels
  TP1: 1.618,
  TP1_EXTENDED: 1.88,
  TP2: 2.618,
  TP2_EXTENDED: 2.88,
  TP3: 4.23,
  TP3_EXTENDED: 4.88,
};

export interface FMCBRLevel {
  price: number;
  label: string;
  type: 'entry' | 'tp' | 'base' | 'setup' | 'support' | 'resistance';
  level: string; // e.g., "TP1", "Major Entry", "Base"
}

export interface FMCBRSignal {
  breakType: 'IB' | 'DB' | null; // Initial Break or Dominant Break
  cb1: boolean; // Candle Break 1 detected
  direction: 'BULLISH' | 'BEARISH' | null;
  swingHigh: number;
  swingLow: number;
  base: number;
  setup: number;
  levels: FMCBRLevel[];
  entryMajor: number;
  entryMinor: number;
  status: 'WAITING_BREAK' | 'WAITING_CB1' | 'WAITING_RETEST' | 'READY';
  /** Time (seconds) of break/CB1 candle for marker placement on chart */
  signalTime?: number;
}

interface PivotPoint {
  index: number;
  time: number;
  price: number;
  type: 'high' | 'low';
}

function computeEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) ema += values[i];
  ema /= period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function inferIntervalSeconds(candles: Candle[]): number {
  if (candles.length < 2) return DEFAULT_INTERVAL_SECONDS;
  const deltas: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const delta = candles[i].time - candles[i - 1].time;
    if (delta > 0) deltas.push(delta);
  }
  if (!deltas.length) return DEFAULT_INTERVAL_SECONDS;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)] || DEFAULT_INTERVAL_SECONDS;
}

function getStructurePeriodSeconds(intervalSeconds: number): number {
  if (intervalSeconds <= 60) return 15 * 60;
  if (intervalSeconds <= 5 * 60) return 30 * 60;
  if (intervalSeconds <= 15 * 60) return 60 * 60;
  return intervalSeconds;
}

export function getFMCBRRequiredCandles(candles: Candle[]): number {
  const intervalSeconds = inferIntervalSeconds(candles);
  if (intervalSeconds <= 60) return 900;
  if (intervalSeconds <= 5 * 60) return 700;
  if (intervalSeconds <= 15 * 60) return 500;
  return 300;
}

function computeATR(candles: Candle[], period: number = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    );
    trs.push(tr);
  }
  const sample = trs.slice(-period);
  return sample.length ? sample.reduce((sum, value) => sum + value, 0) / sample.length : 0;
}

function findPivots(candles: Candle[], left: number = PIVOT_WINDOW, right: number = PIVOT_WINDOW): PivotPoint[] {
  const pivots: PivotPoint[] = [];
  for (let i = left; i < candles.length - right; i++) {
    const current = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= current.high) isHigh = false;
      if (candles[j].low <= current.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) {
      pivots.push({ index: i, time: current.time, price: current.high, type: 'high' });
    }
    if (isLow) {
      pivots.push({ index: i, time: current.time, price: current.low, type: 'low' });
    }
  }
  return pivots.sort((a, b) => a.index - b.index);
}

function getNearestLevels(
  currentPrice: number,
  pivotHighs: PivotPoint[],
  pivotLows: PivotPoint[],
): FMCBRLevel[] {
  const resistances = pivotHighs
    .filter((pivot) => pivot.price > currentPrice)
    .sort((a, b) => a.price - b.price)
    .slice(0, SR_MAX_LEVELS)
    .map((pivot, index) => ({
      price: pivot.price,
      label: `Resistance ${index + 1}`,
      type: 'resistance' as const,
      level: `Resistance ${index + 1}`,
    }));

  const supports = pivotLows
    .filter((pivot) => pivot.price < currentPrice)
    .sort((a, b) => b.price - a.price)
    .slice(0, SR_MAX_LEVELS)
    .map((pivot, index) => ({
      price: pivot.price,
      label: `Support ${index + 1}`,
      type: 'support' as const,
      level: `Support ${index + 1}`,
    }));

  return [...supports, ...resistances];
}

// ──── Step 3: Breakout Detection (Official IB/DB/CB1 Logic) ────

function detectBreak(candles: Candle[]): { type: 'IB' | 'DB'; index: number; direction: 'BULLISH' | 'BEARISH'; swingHigh: number; swingLow: number } | null {
  if (candles.length < 10) return null;

  // Search back up to 30 candles for a breakout of a single "target" candle
  for (let i = candles.length - 30; i < candles.length - 3; i++) {
    if (i < 0) continue;
    const target = candles[i];
    
    let opposingCount = 0;
    let direction: 'BULLISH' | 'BEARISH' | null = null;
    let maxHigh = target.high;
    let minLow = target.low;

    for (let j = i + 1; j < candles.length; j++) {
      const c = candles[j];
      const isUpBreak = c.close > target.high;
      const isDownBreak = c.close < target.low;
      
      if (isUpBreak) {
        if (direction === 'BEARISH') break;
        direction = 'BULLISH';
        opposingCount++;
        maxHigh = Math.max(maxHigh, c.high);
      } else if (isDownBreak) {
        if (direction === 'BULLISH') break;
        direction = 'BEARISH';
        opposingCount++;
        minLow = Math.min(minLow, c.low);
      } else {
        if (opposingCount > 0) break;
      }
    }
    
    if (opposingCount >= 1 && direction) {
      return {
        type: opposingCount >= 3 ? 'DB' : 'IB',
        index: i,
        direction,
        swingHigh: maxHigh,
        swingLow: minLow,
      };
    }
  }
  return null;
}

function detectCB1(candles: Candle[], breakIndex: number, direction: 'BULLISH' | 'BEARISH'): { time: number; price: number } | null {
  // Find Point B (the first significant pullback/local extreme after the break)
  let pointB = -1;
  let pointBIndex = -1;
  
  for (let i = breakIndex + 1; i < candles.length - 1; i++) {
    const c = candles[i];
    if (direction === 'BULLISH') {
      if (c.high > candles[i-1].high && c.high > candles[i+1].high) {
        pointB = c.high;
        pointBIndex = i;
        break;
      }
    } else {
      if (c.low < candles[i-1].low && c.low < candles[i+1].low) {
        pointB = c.low;
        pointBIndex = i;
        break;
      }
    }
  }
  
  if (pointBIndex === -1) return null;
  
  const last = candles[candles.length - 1];
  if (direction === 'BULLISH' && last.close > pointB) {
    return { time: last.time, price: pointB };
  } else if (direction === 'BEARISH' && last.close < pointB) {
    return { time: last.time, price: pointB };
  }
  
  return null;
}

// ──── Main FMCBR Strategy ────
export function calculateFMCBR(candles: Candle[]): FMCBRSignal | null {
  const closedCandles = candles.slice(0, candles.length - 1);
  if (closedCandles.length < 50) return null;

  const requiredCandles = getFMCBRRequiredCandles(closedCandles);
  const dataBase = closedCandles.length > requiredCandles ? closedCandles.slice(-requiredCandles) : closedCandles;
  const intervalSeconds = inferIntervalSeconds(dataBase);
  const structurePeriodSeconds = getStructurePeriodSeconds(intervalSeconds);
  const structureCandles = aggregateCandles(dataBase, structurePeriodSeconds);
  
  if (structureCandles.length < 15) return null;

  try {
    const breakout = detectBreak(structureCandles);
    if (!breakout) {
      const pivots = findPivots(structureCandles);
      const srLevels = getNearestLevels(structureCandles[structureCandles.length-1].close, pivots.filter(p=>p.type==='high'), pivots.filter(p=>p.type==='low'));
      return {
        breakType: null,
        cb1: false,
        direction: null,
        swingHigh: 0,
        swingLow: 0,
        base: 0,
        setup: 0,
        levels: srLevels,
        entryMajor: 0,
        entryMinor: 0,
        status: 'WAITING_BREAK',
      };
    }

    const cb1Data = detectCB1(structureCandles, breakout.index, breakout.direction);
    const cb1Detected = !!cb1Data;
    
    const { direction, type, swingHigh, swingLow } = breakout;
    const range = Math.abs(swingHigh - swingLow);
    
    // Official Formula: Price = Base + (Range * Ratio)
    // Bullish: Base = swingLow, Setup = swingHigh
    // Bearish: Base = swingHigh, Setup = swingLow
    const basePrice = direction === 'BULLISH' ? swingLow : swingHigh;
    const setupPrice = direction === 'BULLISH' ? swingHigh : swingLow;

    const levels: FMCBRLevel[] = [
      { price: basePrice, label: 'Base', type: 'base', level: 'Base' },
      { price: setupPrice, label: 'Setup', type: 'setup', level: 'Setup' },
    ];

    // TP Levels
    const tpRatios = [
      { r: FIBONACCI_RATIOS.TP1, l: 'TP1' },
      { r: FIBONACCI_RATIOS.TP1_EXTENDED, l: 'TP1 Ext' },
      { r: FIBONACCI_RATIOS.TP2, l: 'TP2' },
      { r: FIBONACCI_RATIOS.TP2_EXTENDED, l: 'TP2 Ext' },
      { r: FIBONACCI_RATIOS.TP3, l: 'TP3' },
      { r: FIBONACCI_RATIOS.TP3_EXTENDED, l: 'TP3 Ext' },
    ];

    for (const { r, l } of tpRatios) {
      const price = direction === 'BULLISH' ? basePrice + (range * r) : basePrice - (range * r);
      levels.push({ price, label: l, type: 'tp', level: l });
    }

    // Entry Levels
    const majorEntry = direction === 'BULLISH' ? basePrice + (range * FIBONACCI_RATIOS.MAJOR_ENTRY) : basePrice - (range * FIBONACCI_RATIOS.MAJOR_ENTRY);
    const minorEntry = direction === 'BULLISH' ? basePrice + (range * FIBONACCI_RATIOS.MINOR_ENTRY) : basePrice - (range * FIBONACCI_RATIOS.MINOR_ENTRY);
    
    levels.push({ price: majorEntry, label: 'Major Entry (23.6%)', type: 'entry', level: 'Major Entry' });
    levels.push({ price: minorEntry, label: 'Minor Entry (38.2%)', type: 'entry', level: 'Minor Entry' });

    // Pivot SR context
    const pivots = findPivots(structureCandles);
    const srLevels = getNearestLevels(structureCandles[structureCandles.length-1].close, pivots.filter(p=>p.type==='high'), pivots.filter(p=>p.type==='low'));

    return {
      breakType: type,
      cb1: cb1Detected,
      direction,
      swingHigh,
      swingLow,
      base: basePrice,
      setup: setupPrice,
      levels: [...levels, ...srLevels].sort((a, b) => a.price - b.price),
      entryMajor,
      entryMinor,
      status: cb1Detected ? 'READY' : 'WAITING_CB1',
      signalTime: structureCandles[structureCandles.length - 1].time,
    };
  } catch (err) {
    console.error('FMCBR error:', err);
    return null;
  }
}
