/**
 * Trend Indicator
 * 
 * Identifies trend from candle data using EMA(20), EMA(50), EMA(200) and volume analysis.
 * Shows visual trend lines for up and down trends.
 */

import type { Candle } from '../../store/candlesStore';

export interface TrendInfo {
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
  action: 'BUY_ALLOWED' | 'NO_BUY';
  confidence: number; // 0-100
  details: {
    ema20: number;
    ema50: number;
    ema200: number;
    currentPrice: number;
    slope: number; // EMA20 slope over last 10 candles (%)
    volumeRatio: number; // Current volume / average volume
    volumeAverage: number;
  };
}

export interface TrendMarker {
  time: number;
  price: number;
  trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
  action: 'BUY_ALLOWED' | 'NO_BUY';
  confidence: number;
}

// ─── Helper: Calculate EMA ───
function calculateEMA(data: number[], period: number): number[] {
  if (data.length === 0) return [];
  
  const multiplier = 2 / (period + 1);
  const ema: number[] = [data[0]];

  for (let i = 1; i < data.length; i++) {
    const value = (data[i] - ema[i - 1]) * multiplier + ema[i - 1];
    ema.push(value);
  }

  return ema;
}

// ─── Helper: Calculate SMA ───
function calculateSMA(data: number[], period: number): number[] {
  if (data.length < period) return [];
  
  const sma: number[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma.push(sum / period);
  }
  return sma;
}

/**
 * Identify trend from candle data
 * @param candles Array of candles (needs at least 200 candles for EMA200)
 * @returns TrendInfo with trend, action, confidence, and details
 */
export function identifyTrendWithVolume(candles: Candle[]): TrendInfo | null {
  if (candles.length < 200) {
    return null; // Need at least 200 candles for EMA200
  }

  // Use last 1000 candles if available, otherwise use all
  const data = candles.length > 1000 ? candles.slice(-1000) : candles;
  
  // Extract arrays
  const closes = data.map(c => c.close);
  const volumes = data.map(c => c.volume || 0);
  const currentPrice = closes[closes.length - 1];

  // Calculate EMAs
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);

  // Get current EMA values (last element)
  const currentEMA20 = ema20[ema20.length - 1];
  const currentEMA50 = ema50[ema50.length - 1];
  const currentEMA200 = ema200[ema200.length - 1];

  // Calculate EMA20 slope over last 10 candles
  const slopePeriod = Math.min(10, ema20.length - 1);
  const slopeStart = ema20.length - slopePeriod - 1;
  const slopeEnd = ema20.length - 1;
  
  let slope = 0;
  if (slopeStart >= 0 && slopeEnd > slopeStart) {
    const startValue = ema20[slopeStart];
    const endValue = ema20[slopeEnd];
    slope = ((endValue - startValue) / startValue) * 100; // Percentage change
  }

  // Calculate volume average (SMA50 of volume)
  const volumeSMA50 = calculateSMA(volumes, 50);
  const volumeAverage = volumeSMA50.length > 0 ? volumeSMA50[volumeSMA50.length - 1] : 0;
  const currentVolume = volumes[volumes.length - 1];
  const volumeRatio = volumeAverage > 0 ? currentVolume / volumeAverage : 1;

  // Determine trend
  let trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' = 'SIDEWAYS';
  let action: 'BUY_ALLOWED' | 'NO_BUY' = 'NO_BUY';
  let confidence = 50;

  // UPTREND: EMA20 > EMA50 > EMA200 AND price > EMA20 AND volume > 80% of average
  const isUptrend = 
    currentEMA20 > currentEMA50 && 
    currentEMA50 > currentEMA200 && 
    currentPrice > currentEMA20 &&
    volumeRatio > 0.8;

  // DOWNTREND: EMA20 < EMA50 < EMA200 AND price < EMA20
  const isDowntrend = 
    currentEMA20 < currentEMA50 && 
    currentEMA50 < currentEMA200 && 
    currentPrice < currentEMA20;

  if (isUptrend) {
    trend = 'UPTREND';
    action = 'BUY_ALLOWED';
    
    // Calculate confidence based on slope and volume
    let conf = 70; // Base confidence
    if (slope > 0.5) conf += 15; // Strong slope
    if (slope > 1.0) conf += 10; // Very strong slope
    if (volumeRatio > 1.0) conf += 5; // Above average volume
    confidence = Math.min(100, conf);
  } else if (isDowntrend) {
    trend = 'DOWNTREND';
    action = 'NO_BUY';
    
    // Calculate confidence for downtrend
    let conf = 70; // Base confidence
    if (slope < -0.5) conf += 15; // Strong negative slope
    if (slope < -1.0) conf += 10; // Very strong negative slope
    confidence = Math.min(100, conf);
  } else {
    // SIDEWAYS: EMAs are tangled or flat
    trend = 'SIDEWAYS';
    action = 'NO_BUY';
    
    // Lower confidence for sideways
    confidence = 50;
    
    // Check if EMAs are very close (flat)
    const emaSpread = Math.abs(currentEMA20 - currentEMA50) / currentPrice;
    if (emaSpread < 0.01) { // Less than 1% spread
      confidence = 40; // Very flat
    }
  }

  return {
    trend,
    action,
    confidence,
    details: {
      ema20: currentEMA20,
      ema50: currentEMA50,
      ema200: currentEMA200,
      currentPrice,
      slope,
      volumeRatio,
      volumeAverage,
    },
  };
}

/**
 * Generate trend markers for chart visualization
 * Creates markers at key trend points (when trend changes)
 */
export function generateTrendMarkers(candles: Candle[]): TrendMarker[] {
  if (candles.length < 200) return [];

  const markers: TrendMarker[] = [];
  const windowSize = 200; // Analyze in windows of 200 candles
  
  // Analyze last 1000 candles in overlapping windows to detect trend changes
  const startIndex = Math.max(0, candles.length - 1000);
  const endIndex = candles.length;
  
  let lastTrend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' | null = null;
  
  // Check every 50 candles for trend changes
  for (let i = startIndex + windowSize; i < endIndex; i += 50) {
    const window = candles.slice(Math.max(0, i - windowSize), i);
    const trendInfo = identifyTrendWithVolume(window);
    
    if (!trendInfo) continue;
    
    // Only add marker if trend changed
    if (lastTrend !== null && lastTrend !== trendInfo.trend) {
      const candle = candles[i - 1]; // Last candle in window
      markers.push({
        time: candle.time,
        price: candle.close,
        trend: trendInfo.trend,
        action: trendInfo.action,
        confidence: trendInfo.confidence,
      });
    }
    
    lastTrend = trendInfo.trend;
  }
  
  // Always add current trend marker
  const currentTrendInfo = identifyTrendWithVolume(candles);
  if (currentTrendInfo && candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    markers.push({
      time: lastCandle.time,
      price: lastCandle.close,
      trend: currentTrendInfo.trend,
      action: currentTrendInfo.action,
      confidence: currentTrendInfo.confidence,
    });
  }
  
  return markers;
}

/**
 * Get current trend display item (for chart rendering)
 * Returns a single item showing current trend status
 */
export function getTrendDisplayItem(candles: Candle[]): TrendMarker | null {
  if (candles.length < 200) return null;
  
  const trendInfo = identifyTrendWithVolume(candles);
  if (!trendInfo) return null;
  
  const lastCandle = candles[candles.length - 1];
  return {
    time: lastCandle.time,
    price: lastCandle.close,
    trend: trendInfo.trend,
    action: trendInfo.action,
    confidence: trendInfo.confidence,
  };
}
