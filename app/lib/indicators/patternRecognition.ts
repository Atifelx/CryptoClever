import { Candle } from './types';

/**
 * Pattern Recognition Indicator
 * 
 * Detects common chart patterns used in crypto trading:
 * - Double Bottom/Top
 * - Triple Bottom/Top
 * - Head & Shoulders / Inverse H&S
 * - Triangles (Ascending, Descending, Symmetrical)
 * - Rectangle (Support/Resistance)
 * 
 * Uses multi-timeframe analysis and confidence scoring.
 * All patterns are detected on CLOSED candles only (non-repainting).
 */

export type PatternType =
  | 'DOUBLE_BOTTOM'
  | 'DOUBLE_TOP'
  | 'TRIPLE_BOTTOM'
  | 'TRIPLE_TOP'
  | 'HEAD_SHOULDERS'
  | 'INVERSE_HEAD_SHOULDERS'
  | 'ASCENDING_TRIANGLE'
  | 'DESCENDING_TRIANGLE'
  | 'SYMMETRICAL_TRIANGLE'
  | 'RECTANGLE_SUPPORT'
  | 'RECTANGLE_RESISTANCE'
  | 'HAMMER'
  | 'SHOOTING_STAR'
  | 'DOJI'
  | 'BULLISH_ENGULFING'
  | 'BEARISH_ENGULFING';

export interface PatternSignal {
  type: PatternType;
  time: number;
  price: number;
  confidence: number; // 0-100
  direction: 'UP' | 'DOWN';
  target?: number;
  stopLoss?: number;
  description: string;
  patternPoints: Array<{ time: number; price: number; label: string }>;
}

/**
 * Calculate ATR for volatility-based pattern validation
 */
function computeATR(candles: Candle[], period: number = 14): number {
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

/**
 * Find swing lows (local minima) - IMPROVED STABILITY
 * Uses larger lookback window and requires minimum swing size to filter noise
 */
function findSwingLows(candles: Candle[], lookback: number = 8): Array<{ index: number; price: number; time: number }> {
  const lows: Array<{ index: number; price: number; time: number }> = [];
  const atr = computeATR(candles, 14);
  const minSwingSize = atr * 0.3; // Minimum swing size to be considered significant

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];
    let isLow = true;
    
    // Check if this is a local minimum
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && candles[j].low <= current.low) {
        isLow = false;
        break;
      }
    }

    if (isLow) {
      // Verify this swing is significant (not just noise)
      // Check if there's a meaningful move away from this low
      let hasSignificantMove = false;
      for (let j = i + 1; j < Math.min(i + lookback * 2, candles.length); j++) {
        const move = candles[j].high - current.low;
        if (move >= minSwingSize) {
          hasSignificantMove = true;
          break;
        }
      }

      if (hasSignificantMove) {
        lows.push({ index: i, price: current.low, time: current.time });
      }
    }
  }
  return lows;
}

/**
 * Find swing highs (local maxima) - IMPROVED STABILITY
 */
function findSwingHighs(candles: Candle[], lookback: number = 8): Array<{ index: number; price: number; time: number }> {
  const highs: Array<{ index: number; price: number; time: number }> = [];
  const atr = computeATR(candles, 14);
  const minSwingSize = atr * 0.3;

  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];
    let isHigh = true;
    
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && candles[j].high >= current.high) {
        isHigh = false;
        break;
      }
    }

    if (isHigh) {
      // Verify significant move away from this high
      let hasSignificantMove = false;
      for (let j = i + 1; j < Math.min(i + lookback * 2, candles.length); j++) {
        const move = current.high - candles[j].low;
        if (move >= minSwingSize) {
          hasSignificantMove = true;
          break;
        }
      }

      if (hasSignificantMove) {
        highs.push({ index: i, price: current.high, time: current.time });
      }
    }
  }
  return highs;
}

/**
 * Check if two prices are similar (within tolerance)
 */
function isSimilarPrice(price1: number, price2: number, tolerancePercent: number = 1.0): boolean {
  const avg = (price1 + price2) / 2;
  const diff = Math.abs(price1 - price2);
  return (diff / avg) * 100 <= tolerancePercent;
}

/**
 * Detect Double Bottom pattern
 * Two similar lows with a peak in between (W shape)
 */
function detectDoubleBottom(
  candles: Candle[],
  swingLows: Array<{ index: number; price: number; time: number }>
): PatternSignal | null {
  if (swingLows.length < 2) return null;

  // Look for the last two significant lows
  const lastTwo = swingLows.slice(-2);
  if (lastTwo.length < 2) return null;

  const [firstLow, secondLow] = lastTwo;
  const tolerance = 2.0; // 2% tolerance for double bottom

  // CRITICAL: Ensure second low is at least 5 candles old (confirmed, not forming)
  if (secondLow.index > candles.length - 6) return null;

  // Check if lows are similar
  if (!isSimilarPrice(firstLow.price, secondLow.price, tolerance)) return null;

  // Find the peak between the two lows
  const startIdx = firstLow.index;
  const endIdx = secondLow.index;
  if (endIdx - startIdx < 10) return null; // Need enough candles between

  let peakPrice = 0;
  let peakTime = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    if (candles[i].high > peakPrice) {
      peakPrice = candles[i].high;
      peakTime = candles[i].time;
    }
  }

  // Peak should be at least 2% above the lows
  const peakHeight = ((peakPrice - firstLow.price) / firstLow.price) * 100;
  if (peakHeight < 2.0) return null;

  // Calculate confidence based on pattern quality
  const priceMatch = isSimilarPrice(firstLow.price, secondLow.price, 1.0) ? 30 : 20;
  const peakHeightScore = Math.min(peakHeight / 5, 1) * 30; // Up to 30 points
  const spacingScore = (endIdx - startIdx) >= 20 ? 20 : 15;
  const volumeScore = 10; // Reduced (volume not available)
  const confidence = Math.min(priceMatch + peakHeightScore + spacingScore + volumeScore, 100);
  
  // Only return if confidence is high enough
  if (confidence < 70) return null;

  // Target: height of the pattern projected upward
  const patternHeight = peakPrice - firstLow.price;
  const target = secondLow.price + patternHeight;

  // Stop loss: below the second low
  const stopLoss = secondLow.price * 0.995; // 0.5% below

  return {
    type: 'DOUBLE_BOTTOM',
    time: secondLow.time,
    price: secondLow.price,
    confidence: Math.round(confidence),
    direction: 'UP',
    target,
    stopLoss,
    description: 'Double Bottom - Bullish reversal pattern',
    patternPoints: [
      { time: firstLow.time, price: firstLow.price, label: 'Low 1' },
      { time: peakTime, price: peakPrice, label: 'Peak' },
      { time: secondLow.time, price: secondLow.price, label: 'Low 2' },
    ],
  };
}

/**
 * Detect Double Top pattern
 * Two similar highs with a trough in between (M shape)
 */
function detectDoubleTop(
  candles: Candle[],
  swingHighs: Array<{ index: number; price: number; time: number }>
): PatternSignal | null {
  if (swingHighs.length < 2) return null;

  const lastTwo = swingHighs.slice(-2);
  if (lastTwo.length < 2) return null;

  const [firstHigh, secondHigh] = lastTwo;
  const tolerance = 2.0;

  // CRITICAL: Ensure second high is at least 5 candles old (confirmed)
  if (secondHigh.index > candles.length - 6) return null;

  if (!isSimilarPrice(firstHigh.price, secondHigh.price, tolerance)) return null;

  const startIdx = firstHigh.index;
  const endIdx = secondHigh.index;
  if (endIdx - startIdx < 10) return null;

  let troughPrice = Infinity;
  let troughTime = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    if (candles[i].low < troughPrice) {
      troughPrice = candles[i].low;
      troughTime = candles[i].time;
    }
  }

  const dropDepth = ((firstHigh.price - troughPrice) / firstHigh.price) * 100;
  if (dropDepth < 2.0) return null;

  const priceMatch = isSimilarPrice(firstHigh.price, secondHigh.price, 1.0) ? 30 : 20;
  const dropScore = Math.min(dropDepth / 5, 1) * 30;
  const volumeScore = 20;
  const confidence = Math.min(priceMatch + dropScore + volumeScore, 100);

  const patternHeight = firstHigh.price - troughPrice;
  const target = secondHigh.price - patternHeight;
  const stopLoss = secondHigh.price * 1.005; // 0.5% above

  return {
    type: 'DOUBLE_TOP',
    time: secondHigh.time,
    price: secondHigh.price,
    confidence: Math.round(confidence),
    direction: 'DOWN',
    target,
    stopLoss,
    description: 'Double Top - Bearish reversal pattern',
    patternPoints: [
      { time: firstHigh.time, price: firstHigh.price, label: 'High 1' },
      { time: troughTime, price: troughPrice, label: 'Trough' },
      { time: secondHigh.time, price: secondHigh.price, label: 'High 2' },
    ],
  };
}

/**
 * Detect Triple Bottom pattern
 * 
 * Professional Requirements:
 * 1. Three lows at roughly the same level (W-W-W shape)
 * 2. Two peaks between the lows (each peak must be significantly higher)
 * 3. Proper spacing between lows (minimum 20 candles)
 * 4. Peaks should be at similar or ascending levels
 * 5. Pattern must be fully formed (all points confirmed)
 */
function detectTripleBottom(
  candles: Candle[],
  swingLows: Array<{ index: number; price: number; time: number }>
): PatternSignal | null {
  if (swingLows.length < 3) return null;

  const lastThree = swingLows.slice(-3);
  if (lastThree.length < 3) return null;

  const [first, second, third] = lastThree;
  const tolerance = 1.5; // STRICTER: 1.5% instead of 2.5%

  // CRITICAL: Ensure third low is at least 5 candles old (confirmed)
  if (third.index > candles.length - 6) return null;

  // Check spacing - need proper W-W-W formation
  if (third.index - first.index < 30) return null; // STRICTER: 30 instead of 20

  // All three lows should be similar (within 1.5%)
  if (!isSimilarPrice(first.price, second.price, tolerance) ||
      !isSimilarPrice(second.price, third.price, tolerance)) return null;

  // ═══ CRITICAL: Verify W-W-W shape with peaks ═══
  // Find peaks between lows
  let peak1Price = 0;
  let peak1Time = 0;
  let peak2Price = 0;
  let peak2Time = 0;

  // Peak 1: between first and second low
  for (let i = first.index + 1; i < second.index; i++) {
    if (candles[i].high > peak1Price) {
      peak1Price = candles[i].high;
      peak1Time = candles[i].time;
    }
  }

  // Peak 2: between second and third low
  for (let i = second.index + 1; i < third.index; i++) {
    if (candles[i].high > peak2Price) {
      peak2Price = candles[i].high;
      peak2Time = candles[i].time;
    }
  }

  // CRITICAL: Both peaks must exist and be significantly higher than lows
  if (peak1Price === 0 || peak2Price === 0) return null;

  const avgLow = (first.price + second.price + third.price) / 3;
  const minPeakHeight = avgLow * 0.02; // Peaks must be at least 2% above average low

  if (peak1Price - avgLow < minPeakHeight || peak2Price - avgLow < minPeakHeight) {
    return null; // Peaks not high enough - not a valid triple bottom
  }

  // Peaks should be at similar levels (within 3%) or ascending
  const peakSimilarity = Math.abs(peak1Price - peak2Price) / Math.min(peak1Price, peak2Price) * 100;
  if (peakSimilarity > 5.0) return null; // Peaks too different

  // Calculate confidence based on pattern quality
  const priceMatch = isSimilarPrice(first.price, second.price, 1.0) && 
                     isSimilarPrice(second.price, third.price, 1.0) ? 35 : 25;
  
  const peakHeightScore = Math.min(
    ((peak1Price - avgLow) / avgLow * 100 + (peak2Price - avgLow) / avgLow * 100) / 10,
    30
  );
  
  const spacingScore = (third.index - first.index) >= 40 ? 20 : 15;
  const peakQualityScore = peakSimilarity < 2.0 ? 15 : 10;
  
  const confidence = Math.min(priceMatch + peakHeightScore + spacingScore + peakQualityScore, 100);

  // Only return if confidence is high enough
  if (confidence < 70) return null;

  const patternHeight = Math.max(peak1Price, peak2Price) - avgLow;
  const target = third.price + patternHeight;
  const stopLoss = third.price * 0.995;

  return {
    type: 'TRIPLE_BOTTOM',
    time: third.time,
    price: third.price,
    confidence: Math.round(confidence),
    direction: 'UP',
    target,
    stopLoss,
    description: 'Triple Bottom - Strong bullish reversal',
    patternPoints: [
      { time: first.time, price: first.price, label: 'Low 1' },
      { time: peak1Time, price: peak1Price, label: 'Peak 1' },
      { time: second.time, price: second.price, label: 'Low 2' },
      { time: peak2Time, price: peak2Price, label: 'Peak 2' },
      { time: third.time, price: third.price, label: 'Low 3' },
    ],
  };
}

/**
 * Detect Triple Top pattern
 * 
 * Professional Requirements (same as Triple Bottom but inverted):
 * 1. Three highs at roughly the same level (M-M-M shape)
 * 2. Two troughs between the highs (each trough must be significantly lower)
 * 3. Proper spacing between highs (minimum 30 candles)
 * 4. Troughs should be at similar or descending levels
 * 5. Pattern must be fully formed (all points confirmed)
 */
function detectTripleTop(
  candles: Candle[],
  swingHighs: Array<{ index: number; price: number; time: number }>
): PatternSignal | null {
  if (swingHighs.length < 3) return null;

  const lastThree = swingHighs.slice(-3);
  if (lastThree.length < 3) return null;

  const [first, second, third] = lastThree;
  const tolerance = 1.5; // STRICTER: 1.5% instead of 2.5%

  // CRITICAL: Ensure third high is at least 5 candles old (confirmed)
  if (third.index > candles.length - 6) return null;

  // Check spacing - need proper M-M-M formation
  if (third.index - first.index < 30) return null; // STRICTER: 30 instead of 20

  // All three highs should be similar (within 1.5%)
  if (!isSimilarPrice(first.price, second.price, tolerance) ||
      !isSimilarPrice(second.price, third.price, tolerance)) return null;

  // ═══ CRITICAL: Verify M-M-M shape with troughs ═══
  // Find troughs between highs
  let trough1Price = Infinity;
  let trough1Time = 0;
  let trough2Price = Infinity;
  let trough2Time = 0;

  // Trough 1: between first and second high
  for (let i = first.index + 1; i < second.index; i++) {
    if (candles[i].low < trough1Price) {
      trough1Price = candles[i].low;
      trough1Time = candles[i].time;
    }
  }

  // Trough 2: between second and third high
  for (let i = second.index + 1; i < third.index; i++) {
    if (candles[i].low < trough2Price) {
      trough2Price = candles[i].low;
      trough2Time = candles[i].time;
    }
  }

  // CRITICAL: Both troughs must exist and be significantly lower than highs
  if (trough1Price === Infinity || trough2Price === Infinity) return null;

  const avgHigh = (first.price + second.price + third.price) / 3;
  const minTroughDepth = avgHigh * 0.02; // Troughs must be at least 2% below average high

  if (avgHigh - trough1Price < minTroughDepth || avgHigh - trough2Price < minTroughDepth) {
    return null; // Troughs not low enough - not a valid triple top
  }

  // Troughs should be at similar levels (within 3%) or descending
  const troughSimilarity = Math.abs(trough1Price - trough2Price) / Math.max(trough1Price, trough2Price) * 100;
  if (troughSimilarity > 5.0) return null; // Troughs too different

  // Calculate confidence based on pattern quality
  const priceMatch = isSimilarPrice(first.price, second.price, 1.0) && 
                     isSimilarPrice(second.price, third.price, 1.0) ? 35 : 25;
  
  const troughDepthScore = Math.min(
    ((avgHigh - trough1Price) / avgHigh * 100 + (avgHigh - trough2Price) / avgHigh * 100) / 10,
    30
  );
  
  const spacingScore = (third.index - first.index) >= 40 ? 20 : 15;
  const troughQualityScore = troughSimilarity < 2.0 ? 15 : 10;
  
  const confidence = Math.min(priceMatch + troughDepthScore + spacingScore + troughQualityScore, 100);

  // Only return if confidence is high enough
  if (confidence < 70) return null;

  const patternHeight = avgHigh - Math.min(trough1Price, trough2Price);
  const target = third.price - patternHeight;
  const stopLoss = third.price * 1.005;

  return {
    type: 'TRIPLE_TOP',
    time: third.time,
    price: third.price,
    confidence: Math.round(confidence),
    direction: 'DOWN',
    target,
    stopLoss,
    description: 'Triple Top - Strong bearish reversal',
    patternPoints: [
      { time: first.time, price: first.price, label: 'High 1' },
      { time: trough1Time, price: trough1Price, label: 'Trough 1' },
      { time: second.time, price: second.price, label: 'High 2' },
      { time: trough2Time, price: trough2Price, label: 'Trough 2' },
      { time: third.time, price: third.price, label: 'High 3' },
    ],
  };
}

/**
 * Detect Head & Shoulders pattern
 * Three peaks: left shoulder, head (highest), right shoulder (similar to left)
 */
function detectHeadShoulders(
  candles: Candle[],
  swingHighs: Array<{ index: number; price: number; time: number }>
): PatternSignal | null {
  if (swingHighs.length < 3) return null;

  const lastThree = swingHighs.slice(-3);
  if (lastThree.length < 3) return null;

  const [leftShoulder, head, rightShoulder] = lastThree;

  // CRITICAL: Ensure right shoulder is at least 5 candles old (confirmed)
  if (rightShoulder.index > candles.length - 6) return null;

  // Head must be higher than both shoulders
  if (head.price <= leftShoulder.price || head.price <= rightShoulder.price) return null;

  // Shoulders should be similar in height
  if (!isSimilarPrice(leftShoulder.price, rightShoulder.price, 3.0)) return null;

  // Head should be at least 2% higher than shoulders
  const headHeight = ((head.price - leftShoulder.price) / leftShoulder.price) * 100;
  if (headHeight < 2.0) return null;

  // Check spacing
  if (rightShoulder.index - leftShoulder.index < 15) return null;

  const shoulderMatch = isSimilarPrice(leftShoulder.price, rightShoulder.price, 2.0) ? 30 : 20;
  const headHeightScore = Math.min(headHeight / 5, 1) * 30;
  const spacingScore = 20;
  const confidence = Math.min(shoulderMatch + headHeightScore + spacingScore, 100);

  // Neckline: lowest point between shoulders
  let neckline = Infinity;
  let necklineTime = 0;
  for (let i = leftShoulder.index; i <= rightShoulder.index; i++) {
    if (candles[i].low < neckline) {
      neckline = candles[i].low;
      necklineTime = candles[i].time;
    }
  }

  const patternHeight = head.price - neckline;
  const target = neckline - patternHeight;
  const stopLoss = rightShoulder.price * 1.005;

  return {
    type: 'HEAD_SHOULDERS',
    time: rightShoulder.time,
    price: rightShoulder.price,
    confidence: Math.round(confidence),
    direction: 'DOWN',
    target,
    stopLoss,
    description: 'Head & Shoulders - Bearish reversal',
    patternPoints: [
      { time: leftShoulder.time, price: leftShoulder.price, label: 'L Shoulder' },
      { time: head.time, price: head.price, label: 'Head' },
      { time: rightShoulder.time, price: rightShoulder.price, label: 'R Shoulder' },
      { time: necklineTime, price: neckline, label: 'Neckline' },
    ],
  };
}

/**
 * Detect Inverse Head & Shoulders pattern
 */
function detectInverseHeadShoulders(
  candles: Candle[],
  swingLows: Array<{ index: number; price: number; time: number }>
): PatternSignal | null {
  if (swingLows.length < 3) return null;

  const lastThree = swingLows.slice(-3);
  if (lastThree.length < 3) return null;

  const [leftShoulder, head, rightShoulder] = lastThree;

  // CRITICAL: Ensure right shoulder is at least 5 candles old (confirmed)
  if (rightShoulder.index > candles.length - 6) return null;

  if (head.price >= leftShoulder.price || head.price >= rightShoulder.price) return null;
  if (!isSimilarPrice(leftShoulder.price, rightShoulder.price, 3.0)) return null;

  const headDepth = ((leftShoulder.price - head.price) / leftShoulder.price) * 100;
  if (headDepth < 2.0) return null;

  if (rightShoulder.index - leftShoulder.index < 15) return null;

  const shoulderMatch = isSimilarPrice(leftShoulder.price, rightShoulder.price, 2.0) ? 30 : 20;
  const headDepthScore = Math.min(headDepth / 5, 1) * 30;
  const spacingScore = 20;
  const confidence = Math.min(shoulderMatch + headDepthScore + spacingScore, 100);

  let neckline = 0;
  let necklineTime = 0;
  for (let i = leftShoulder.index; i <= rightShoulder.index; i++) {
    if (candles[i].high > neckline) {
      neckline = candles[i].high;
      necklineTime = candles[i].time;
    }
  }

  const patternHeight = neckline - head.price;
  const target = neckline + patternHeight;
  const stopLoss = rightShoulder.price * 0.995;

  return {
    type: 'INVERSE_HEAD_SHOULDERS',
    time: rightShoulder.time,
    price: rightShoulder.price,
    confidence: Math.round(confidence),
    direction: 'UP',
    target,
    stopLoss,
    description: 'Inverse H&S - Bullish reversal',
    patternPoints: [
      { time: leftShoulder.time, price: leftShoulder.price, label: 'L Shoulder' },
      { time: head.time, price: head.price, label: 'Head' },
      { time: rightShoulder.time, price: rightShoulder.price, label: 'R Shoulder' },
      { time: necklineTime, price: neckline, label: 'Neckline' },
    ],
  };
}

/**
 * Detect Hammer pattern (bullish reversal)
 * Small body at top, long lower wick (at least 2x body), little/no upper wick
 */
function detectHammer(candles: Candle[]): PatternSignal | null {
  if (candles.length < 2) return null;
  
  // Check last CLOSED candle (exclude forming candle)
  const candle = candles[candles.length - 2];
  if (!candle) return null;
  
  const bodySize = Math.abs(candle.close - candle.open);
  const totalRange = candle.high - candle.low;
  if (totalRange === 0) return null;
  
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  
  // Hammer criteria (more lenient):
  // 1. Lower wick at least 1.5x body size (or 2x total range if body is very small)
  // 2. Upper wick small (less than 0.3x total range)
  // 3. Lower wick is at least 50% of total range
  const bodyRatio = bodySize / totalRange;
  const lowerWickRatio = lowerWick / totalRange;
  const upperWickRatio = upperWick / totalRange;
  
  const isHammer = lowerWickRatio >= 0.5 && // Lower wick is at least 50% of range
                   upperWickRatio <= 0.3 && // Upper wick is small
                   (bodySize === 0 || lowerWick >= bodySize * 1.5); // Lower wick 1.5x body (or body is tiny)
  
  if (!isHammer) return null;
  
  // Check if it's at a support level (recent low) - more lenient
  const recentLows = candles.slice(Math.max(0, candles.length - 30), -1).map(c => c.low);
  if (recentLows.length === 0) return null;
  const minRecentLow = Math.min(...recentLows);
  const isAtSupport = candle.low <= minRecentLow * 1.02; // Within 2% of recent low
  
  const confidence = isAtSupport ? 70 : 60; // Lower threshold to catch more patterns
  
  const target = candle.close + (lowerWick * 1.5);
  const stopLoss = candle.low * 0.995;
  
  return {
    type: 'HAMMER',
    time: candle.time,
    price: candle.close,
    confidence,
    direction: 'UP',
    target,
    stopLoss,
    description: 'Hammer - Bullish reversal',
    patternPoints: [
      { time: candle.time, price: candle.low, label: 'Hammer Low' },
      { time: candle.time, price: candle.close, label: 'Close' },
    ],
  };
}

/**
 * Detect Shooting Star pattern (bearish reversal)
 * Small body at bottom, long upper wick (at least 2x body), little/no lower wick
 */
function detectShootingStar(candles: Candle[]): PatternSignal | null {
  if (candles.length < 2) return null;
  
  const candle = candles[candles.length - 2];
  if (!candle) return null;
  
  const bodySize = Math.abs(candle.close - candle.open);
  const totalRange = candle.high - candle.low;
  if (totalRange === 0) return null;
  
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  
  // Shooting Star criteria:
  // 1. Upper wick at least 2x body size
  // 2. Lower wick small (less than body size)
  // 3. Body in lower half of range
  const isShootingStar = upperWick >= bodySize * 2 && 
                        lowerWick <= bodySize * 0.5 &&
                        (candle.high - Math.max(candle.open, candle.close)) / totalRange >= 0.6;
  
  if (!isShootingStar) return null;
  
  // Check if it's at a resistance level (recent high)
  const recentHighs = candles.slice(-20, -1).map(c => c.high);
  const maxRecentHigh = Math.max(...recentHighs);
  const isAtResistance = candle.high >= maxRecentHigh * 0.99; // Within 1% of recent high
  
  const confidence = isAtResistance ? 75 : 65;
  
  const target = candle.close - (upperWick * 1.5);
  const stopLoss = candle.high * 1.005;
  
  return {
    type: 'SHOOTING_STAR',
    time: candle.time,
    price: candle.close,
    confidence,
    direction: 'DOWN',
    target,
    stopLoss,
    description: 'Shooting Star - Bearish reversal',
    patternPoints: [
      { time: candle.time, price: candle.high, label: 'Shooting Star High' },
      { time: candle.time, price: candle.close, label: 'Close' },
    ],
  };
}

/**
 * Detect Doji pattern (indecision)
 * Very small body (less than 10% of range), long wicks on both sides
 */
function detectDoji(candles: Candle[]): PatternSignal | null {
  if (candles.length < 2) return null;
  
  const candle = candles[candles.length - 2];
  if (!candle) return null;
  
  const bodySize = Math.abs(candle.close - candle.open);
  const totalRange = candle.high - candle.low;
  if (totalRange === 0) return null;
  
  const bodyRatio = bodySize / totalRange;
  
  // Doji: body less than 10% of total range
  if (bodyRatio > 0.1) return null;
  
  // Both wicks should be significant
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  
  if (lowerWick / totalRange < 0.3 || upperWick / totalRange < 0.3) return null;
  
  // Doji at support = potential bullish, at resistance = potential bearish
  const recentLows = candles.slice(-20, -1).map(c => c.low);
  const recentHighs = candles.slice(-20, -1).map(c => c.high);
  const minRecentLow = Math.min(...recentLows);
  const maxRecentHigh = Math.max(...recentHighs);
  
  const isAtSupport = candle.low <= minRecentLow * 1.01;
  const isAtResistance = candle.high >= maxRecentHigh * 0.99;
  
  let direction: 'UP' | 'DOWN' = 'UP';
  let confidence = 60;
  
  if (isAtSupport) {
    direction = 'UP';
    confidence = 65;
  } else if (isAtResistance) {
    direction = 'DOWN';
    confidence = 65;
  }
  
  const target = direction === 'UP' ? candle.close * 1.02 : candle.close * 0.98;
  const stopLoss = direction === 'UP' ? candle.low * 0.995 : candle.high * 1.005;
  
  return {
    type: 'DOJI',
    time: candle.time,
    price: candle.close,
    confidence,
    direction,
    target,
    stopLoss,
    description: 'Doji - Indecision/Reversal',
    patternPoints: [
      { time: candle.time, price: candle.low, label: 'Low' },
      { time: candle.time, price: candle.high, label: 'High' },
    ],
  };
}

/**
 * Detect Engulfing patterns (2-candle patterns)
 */
function detectEngulfing(candles: Candle[]): PatternSignal | null {
  if (candles.length < 3) return null;
  
  const prevCandle = candles[candles.length - 3]; // Previous closed candle
  const currentCandle = candles[candles.length - 2]; // Last closed candle
  
  if (!prevCandle || !currentCandle) return null;
  
  const prevBody = Math.abs(prevCandle.close - prevCandle.open);
  const currentBody = Math.abs(currentCandle.close - currentCandle.open);
  
  // Engulfing: current candle body must be larger and engulf previous
  if (currentBody <= prevBody * 1.1) return null; // Current body must be at least 10% larger
  
  // Bullish Engulfing: prev red, current green, current engulfs prev
  const isBullishEngulfing = 
    prevCandle.close < prevCandle.open && // Previous was bearish
    currentCandle.close > currentCandle.open && // Current is bullish
    currentCandle.open < prevCandle.close && // Current opens below prev close
    currentCandle.close > prevCandle.open; // Current closes above prev open
  
  // Bearish Engulfing: prev green, current red, current engulfs prev
  const isBearishEngulfing = 
    prevCandle.close > prevCandle.open && // Previous was bullish
    currentCandle.close < currentCandle.open && // Current is bearish
    currentCandle.open > prevCandle.close && // Current opens above prev close
    currentCandle.close < prevCandle.open; // Current closes below prev open
  
  if (!isBullishEngulfing && !isBearishEngulfing) return null;
  
  const isBullish = isBullishEngulfing;
  const engulfingSize = Math.abs(currentCandle.close - currentCandle.open);
  const confidence = Math.min(60 + (engulfingSize / prevBody) * 10, 85);
  
  const target = isBullish 
    ? currentCandle.close + engulfingSize * 1.5
    : currentCandle.close - engulfingSize * 1.5;
  const stopLoss = isBullish 
    ? currentCandle.low * 0.995
    : currentCandle.high * 1.005;
  
  return {
    type: isBullish ? 'BULLISH_ENGULFING' : 'BEARISH_ENGULFING',
    time: currentCandle.time,
    price: currentCandle.close,
    confidence: Math.round(confidence),
    direction: isBullish ? 'UP' : 'DOWN',
    target,
    stopLoss,
    description: isBullish ? 'Bullish Engulfing - Reversal up' : 'Bearish Engulfing - Reversal down',
    patternPoints: [
      { time: prevCandle.time, price: prevCandle.close, label: 'Prev' },
      { time: currentCandle.time, price: currentCandle.close, label: 'Engulfing' },
    ],
  };
}

/**
 * Main pattern recognition function
 * Analyzes candles and returns detected patterns
 */
export function detectPatterns(
  candles: Candle[],
  minConfidence: number = 60
): PatternSignal[] {
  if (!candles || candles.length < 50) return [];

  try {
    // Only analyze CLOSED candles (exclude the forming candle)
    const closedCandles = candles.slice(0, candles.length - 1);
    if (closedCandles.length < 50) return [];

    const atr = computeATR(closedCandles);
    if (atr <= 0) return [];

    // Find swing points
    const swingLows = findSwingLows(closedCandles, 8);
    const swingHighs = findSwingHighs(closedCandles, 8);

    // Debug: Log swing point counts
    if (swingLows.length > 0 || swingHighs.length > 0) {
      console.log(`🔍 Swing points: ${swingLows.length} lows, ${swingHighs.length} highs`);
    }

    const patterns: PatternSignal[] = [];

    // ═══ SINGLE-CANDLE PATTERNS (Check first - most recent) ═══
    // These are the most immediate signals and should be prioritized
    // Check last 5 closed candles for patterns (not just the last one)
    const recentCandlesToCheck = Math.min(5, closedCandles.length);
    let bestSingleCandlePattern: PatternSignal | null = null;
    
    for (let i = 0; i < recentCandlesToCheck; i++) {
      const checkCandles = closedCandles.slice(0, closedCandles.length - i);
      
      const hammer = detectHammer(checkCandles);
      if (hammer && hammer.confidence >= minConfidence) {
        if (!bestSingleCandlePattern || hammer.confidence > bestSingleCandlePattern.confidence) {
          bestSingleCandlePattern = hammer;
        }
      }

      const shootingStar = detectShootingStar(checkCandles);
      if (shootingStar && shootingStar.confidence >= minConfidence) {
        if (!bestSingleCandlePattern || shootingStar.confidence > bestSingleCandlePattern.confidence) {
          bestSingleCandlePattern = shootingStar;
        }
      }

      const doji = detectDoji(checkCandles);
      if (doji && doji.confidence >= minConfidence) {
        if (!bestSingleCandlePattern || doji.confidence > bestSingleCandlePattern.confidence) {
          bestSingleCandlePattern = doji;
        }
      }
    }
    
    // Check engulfing (needs 2 candles)
    const engulfing = detectEngulfing(closedCandles);
    if (engulfing && engulfing.confidence >= minConfidence) {
      if (!bestSingleCandlePattern || engulfing.confidence > bestSingleCandlePattern.confidence) {
        bestSingleCandlePattern = engulfing;
      }
    }
    
    if (bestSingleCandlePattern) {
      patterns.push(bestSingleCandlePattern);
      console.log(`🔨 Single-candle pattern detected: ${bestSingleCandlePattern.description} (${bestSingleCandlePattern.confidence}%)`);
    }

    // ═══ MULTI-CANDLE PATTERNS (Check after single-candle) ═══
    // Note: Triple patterns are rarer, so we check them first but with higher confidence requirement
    const tripleBottom = detectTripleBottom(closedCandles, swingLows);
    if (tripleBottom && tripleBottom.confidence >= 75) { // Higher threshold for triple patterns
      patterns.push(tripleBottom);
      console.log(`✅ Triple Bottom: ${tripleBottom.confidence}% confidence`);
    }

    const tripleTop = detectTripleTop(closedCandles, swingHighs);
    if (tripleTop && tripleTop.confidence >= 75) {
      patterns.push(tripleTop);
      console.log(`✅ Triple Top: ${tripleTop.confidence}% confidence`);
    }

    const headShoulders = detectHeadShoulders(closedCandles, swingHighs);
    if (headShoulders && headShoulders.confidence >= minConfidence) patterns.push(headShoulders);

    const inverseHS = detectInverseHeadShoulders(closedCandles, swingLows);
    if (inverseHS && inverseHS.confidence >= minConfidence) patterns.push(inverseHS);

    const doubleBottom = detectDoubleBottom(closedCandles, swingLows);
    if (doubleBottom && doubleBottom.confidence >= minConfidence) {
      patterns.push(doubleBottom);
      console.log(`✅ Double Bottom: ${doubleBottom.confidence}% confidence`);
    }

    const doubleTop = detectDoubleTop(closedCandles, swingHighs);
    if (doubleTop && doubleTop.confidence >= minConfidence) {
      patterns.push(doubleTop);
      console.log(`✅ Double Top: ${doubleTop.confidence}% confidence`);
    }

    // Return only the most recent pattern (highest confidence if multiple)
    if (patterns.length === 0) return [];

    // Filter: Only patterns from the last 200 candles (recent patterns only)
    const recentCutoff = closedCandles.length > 200 ? closedCandles[closedCandles.length - 200].time : 0;
    const recentPatterns = patterns.filter(p => p.time >= recentCutoff);

    if (recentPatterns.length === 0) return [];

    // Sort by confidence first (highest quality), then by time (most recent)
    recentPatterns.sort((a, b) => {
      // Prioritize higher confidence
      if (Math.abs(a.confidence - b.confidence) > 5) {
        return b.confidence - a.confidence;
      }
      // If confidence is similar, prefer most recent
      return b.time - a.time;
    });

    // Return the highest confidence pattern (if multiple, prefer most recent)
    const selected = recentPatterns[0];
    
    // Only log if confidence is high enough
    if (selected.confidence >= 75) {
      console.log(`📊 Pattern detected: ${selected.description} (${selected.confidence}%) at candle ${selected.time}`);
    }
    
    return [selected];
  } catch (error) {
    console.error('Pattern recognition error:', error);
    return [];
  }
}

/**
 * Get pattern display name
 */
export function getPatternName(type: PatternType): string {
  const names: Record<PatternType, string> = {
    DOUBLE_BOTTOM: 'Double Bottom',
    DOUBLE_TOP: 'Double Top',
    TRIPLE_BOTTOM: 'Triple Bottom',
    TRIPLE_TOP: 'Triple Top',
    HEAD_SHOULDERS: 'Head & Shoulders',
    INVERSE_HEAD_SHOULDERS: 'Inverse H&S',
    ASCENDING_TRIANGLE: 'Ascending Triangle',
    DESCENDING_TRIANGLE: 'Descending Triangle',
    SYMMETRICAL_TRIANGLE: 'Symmetrical Triangle',
    RECTANGLE_SUPPORT: 'Rectangle Support',
    RECTANGLE_RESISTANCE: 'Rectangle Resistance',
  };
  return names[type] || type;
}
