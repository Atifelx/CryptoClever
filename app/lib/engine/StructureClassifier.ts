/**
 * Market Structure Classifier
 * Determines bullish, bearish, or range structure
 * Pure function, deterministic
 */

import { Pivot, MarketStructure } from './types';

/**
 * Classify market structure based on pivot sequence
 * 
 * Bullish: lastHigh > previousHigh AND lastLow > previousLow
 * Bearish: lastHigh < previousHigh AND lastLow < previousLow
 * Range: Otherwise
 * 
 * @param pivots - Array of confirmed pivots
 * @returns Market structure classification
 */
export function classifyStructure(pivots: Pivot[]): MarketStructure {
  if (pivots.length < 4) {
    return 'Range';
  }

  // Get last two highs and last two lows
  const highs = pivots.filter(p => p.type === 'HIGH').slice(-2);
  const lows = pivots.filter(p => p.type === 'LOW').slice(-2);

  if (highs.length < 2 || lows.length < 2) {
    return 'Range';
  }

  const lastHigh = highs[highs.length - 1];
  const previousHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const previousLow = lows[lows.length - 2];

  // Check for bullish structure
  const isBullish = lastHigh.price > previousHigh.price && 
                    lastLow.price > previousLow.price;

  // Check for bearish structure
  const isBearish = lastHigh.price < previousHigh.price && 
                    lastLow.price < previousLow.price;

  if (isBullish) {
    return 'Bullish';
  }

  if (isBearish) {
    return 'Bearish';
  }

  return 'Range';
}
