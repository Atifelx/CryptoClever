/**
 * Confidence Aggregator
 * Combines multiple signals into a single confidence score
 * Pure function, deterministic
 */

import { MarketStructure, MarketRegime } from './types';

/**
 * Aggregate confidence from multiple signals
 * 
 * Weights:
 * - Structure: 40%
 * - ImpulseScore: 30%
 * - Regime alignment: 30%
 * 
 * @param structure - Market structure classification
 * @param impulseScore - Impulse score (0-100)
 * @param regime - Market regime classification
 * @returns Confidence score (0-100)
 */
export function aggregateConfidence(
  structure: MarketStructure,
  impulseScore: number,
  regime: MarketRegime
): number {
  // Structure contribution (40%)
  let structureScore = 0;
  if (structure === 'Bullish' || structure === 'Bearish') {
    structureScore = 40; // Full points for clear structure
  } else {
    structureScore = 20; // Half points for range
  }

  // Impulse score contribution (30%)
  const impulseContribution = (impulseScore / 100) * 30;

  // Regime alignment contribution (30%)
  let regimeScore = 0;
  if (regime === 'TREND' || regime === 'EXPANSION') {
    // High confidence for trending/expanding markets
    if (structure !== 'Range') {
      regimeScore = 30; // Full alignment
    } else {
      regimeScore = 15; // Partial alignment
    }
  } else if (regime === 'COMPRESSION') {
    // Lower confidence during compression
    regimeScore = 10;
  } else {
    // Range regime
    if (structure === 'Range') {
      regimeScore = 20; // Alignment with range structure
    } else {
      regimeScore = 10; // Mismatch
    }
  }

  // Total confidence
  const totalConfidence = structureScore + impulseContribution + regimeScore;

  // Clamp to 0-100
  return Math.max(0, Math.min(100, totalConfidence));
}
