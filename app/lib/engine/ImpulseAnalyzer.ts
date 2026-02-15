/**
 * Impulse Analyzer
 * Computes impulse strength and velocity
 * Pure function, deterministic
 */

import { Candle, Pivot } from './types';

/**
 * Calculate impulse score based on price movement
 * 
 * Metrics:
 * - ImpulseSize = abs(currentHigh - previousLow)
 * - PullbackSize = abs(previousHigh - previousLow)
 * - ImpulseRatio = ImpulseSize / PullbackSize
 * - Velocity = ImpulseSize / numberOfBars
 * - NormalizedImpulse = ImpulseSize / ATR
 * 
 * @param candles - Array of candle data
 * @param pivots - Array of confirmed pivots
 * @param atrValues - Array of ATR values
 * @returns Impulse score (0-100)
 */
export function calculateImpulseScore(
  candles: Candle[],
  pivots: Pivot[],
  atrValues: number[]
): number {
  if (pivots.length < 4 || candles.length === 0 || atrValues.length === 0) {
    return 0;
  }

  // Get last two pivots
  const lastPivot = pivots[pivots.length - 1];
  const secondLastPivot = pivots[pivots.length - 2];
  const thirdLastPivot = pivots[pivots.length - 3];
  const fourthLastPivot = pivots[pivots.length - 4];

  // Determine current impulse direction
  let impulseSize = 0;
  let pullbackSize = 0;
  let numberOfBars = 0;
  let currentATR = 0;

  if (lastPivot.type === 'HIGH' && secondLastPivot.type === 'LOW') {
    // Bullish impulse
    impulseSize = Math.abs(lastPivot.price - secondLastPivot.price);
    
    if (thirdLastPivot.type === 'HIGH') {
      pullbackSize = Math.abs(thirdLastPivot.price - fourthLastPivot.price);
    }
    
    numberOfBars = lastPivot.index - secondLastPivot.index;
    currentATR = atrValues[lastPivot.index] || atrValues[atrValues.length - 1];
  } else if (lastPivot.type === 'LOW' && secondLastPivot.type === 'HIGH') {
    // Bearish impulse
    impulseSize = Math.abs(secondLastPivot.price - lastPivot.price);
    
    if (thirdLastPivot.type === 'LOW') {
      pullbackSize = Math.abs(fourthLastPivot.price - thirdLastPivot.price);
    }
    
    numberOfBars = lastPivot.index - secondLastPivot.index;
    currentATR = atrValues[lastPivot.index] || atrValues[atrValues.length - 1];
  } else {
    return 0;
  }

  if (numberOfBars === 0 || currentATR === 0) {
    return 0;
  }

  // Calculate metrics
  const impulseRatio = pullbackSize > 0 ? impulseSize / pullbackSize : 0;
  const velocity = impulseSize / numberOfBars;
  const normalizedImpulse = impulseSize / currentATR;

  // Combine metrics into score (0-100)
  // Weighted combination
  const ratioScore = Math.min(impulseRatio * 20, 40); // Max 40 points
  const velocityScore = Math.min(velocity / currentATR * 30, 30); // Max 30 points
  const normalizedScore = Math.min(normalizedImpulse * 10, 30); // Max 30 points

  const totalScore = ratioScore + velocityScore + normalizedScore;
  
  // Clamp to 0-100
  return Math.max(0, Math.min(100, totalScore));
}
