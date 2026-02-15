/**
 * Streaming Pivot Detection Engine
 * Detects swing highs and lows with strict alternation
 * Pure function, deterministic
 */

import { Candle, Pivot } from './types';

interface PivotCandidate {
  type: 'HIGH' | 'LOW';
  price: number;
  index: number;
  time: number;
}

/**
 * Detect confirmed pivots using ATR-based reversal threshold
 * 
 * Rules:
 * 1. ReversalThreshold = ATR * 1.5
 * 2. Use close-based confirmation
 * 3. Strict alternation: HIGH → LOW → HIGH → LOW
 * 4. Confirmed pivots are immutable
 * 5. Only confirm pivot when price closes beyond threshold
 * 6. Ignore wicks for BOS logic
 * 7. Reject duplicate timestamps
 * 8. Enforce chronological order
 * 
 * @param candles - Array of candle data
 * @param atrValues - Array of ATR values (same length as candles)
 * @returns Array of confirmed pivots
 */
export function detectPivots(
  candles: Candle[],
  atrValues: number[]
): Pivot[] {
  if (candles.length < 3 || atrValues.length !== candles.length) {
    return [];
  }

  const confirmedPivots: Pivot[] = [];
  let lastConfirmedPivot: PivotCandidate | null = null;
  let pendingPivot: PivotCandidate | null = null;

  // Track seen timestamps to reject duplicates
  const seenTimes = new Set<number>();

  for (let i = 1; i < candles.length - 1; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    const next = candles[i + 1];
    const atr = atrValues[i];
    const reversalThreshold = atr * 1.5;

    // Reject duplicate timestamps
    if (seenTimes.has(current.time)) {
      continue;
    }
    seenTimes.add(current.time);

    // Check for potential HIGH pivot
    if (current.high >= previous.high && current.high >= next.high) {
      // Only consider if we need a HIGH (alternation rule)
      if (!lastConfirmedPivot || lastConfirmedPivot.type === 'LOW') {
        // Update pending HIGH if this is higher
        if (!pendingPivot || pendingPivot.type !== 'HIGH' || current.high > pendingPivot.price) {
          pendingPivot = {
            type: 'HIGH',
            price: current.high,
            index: i,
            time: current.time
          };
        }
      }
    }

    // Check for potential LOW pivot
    if (current.low <= previous.low && current.low <= next.low) {
      // Only consider if we need a LOW (alternation rule)
      if (!lastConfirmedPivot || lastConfirmedPivot.type === 'HIGH') {
        // Update pending LOW if this is lower
        if (!pendingPivot || pendingPivot.type !== 'LOW' || current.low < pendingPivot.price) {
          pendingPivot = {
            type: 'LOW',
            price: current.low,
            index: i,
            time: current.time
          };
        }
      }
    }

    // Check if we can confirm the pending pivot
    if (pendingPivot && lastConfirmedPivot) {
      const priceMove = Math.abs(
        current.close - lastConfirmedPivot.price
      );

      if (priceMove >= reversalThreshold) {
        // Confirm the pending pivot
        const confirmedPivot: Pivot = {
          type: pendingPivot.type,
          price: pendingPivot.price,
          index: pendingPivot.index,
          time: pendingPivot.time
        };

        // Enforce chronological order
        if (confirmedPivots.length === 0 || confirmedPivot.time > confirmedPivots[confirmedPivots.length - 1].time) {
          confirmedPivots.push(confirmedPivot);
          lastConfirmedPivot = pendingPivot;
          pendingPivot = null;
        }
      }
    } else if (pendingPivot && !lastConfirmedPivot) {
      // First pivot - confirm immediately if we have enough data
      if (i >= 2) {
        const confirmedPivot: Pivot = {
          type: pendingPivot.type,
          price: pendingPivot.price,
          index: pendingPivot.index,
          time: pendingPivot.time
        };
        confirmedPivots.push(confirmedPivot);
        lastConfirmedPivot = pendingPivot;
        pendingPivot = null;
      }
    }
  }

  // Add final pending pivot if it's significant
  if (pendingPivot && lastConfirmedPivot) {
    const lastCandle = candles[candles.length - 1];
    const priceMove = Math.abs(
      lastCandle.close - lastConfirmedPivot.price
    );
    const atr = atrValues[atrValues.length - 1];
    const reversalThreshold = atr * 1.5;

    if (priceMove >= reversalThreshold) {
      const confirmedPivot: Pivot = {
        type: pendingPivot.type,
        price: pendingPivot.price,
        index: pendingPivot.index,
        time: pendingPivot.time
      };

      if (confirmedPivots.length === 0 || confirmedPivot.time > confirmedPivots[confirmedPivots.length - 1].time) {
        confirmedPivots.push(confirmedPivot);
      }
    }
  }

  return confirmedPivots;
}
