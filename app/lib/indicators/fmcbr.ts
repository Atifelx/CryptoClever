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
  ENTRY_12: 0.120,
  ENTRY_236: 0.236,
  PRE_ENTRY_382: 0.382,
  PRE_ENTRY_50: 0.500,
  PULLBACK_786: 0.786,
  BREAKOUT_88: 0.880,
  SETUP_100: 1.000,
  PRE_TP_127: 1.272,
  PRE_TP_131: 1.314,
  TP1_161: 1.618,
  EXIT_TP1_178: 1.786,
  EXIT_TP1_188: 1.880,
  TP2_261: 2.618,
  EXIT_TP2_278: 2.786,
  EXIT_TP2_288: 2.880,
  CYCLE_423: 4.230,
  EXIT_CYCLE_478: 4.786,
  EXIT_CYCLE_488: 4.880,
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

  // 1. Find Structural pivots (using a stable window)
  const pivotHighs: { idx: number, price: number }[] = [];
  const pivotLows: { idx: number, price: number }[] = [];
  
  const window = 3; 
  for (let i = window; i < candles.length - window; i++) {
    const c = candles[i];
    
    let isHigh = true;
    let isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
    }
    if (isHigh) pivotHighs.push({ idx: i, price: c.high });
    if (isLow) pivotLows.push({ idx: i, price: c.low });
  }

  // 2. Search for the most RECENT valid structural break
  // We search back 2000 candles to find a "Sticky" signal (Institutional Depth)
  for (let i = candles.length - 1; i >= Math.max(0, candles.length - 2000); i--) {
    const c = candles[i];
    const currentPrice = candles[candles.length - 1].close;

    // --- BULLISH CHECK ---
    const recentHighs = pivotHighs.filter(p => p.idx < i).sort((a, b) => b.idx - a.idx);
    const majorHigh = recentHighs[0];
    
    if (majorHigh && c.close > majorHigh.price) {
      const recentLow = pivotLows.filter(p => p.idx < majorHigh.idx).sort((a, b) => b.idx - a.idx)[0];
      if (recentLow) {
        // VALIDATION: Has this signal been broken? (Price below base)
        const basePrice = recentLow.price;
        const setupPrice = majorHigh.price;
        const range = setupPrice - basePrice;
        const tp3 = basePrice + (range * FIBO.CYCLE_423);

        // STICKY RULE: Only return if price is still above base AND hasn't finished the move (TP3)
        if (currentPrice > basePrice && currentPrice < tp3) {
          return { 
            type: 'IB' as const, 
            direction: 'BULLISH' as const, 
            baseIdx: recentLow.idx, 
            breakIdx: i, 
            basePrice,
            setupPrice
          };
        }
      }
    }

    // --- BEARISH CHECK ---
    const recentLows = pivotLows.filter(p => p.idx < i).sort((a, b) => b.idx - a.idx);
    const majorLow = recentLows[0];
    if (majorLow && c.close < majorLow.price) {
      const recentHigh = pivotHighs.filter(p => p.idx < majorLow.idx).sort((a, b) => b.idx - a.idx)[0];
      if (recentHigh) {
        const basePrice = recentHigh.price;
        const setupPrice = majorLow.price;
        const range = basePrice - setupPrice;
        const tp3 = basePrice - (range * FIBO.CYCLE_423);

        if (currentPrice < basePrice && currentPrice > tp3) {
          return { 
            type: 'IB' as const, 
            direction: 'BEARISH' as const, 
            baseIdx: recentHigh.idx, 
            breakIdx: i, 
            basePrice,
            setupPrice
          };
        }
      }
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
    if (!brk) {
      // Show stable S/R context when no breakout is active
      const pivots = calculateSemafor(data).filter(p => p.strength >= 2);
      const srLevels = pivots.map(p => ({
        price: p.price,
        label: p.type === 'high' ? 'RESISTANCE' : 'SUPPORT',
        type: (p.type === 'high' ? 'resistance' : 'support') as any,
        level: 'SR'
      }));
      return { breakType: null, cb1: false, direction: null, base: 0, setup: 0, levels: srLevels, status: 'WAITING_BREAK' };
    }

    const { direction, basePrice, setupPrice, breakIdx } = brk;
    const range = Math.abs(setupPrice - basePrice);

    const levels: FMCBRLevel[] = [
      { price: basePrice, label: '0.00 = Base Zone', type: 'base', level: 'Base' },
      { price: setupPrice, label: '100: Setup', type: 'setup', level: 'Setup' },
    ];

    const addLevel = (ratio: number, label: string, type: any) => {
      const price = direction === 'BULLISH' ? basePrice + (range * ratio) : basePrice - (range * ratio);
      levels.push({ price, label, type, level: label });
    };

    // Official MT4 Sequence
    addLevel(FIBO.ENTRY_12, '12.0 = Entry Zone', 'entry');
    addLevel(FIBO.ENTRY_236, '23.6 = Entry Zone', 'entry');
    addLevel(FIBO.PRE_ENTRY_382, '38.2 = PreMature Entry', 'entry');
    addLevel(FIBO.PRE_ENTRY_50, '50.0 = PreMature Entry', 'entry');
    addLevel(FIBO.PULLBACK_786, '78.6 = Pullback Zone', 'entry');
    addLevel(FIBO.BREAKOUT_88, '88.0 = Breakout Zone', 'entry');
    
    addLevel(FIBO.PRE_TP_127, '127.2 = PreMature TP', 'tp');
    addLevel(FIBO.PRE_TP_131, '131.4 = PreMature TP', 'tp');
    addLevel(FIBO.TP1_161, '161.8 = Alert TP1', 'tp');
    addLevel(FIBO.EXIT_TP1_178, '178.6 = Alert Exit TP1', 'tp');
    addLevel(FIBO.EXIT_TP1_188, '188.0 = Alert Exit TP1', 'tp');
    addLevel(FIBO.TP2_261, '261.8 = Alert TP2', 'tp');
    addLevel(FIBO.EXIT_TP2_278, '278.6 = Alert Exit TP2', 'tp');
    addLevel(FIBO.EXIT_TP2_288, '288.0 = Alert Exit TP2', 'tp');
    addLevel(FIBO.CYCLE_423, '423.0 = Complete Cycle', 'tp');
    addLevel(FIBO.EXIT_CYCLE_478, '478.6 = ExitCompleteCycle', 'tp');
    addLevel(FIBO.EXIT_CYCLE_488, '488.0 = ExitCompleteCycle', 'tp');

    return {
      breakType: brk.type as 'IB' | 'DB',
      cb1: true, // Simplified for sticky mode
      direction,
      base: basePrice,
      setup: setupPrice,
      levels: levels.sort((a, b) => a.price - b.price),
      status: 'READY',
      signalTime: data[breakIdx].time,
    };
  } catch (error) {
    console.error('[FMCBR] Calculation error:', error);
    return null;
  }
}

export function getFMCBRRequiredCandles(candles: Candle[]): number {
  return 100; // Load instantly, use up to 2000 if available
}
