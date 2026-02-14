import { Candle, CamarillaLevels } from './types';

/**
 * Calculate Camarilla pivot points
 * Uses previous candle's high, low, and close
 */
export function calculateCamarilla(candles: Candle[]): CamarillaLevels | null {
  if (candles.length < 2) return null;
  
  // Use previous candle for calculation
  const prev = candles[candles.length - 2];
  const H = prev.high;
  const L = prev.low;
  const C = prev.close;
  const range = H - L;
  
  if (range === 0) return null;
  
  return {
    R4: C + range * 1.1 / 2,
    R3: C + range * 1.1 / 4,
    R2: C + range * 1.1 / 6,
    R1: C + range * 1.1 / 12,
    PP: (H + L + C) / 3,
    S1: C - range * 1.1 / 12,
    S2: C - range * 1.1 / 6,
    S3: C - range * 1.1 / 4,
    S4: C - range * 1.1 / 2
  };
}
