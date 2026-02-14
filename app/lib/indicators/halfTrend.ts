import { Candle } from './types';

export interface HalfTrendResult {
  trend: 'up' | 'down';
  trendLine: number;
  atr: number;
  buySignal: boolean;
  sellSignal: boolean;
  time: number;
}

/**
 * Calculate Average True Range (ATR)
 */
function calculateATR(candles: Candle[], period: number = 14): number[] {
  const atrs: number[] = new Array(candles.length).fill(0);
  
  if (candles.length < period + 1) {
    return atrs;
  }
  
  // Calculate True Range for each candle
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
  
  // Calculate initial ATR (simple average)
  if (trueRanges.length >= period) {
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += trueRanges[i];
    }
    atrs[period] = sum / period;
    
    // Calculate remaining ATRs using smoothed average
    for (let i = period + 1; i < candles.length; i++) {
      atrs[i] = (atrs[i - 1] * (period - 1) + trueRanges[i - 1]) / period;
    }
  }
  
  return atrs;
}

/**
 * Calculate Half Trend indicator
 * @param candles - Array of candle data
 * @param amplitude - ATR multiplier (default 2)
 * @param channelDeviation - Channel deviation (default 2)
 * @returns Array of Half Trend results
 */
export function calculateHalfTrend(
  candles: Candle[],
  amplitude: number = 2,
  channelDeviation: number = 2
): HalfTrendResult[] {
  if (!candles || candles.length < 14) return [];

  const results: HalfTrendResult[] = [];
  const atrPeriod = 14;
  
  // Calculate ATR for all candles
  const atrs = calculateATR(candles, atrPeriod);
  
  let trend: 'up' | 'down' = 'up';
  let trendLine = 0;
  let previousTrend: 'up' | 'down' = 'up';
  let up = 0;
  let down = 0;
  
  for (let i = atrPeriod; i < candles.length; i++) {
    const candle = candles[i];
    const atr = atrs[i] || 0;
    
    if (atr === 0) {
      // Skip if ATR not calculated yet
      results.push({
        trend: 'up',
        trendLine: candle.close,
        atr: 0,
        buySignal: false,
        sellSignal: false,
        time: candle.time
      });
      continue;
    }
    
    const highPrice = candle.high;
    const lowPrice = candle.low;
    const close = candle.close;
    
    // Calculate high and low sources
    const highSource = highPrice - atr * amplitude / channelDeviation;
    const lowSource = lowPrice + atr * amplitude / channelDeviation;
    
    // Update trend line
    if (previousTrend === 'up') {
      up = lowSource;
      if (close < up) {
        trend = 'down';
        down = highSource;
        trendLine = down;
      } else {
        trend = 'up';
        up = Math.max(up, lowSource);
        trendLine = up;
      }
    } else {
      down = highSource;
      if (close > down) {
        trend = 'up';
        up = lowSource;
        trendLine = up;
      } else {
        trend = 'down';
        down = Math.min(down, highSource);
        trendLine = down;
      }
    }
    
    // Detect buy/sell signals (trend change)
    const buySignal = trend === 'up' && previousTrend === 'down';
    const sellSignal = trend === 'down' && previousTrend === 'up';
    
    results.push({
      trend,
      trendLine,
      atr,
      buySignal,
      sellSignal,
      time: candle.time
    });
    
    previousTrend = trend;
  }
  
  return results;
}

/**
 * Get current Half Trend signal
 */
export function getHalfTrendSignal(
  results: HalfTrendResult[]
): 'BUY' | 'SELL' | 'HOLD' {
  if (results.length === 0) return 'HOLD';
  
  const latest = results[results.length - 1];
  
  if (latest.buySignal) return 'BUY';
  if (latest.sellSignal) return 'SELL';
  
  return latest.trend === 'up' ? 'BUY' : 'SELL';
}

/**
 * Get recent buy/sell signals
 */
export function getHalfTrendSignals(
  results: HalfTrendResult[],
  count: number = 10
): { time: number; type: 'BUY' | 'SELL'; price: number }[] {
  const signals = results
    .filter(r => r.buySignal || r.sellSignal)
    .slice(-count)
    .map(r => ({
      time: r.time,
      type: (r.buySignal ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
      price: r.trendLine
    }));
  
  return signals;
}
