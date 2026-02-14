import { Candle, SemaforPoint } from './types';

/**
 * Professional Semafor Indicator
 * Based on ZigZag algorithm with multiple period levels
 * Identifies swing highs/lows and generates buy/sell signals
 * 
 * Algorithm inspired by MetaTrader 4/5 Semafor implementations
 * Uses multiple depth levels for robust pivot detection
 */

interface ZigZagPoint {
  time: number;
  price: number;
  type: 'high' | 'low';
  barIndex: number;
}

/**
 * Calculate Semafor pivot points using ZigZag-based algorithm
 * 
 * @param candles - Array of candle data
 * @param depth - Depth parameter for ZigZag (default 5, typical: 5-12)
 * @param deviation - Minimum price deviation percentage (default 0.5%)
 * @param backstep - Minimum bars between pivots (default 3)
 * @returns Array of pivot points with strength ratings and signals
 */
export function calculateSemafor(
  candles: Candle[],
  depth: number = 5,
  deviation: number = 0.5,
  backstep: number = 3
): SemaforPoint[] {
  const points: SemaforPoint[] = [];
  
  // Safety checks
  if (!candles || !Array.isArray(candles) || candles.length === 0) {
    return points;
  }
  
  // Need minimum bars for calculation
  const minBars = Math.max(depth * 2 + backstep, 20);
  if (candles.length < minBars) {
    return points;
  }
  
  try {
    // Step 1: Calculate ZigZag points using multiple depth levels
    const zigzagPoints = calculateZigZag(candles, depth, deviation, backstep);
    
    if (zigzagPoints.length < 2) {
      return points;
    }
    
    // Step 2: Analyze each ZigZag point for strength and signals
    // Limit to prevent performance issues (max 100 points)
    const maxPoints = Math.min(zigzagPoints.length, 100);
    const pointMap = new Map<number, SemaforPoint>(); // Deduplicate by time
    
    for (let i = 0; i < maxPoints; i++) {
      const zzPoint = zigzagPoints[i];
      
      try {
        // Calculate pivot strength using multiple methods
        const strength = calculateAdvancedStrength(candles, zzPoint, zigzagPoints, i);
        
        // Calculate buy/sell signal with improved logic
        const signal = calculateAdvancedSignal(candles, zzPoint, zigzagPoints, i);
        
        // Include all points with strength >= 1 (show all pivots, not just signals)
        if (strength >= 1) {
          const newPoint: SemaforPoint = {
            time: zzPoint.time,
            price: zzPoint.price,
            type: zzPoint.type,
            strength: strength as 1 | 2 | 3,
            barIndex: zzPoint.barIndex,
            signal: signal.signal || undefined,
            signalStrength: signal.signal ? signal.strength : undefined
          };
          
          // Deduplicate: if point at same time exists, keep the stronger one
          const existingPoint = pointMap.get(zzPoint.time);
          if (!existingPoint) {
            pointMap.set(zzPoint.time, newPoint);
          } else {
            // Keep the point with higher strength or signal strength
            const existingStrength = existingPoint.signalStrength || existingPoint.strength;
            const newStrength = newPoint.signalStrength || newPoint.strength;
            if (newStrength > existingStrength) {
              pointMap.set(zzPoint.time, newPoint);
            } else if (newStrength === existingStrength && newPoint.signal && !existingPoint.signal) {
              // If same strength but new one has signal, prefer it
              pointMap.set(zzPoint.time, newPoint);
            }
          }
        }
      } catch (pointError) {
        // Skip this point if calculation fails
        console.warn('Error calculating point:', pointError);
        continue;
      }
    }
    
    // Convert map to array (already deduplicated)
    const deduplicatedPoints = Array.from(pointMap.values());
    points.push(...deduplicatedPoints);
  } catch (error) {
    console.error('Error in calculateSemafor:', error);
    return points; // Return empty array on error to prevent crash
  }
  
  return points;
}

/**
 * Calculate ZigZag points using depth and deviation
 * FIXED: Properly alternates between highs and lows
 */
function calculateZigZag(
  candles: Candle[],
  depth: number,
  deviation: number,
  backstep: number
): ZigZagPoint[] {
  const points: ZigZagPoint[] = [];
  let lastExtreme: { price: number; index: number; type: 'high' | 'low' } | null = null;
  let pendingExtreme: { price: number; index: number; type: 'high' | 'low' } | null = null;
  
  // Start from depth bars to have enough history
  for (let i = depth; i < candles.length - depth; i++) {
    const current = candles[i];
    
    // Find highest/lowest in the depth window
    let isHigh = true;
    let isLow = true;
    
    for (let j = i - depth; j <= i + depth; j++) {
      if (j !== i) {
        if (candles[j].high >= current.high) {
          isHigh = false;
        }
        if (candles[j].low <= current.low) {
          isLow = false;
        }
      }
    }
    
    // Check for high pivot
    if (isHigh) {
      const windowHigh = Math.max(...candles.slice(i - depth, i + depth + 1).map(c => c.high));
      if (current.high === windowHigh) {
        // If we have a pending extreme, check if we should confirm it
        if (pendingExtreme && pendingExtreme.type === 'low') {
          // Check deviation from pending low
          const deviationPercent = ((current.high - pendingExtreme.price) / pendingExtreme.price) * 100;
          if (deviationPercent >= deviation && (i - pendingExtreme.index) >= backstep) {
            // Confirm the pending low
            points.push({
              time: candles[pendingExtreme.index].time,
              price: pendingExtreme.price,
              type: pendingExtreme.type,
              barIndex: pendingExtreme.index
            });
            lastExtreme = pendingExtreme;
            pendingExtreme = { price: current.high, index: i, type: 'high' };
          } else if (current.high > pendingExtreme.price * (1 + deviation / 100)) {
            // New high is significantly higher, replace pending
            pendingExtreme = { price: current.high, index: i, type: 'high' };
          }
        } else if (!lastExtreme || lastExtreme.type === 'low') {
          // First point or alternating from low to high
          const deviationPercent = lastExtreme 
            ? ((current.high - lastExtreme.price) / lastExtreme.price) * 100
            : deviation + 1; // First point always passes
          
          if (deviationPercent >= deviation && (!lastExtreme || (i - lastExtreme.index) >= backstep)) {
            if (lastExtreme) {
              points.push({
                time: candles[lastExtreme.index].time,
                price: lastExtreme.price,
                type: lastExtreme.type,
                barIndex: lastExtreme.index
              });
            }
            lastExtreme = { price: current.high, index: i, type: 'high' };
            pendingExtreme = null;
          } else if (!pendingExtreme || current.high > pendingExtreme.price) {
            pendingExtreme = { price: current.high, index: i, type: 'high' };
          }
        }
      }
    }
    
    // Check for low pivot
    if (isLow) {
      const windowLow = Math.min(...candles.slice(i - depth, i + depth + 1).map(c => c.low));
      if (current.low === windowLow) {
        // If we have a pending extreme, check if we should confirm it
        if (pendingExtreme && pendingExtreme.type === 'high') {
          // Check deviation from pending high
          const deviationPercent = ((pendingExtreme.price - current.low) / pendingExtreme.price) * 100;
          if (deviationPercent >= deviation && (i - pendingExtreme.index) >= backstep) {
            // Confirm the pending high
            points.push({
              time: candles[pendingExtreme.index].time,
              price: pendingExtreme.price,
              type: pendingExtreme.type,
              barIndex: pendingExtreme.index
            });
            lastExtreme = pendingExtreme;
            pendingExtreme = { price: current.low, index: i, type: 'low' };
          } else if (current.low < pendingExtreme.price * (1 - deviation / 100)) {
            // New low is significantly lower, replace pending
            pendingExtreme = { price: current.low, index: i, type: 'low' };
          }
        } else if (!lastExtreme || lastExtreme.type === 'high') {
          // First point or alternating from high to low
          const deviationPercent = lastExtreme
            ? ((lastExtreme.price - current.low) / lastExtreme.price) * 100
            : deviation + 1; // First point always passes
          
          if (deviationPercent >= deviation && (!lastExtreme || (i - lastExtreme.index) >= backstep)) {
            if (lastExtreme) {
              points.push({
                time: candles[lastExtreme.index].time,
                price: lastExtreme.price,
                type: lastExtreme.type,
                barIndex: lastExtreme.index
              });
            }
            lastExtreme = { price: current.low, index: i, type: 'low' };
            pendingExtreme = null;
          } else if (!pendingExtreme || current.low < pendingExtreme.price) {
            pendingExtreme = { price: current.low, index: i, type: 'low' };
          }
        }
      }
    }
  }
  
  // Add the last confirmed extreme
  if (lastExtreme) {
    points.push({
      time: candles[lastExtreme.index].time,
      price: lastExtreme.type === 'high' ? candles[lastExtreme.index].high : candles[lastExtreme.index].low,
      type: lastExtreme.type,
      barIndex: lastExtreme.index
    });
  }
  
  // Add pending extreme if it's significant
  if (pendingExtreme && lastExtreme) {
    const deviationPercent = pendingExtreme.type === 'high'
      ? ((pendingExtreme.price - lastExtreme.price) / lastExtreme.price) * 100
      : ((lastExtreme.price - pendingExtreme.price) / lastExtreme.price) * 100;
    
    if (deviationPercent >= deviation) {
      points.push({
        time: candles[pendingExtreme.index].time,
        price: pendingExtreme.type === 'high' ? candles[pendingExtreme.index].high : candles[pendingExtreme.index].low,
        type: pendingExtreme.type,
        barIndex: pendingExtreme.index
      });
    }
  }
  
  return points;
}

/**
 * Advanced strength calculation using multiple factors:
 * 1. Price percentile ranking
 * 2. Volume confirmation
 * 3. Distance from moving average
 * 4. Number of touches (support/resistance strength)
 */
function calculateAdvancedStrength(
  candles: Candle[],
  point: ZigZagPoint,
  allPoints: ZigZagPoint[],
  pointIndex: number
): 1 | 2 | 3 {
  let strengthScore = 0;
  
  // Factor 1: Price percentile (0-30 points)
  const lookback = Math.min(50, point.barIndex);
  const start = Math.max(0, point.barIndex - lookback);
  const prices = candles.slice(start, point.barIndex + 1)
    .map(c => point.type === 'high' ? c.high : c.low);
  
  if (prices.length > 0) {
    const sorted = [...prices].sort((a, b) => point.type === 'high' ? b - a : a - b);
    const rank = sorted.indexOf(point.price);
    const percentile = rank / sorted.length;
    
    if (percentile < 0.05) strengthScore += 30;
    else if (percentile < 0.15) strengthScore += 20;
    else if (percentile < 0.30) strengthScore += 10;
  }
  
  // Factor 2: Volume confirmation (0-25 points)
  if (candles[point.barIndex]?.volume) {
    const avgVolume = candles.slice(start, point.barIndex + 1)
      .reduce((sum, c) => sum + (c.volume || 0), 0) / (point.barIndex - start + 1);
    const volumeRatio = (candles[point.barIndex].volume || 0) / (avgVolume || 1);
    
    if (volumeRatio > 1.5) strengthScore += 25;
    else if (volumeRatio > 1.2) strengthScore += 15;
    else if (volumeRatio > 1.0) strengthScore += 5;
  }
  
  // Factor 3: Distance from EMA (0-25 points)
  const emaPeriod = 20;
  if (point.barIndex >= emaPeriod) {
    try {
      const ema = calculateEMA(candles.slice(point.barIndex - emaPeriod, point.barIndex + 1), emaPeriod);
      const distance = Math.abs(point.price - ema) / (ema || 1) * 100;
      
      if (distance > 3) strengthScore += 25;
      else if (distance > 2) strengthScore += 15;
      else if (distance > 1) strengthScore += 5;
    } catch (e) {
      // Skip EMA calculation if it fails
    }
  }
  
  // Factor 4: Support/Resistance touches (0-20 points)
  const nearbyPoints = allPoints.filter(p => 
    Math.abs(p.barIndex - point.barIndex) <= 20 &&
    Math.abs(p.price - point.price) / (point.price || 1) < 0.01 // Within 1%
  );
  
  if (nearbyPoints.length >= 3) strengthScore += 20;
  else if (nearbyPoints.length >= 2) strengthScore += 10;
  
  // Convert score to strength level
  if (strengthScore >= 60) return 3;
  if (strengthScore >= 35) return 2;
  return 1;
}

/**
 * Advanced signal calculation with multiple confirmation factors
 * FIXED: Lower thresholds for crypto volatility
 */
function calculateAdvancedSignal(
  candles: Candle[],
  point: ZigZagPoint,
  allPoints: ZigZagPoint[],
  pointIndex: number
): { signal: 'BUY' | 'SELL' | null; strength: 1 | 2 | 3 } {
  const lookAhead = Math.min(10, candles.length - point.barIndex - 1);
  
  if (lookAhead < 3) {
    return { signal: null, strength: 1 };
  }
  
  const futureCandles = candles.slice(point.barIndex + 1, point.barIndex + 1 + lookAhead);
  
  if (point.type === 'high') {
    // SELL signal: price should drop after high
    const lowestPrice = Math.min(...futureCandles.map(c => c.low));
    const dropPercent = ((point.price - lowestPrice) / point.price) * 100;
    
    // Additional confirmation: check if price stays below pivot
    const closesBelow = futureCandles.filter(c => c.close < point.price * 0.998).length;
    const confirmationRatio = closesBelow / lookAhead;
    
    // Lower thresholds for crypto (more volatile)
    if (dropPercent > 1.0 && confirmationRatio > 0.5) {
      return { signal: 'SELL', strength: 3 };
    } else if (dropPercent > 0.5 && confirmationRatio > 0.4) {
      return { signal: 'SELL', strength: 2 };
    } else if (dropPercent > 0.2 && confirmationRatio > 0.3) {
      return { signal: 'SELL', strength: 1 };
    }
  } else {
    // BUY signal: price should rise after low
    const highestPrice = Math.max(...futureCandles.map(c => c.high));
    const risePercent = ((highestPrice - point.price) / point.price) * 100;
    
    // Additional confirmation: check if price stays above pivot
    const closesAbove = futureCandles.filter(c => c.close > point.price * 1.002).length;
    const confirmationRatio = closesAbove / lookAhead;
    
    // Lower thresholds for crypto (more volatile)
    if (risePercent > 1.0 && confirmationRatio > 0.5) {
      return { signal: 'BUY', strength: 3 };
    } else if (risePercent > 0.5 && confirmationRatio > 0.4) {
      return { signal: 'BUY', strength: 2 };
    } else if (risePercent > 0.2 && confirmationRatio > 0.3) {
      return { signal: 'BUY', strength: 1 };
    }
  }
  
  return { signal: null, strength: 1 };
}

/**
 * Calculate Exponential Moving Average
 */
function calculateEMA(candles: Candle[], period: number): number {
  if (candles.length === 0) return 0;
  
  const multiplier = 2 / (period + 1);
  let ema = candles[0].close;
  
  for (let i = 1; i < candles.length; i++) {
    ema = (candles[i].close - ema) * multiplier + ema;
  }
  
  return ema;
}

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
  
  // Find nearest resistance (first high above current price)
  const resistance = highs.find(h => h > currentPrice) || null;
  
  // Find nearest support (last low below current price)
  const support = [...lows].reverse().find(l => l < currentPrice) || null;
  
  return { support, resistance };
}
