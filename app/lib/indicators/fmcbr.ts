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
import { calculateSemafor } from './semafor';

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

// ──── FIBONACCI RATIOS (OFFICIAL FMCBR 3.0) ────
const FIBO = {
  BASE: 0.000,
  MAJOR_ENTRY: 0.236,
  MINOR_ENTRY: 0.382,
  SETUP: 1.000,
  TP1: 1.618,
  TP1_EXT: 1.880,
  TP2: 2.618,
  TP2_EXT: 2.880,
  TP3: 4.230,
  TP3_EXT: 4.880,
};

export interface FMCBRLevel {
  price: number;
  label: string;
  type: 'entry' | 'tp' | 'base' | 'setup' | 'support' | 'resistance';
  level: string;
}

export interface FMCBRSignal {
  breakType: 'IB' | 'DB' | null;
  cb1: boolean;
  direction: 'BULLISH' | 'BEARISH' | null;
  base: number;
  setup: number;
  levels: FMCBRLevel[];
  status: 'WAITING_BREAK' | 'WAITING_CB1' | 'WAITING_RETEST' | 'READY';
  signalTime?: number;
}

/**
 * Detect Initial Break (IB) or Dominant Break (DB)
 * IB: A candle that breaks the high/low of a previous 'base' candle.
 * DB: A candle that breaks a 'dominant' candle (engulfing or 3+ opposing candles).
 */
/**
 * Detect Initial Break (IB) or Dominant Break (DB) based on Major Structure
 * A Bullish Break occurs when price closes above a SIGNIFICANT recent swing high.
 * A Bearish Break occurs when price closes below a SIGNIFICANT recent swing low.
 */
function detectFMCBRBreak(candles: Candle[]) {
  if (candles.length < 50) return null;

  // 1. Find SIGNIFICANT pivots (5-candle window for major structure)
  const pivotHighs: { idx: number, price: number, strength: number }[] = [];
  const pivotLows: { idx: number, price: number, strength: number }[] = [];
  
  const window = 5;
  for (let i = candles.length - 100; i < candles.length - window; i++) {
    if (i < window) continue;
    const c = candles[i];
    
    // Pivot High (Structural)
    let isHigh = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) { isHigh = false; break; }
    }
    if (isHigh) pivotHighs.push({ idx: i, price: c.high, strength: c.high - c.low });

    // Pivot Low (Structural)
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (candles[j].low <= c.low) { isLow = false; break; }
    }
    if (isLow) pivotLows.push({ idx: i, price: c.low, strength: c.high - c.low });
  }

  // 2. Identify the active breakout (Search most significant recent break)
  // We look back to find if price has broken a major resistance or support
  let bestBullish: any = null;
  let bestBearish: any = null;

  for (let i = candles.length - 1; i >= Math.max(0, candles.length - 100); i--) {
    const c = candles[i];

    // Check for Bullish Break of a major pivot high
    // We only need ONE solid close above to flip trend if price is climbing from a Major Low
    const majorHigh = pivotHighs.filter(p => p.idx < i).sort((a, b) => b.idx - a.idx)[0];
    if (majorHigh && c.close > majorHigh.price && (!bestBullish || majorHigh.idx > bestBullish.breakIdx)) {
      const recentLow = pivotLows.filter(p => p.idx < majorHigh.idx).sort((a, b) => b.idx - a.idx)[0];
      bestBullish = { 
        type: 'IB' as const, 
        direction: 'BULLISH' as const, 
        baseIdx: recentLow ? recentLow.idx : majorHigh.idx, 
        breakIdx: i, 
        basePrice: recentLow ? recentLow.price : majorHigh.price * 0.999
      };
    }

    // Check for Bearish Break of a major pivot low
    const majorLow = pivotLows.filter(p => p.idx < i).sort((a, b) => b.idx - a.idx)[0];
    if (majorLow && c.close < majorLow.price && (!bestBearish || majorLow.idx > bestBearish.breakIdx)) {
      const recentHigh = pivotHighs.filter(p => p.idx < majorLow.idx).sort((a, b) => b.idx - a.idx)[0];
      bestBearish = { 
        type: 'IB' as const, 
        direction: 'BEARISH' as const, 
        baseIdx: recentHigh ? recentHigh.idx : majorLow.idx, 
        breakIdx: i, 
        basePrice: recentHigh ? recentHigh.price : majorLow.price * 1.001
      };
    }
  }

  // 3. SEMAFOR INTEGRATION: Detect Major Bottoms/Tops
  const semaforPoints = calculateSemafor(candles);
  const majorLows = semaforPoints.filter(p => p.type === 'low' && p.strength === 3);
  const majorHighs = semaforPoints.filter(p => p.type === 'high' && p.strength === 3);

  const lastMajorLow = majorLows.length > 0 ? majorLows[majorLows.length - 1] : null;
  const lastMajorHigh = majorHighs.length > 0 ? majorHighs[majorHighs.length - 1] : null;

  // 4. PERSISTENCE: If a major Bullish structure was broken, stay bullish 
  // unless a more recent or significant Bearish structure break occurs.
  let finalResult = null;
  if (bestBullish && bestBearish) {
    finalResult = bestBullish.breakIdx > bestBearish.breakIdx ? bestBullish : bestBearish;
  } else {
    finalResult = bestBullish || bestBearish || null;
  }

  // 5. TREND RESET: If we have a Major Low (Double Bottom feel) and price is rising, 
  // and our finalResult is still BEARISH, we should check if it's invalidated.
  if (finalResult && finalResult.direction === 'BEARISH' && lastMajorLow) {
    const currentPrice = candles[candles.length - 1].close;
    // RESET: If price has climbed significantly from a major low, 
    // it's a structural reversal regardless of previous breaks.
    if (currentPrice > lastMajorLow.price * 1.0015) {
      return null; 
    }
    // TIMEOUT: If bearish break happened too long ago (e.g. 40 bars) without continuation
    if (candles.length - finalResult.breakIdx > 40) {
      return null;
    }
  }

  if (finalResult && finalResult.direction === 'BULLISH' && lastMajorHigh) {
    const currentPrice = candles[candles.length - 1].close;
    if (currentPrice < lastMajorHigh.price * 0.9985) {
      return null;
    }
    if (candles.length - finalResult.breakIdx > 40) {
      return null;
    }
  }
  
  return finalResult;
}

/**
 * Detect CB1 (Candle Break 1)
 * The first candle that closes above the breakout candle's high (Bullish) 
 * or below its low (Bearish).
 */
function detectCB1(candles: Candle[], breakIdx: number, direction: 'BULLISH' | 'BEARISH') {
  if (breakIdx >= candles.length - 1) return null;
  
  const breakCandle = candles[breakIdx];
  for (let i = breakIdx + 1; i < candles.length; i++) {
    const c = candles[i];
    if (direction === 'BULLISH' && c.close > breakCandle.high) {
      return { idx: i, setupPrice: c.high };
    }
    if (direction === 'BEARISH' && c.close < breakCandle.low) {
      return { idx: i, setupPrice: c.low };
    }
  }
  return null;
}

export function calculateFMCBR(candles: Candle[]): FMCBRSignal | null {
  // Use closed candles only
  const data = candles.slice(0, candles.length - 1);
  if (data.length < 50) return null;

  try {
    const brk = detectFMCBRBreak(data);
    if (!brk) return { breakType: null, cb1: false, direction: null, base: 0, setup: 0, levels: [], status: 'WAITING_BREAK' };

    const direction = brk.direction;
    
    // TIGHT RANGE CALCULATION (Matching MT4 'Breakout Zone' feel)
    // In MT4, the range is based on the candle that was broken.
    const breakCandle = data[brk.breakIdx];
    const baseCandle = data[brk.breakIdx - 1]; // The 'Initial' candle
    
    const basePrice = direction === 'BULLISH' ? baseCandle.low : baseCandle.high;
    const setupPrice = direction === 'BULLISH' ? breakCandle.high : breakCandle.low;
    const range = Math.abs(setupPrice - basePrice);

    // Detect CB1 (for status only, don't expand range with it)
    const cb1 = detectCB1(data, brk.breakIdx, direction);
    const hasCB1 = !!cb1;

    const levels: FMCBRLevel[] = [
      { price: basePrice, label: 'Base', type: 'base', level: 'Base' },
      { price: setupPrice, label: 'Setup', type: 'setup', level: 'Setup' },
    ];

    // Add Fibonacci Levels based on this tight local range
    const addLevel = (ratio: number, label: string, type: any) => {
      const price = direction === 'BULLISH' ? basePrice + (range * ratio) : basePrice - (range * ratio);
      levels.push({ price, label, type, level: label });
    };

    addLevel(FIBO.MAJOR_ENTRY, 'Major Entry', 'entry');
    addLevel(FIBO.MINOR_ENTRY, 'Minor Entry', 'entry');
    addLevel(FIBO.TP1, 'TP1', 'tp');
    addLevel(FIBO.TP1_EXT, 'TP1 Ext', 'tp');
    addLevel(FIBO.TP2, 'TP2', 'tp');
    addLevel(FIBO.TP2_EXT, 'TP2 Ext', 'tp');
    addLevel(FIBO.TP3, 'TP3', 'tp');
    addLevel(FIBO.TP3_EXT, 'TP3 Ext', 'tp');

    // EXHAUSTION CHECK: If price has already smashed TP3 and then reversed past TP1/TP2
    const currentPrice = data[data.length - 1].close;
    if (direction === 'BEARISH') {
      const tp3 = levels.find(l => l.level === 'TP3')?.price || 0;
      const tp1 = levels.find(l => l.level === 'TP1')?.price || 999999;
      if (tp3 > 0 && data.some(c => c.low <= tp3) && currentPrice > tp1) {
        return { breakType: null, cb1: false, direction: null, base: 0, setup: 0, levels: [], status: 'WAITING_BREAK' };
      }
    } else {
      const tp3 = levels.find(l => l.level === 'TP3')?.price || 999999;
      const tp1 = levels.find(l => l.level === 'TP1')?.price || 0;
      if (tp3 < 999999 && data.some(c => c.high >= tp3) && currentPrice < tp1) {
        return { breakType: null, cb1: false, direction: null, base: 0, setup: 0, levels: [], status: 'WAITING_BREAK' };
      }
    }

    return {
      breakType: brk.type as 'IB' | 'DB',
      cb1: hasCB1,
      direction,
      base: basePrice,
      setup: setupPrice,
      levels: levels.sort((a, b) => a.price - b.price),
      status: hasCB1 ? 'READY' : 'WAITING_CB1',
      signalTime: data[brk.breakIdx].time,
    };
  } catch (error) {
    console.error('[FMCBR] Calculation error:', error);
    return null;
  }
}

/**
 * Re-exporting required candle count based on interval
 */
export function getFMCBRRequiredCandles(candles: Candle[]): number {
  return 300; // Simplified for performance, enough for local pivots
}
