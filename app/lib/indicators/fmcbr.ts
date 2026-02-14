import { Candle, FMCBRLevels, KeyLevel, BollingerBands, CamarillaLevels } from './types';
import { calculateFibonacci } from './fibonacci';
import { calculateMurrayMath } from './murrayMath';
import { calculateCamarilla } from './camarilla';
import { calculateSemafor } from './semafor';

/**
 * Calculate Bollinger Bands
 */
function calculateBollingerBands(candles: Candle[], period = 20, stdDev = 2): BollingerBands {
  if (candles.length < period) {
    const lastClose = candles[candles.length - 1]?.close || 0;
    return {
      upper: lastClose,
      middle: lastClose,
      lower: lastClose
    };
  }
  
  const closes = candles.slice(-period).map(c => c.close);
  const sma = closes.reduce((a, b) => a + b, 0) / closes.length;
  
  const variance = closes.reduce((sum, price) => 
    sum + Math.pow(price - sma, 2), 0
  ) / closes.length;
  
  const sd = Math.sqrt(variance);
  
  return {
    upper: sma + stdDev * sd,
    middle: sma,
    lower: sma - stdDev * sd
  };
}

/**
 * Consolidate levels that are too close together
 */
function consolidateLevels(levels: KeyLevel[]): KeyLevel[] {
  const consolidated: KeyLevel[] = [];
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  
  for (const level of sorted) {
    const existing = consolidated.find(l => 
      Math.abs(l.price - level.price) / Math.max(l.price, level.price, 0.01) < 0.001
    );
    
    if (existing) {
      // Strengthen existing level
      existing.strength = Math.max(existing.strength, level.strength);
    } else {
      consolidated.push(level);
    }
  }
  
  return consolidated;
}

/**
 * Identify key support/resistance levels from all indicators
 */
function identifyKeyLevels(
  fibonacci: any[],
  murrayMath: number[],
  camarilla: CamarillaLevels | null,
  bollinger: BollingerBands,
  semafor: any[],
  currentPrice: number
): KeyLevel[] {
  const levels: KeyLevel[] = [];
  
  // Add Fibonacci levels
  fibonacci.forEach(fib => {
    levels.push({
      price: fib.price,
      type: fib.price > currentPrice ? 'resistance' : 'support',
      strength: 2,
      source: `Fib ${fib.label}`
    });
  });
  
  // Add Murray Math levels
  murrayMath.forEach((price, index) => {
    levels.push({
      price,
      type: price > currentPrice ? 'resistance' : 'support',
      strength: 1,
      source: `Murray ${index}/8`
    });
  });
  
  // Add Camarilla pivots
  if (camarilla) {
    Object.entries(camarilla).forEach(([key, value]) => {
      if (typeof value === 'number' && key !== 'PP') {
        levels.push({
          price: value as number,
          type: key.startsWith('R') ? 'resistance' : 'support',
          strength: key.includes('4') || key.includes('3') ? 3 : 2,
          source: `Camarilla ${key}`
        });
      }
    });
  }
  
  // Add Bollinger Bands
  levels.push({
    price: bollinger.upper,
    type: 'resistance',
    strength: 2,
    source: 'BB Upper'
  });
  
  levels.push({
    price: bollinger.lower,
    type: 'support',
    strength: 2,
    source: 'BB Lower'
  });
  
  // Add Semafor pivots (only strong ones)
  semafor.filter(p => p.strength >= 2).forEach(pivot => {
    levels.push({
      price: pivot.price,
      type: pivot.type === 'high' ? 'resistance' : 'support',
      strength: pivot.strength,
      source: `Semafor ${pivot.strength}`
    });
  });
  
  // Remove duplicates (levels within 0.1% of each other)
  return consolidateLevels(levels);
}

/**
 * Calculate FMCBR (Fibonacci, Murray Math, Camarilla, Bollinger, Resistance) levels
 * Combines all indicator types into unified support/resistance levels
 */
export function calculateFMCBR(candles: Candle[]): FMCBRLevels | null {
  if (!candles || candles.length < 20) return null;
  
  try {
    const fibonacci = calculateFibonacci(candles);
    const murrayMath = calculateMurrayMath(candles);
    const camarilla = calculateCamarilla(candles);
    const bollinger = calculateBollingerBands(candles);
    const semafor = calculateSemafor(candles);
    
    // Get current price for level classification
    const currentPrice = candles[candles.length - 1]?.close || 0;
    
    // Combine all levels into key support/resistance
    const keyLevels = identifyKeyLevels(
      fibonacci,
      murrayMath,
      camarilla,
      bollinger,
      semafor,
      currentPrice
    );
    
    return {
      fibonacci,
      murrayMath,
      camarilla: camarilla || {
        R4: 0, R3: 0, R2: 0, R1: 0, PP: 0,
        S1: 0, S2: 0, S3: 0, S4: 0
      },
      bollinger,
      keyLevels
    };
  } catch (error) {
    console.error('Error calculating FMCBR:', error);
    return null;
  }
}
