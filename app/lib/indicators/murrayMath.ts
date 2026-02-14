import { Candle } from './types';

/**
 * Calculate Murray Math levels
 * Divides price range into 8 equal parts (octaves)
 */
export function calculateMurrayMath(candles: Candle[]): number[] {
  if (candles.length < 50) return [];
  
  const recentCandles = candles.slice(-100);
  const high = Math.max(...recentCandles.map(c => c.high));
  const low = Math.min(...recentCandles.map(c => c.low));
  
  if (high === low) return [];
  
  // Murray Math divides range into 8 equal parts (octaves)
  const range = high - low;
  const step = range / 8;
  
  const levels: number[] = [];
  for (let i = 0; i <= 8; i++) {
    levels.push(low + step * i);
  }
  
  return levels;
}
