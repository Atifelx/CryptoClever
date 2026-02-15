/**
 * Deep Analysis Runner
 * Main orchestrator for market structure analysis
 * Pure function, deterministic pipeline
 * Now integrates with Semafor signals for better accuracy
 */

import { Candle, AnalysisResult, TradingZone, MarketStructure, MarketRegime } from './types';
import { calculateATR } from './ATR';
import { detectPivots } from './StreamingPivotEngine';
import { classifyStructure } from './StructureClassifier';
import { calculateImpulseScore } from './ImpulseAnalyzer';
import { classifyRegime } from './RegimeClassifier';
import { aggregateConfidence } from './ConfidenceAggregator';
import { calculateSemafor } from '../indicators/semafor';
import { SemaforPoint } from '../indicators/types';

/**
 * Calculate trading zones with profit targets and stop loss
 * Only creates zones that haven't been hit yet (price hasn't reached target or stop)
 */
function calculateTradingZones(
  candles: Candle[],
  semaforPoints: SemaforPoint[],
  atrValues: number[],
  currentPrice: number,
  overallConfidence: number
): TradingZone[] {
  const zones: TradingZone[] = [];
  const currentATR = atrValues[atrValues.length - 1] || currentPrice * 0.02;
  
  // Get recent Semafor signals (last 20 points)
  const recentSignals = semaforPoints
    .filter(p => p.signal && p.barIndex >= candles.length - 50)
    .slice(-10);
  
  for (const signal of recentSignals) {
    if (!signal.signal) continue;
    
    const entryPrice = signal.price;
    const atrMultiplier = signal.signalStrength === 3 ? 2.5 : signal.signalStrength === 2 ? 2.0 : 1.5;
    
    // Calculate signal confidence based on:
    // 1. Signal strength (1-3) = base 20-60%
    // 2. Overall Core Engine confidence = multiplier (0.5x to 1.5x)
    // 3. Final confidence = base * multiplier, capped at 100%
    const baseConfidence = (signal.signalStrength || signal.strength) * 20; // 20%, 40%, 60%
    const confidenceMultiplier = 0.5 + (overallConfidence / 100) * 1.0; // 0.5x to 1.5x based on overall confidence
    const finalConfidence = Math.min(100, Math.round(baseConfidence * confidenceMultiplier));
    
    if (signal.signal === 'BUY') {
      // Buy zone: entry at support, profit target above, stop loss below
      const profitTarget = entryPrice + (currentATR * atrMultiplier);
      const stopLoss = entryPrice - (currentATR * 0.8);
      
      // Only include zone if:
      // 1. Price hasn't hit the target yet (currentPrice < profitTarget)
      // 2. Price hasn't hit the stop loss (currentPrice > stopLoss)
      // 3. Entry price is reasonable (within 5% of current price for active signals)
      const priceFromEntry = Math.abs(currentPrice - entryPrice) / entryPrice;
      const targetNotHit = currentPrice < profitTarget;
      const stopNotHit = currentPrice > stopLoss;
      const entryReasonable = priceFromEntry <= 0.05 || currentPrice >= entryPrice * 0.95; // Within 5% or price moved up from entry
      
      if (targetNotHit && stopNotHit && entryReasonable) {
        zones.push({
          type: 'BUY',
          entryPrice,
          profitTarget,
          stopLoss,
          confidence: finalConfidence,
          reasoning: `Strong BUY signal at support level. Target: ${profitTarget.toFixed(2)}, Stop: ${stopLoss.toFixed(2)}`,
          time: signal.time
        });
      }
    } else if (signal.signal === 'SELL') {
      // Sell zone: entry at resistance, profit target below, stop loss above
      const profitTarget = entryPrice - (currentATR * atrMultiplier);
      const stopLoss = entryPrice + (currentATR * 0.8);
      
      // Only include zone if:
      // 1. Price hasn't hit the target yet (currentPrice > profitTarget)
      // 2. Price hasn't hit the stop loss (currentPrice < stopLoss)
      // 3. Entry price is reasonable (within 5% of current price for active signals)
      const priceFromEntry = Math.abs(currentPrice - entryPrice) / entryPrice;
      const targetNotHit = currentPrice > profitTarget;
      const stopNotHit = currentPrice < stopLoss;
      const entryReasonable = priceFromEntry <= 0.05 || currentPrice <= entryPrice * 1.05; // Within 5% or price moved down from entry
      
      if (targetNotHit && stopNotHit && entryReasonable) {
        zones.push({
          type: 'SELL',
          entryPrice,
          profitTarget,
          stopLoss,
          confidence: finalConfidence,
          reasoning: `Strong SELL signal at resistance level. Target: ${profitTarget.toFixed(2)}, Stop: ${stopLoss.toFixed(2)}`,
          time: signal.time
        });
      }
    }
  }
  
  return zones;
}

/**
 * Generate reasoning for structure classification
 */
function generateReasoning(
  structure: MarketStructure,
  semaforPoints: SemaforPoint[],
  pivots: any[],
  impulseScore: number,
  regime: MarketRegime,
  zones: TradingZone[]
): string {
  const recentBuySignals = semaforPoints.filter(p => p.signal === 'BUY' && p.barIndex >= semaforPoints.length - 10).length;
  const recentSellSignals = semaforPoints.filter(p => p.signal === 'SELL' && p.barIndex >= semaforPoints.length - 10).length;
  
  let reasoning = '';
  
  // Primary structure reasoning
  if (structure === 'Bullish') {
    reasoning = `📈 BULLISH Structure: Higher highs and higher lows detected. `;
    if (recentBuySignals > recentSellSignals) {
      reasoning += `Semafor shows ${recentBuySignals} BUY signals vs ${recentSellSignals} SELL signals, confirming bullish momentum. `;
    }
  } else if (structure === 'Bearish') {
    reasoning = `📉 BEARISH Structure: Lower highs and lower lows detected. `;
    if (recentSellSignals > recentBuySignals) {
      reasoning += `Semafor shows ${recentSellSignals} SELL signals vs ${recentBuySignals} BUY signals, confirming bearish momentum. `;
    }
  } else {
    reasoning = `➡️ RANGE Structure: Market is consolidating. `;
    if (recentBuySignals === recentSellSignals) {
      reasoning += `Semafor shows balanced signals (${recentBuySignals} BUY, ${recentSellSignals} SELL). `;
    }
  }
  
  // Add regime context
  reasoning += `Regime: ${regime}. `;
  
  // Add impulse context
  if (impulseScore > 60) {
    reasoning += `Strong impulse (${impulseScore.toFixed(0)}/100). `;
  } else if (impulseScore < 40) {
    reasoning += `Weak impulse (${impulseScore.toFixed(0)}/100). `;
  }
  
  // Add zone summary
  if (zones.length > 0) {
    const buyZones = zones.filter(z => z.type === 'BUY').length;
    const sellZones = zones.filter(z => z.type === 'SELL').length;
    reasoning += `Found ${buyZones} BUY zones and ${sellZones} SELL zones with profit targets.`;
  }
  
  return reasoning;
}

/**
 * Run complete deep market structure analysis
 * 
 * Pipeline:
 * 1. Compute ATR
 * 2. Detect pivots (Core Engine)
 * 3. Calculate Semafor signals
 * 4. Classify structure (considering Semafor)
 * 5. Compute impulse score
 * 6. Detect regime
 * 7. Aggregate confidence
 * 8. Calculate trading zones
 * 9. Generate reasoning
 * 
 * @param candles - Array of candle data
 * @returns Complete analysis result with reasoning and zones
 */
export function runDeepAnalysis(candles: Candle[]): AnalysisResult {
  // Validate input
  if (!candles || candles.length < 20) {
    return {
      structure: 'Range',
      regime: 'RANGE',
      impulseScore: 0,
      confidence: 0,
      pivots: [],
      reasoning: 'Insufficient data for analysis (need at least 20 candles).',
      zones: []
    };
  }

  // Step 1: Compute ATR
  const atrValues = calculateATR(candles, 14);

  // Step 2: Detect pivots (Core Engine)
  const pivots = detectPivots(candles, atrValues);

  // Step 3: Calculate Semafor signals
  const semaforPoints = calculateSemafor(candles);

  // Step 4: Classify structure (considering Semafor signals)
  let structure = classifyStructure(pivots);
  
  // Prioritize Semafor signals - they are more accurate for crypto
  const recentBuySignals = semaforPoints.filter(p => p.signal === 'BUY' && p.barIndex >= candles.length - 30).length;
  const recentSellSignals = semaforPoints.filter(p => p.signal === 'SELL' && p.barIndex >= candles.length - 30).length;
  const totalRecentSignals = recentBuySignals + recentSellSignals;
  
  // If we have Semafor signals, prioritize them over Core Engine structure
  if (totalRecentSignals > 0) {
    const buyRatio = recentBuySignals / totalRecentSignals;
    const sellRatio = recentSellSignals / totalRecentSignals;
    
    // If Semafor clearly indicates direction (60%+ signals in one direction), trust it
    if (sellRatio >= 0.6) {
      // Strong bearish signals from Semafor
      structure = 'Bearish';
    } else if (buyRatio >= 0.6) {
      // Strong bullish signals from Semafor
      structure = 'Bullish';
    } else if (recentSellSignals > recentBuySignals && recentSellSignals >= 2) {
      // More sell signals than buy signals, and at least 2 sell signals
      structure = 'Bearish';
    } else if (recentBuySignals > recentSellSignals && recentBuySignals >= 2) {
      // More buy signals than sell signals, and at least 2 buy signals
      structure = 'Bullish';
    }
    // If signals are balanced or too few, keep the Core Engine structure
  }

  // Step 5: Compute impulse score
  const impulseScore = calculateImpulseScore(candles, pivots, atrValues);

  // Step 6: Detect regime
  const regime = classifyRegime(candles, pivots, atrValues);

  // Step 7: Aggregate confidence
  const confidence = aggregateConfidence(structure, impulseScore, regime);

  // Step 8: Calculate trading zones (pass overall confidence to align signal confidence)
  const currentPrice = candles[candles.length - 1].close;
  const zones = calculateTradingZones(candles, semaforPoints, atrValues, currentPrice, confidence);

  // Step 9: Generate reasoning
  const reasoning = generateReasoning(structure, semaforPoints, pivots, impulseScore, regime, zones);

  return {
    structure,
    regime,
    impulseScore,
    confidence,
    pivots,
    reasoning,
    zones
  };
}
