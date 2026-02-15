/**
 * Average True Range (ATR) Calculator
 * Uses Wilder's smoothing method
 * Pure function, deterministic
 */

import { Candle } from './types';

/**
 * Calculate True Range for a single candle
 */
function calculateTrueRange(
  current: Candle,
  previous: Candle | null
): number {
  if (!previous) {
    return current.high - current.low;
  }

  const hl = current.high - current.low;
  const hc = Math.abs(current.high - previous.close);
  const lc = Math.abs(current.low - previous.close);

  return Math.max(hl, hc, lc);
}

/**
 * Calculate ATR array using Wilder's smoothing
 * 
 * @param candles - Array of candle data
 * @param period - ATR period (default: 14)
 * @returns Array of ATR values, same length as candles
 */
export function calculateATR(
  candles: Candle[],
  period: number = 14
): number[] {
  if (candles.length === 0) {
    return [];
  }

  if (candles.length < period) {
    // For initial period, use simple average
    const atrValues: number[] = [];
    let sum = 0;

    for (let i = 0; i < candles.length; i++) {
      const previous = i > 0 ? candles[i - 1] : null;
      const tr = calculateTrueRange(candles[i], previous);
      sum += tr;
      atrValues.push(sum / (i + 1));
    }

    return atrValues;
  }

  // Calculate initial ATR (simple average of first period TRs)
  const initialATRs: number[] = [];
  let initialSum = 0;

  for (let i = 0; i < period; i++) {
    const previous = i > 0 ? candles[i - 1] : null;
    const tr = calculateTrueRange(candles[i], previous);
    initialSum += tr;
    initialATRs.push(tr);
  }

  const atrValues: number[] = [];
  let currentATR = initialSum / period;
  atrValues.push(currentATR);

  // Apply Wilder's smoothing for remaining candles
  for (let i = period; i < candles.length; i++) {
    const previous = candles[i - 1];
    const tr = calculateTrueRange(candles[i], previous);
    
    // Wilder's smoothing: ATR = ((ATR_prev * (period - 1)) + TR) / period
    currentATR = ((currentATR * (period - 1)) + tr) / period;
    atrValues.push(currentATR);
  }

  // Prepend initial ATR values
  return [...initialATRs.slice(0, period - 1), ...atrValues];
}
