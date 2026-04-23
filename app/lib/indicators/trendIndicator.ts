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

// ─── Helpers for trend scoring ───

function computeSlopePercent(series: number[], candles: number): number {
  if (series.length < 2) return 0;
  const period = Math.min(candles, series.length - 1);
  const endIndex = series.length - 1;
  const startIndex = Math.max(0, endIndex - period);
  const start = series[startIndex];
  const end = series[endIndex];
  if (start === 0) return 0;
  return ((end - start) / start) * 100;
}

interface SwingPoint {
  index: number;
  price: number;
}

function findSwingPoints(
  closes: number[],
  lookback: number
): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  if (closes.length < 5) return { highs, lows };

  const start = Math.max(2, closes.length - lookback);
  const end = closes.length - 2;

  for (let i = start; i < end; i++) {
    const c0 = closes[i - 2];
    const c1 = closes[i - 1];
    const c2 = closes[i];
    const c3 = closes[i + 1];
    const c4 = closes[i + 2];

    const isHigh = c2 > c1 && c2 > c3 && c2 >= c0 && c2 >= c4;
    const isLow = c2 < c1 && c2 < c3 && c2 <= c0 && c2 <= c4;

    if (isHigh) highs.push({ index: i, price: c2 });
    if (isLow) lows.push({ index: i, price: c2 });
  }

  return { highs, lows };
}

type StructureBias = 'UP' | 'DOWN' | 'NEUTRAL';

function getStructureBias(
  highs: SwingPoint[],
  lows: SwingPoint[]
): StructureBias {
  const recentHighs = highs.slice(-6);
  const recentLows = lows.slice(-6);

  let hh = 0;
  let lh = 0;
  for (let i = 1; i < recentHighs.length; i++) {
    if (recentHighs[i].price > recentHighs[i - 1].price) hh++;
    else if (recentHighs[i].price < recentHighs[i - 1].price) lh++;
  }

  let hl = 0;
  let ll = 0;
  for (let i = 1; i < recentLows.length; i++) {
    if (recentLows[i].price > recentLows[i - 1].price) hl++;
    else if (recentLows[i].price < recentLows[i - 1].price) ll++;
  }

  const upScore = hh + hl;
  const downScore = ll + lh;

  if (upScore >= 3 && upScore >= downScore + 1) return 'UP';
  if (downScore >= 3 && downScore >= upScore + 1) return 'DOWN';
  return 'NEUTRAL';
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

  // EMA slopes: short and long horizon (percentage)
  const slopeShort = computeSlopePercent(ema20, 10);
  const slopeLong = computeSlopePercent(ema20, 50);

  // Calculate volume average (SMA50 of volume)
  const volumeSMA50 = calculateSMA(volumes, 50);
  const volumeAverage = volumeSMA50.length > 0 ? volumeSMA50[volumeSMA50.length - 1] : 0;
  const currentVolume = volumes[volumes.length - 1];
  const volumeRatio = volumeAverage > 0 ? currentVolume / volumeAverage : 1;

  // Swing structure (higher highs / higher lows vs lower highs / lower lows)
  const swingWindow = Math.min(closes.length, 200);
  const recentCloses = closes.slice(-swingWindow);
  const { highs, lows } = findSwingPoints(recentCloses, swingWindow);
  const structureBias = getStructureBias(highs, lows);

  // Determine trend
  let trend: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS' = 'SIDEWAYS';
  let action: 'BUY_ALLOWED' | 'NO_BUY' = 'NO_BUY';
  let confidence = 50;

  // Scores from EMAs and slopes
  let emaUpScore = 0;
  let emaDownScore = 0;

  if (currentEMA20 > currentEMA50) emaUpScore += 2;
  if (currentEMA50 > currentEMA200) emaUpScore += 1;
  if (currentEMA20 < currentEMA50) emaDownScore += 2;
  if (currentEMA50 < currentEMA200) emaDownScore += 1;

  if (slopeShort > 0.15) emaUpScore += 1;
  if (slopeShort < -0.15) emaDownScore += 1;
  if (slopeLong > 0.3) emaUpScore += 2;
  if (slopeLong < -0.3) emaDownScore += 2;

  // Scores from swing structure
  let structureUpScore = 0;
  let structureDownScore = 0;
  if (structureBias === 'UP') structureUpScore += 3;
  else if (structureBias === 'DOWN') structureDownScore += 3;

  const upTotal = emaUpScore + structureUpScore;
  const downTotal = emaDownScore + structureDownScore;

  const emaSpread = Math.abs(currentEMA20 - currentEMA50) / currentPrice;

  // Decide trend based on combined scores
  if (upTotal >= 3 && upTotal >= downTotal + 1) {
    trend = 'UPTREND';
    action = 'BUY_ALLOWED';
  } else if (downTotal >= 3 && downTotal >= upTotal + 1) {
    trend = 'DOWNTREND';
    action = 'NO_BUY';
  } else {
    // SIDEWAYS: flat EMAs and neutral structure
    const flatSlope = Math.abs(slopeLong) < 0.2 && Math.abs(slopeShort) < 0.1;
    const noStructureBias = structureBias === 'NEUTRAL';
    if (flatSlope && noStructureBias && emaSpread < 0.002) {
      trend = 'SIDEWAYS';
      action = 'NO_BUY';
    } else if (upTotal > downTotal) {
      trend = 'UPTREND';
      action = 'BUY_ALLOWED';
    } else if (downTotal > upTotal) {
      trend = 'DOWNTREND';
      action = 'NO_BUY';
    } else {
      trend = 'SIDEWAYS';
      action = 'NO_BUY';
    }
  }

  // Confidence
  if (trend === 'UPTREND') {
    let conf = 60;
    conf += emaUpScore * 5;
    if (structureBias === 'UP') conf += 10;
    if (volumeRatio > 1.0) conf += 5;
    if (volumeRatio < 0.7) conf -= 5;
    if (emaSpread < 0.0005) conf -= 10;
    confidence = Math.max(40, Math.min(100, conf));
  } else if (trend === 'DOWNTREND') {
    let conf = 60;
    conf += emaDownScore * 5;
    if (structureBias === 'DOWN') conf += 10;
    if (volumeRatio > 1.0) conf += 5;
    if (volumeRatio < 0.7) conf -= 5;
    if (emaSpread < 0.0005) conf -= 10;
    confidence = Math.max(40, Math.min(100, conf));
  } else {
    let conf = 50;
    if (emaSpread < 0.0005) conf = 40;
    confidence = conf;
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
      slope: slopeLong,
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
