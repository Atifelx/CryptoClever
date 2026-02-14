import { Candle, FibonacciLevel } from './types';

/**
 * Calculate Fibonacci retracement levels
 * Uses swing high and low from recent candles
 */
export function calculateFibonacci(candles: Candle[]): FibonacciLevel[] {
  if (candles.length < 50) return [];
  
  // Use last 100 candles for swing high/low
  const recentCandles = candles.slice(-100);
  const high = Math.max(...recentCandles.map(c => c.high));
  const low = Math.min(...recentCandles.map(c => c.low));
  const range = high - low;
  
  if (range === 0) return [];
  
  const levels: FibonacciLevel[] = [
    { level: 0, price: low, label: '0.0%' },
    { level: 23.6, price: low + range * 0.236, label: '23.6%' },
    { level: 38.2, price: low + range * 0.382, label: '38.2%' },
    { level: 50, price: low + range * 0.5, label: '50.0%' },
    { level: 61.8, price: low + range * 0.618, label: '61.8%' },
    { level: 78.6, price: low + range * 0.786, label: '78.6%' },
    { level: 100, price: high, label: '100.0%' }
  ];
  
  return levels;
}
