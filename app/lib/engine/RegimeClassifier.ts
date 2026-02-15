/**
 * Market Regime Classifier
 * Detects expansion, compression, trend, or range
 * Pure function, deterministic
 */

import { Candle, Pivot, MarketRegime } from './types';

/**
 * Calculate rolling standard deviation
 */
function calculateStdDev(values: number[], period: number): number {
  if (values.length < period) {
    return 0;
  }

  const slice = values.slice(-period);
  const mean = slice.reduce((sum, val) => sum + val, 0) / slice.length;
  const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / slice.length;
  
  return Math.sqrt(variance);
}

/**
 * Classify market regime
 * 
 * Uses:
 * 1. ATR slope (difference over last N bars)
 * 2. Swing amplitude contraction
 * 3. Rolling std deviation
 * 
 * @param candles - Array of candle data
 * @param pivots - Array of confirmed pivots
 * @param atrValues - Array of ATR values
 * @returns Market regime classification
 */
export function classifyRegime(
  candles: Candle[],
  pivots: Pivot[],
  atrValues: number[]
): MarketRegime {
  if (candles.length < 20 || atrValues.length < 20) {
    return 'RANGE';
  }

  const lookback = Math.min(20, Math.floor(candles.length / 2));

  // 1. ATR slope analysis
  const recentATRs = atrValues.slice(-lookback);
  const olderATRs = atrValues.slice(-lookback * 2, -lookback);
  
  const recentATRMean = recentATRs.reduce((sum, val) => sum + val, 0) / recentATRs.length;
  const olderATRMean = olderATRs.length > 0 
    ? olderATRs.reduce((sum, val) => sum + val, 0) / olderATRs.length 
    : recentATRMean;
  
  const atrSlope = recentATRMean - olderATRMean;
  const atrSlopePercent = olderATRMean > 0 ? (atrSlope / olderATRMean) * 100 : 0;

  // 2. Swing amplitude analysis
  let swingContraction = 0;
  if (pivots.length >= 4) {
    const recentPivots = pivots.slice(-4);
    const recentAmplitudes: number[] = [];
    
    for (let i = 1; i < recentPivots.length; i++) {
      const amplitude = Math.abs(recentPivots[i].price - recentPivots[i - 1].price);
      recentAmplitudes.push(amplitude);
    }
    
    if (recentAmplitudes.length >= 2) {
      const lastAmplitude = recentAmplitudes[recentAmplitudes.length - 1];
      const previousAmplitude = recentAmplitudes[recentAmplitudes.length - 2];
      
      if (previousAmplitude > 0) {
        swingContraction = ((previousAmplitude - lastAmplitude) / previousAmplitude) * 100;
      }
    }
  }

  // 3. Rolling std deviation
  const closes = candles.slice(-lookback).map(c => c.close);
  const stdDev = calculateStdDev(closes, lookback);
  const meanPrice = closes.reduce((sum, val) => sum + val, 0) / closes.length;
  const stdDevPercent = meanPrice > 0 ? (stdDev / meanPrice) * 100 : 0;

  // Classification logic
  const isExpanding = atrSlopePercent > 5 && swingContraction < -10;
  const isCompressing = atrSlopePercent < -5 && swingContraction > 10;
  const isTrending = Math.abs(atrSlopePercent) > 3 && stdDevPercent > 1 && Math.abs(swingContraction) < 5;
  const isRanging = stdDevPercent < 0.5 && Math.abs(atrSlopePercent) < 2;

  if (isExpanding) {
    return 'EXPANSION';
  }

  if (isCompressing) {
    return 'COMPRESSION';
  }

  if (isTrending) {
    return 'TREND';
  }

  return 'RANGE';
}
