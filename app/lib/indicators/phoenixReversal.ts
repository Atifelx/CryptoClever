/**
 * Swing Point Reversal Indicator (Phoenix Style)
 * 
 * Detects swing high/low reversals and marks trading zones with:
 * - Entry zones (green boxes)
 * - Target zones
 * - Market Structure Breaks (MSB)
 * - Stop loss levels
 */

import type { Candle } from '../../store/candlesStore';

export interface SwingPoint {
  time: number;
  price: number;
  type: 'high' | 'low';
  index: number;
}

export interface ReversalZone {
  id: string;
  type: 'BUY' | 'SELL';
  entryPrice: number;
  entryTime: number;
  targetPrice: number;
  stopLoss: number;
  label: string; // "BUY", "SELL", "MSB", "MESS"
  zoneTop: number;
  zoneBottom: number;
  confidence: number;
  structure: 'MSB' | 'REVERSAL' | 'BREAKOUT'; // Market Structure types
}

export interface SwingConnection {
  from: SwingPoint;
  to: SwingPoint;
  type: 'structure' | 'reversal';
}

export interface PhoenixIndicatorResult {
  swingPoints: SwingPoint[];
  zones: ReversalZone[];
  connections: SwingConnection[];
}

/**
 * Detect swing highs and lows using a lookback window
 * SIMPLIFIED: Use consistent lookback, no complex logic
 */
function detectSwingPoints(candles: Candle[], lookback: number = 3): SwingPoint[] {
  const points: SwingPoint[] = [];
  
  // Simple swing detection: only need 1-2 candles on right side
  for (let i = lookback; i < candles.length - 1; i++) {
    const current = candles[i];
    let isHigh = true;
    let isLow = true;
    
    // Check lookback candles on left
    for (let j = i - lookback; j < i; j++) {
      if (candles[j].high >= current.high) isHigh = false;
      if (candles[j].low <= current.low) isLow = false;
    }
    
    // Check 1 candle on right (for confirmation)
    if (candles[i + 1].high > current.high) isHigh = false;
    if (candles[i + 1].low < current.low) isLow = false;
    
    if (isHigh) {
      points.push({
        time: current.time,
        price: current.high,
        type: 'high',
        index: i,
      });
    }
    
    if (isLow) {
      points.push({
        time: current.time,
        price: current.low,
        type: 'low',
        index: i,
      });
    }
  }
  
  return points;
}

/**
 * Detect Market Structure Breaks (MSB)
 * A break occurs when price closes beyond the previous swing high/low
 */
function detectMarketStructureBreaks(
  candles: Candle[],
  swingPoints: SwingPoint[]
): { index: number; type: 'bullish' | 'bearish'; price: number }[] {
  const breaks: { index: number; type: 'bullish' | 'bearish'; price: number }[] = [];
  
  let lastSwingHigh: SwingPoint | null = null;
  let lastSwingLow: SwingPoint | null = null;
  
  for (const point of swingPoints) {
    if (point.type === 'high') {
      // Check if we broke the previous swing low (bullish MSB)
      if (lastSwingLow && point.index > lastSwingLow.index) {
        const breakCandle = candles[point.index];
        if (breakCandle.close > lastSwingLow.price) {
          breaks.push({
            index: point.index,
            type: 'bullish',
            price: lastSwingLow.price,
          });
        }
      }
      lastSwingHigh = point;
    } else {
      // Check if we broke the previous swing high (bearish MSB)
      if (lastSwingHigh && point.index > lastSwingHigh.index) {
        const breakCandle = candles[point.index];
        if (breakCandle.close < lastSwingHigh.price) {
          breaks.push({
            index: point.index,
            type: 'bearish',
            price: lastSwingHigh.price,
          });
        }
      }
      lastSwingLow = point;
    }
  }
  
  return breaks;
}

/**
 * Create reversal zones around swing points
 */
function createReversalZones(
  candles: Candle[],
  swingPoints: SwingPoint[],
  msBreaks: { index: number; type: 'bullish' | 'bearish'; price: number }[]
): ReversalZone[] {
  const zones: ReversalZone[] = [];
  const atr = calculateATR(candles, 14);
  const avgATR = atr[atr.length - 1] || 0;
  
  // Create zones for swing points
  for (let i = 0; i < swingPoints.length - 1; i++) {
    const current = swingPoints[i];
    const next = swingPoints[i + 1];
    
    // Only create zones for alternating swing points (high->low or low->high)
    if (current.type === next.type) continue;
    
    const isBuyZone = current.type === 'low';
    const zoneHeight = avgATR * 0.5; // Zone height = 50% of ATR
    
    if (isBuyZone) {
      // BUY zone at swing low
      const entry = current.price;
      const target = next.price; // Target at next swing high
      const stop = entry - avgATR * 1.5;
      
      zones.push({
        id: `zone-${current.time}-buy`,
        type: 'BUY',
        entryPrice: entry,
        entryTime: current.time,
        targetPrice: target,
        stopLoss: stop,
        label: 'BUY',
        zoneTop: entry + zoneHeight,
        zoneBottom: entry - zoneHeight,
        confidence: 70, // Lower confidence for regular swing reversals
        structure: 'REVERSAL',
      });
    } else {
      // SELL zone at swing high
      const entry = current.price;
      const target = next.price; // Target at next swing low
      const stop = entry + avgATR * 1.5;
      
      zones.push({
        id: `zone-${current.time}-sell`,
        type: 'SELL',
        entryPrice: entry,
        entryTime: current.time,
        targetPrice: target,
        stopLoss: stop,
        label: 'SELL',
        zoneTop: entry + zoneHeight,
        zoneBottom: entry - zoneHeight,
        confidence: 70, // Lower confidence for regular swing reversals
        structure: 'REVERSAL',
      });
    }
  }
  
  // Create zones for Market Structure Breaks
  for (const msb of msBreaks) {
    const candle = candles[msb.index];
    const isBullish = msb.type === 'bullish';
    const zoneHeight = avgATR * 0.3;
    
    zones.push({
      id: `zone-${candle.time}-msb`,
      type: isBullish ? 'BUY' : 'SELL',
      entryPrice: msb.price,
      entryTime: candle.time,
      targetPrice: isBullish ? msb.price + avgATR * 2 : msb.price - avgATR * 2,
      stopLoss: isBullish ? msb.price - avgATR : msb.price + avgATR,
      label: 'MSB',
      zoneTop: msb.price + zoneHeight,
      zoneBottom: msb.price - zoneHeight,
      confidence: 90, // Higher confidence for MSB
      structure: 'MSB',
    });
  }
  
  return zones;
}

/**
 * Create connections between swing points to show structure
 */
function createConnections(swingPoints: SwingPoint[]): SwingConnection[] {
  const connections: SwingConnection[] = [];
  
  for (let i = 0; i < swingPoints.length - 1; i++) {
    const current = swingPoints[i];
    const next = swingPoints[i + 1];
    
    // Connect alternating swing points
    if (current.type !== next.type) {
      connections.push({
        from: current,
        to: next,
        type: 'structure',
      });
    }
  }
  
  return connections;
}

/**
 * Calculate ATR (Average True Range) for zone sizing
 */
function calculateATR(candles: Candle[], period: number = 14): number[] {
  const atr: number[] = [];
  const trueRanges: number[] = [];
  
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    
    trueRanges.push(tr);
  }
  
  // Simple moving average of TR
  for (let i = 0; i < trueRanges.length; i++) {
    if (i < period - 1) {
      atr.push(trueRanges[i]);
    } else {
      const sum = trueRanges.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      atr.push(sum / period);
    }
  }
  
  return atr;
}

/**
 * Main function: Calculate Phoenix Indicator (Swing Point Reversal)
 * SIMPLIFIED: Focus on recent, strong reversals only
 * 
 * @param candles - Array of candles
 * @param lookback - Lookback period for swing detection (default 3)
 * @returns Phoenix indicator result with zones, swing points, and connections
 */
export function calculatePhoenixIndicator(
  candles: Candle[],
  lookback: number = 3
): PhoenixIndicatorResult {
  if (!candles || candles.length < 50) {
    return { swingPoints: [], zones: [], connections: [] };
  }
  
  try {
    // SIMPLIFIED: Only process last 200 candles for speed and relevance
    const data = candles.length > 200 ? candles.slice(-200) : candles;
    
    // 1. Detect swing points with HIGHER threshold
    const allSwingPoints = detectSwingPoints(data, lookback);
    
    // FILTER: Only keep strong swings (at least 0.5% move from previous swing)
    const strongSwings: SwingPoint[] = [];
    let lastPrice = 0;
    
    for (const point of allSwingPoints) {
      if (lastPrice === 0) {
        strongSwings.push(point);
        lastPrice = point.price;
        continue;
      }
      
      const changePercent = Math.abs((point.price - lastPrice) / lastPrice) * 100;
      if (changePercent >= 0.5) { // At least 0.5% move
        strongSwings.push(point);
        lastPrice = point.price;
      }
    }
    
    console.log(`[Phoenix] Found ${allSwingPoints.length} swings → filtered to ${strongSwings.length} strong swings`);
    
    // 2. Detect Market Structure Breaks (MSB) - these are HIGH priority
    const msBreaks = detectMarketStructureBreaks(data, strongSwings);
    
    // 3. Create reversal zones ONLY for recent swings
    const allZones = createReversalZones(data, strongSwings, msBreaks);
    
    // 4. FILTER: Only show zones from last 50 candles
    const recentTime = data[data.length - 1].time - (3600 * 50); // Last 50 hours
    const recentZones = allZones.filter(z => z.entryTime >= recentTime);
    
    // 5. Sort by time (newest first), then take top 5
    const sortedByTime = recentZones.sort((a, b) => b.entryTime - a.entryTime);
    const finalZones = sortedByTime.slice(0, 5); // ONLY 5 most recent zones
    
    console.log(`[Phoenix] ${allZones.length} total zones → ${recentZones.length} recent → showing ${finalZones.length} newest`);
    
    // 6. Create connections
    const connections = createConnections(strongSwings);
    
    return {
      swingPoints: strongSwings,
      zones: finalZones,
      connections,
    };
  } catch (error) {
    console.error('[Phoenix] Error calculating indicator:', error);
    return { swingPoints: [], zones: [], connections: [] };
  }
}
