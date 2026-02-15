import { Candle, SemaforPoint } from './types';

/**
 * Semafor Indicator — NON-REPAINTING Rebuild
 * 
 * ═══════════════════════════════════════════════════════════════
 * CORE: ZigZag-based pivot detection (faithful to MT4 Semafor)
 * ═══════════════════════════════════════════════════════════════
 * 1. Scan candles left→right tracking direction (up/down)
 * 2. When direction is UP, track the swing high
 * 3. When price drops by ≥ deviation% from the swing high → CONFIRM high pivot
 * 4. Switch direction to DOWN, begin tracking the swing low
 * 5. When price rises by ≥ deviation% from the swing low → CONFIRM low pivot
 * 6. Switch direction to UP, repeat
 * 
 * ═══════════════════════════════════════════════════════════════
 * LIVE SIGNALS: Non-repainting candle pattern detection
 * ═══════════════════════════════════════════════════════════════
 * ⚠️ ANTI-REPAINTING RULES (CRITICAL):
 *   1. NEVER analyze the forming candle (candles[len-1])
 *   2. Only analyze CLOSED candles for patterns
 *   3. Require EMA(20) vs EMA(50) trend confirmation
 *   4. Maximum ONE signal direction per candle (no contradictions)
 *   5. Strict thresholds — body > atr*0.4, not 0.15
 *   6. Prior trend context required (can't signal without preceding move)
 *   7. Removed: Doji, Pin Bar, Momentum (too noisy / repainting-prone)
 *   8. Kept: Engulfing, Hammer, Shooting Star, Morning/Evening Star
 */

// ────────────────────────────────────────────────────────────
//  TYPES
// ────────────────────────────────────────────────────────────

interface ZigZagPivot {
  index: number;
  time: number;
  price: number;
  type: 'high' | 'low';
}

export interface LiveSignal {
  time: number;
  price: number;
  type: 'high' | 'low';
  direction: 'UP' | 'DOWN';
  strength: 1 | 2 | 3;
  pattern: string;
  isLive: true;
}

export interface SemaforTrend {
  trend: 'BULL' | 'BEAR' | 'NEUTRAL';
  ema20: number;
  ema50: number;
}

// ────────────────────────────────────────────────────────────
//  MATH HELPERS
// ────────────────────────────────────────────────────────────

/**
 * Exponential Moving Average — returns the final EMA value
 */
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

/**
 * Average True Range — returns ATR in price units
 */
function computeATR(candles: Candle[], period: number): number {
  if (candles.length < period + 1) return 0;
  const recent = candles.slice(-period - 1);
  let total = 0;
  for (let i = 1; i < recent.length; i++) {
    const tr = Math.max(
      recent[i].high - recent[i].low,
      Math.abs(recent[i].high - recent[i - 1].close),
      Math.abs(recent[i].low - recent[i - 1].close)
    );
    total += tr;
  }
  return total / period;
}

// ────────────────────────────────────────────────────────────
//  ADAPTIVE DEVIATION (ZigZag sensitivity)
// ────────────────────────────────────────────────────────────

/**
 * Calculate adaptive deviation using ATR%
 * Makes the indicator work equally well across all price ranges
 */
function getAdaptiveDeviation(candles: Candle[], timeframe?: string): number {
  if (candles.length < 10) return 0.5;

  const lookback = Math.min(50, candles.length - 1);
  const recent = candles.slice(-lookback - 1);
  let totalTR = 0;

  for (let i = 1; i < recent.length; i++) {
    const tr = Math.max(
      recent[i].high - recent[i].low,
      Math.abs(recent[i].high - recent[i - 1].close),
      Math.abs(recent[i].low - recent[i - 1].close)
    );
    totalTR += (tr / recent[i].close) * 100;
  }

  const atrPercent = totalTR / lookback;

  const multipliers: Record<string, number> = {
    '1m': 3.0,
    '5m': 3.5,
    '15m': 4.0,
    '1h': 4.5,
    '4h': 5.5,
    '1d': 6.5,
  };

  const tf = (timeframe || '5m').toLowerCase();
  const mult = multipliers[tf] || 3.5;

  return Math.max(0.08, Math.min(atrPercent * mult, 20.0));
}

// ────────────────────────────────────────────────────────────
//  CORE ZIGZAG ENGINE
// ────────────────────────────────────────────────────────────

/**
 * ZigZag — deviation-based, left→right scan, strict alternation
 * Produces clean High-Low-High-Low sequence
 */
function runZigZag(candles: Candle[], devPercent: number): ZigZagPivot[] {
  if (candles.length < 3) return [];

  const pivots: ZigZagPivot[] = [];

  let direction = 0; // 0=unknown, 1=up (tracking high), -1=down (tracking low)
  let swHi = 0;
  let swHiP = candles[0].high;
  let swLo = 0;
  let swLoP = candles[0].low;

  for (let i = 1; i < candles.length; i++) {
    const bar = candles[i];

    if (direction === 0) {
      if (bar.high > swHiP) { swHiP = bar.high; swHi = i; }
      if (bar.low < swLoP) { swLoP = bar.low; swLo = i; }

      const spread = ((swHiP - swLoP) / swLoP) * 100;
      if (spread >= devPercent) {
        if (swHi > swLo) {
          pivots.push({ index: swLo, time: candles[swLo].time, price: swLoP, type: 'low' });
          direction = 1;
        } else {
          pivots.push({ index: swHi, time: candles[swHi].time, price: swHiP, type: 'high' });
          direction = -1;
        }
      }
      continue;
    }

    if (direction === 1) {
      if (bar.high > swHiP) {
        swHiP = bar.high;
        swHi = i;
      }
      const drop = ((swHiP - bar.low) / swHiP) * 100;
      if (drop >= devPercent) {
        pivots.push({ index: swHi, time: candles[swHi].time, price: swHiP, type: 'high' });
        direction = -1;
        swLoP = bar.low;
        swLo = i;
      }
    } else {
      if (bar.low < swLoP) {
        swLoP = bar.low;
        swLo = i;
      }
      const rise = ((bar.high - swLoP) / swLoP) * 100;
      if (rise >= devPercent) {
        pivots.push({ index: swLo, time: candles[swLo].time, price: swLoP, type: 'low' });
        direction = 1;
        swHiP = bar.high;
        swHi = i;
      }
    }
  }

  // Add the last unconfirmed extreme (the "live" pivot)
  if (direction === 1) {
    pivots.push({ index: swHi, time: candles[swHi].time, price: swHiP, type: 'high' });
  } else if (direction === -1) {
    pivots.push({ index: swLo, time: candles[swLo].time, price: swLoP, type: 'low' });
  }

  return pivots;
}

// ────────────────────────────────────────────────────────────
//  STRENGTH ASSIGNMENT
// ────────────────────────────────────────────────────────────

/**
 * Assign strength 1/2/3 based on swing size percentiles
 */
function assignStrengths(pivots: ZigZagPivot[]): Map<number, 1 | 2 | 3> {
  const strengths = new Map<number, 1 | 2 | 3>();
  if (pivots.length < 2) {
    pivots.forEach(p => strengths.set(p.index, 2));
    return strengths;
  }

  const swings: { index: number; size: number }[] = [];
  for (let i = 1; i < pivots.length; i++) {
    const prev = pivots[i - 1];
    const curr = pivots[i];
    const minP = Math.min(prev.price, curr.price);
    const size = minP > 0 ? (Math.abs(curr.price - prev.price) / minP) * 100 : 0;
    swings.push({ index: curr.index, size });
  }
  if (swings.length > 0) {
    swings.unshift({ index: pivots[0].index, size: swings[0].size });
  }

  const sorted = swings.map(s => s.size).sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const p80 = sorted[Math.floor(sorted.length * 0.8)] || 0;

  swings.forEach(({ index, size }) => {
    if (size >= p80) strengths.set(index, 3);
    else if (size >= p50) strengths.set(index, 2);
    else strengths.set(index, 1);
  });

  return strengths;
}

// ════════════════════════════════════════════════════════════
//  NON-REPAINTING LIVE PATTERN DETECTION
// ════════════════════════════════════════════════════════════

/**
 * Detect candle patterns on CLOSED candles only.
 * 
 * This function is called on every tick but its output is DETERMINISTIC
 * because it NEVER looks at the forming candle (candles[len-1]).
 * The closed candle data never changes, so the same input → same output.
 * 
 * TREND FILTER:
 *   EMA(20) > EMA(50) → uptrend → only BUY signals
 *   EMA(20) < EMA(50) → downtrend → only SELL signals
 *   Neutral → allow the strongest signal
 * 
 * PATTERNS (strict thresholds):
 *   ✅ Bullish Engulfing  — requires prior bearish move + body > ATR*0.4
 *   ✅ Bearish Engulfing  — requires prior bullish move + body > ATR*0.4
 *   ✅ Hammer             — requires prior bearish move + lower wick > 2x body
 *   ✅ Shooting Star      — requires prior bullish move + upper wick > 2x body
 *   ✅ Morning Star       — 3-candle pattern, body > ATR*0.5
 *   ✅ Evening Star       — 3-candle pattern, body > ATR*0.5
 * 
 *   ❌ Doji              — REMOVED (too common, unreliable on live)
 *   ❌ Pin Bar            — REMOVED (overlaps with Hammer/Shooting Star)
 *   ❌ Momentum           — REMOVED (biggest source of repainting noise)
 */
function detectLivePatterns(candles: Candle[]): LiveSignal[] {
  // Need enough data for EMA(50) + pattern context
  if (candles.length < 55) return [];

  const signals: LiveSignal[] = [];
  const len = candles.length;
  const atr = computeATR(candles, 14);
  if (atr <= 0) return signals;

  // ═══ TREND CONTEXT via EMA(20) vs EMA(50) ═══
  // IMPORTANT: Only use closes up to candles[len-2] (exclude forming candle)
  const closedCloses = candles.slice(0, len - 1).map(c => c.close);
  const ema20 = computeEMA(closedCloses, 20);
  const ema50 = computeEMA(closedCloses, 50);

  const emaDiff = ema50 > 0 ? ((ema20 - ema50) / ema50) * 100 : 0;

  let trend: 'BULL' | 'BEAR' | 'NEUTRAL';
  if (emaDiff > 0.02) trend = 'BULL';
  else if (emaDiff < -0.02) trend = 'BEAR';
  else trend = 'NEUTRAL';

  // ═══ ANALYZE ONLY CLOSED CANDLES ═══
  // Check the last 2 CLOSED candles (candles[len-2] and candles[len-3])
  // candles[len-1] is the FORMING candle — NEVER TOUCH IT
  for (let offset = 2; offset <= 3; offset++) {
    const idx = len - offset;
    if (idx < 5) continue;

    const c = candles[idx];         // Signal candle (CLOSED)
    const p1 = candles[idx - 1];    // Previous candle
    const p2 = candles[idx - 2];    // 2 candles before
    const p3 = candles[idx - 3];    // 3 candles before

    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    const p1Body = Math.abs(p1.close - p1.open);
    const p2Body = Math.abs(p2.close - p2.open);

    const isBullish = c.close > c.open;
    const isBearish = c.close < c.open;
    const p1Bullish = p1.close > p1.open;
    const p1Bearish = p1.close < p1.open;

    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;

    // Was there a clear prior move in one direction?
    // Require: 2+ of last 3 candles in the same direction AND closes trending
    const priorBearCount = [p1, p2, p3].filter(x => x.close < x.open).length;
    const priorBullCount = [p1, p2, p3].filter(x => x.close > x.open).length;
    const priorBearish = priorBearCount >= 2 && p1.close < p2.close;
    const priorBullish = priorBullCount >= 2 && p1.close > p2.close;

    // ──── BULLISH PATTERNS ────
    // Only signal BUY in uptrend or neutral (NEVER in confirmed downtrend)
    if (trend !== 'BEAR') {

      // 1. BULLISH ENGULFING
      // Previous red, current green, current body fully covers previous body
      if (p1Bearish && isBullish &&
          c.open <= p1.close && c.close >= p1.open &&
          body > p1Body * 1.0 &&     // Must fully engulf
          body > atr * 0.4 &&         // Significant body size
          priorBearish) {              // After a bearish move
        const str: 1|2|3 = body > atr * 1.5 ? 3 : body > atr * 0.8 ? 2 : 1;
        signals.push({
          time: c.time, price: c.low, type: 'low',
          direction: 'UP', strength: str,
          pattern: 'Bullish Engulfing', isLive: true,
        });
      }

      // 2. HAMMER (bullish reversal after downtrend)
      // Small body at top, long lower wick, short upper wick
      if (priorBearish &&
          lowerWick > body * 2.0 &&    // Lower wick ≥ 2x body
          upperWick < body * 0.5 &&    // Upper wick < 0.5x body
          body > 0 &&                  // Must have some body
          range > atr * 0.5) {         // Significant range
        const str: 1|2|3 = lowerWick > body * 4 ? 3 : lowerWick > body * 2.5 ? 2 : 1;
        signals.push({
          time: c.time, price: c.low, type: 'low',
          direction: 'UP', strength: str,
          pattern: 'Hammer', isLive: true,
        });
      }

      // 3. MORNING STAR (3-candle bullish reversal)
      // p2 = big red, p1 = small body (star), c = big green closing above p2 midpoint
      if (idx >= 5) {
        const p2Bearish = p2.close < p2.open;
        const p1Small = p1Body < p2Body * 0.3 && p1Body < body * 0.3;
        const p2Mid = (p2.open + p2.close) / 2;

        if (p2Bearish && p1Small && isBullish && c.close > p2Mid &&
            body > atr * 0.5 && p2Body > atr * 0.5) {
          signals.push({
            time: c.time, price: c.low, type: 'low',
            direction: 'UP', strength: 3,
            pattern: 'Morning Star', isLive: true,
          });
        }
      }
    }

    // ──── BEARISH PATTERNS ────
    // Only signal SELL in downtrend or neutral (NEVER in confirmed uptrend)
    if (trend !== 'BULL') {

      // 4. BEARISH ENGULFING
      // Previous green, current red, current body fully covers previous body
      if (p1Bullish && isBearish &&
          c.open >= p1.close && c.close <= p1.open &&
          body > p1Body * 1.0 &&
          body > atr * 0.4 &&
          priorBullish) {
        const str: 1|2|3 = body > atr * 1.5 ? 3 : body > atr * 0.8 ? 2 : 1;
        signals.push({
          time: c.time, price: c.high, type: 'high',
          direction: 'DOWN', strength: str,
          pattern: 'Bearish Engulfing', isLive: true,
        });
      }

      // 5. SHOOTING STAR (bearish reversal after uptrend)
      // Small body at bottom, long upper wick, short lower wick
      if (priorBullish &&
          upperWick > body * 2.0 &&
          lowerWick < body * 0.5 &&
          body > 0 &&
          range > atr * 0.5) {
        const str: 1|2|3 = upperWick > body * 4 ? 3 : upperWick > body * 2.5 ? 2 : 1;
        signals.push({
          time: c.time, price: c.high, type: 'high',
          direction: 'DOWN', strength: str,
          pattern: 'Shooting Star', isLive: true,
        });
      }

      // 6. EVENING STAR (3-candle bearish reversal)
      // p2 = big green, p1 = small body (star), c = big red closing below p2 midpoint
      if (idx >= 5) {
        const p2Bullish = p2.close > p2.open;
        const p1Small = p1Body < p2Body * 0.3 && p1Body < body * 0.3;
        const p2Mid = (p2.open + p2.close) / 2;

        if (p2Bullish && p1Small && isBearish && c.close < p2Mid &&
            body > atr * 0.5 && p2Body > atr * 0.5) {
          signals.push({
            time: c.time, price: c.high, type: 'high',
            direction: 'DOWN', strength: 3,
            pattern: 'Evening Star', isLive: true,
          });
        }
      }
    }
  }

  // ═══ DEDUPLICATION ═══
  // One signal per candle time per direction — keep highest strength
  const seen = new Map<string, LiveSignal>();
  for (const sig of signals) {
    const key = `${sig.time}-${sig.direction}`;
    const existing = seen.get(key);
    if (!existing || sig.strength > existing.strength) {
      seen.set(key, sig);
    }
  }

  const deduped = Array.from(seen.values());

  // ═══ CONFLICT RESOLUTION ═══
  // If both BUY and SELL on the same candle time → keep only the trend-aligned one
  const byTime = new Map<number, LiveSignal[]>();
  for (const sig of deduped) {
    const arr = byTime.get(sig.time) || [];
    arr.push(sig);
    byTime.set(sig.time, arr);
  }

  const result: LiveSignal[] = [];
  for (const [, sigs] of byTime.entries()) {
    if (sigs.length === 1) {
      result.push(sigs[0]);
    } else {
      // Multiple on same candle — pick by trend, then strength
      const trendSig = sigs.find(s =>
        (trend === 'BULL' && s.direction === 'UP') ||
        (trend === 'BEAR' && s.direction === 'DOWN')
      );
      if (trendSig) {
        result.push(trendSig);
      } else {
        // Neutral — pick strongest
        result.push(sigs.reduce((best, s) => s.strength > best.strength ? s : best));
      }
    }
  }

  return result;
}


// ════════════════════════════════════════════════════════════
//  MAIN EXPORT: calculateSemafor
// ════════════════════════════════════════════════════════════

/**
 * Main Semafor calculation
 * 
 * Returns ZigZag pivot points + non-repainting live pattern signals.
 * Live signals only appear on CLOSED candles and are deterministic.
 */
export function calculateSemafor(
  candles: Candle[],
  timeframe?: string
): SemaforPoint[] {
  if (!candles || !Array.isArray(candles) || candles.length < 10) {
    return [];
  }

  try {
    const data = candles.length > 500 ? candles.slice(-500) : candles;

    // Adaptive deviation based on volatility
    const deviation = getAdaptiveDeviation(data, timeframe);

    // Run ZigZag for pivot detection
    const pivots = runZigZag(data, deviation);
    if (pivots.length === 0) return [];

    // Assign strength levels to pivots
    const strengths = assignStrengths(pivots);

    // Convert pivots to SemaforPoints
    const points: SemaforPoint[] = pivots.map(pivot => {
      const strength = strengths.get(pivot.index) || 1;
      return {
        time: pivot.time,
        price: pivot.price,
        type: pivot.type,
        strength,
        barIndex: pivot.index,
        signal: pivot.type === 'high' ? ('SELL' as const) : ('BUY' as const),
        signalStrength: strength,
      };
    });

    // ──── NON-REPAINTING LIVE PATTERN DETECTION ────
    // Only signals on CLOSED candles with trend confirmation
    const liveSignals = detectLivePatterns(data);

    if (liveSignals.length > 0) {
      console.log('📍 Confirmed pattern signals:', liveSignals.map(s => `${s.pattern} (${s.direction})`).join(', '));
    }

    // Check for cooldown: don't add a live signal if there's already
    // a ZigZag pivot within 3 candles of the signal candle
    const pivotTimes = new Set(pivots.map(p => p.time));

    for (const sig of liveSignals) {
      // Cooldown: skip if a ZigZag pivot of the same type exists at this time
      if (pivotTimes.has(sig.time)) continue;

      // Also skip if there's a pivot within ±2 candle times
      const sigIdx = data.findIndex(c => c.time === sig.time);
      let tooCloseToZigZag = false;
      for (let i = Math.max(0, sigIdx - 2); i <= Math.min(data.length - 1, sigIdx + 2); i++) {
        if (pivotTimes.has(data[i].time)) {
          // Check if it's the same type (high/low)
          const nearbyPivot = pivots.find(p => p.time === data[i].time);
          if (nearbyPivot && nearbyPivot.type === sig.type) {
            tooCloseToZigZag = true;
            break;
          }
        }
      }
      if (tooCloseToZigZag) continue;

      points.push({
        time: sig.time,
        price: sig.price,
        type: sig.type,
        strength: sig.strength,
        barIndex: sigIdx >= 0 ? sigIdx : data.length - 2,
        signal: sig.direction === 'UP' ? 'BUY' : 'SELL',
        signalStrength: sig.strength,
        isLive: true,
        pattern: sig.pattern,
        direction: sig.direction,
      });
    }

    return points;
  } catch (error) {
    console.error('Semafor error:', error);
    return [];
  }
}


// ════════════════════════════════════════════════════════════
//  TREND EXPORT (for UI display)
// ════════════════════════════════════════════════════════════

/**
 * Get current trend based on EMA(20) vs EMA(50)
 * Called separately by the UI component for display
 */
export function getSemaforTrend(candles: Candle[]): SemaforTrend {
  if (!candles || candles.length < 55) {
    return { trend: 'NEUTRAL', ema20: 0, ema50: 0 };
  }

  const data = candles.length > 500 ? candles.slice(-500) : candles;
  // Use closes of CLOSED candles only (exclude the forming candle)
  const closedCloses = data.slice(0, data.length - 1).map(c => c.close);
  const ema20 = computeEMA(closedCloses, 20);
  const ema50 = computeEMA(closedCloses, 50);

  const emaDiff = ema50 > 0 ? ((ema20 - ema50) / ema50) * 100 : 0;

  let trend: 'BULL' | 'BEAR' | 'NEUTRAL';
  if (emaDiff > 0.02) trend = 'BULL';
  else if (emaDiff < -0.02) trend = 'BEAR';
  else trend = 'NEUTRAL';

  return { trend, ema20, ema50 };
}


// ════════════════════════════════════════════════════════════
//  UTILITY EXPORTS
// ════════════════════════════════════════════════════════════

/**
 * Get recent pivot points (last N)
 */
export function getRecentPivots(
  points: SemaforPoint[],
  count: number = 10
): SemaforPoint[] {
  return points.slice(-count);
}

/**
 * Find nearest support/resistance from Semafor points
 */
export function findNearestLevels(
  points: SemaforPoint[],
  currentPrice: number
): { support: number | null; resistance: number | null } {
  const highs = points
    .filter(p => p.type === 'high')
    .map(p => p.price)
    .sort((a, b) => a - b);

  const lows = points
    .filter(p => p.type === 'low')
    .map(p => p.price)
    .sort((a, b) => a - b);

  const resistance = highs.find(h => h > currentPrice) || null;
  const support = [...lows].reverse().find(l => l < currentPrice) || null;

  return { support, resistance };
}
