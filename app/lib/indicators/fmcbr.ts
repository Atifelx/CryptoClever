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

interface BreakoutContext {
  direction: 'BULLISH' | 'BEARISH';
  breakType: 'IB' | 'DB';
  breakIndex: number;
  breakLevel: number;
  swingHigh: number;
  swingLow: number;
  signalTime: number;
  status: FMCBRSignal['status'];
  cb1: boolean;
}

function detectBreakout(candles: Candle[]): BreakoutContext | null {
  const pivots = findPivots(candles);
  const pivotHighs = pivots.filter((pivot) => pivot.type === 'high');
  const pivotLows = pivots.filter((pivot) => pivot.type === 'low');
  const current = candles[candles.length - 1];
  const atr = computeATR(candles);
  const breakBuffer = Math.max(atr * BREAK_BUFFER_ATR, current.close * 0.0005);
  const retestTolerance = Math.max(atr * RETEST_TOLERANCE_ATR, current.close * 0.0008);

  const lastPivotHigh = [...pivotHighs].reverse().find((pivot) => pivot.index < candles.length - 1);
  const lastPivotLow = [...pivotLows].reverse().find((pivot) => pivot.index < candles.length - 1);

  if (lastPivotHigh && current.close > lastPivotHigh.price + breakBuffer) {
    const breakIndex = candles.findIndex((candle, index) => index > lastPivotHigh.index && candle.close > lastPivotHigh.price + breakBuffer);
    const priorLow = [...pivotLows].reverse().find((pivot) => pivot.index < lastPivotHigh.index);
    const swingLow = priorLow?.price ?? Math.min(...candles.slice(Math.max(0, lastPivotHigh.index - 20), lastPivotHigh.index + 1).map((c) => c.low));
    const confirmingCandles = candles.slice(Math.max(0, breakIndex), candles.length).filter((candle) => candle.close > lastPivotHigh.price).length;
    const retestCandle = candles
      .slice(Math.max(0, breakIndex))
      .find((candle) => candle.low <= lastPivotHigh.price + retestTolerance && candle.close >= lastPivotHigh.price);
    return {
      direction: 'BULLISH',
      breakType: confirmingCandles >= 2 ? 'DB' : 'IB',
      breakIndex,
      breakLevel: lastPivotHigh.price,
      swingHigh: lastPivotHigh.price,
      swingLow,
      signalTime: retestCandle?.time ?? candles[Math.max(breakIndex, 0)]?.time ?? current.time,
      status: retestCandle ? 'READY' : confirmingCandles >= 1 ? 'WAITING_RETEST' : 'WAITING_CB1',
      cb1: confirmingCandles >= 1,
    };
  }

  if (lastPivotLow && current.close < lastPivotLow.price - breakBuffer) {
    const breakIndex = candles.findIndex((candle, index) => index > lastPivotLow.index && candle.close < lastPivotLow.price - breakBuffer);
    const priorHigh = [...pivotHighs].reverse().find((pivot) => pivot.index < lastPivotLow.index);
    const swingHigh = priorHigh?.price ?? Math.max(...candles.slice(Math.max(0, lastPivotLow.index - 20), lastPivotLow.index + 1).map((c) => c.high));
    const confirmingCandles = candles.slice(Math.max(0, breakIndex), candles.length).filter((candle) => candle.close < lastPivotLow.price).length;
    const retestCandle = candles
      .slice(Math.max(0, breakIndex))
      .find((candle) => candle.high >= lastPivotLow.price - retestTolerance && candle.close <= lastPivotLow.price);
    return {
      direction: 'BEARISH',
      breakType: confirmingCandles >= 2 ? 'DB' : 'IB',
      breakIndex,
      breakLevel: lastPivotLow.price,
      swingHigh,
      swingLow: lastPivotLow.price,
      signalTime: retestCandle?.time ?? candles[Math.max(breakIndex, 0)]?.time ?? current.time,
      status: retestCandle ? 'READY' : confirmingCandles >= 1 ? 'WAITING_RETEST' : 'WAITING_CB1',
      cb1: confirmingCandles >= 1,
    };
  }

  return null;
}

// ──── Step 4: Calculate Fibonacci Levels ────
function calculateFibonacciTP(
  swingHigh: number,
  swingLow: number,
  direction: 'BULLISH' | 'BEARISH'
): FMCBRLevel[] {
  const range = Math.abs(swingHigh - swingLow);
  const levels: FMCBRLevel[] = [];
  
  if (direction === 'BULLISH') {
    // Setup = swing low, Base = swing high
    const base = swingHigh;
    const setup = swingLow;
    
    levels.push({
      price: base,
      label: 'Base',
      type: 'base',
      level: 'Base',
    });
    
    levels.push({
      price: setup,
      label: 'Setup',
      type: 'setup',
      level: 'Setup',
    });
    
    // TP Levels (extending upward from setup)
    levels.push({
      price: setup + (range * FIBONACCI_RATIOS.TP1),
      label: 'TP1',
      type: 'tp',
      level: 'TP1',
    });
    
    levels.push({
      price: setup + (range * FIBONACCI_RATIOS.TP1_EXTENDED),
      label: 'TP1 Ext',
      type: 'tp',
      level: 'TP1 Extended',
    });
    
    levels.push({
      price: setup + (range * FIBONACCI_RATIOS.TP2),
      label: 'TP2',
      type: 'tp',
      level: 'TP2',
    });
    
    levels.push({
      price: setup + (range * FIBONACCI_RATIOS.TP2_EXTENDED),
      label: 'TP2 Ext',
      type: 'tp',
      level: 'TP2 Extended',
    });
    
    levels.push({
      price: setup + (range * FIBONACCI_RATIOS.TP3),
      label: 'TP3',
      type: 'tp',
      level: 'TP3',
    });
    
    levels.push({
      price: setup + (range * FIBONACCI_RATIOS.TP3_EXTENDED),
      label: 'TP3 Ext',
      type: 'tp',
      level: 'TP3 Extended',
    });
  } else {
    // BEARISH: Setup = swing high, Base = swing low
    const base = swingLow;
    const setup = swingHigh;
    
    levels.push({
      price: base,
      label: 'Base',
      type: 'base',
      level: 'Base',
    });
    
    levels.push({
      price: setup,
      label: 'Setup',
      type: 'setup',
      level: 'Setup',
    });
    
    // TP Levels (extending downward from setup)
    levels.push({
      price: setup - (range * FIBONACCI_RATIOS.TP1),
      label: 'TP1',
      type: 'tp',
      level: 'TP1',
    });
    
    levels.push({
      price: setup - (range * FIBONACCI_RATIOS.TP1_EXTENDED),
      label: 'TP1 Ext',
      type: 'tp',
      level: 'TP1 Extended',
    });
    
    levels.push({
      price: setup - (range * FIBONACCI_RATIOS.TP2),
      label: 'TP2',
      type: 'tp',
      level: 'TP2',
    });
    
    levels.push({
      price: setup - (range * FIBONACCI_RATIOS.TP2_EXTENDED),
      label: 'TP2 Ext',
      type: 'tp',
      level: 'TP2 Extended',
    });
    
    levels.push({
      price: setup - (range * FIBONACCI_RATIOS.TP3),
      label: 'TP3',
      type: 'tp',
      level: 'TP3',
    });
    
    levels.push({
      price: setup - (range * FIBONACCI_RATIOS.TP3_EXTENDED),
      label: 'TP3 Ext',
      type: 'tp',
      level: 'TP3 Extended',
    });
  }
  
  return levels;
}

// ──── Step 5: Calculate Entry Levels ────
function calculateFibonacciEntry(
  swingHigh: number,
  swingLow: number,
  direction: 'BULLISH' | 'BEARISH'
): { majorEntry: number; minorEntry: number } {
  const range = Math.abs(swingHigh - swingLow);
  
  if (direction === 'BULLISH') {
    const base = swingHigh;
    const distance = swingHigh - swingLow;
    
    return {
      majorEntry: base - (distance * FIBONACCI_RATIOS.MAJOR_ENTRY), // 0.236
      minorEntry: base - (distance * FIBONACCI_RATIOS.MINOR_ENTRY), // 0.382
    };
  } else {
    const base = swingLow;
    const distance = swingHigh - swingLow;
    
    return {
      majorEntry: base + (distance * FIBONACCI_RATIOS.MAJOR_ENTRY), // 0.236
      minorEntry: base + (distance * FIBONACCI_RATIOS.MINOR_ENTRY), // 0.382
    };
  }
}

// ──── Main FMCBR Strategy ────
export function calculateFMCBR(candles: Candle[]): FMCBRSignal | null {
  // CRITICAL: Use only closed candles to prevent repainting
  const closedCandles = candles.slice(0, candles.length - 1);
  const requiredCandles = getFMCBRRequiredCandles(closedCandles);
  if (!closedCandles || closedCandles.length < requiredCandles) {
    return null;
  }

  const dataBase = closedCandles.length > requiredCandles
    ? closedCandles.slice(-requiredCandles)
    : closedCandles;

  const intervalSeconds = inferIntervalSeconds(dataBase);
  const structurePeriodSeconds = getStructurePeriodSeconds(intervalSeconds);
  const baseCloses = dataBase.map(c => c.close);
  const ema200 = computeEMA(baseCloses, 200);
  const currentPrice = baseCloses[baseCloses.length - 1];
  const macroTrend = ema200 > 0 ? (currentPrice > ema200 ? 'BULL' : 'BEAR') : 'NEUTRAL';
  const structureCandles = aggregateCandles(dataBase, structurePeriodSeconds);
  if (structureCandles.length < 30) {
    return null;
  }

  try {
    const breakout = detectBreakout(structureCandles);
    const pivots = findPivots(structureCandles);
    const pivotHighs = pivots.filter((pivot) => pivot.type === 'high');
    const pivotLows = pivots.filter((pivot) => pivot.type === 'low');
    const srLevels = getNearestLevels(structureCandles[structureCandles.length - 1].close, pivotHighs, pivotLows);

    if (!breakout) {
      return {
        breakType: null,
        cb1: false,
        direction: null,
        swingHigh: srLevels.find((level) => level.type === 'resistance')?.price ?? 0,
        swingLow: srLevels.find((level) => level.type === 'support')?.price ?? 0,
        base: 0,
        setup: 0,
        levels: srLevels,
        entryMajor: 0,
        entryMinor: 0,
        status: 'WAITING_BREAK',
      };
    }

    const { direction, breakType, swingHigh, swingLow, status, cb1, signalTime } = breakout;

    if (direction === 'BULLISH' && macroTrend === 'BEAR') {
      return { breakType: null, cb1: false, direction: null, swingHigh: 0, swingLow: 0, base: 0, setup: 0, levels: srLevels, entryMajor: 0, entryMinor: 0, status: 'WAITING_BREAK' };
    }
    if (direction === 'BEARISH' && macroTrend === 'BULL') {
      return { breakType: null, cb1: false, direction: null, swingHigh: 0, swingLow: 0, base: 0, setup: 0, levels: srLevels, entryMajor: 0, entryMinor: 0, status: 'WAITING_BREAK' };
    }

    const tpLevels = calculateFibonacciTP(swingHigh, swingLow, direction);
    const entryLevels = calculateFibonacciEntry(swingHigh, swingLow, direction);

    const allLevels: FMCBRLevel[] = [
      ...tpLevels,
      {
        price: entryLevels.majorEntry,
        label: 'Major Entry (23.6%)',
        type: 'entry',
        level: 'Major Entry',
      },
      {
        price: entryLevels.minorEntry,
        label: 'Minor Entry (38.2%)',
        type: 'entry',
        level: 'Minor Entry',
      },
      ...srLevels,
    ];

    const base = direction === 'BULLISH' ? swingHigh : swingLow;
    const setup = direction === 'BULLISH' ? swingLow : swingHigh;

    return {
      breakType,
      cb1,
      direction,
      swingHigh,
      swingLow,
      base,
      setup,
      levels: allLevels.sort((a, b) => a.price - b.price),
      entryMajor: entryLevels.majorEntry,
      entryMinor: entryLevels.minorEntry,
      status,
      signalTime,
    };
  } catch (error) {
    console.error('Error calculating FMCBR:', error);
    return null;
  }
}
