/**
 * FMCBR 3.0 - Official Algorithm
 * Fibo Musang Candle Break Retest
 * 
 * Based on official documentation by Mohd Zulkifli & Baha (2011)
 */

import type { Candle } from '../../store/candlesStore';

// ──── FIBONACCI SETTINGS ────
const FIBONACCI_RATIOS = {
  // Entry Levels
  BASE: 0.000,
  MINOR_ENTRY: 0.382,
  MAJOR_ENTRY: 0.236,
  SETUP: 1.000,
  
  // Take Profit Levels
  TP1: 1.618,
  TP1_EXTENDED: 1.88,
  TP2: 2.618,
  TP2_EXTENDED: 2.88,
  TP3: 4.23,
  TP3_EXTENDED: 4.88,
};

export interface FMCBRLevel {
  price: number;
  label: string;
  type: 'entry' | 'tp' | 'base' | 'setup';
  level: string; // e.g., "TP1", "Major Entry", "Base"
}

export interface FMCBRSignal {
  breakType: 'IB' | 'DB' | null; // Initial Break or Dominant Break
  cb1: boolean; // Candle Break 1 detected
  direction: 'BULLISH' | 'BEARISH' | null;
  swingHigh: number;
  swingLow: number;
  base: number;
  setup: number;
  levels: FMCBRLevel[];
  entryMajor: number;
  entryMinor: number;
  status: 'WAITING_BREAK' | 'WAITING_CB1' | 'WAITING_RETEST' | 'READY';
}

// ──── Helper: Get trend direction ────
function getTrend(candles: Candle[], index: number): 'UP' | 'DOWN' {
  if (index < 1) return 'UP';
  const current = candles[index];
  const previous = candles[index - 1];
  return current.close > previous.close ? 'UP' : 'DOWN';
}

// ──── Helper: Check if candle is opposing trend ────
function isOpposing(candle: Candle, trend: 'UP' | 'DOWN'): boolean {
  if (trend === 'UP') {
    return candle.close < candle.open; // Bearish candle
  } else {
    return candle.close > candle.open; // Bullish candle
  }
}

// ──── Step 1: Detect Break Types (IB or DB) ────
function detectBreak(candles: Candle[], index: number): 'IB' | 'DB' | null {
  if (index < 1 || index >= candles.length) return null;
  
  const currentTrend = getTrend(candles, index - 1);
  let opposingCount = 0;
  
  // Count consecutive opposing candles starting from index
  for (let i = index; i < candles.length && i < index + 5; i++) {
    if (isOpposing(candles[i], currentTrend)) {
      opposingCount++;
    } else {
      break;
    }
  }
  
  if (opposingCount >= 3) return 'DB'; // Dominant Break (3+ opposing candles)
  if (opposingCount >= 1) return 'IB'; // Initial Break (1-2 opposing candles)
  
  return null;
}

// ──── Step 2: Find ABC Pattern ────
interface ABCPattern {
  A: number; // Swing high/low
  B: number; // Retracement point
  C: number; // Break point
  type: 'high' | 'low';
}

function findABCPattern(candles: Candle[], startIndex: number): ABCPattern | null {
  if (startIndex < 10 || startIndex >= candles.length) return null;
  
  // Look for swing high/low pattern
  // Use larger window (50 candles) for better pattern detection (was 20)
  const window = candles.slice(Math.max(0, startIndex - 50), startIndex + 5);
  
  // Find swing high (for bearish break) or swing low (for bullish break)
  let swingHigh = -Infinity;
  let swingLow = Infinity;
  let swingHighIndex = -1;
  let swingLowIndex = -1;
  
  for (let i = 1; i < window.length - 1; i++) {
    const candle = window[i];
    if (candle.high > swingHigh) {
      swingHigh = candle.high;
      swingHighIndex = i;
    }
    if (candle.low < swingLow) {
      swingLow = candle.low;
      swingLowIndex = i;
    }
  }
  
  if (swingHighIndex === -1 || swingLowIndex === -1) return null;
  
  // Determine pattern type based on break direction
  const breakCandle = candles[startIndex];
  const isBearishBreak = breakCandle.close < breakCandle.open;
  
  if (isBearishBreak && swingHighIndex < swingLowIndex) {
    // Bearish: A = high, B = low, C = break
    return {
      A: swingHigh,
      B: swingLow,
      C: breakCandle.close,
      type: 'high',
    };
  } else if (!isBearishBreak && swingLowIndex < swingHighIndex) {
    // Bullish: A = low, B = high, C = break
    return {
      A: swingLow,
      B: swingHigh,
      C: breakCandle.close,
      type: 'low',
    };
  }
  
  return null;
}

// ──── Step 3: Detect CB1 (Candle Break 1) ────
function detectCB1(candles: Candle[], breakIndex: number): boolean {
  const pattern = findABCPattern(candles, breakIndex);
  if (!pattern) return false;
  
  // CB1 occurs when price breaks point B after IB/DB
  // Check if current price has broken point B
  const currentCandle = candles[candles.length - 1];
  
  if (pattern.type === 'high') {
    // Bearish: CB1 when price breaks below point B (swing low)
    return currentCandle.close < pattern.B;
  } else {
    // Bullish: CB1 when price breaks above point B (swing high)
    return currentCandle.close > pattern.B;
  }
}

// ──── Step 4: Calculate Fibonacci Levels ────
function calculateFibonacciTP(
  swingHigh: number,
  swingLow: number,
  direction: 'BULLISH' | 'BEARISH'
): FMCBRLevel[] {
  const range = Math.abs(swingHigh - swingLow);
  const levels: FMCBRLevel[] = [];
  
  if (direction === 'BULLISH') {
    // Setup = swing low, Base = swing high
    const base = swingHigh;
    const setup = swingLow;
    
    levels.push({
      price: base,
      label: 'Base',
      type: 'base',
      level: 'Base',
    });
    
    levels.push({
      price: setup,
      label: 'Setup',
      type: 'setup',
      level: 'Setup',
    });
    
    // TP Levels (extending upward from setup)
    levels.push({
      price: setup + (range * FIBONACCI_RATIOS.TP1),
      label: 'TP1',
      type: 'tp',
      level: 'TP1',
    });
    
    levels.push({
      price: setup + (range * FIBONACCI_RATIOS.TP1_EXTENDED),
      label: 'TP1 Ext',
      type: 'tp',
      level: 'TP1 Extended',
    });
    
    levels.push({
      price: setup + (range * FIBONACCI_RATIOS.TP2),
      label: 'TP2',
      type: 'tp',
      level: 'TP2',
    });
    
    levels.push({
      price: setup + (range * FIBONACCI_RATIOS.TP2_EXTENDED),
      label: 'TP2 Ext',
      type: 'tp',
      level: 'TP2 Extended',
    });
    
    levels.push({
      price: setup + (range * FIBONACCI_RATIOS.TP3),
      label: 'TP3',
      type: 'tp',
      level: 'TP3',
    });
    
    levels.push({
      price: setup + (range * FIBONACCI_RATIOS.TP3_EXTENDED),
      label: 'TP3 Ext',
      type: 'tp',
      level: 'TP3 Extended',
    });
  } else {
    // BEARISH: Setup = swing high, Base = swing low
    const base = swingLow;
    const setup = swingHigh;
    
    levels.push({
      price: base,
      label: 'Base',
      type: 'base',
      level: 'Base',
    });
    
    levels.push({
      price: setup,
      label: 'Setup',
      type: 'setup',
      level: 'Setup',
    });
    
    // TP Levels (extending downward from setup)
    levels.push({
      price: setup - (range * FIBONACCI_RATIOS.TP1),
      label: 'TP1',
      type: 'tp',
      level: 'TP1',
    });
    
    levels.push({
      price: setup - (range * FIBONACCI_RATIOS.TP1_EXTENDED),
      label: 'TP1 Ext',
      type: 'tp',
      level: 'TP1 Extended',
    });
    
    levels.push({
      price: setup - (range * FIBONACCI_RATIOS.TP2),
      label: 'TP2',
      type: 'tp',
      level: 'TP2',
    });
    
    levels.push({
      price: setup - (range * FIBONACCI_RATIOS.TP2_EXTENDED),
      label: 'TP2 Ext',
      type: 'tp',
      level: 'TP2 Extended',
    });
    
    levels.push({
      price: setup - (range * FIBONACCI_RATIOS.TP3),
      label: 'TP3',
      type: 'tp',
      level: 'TP3',
    });
    
    levels.push({
      price: setup - (range * FIBONACCI_RATIOS.TP3_EXTENDED),
      label: 'TP3 Ext',
      type: 'tp',
      level: 'TP3 Extended',
    });
  }
  
  return levels;
}

// ──── Step 5: Calculate Entry Levels ────
function calculateFibonacciEntry(
  swingHigh: number,
  swingLow: number,
  direction: 'BULLISH' | 'BEARISH'
): { majorEntry: number; minorEntry: number } {
  const range = Math.abs(swingHigh - swingLow);
  
  if (direction === 'BULLISH') {
    const base = swingHigh;
    const distance = swingHigh - swingLow;
    
    return {
      majorEntry: base - (distance * FIBONACCI_RATIOS.MAJOR_ENTRY), // 0.236
      minorEntry: base - (distance * FIBONACCI_RATIOS.MINOR_ENTRY), // 0.382
    };
  } else {
    const base = swingLow;
    const distance = swingHigh - swingLow;
    
    return {
      majorEntry: base + (distance * FIBONACCI_RATIOS.MAJOR_ENTRY), // 0.236
      minorEntry: base + (distance * FIBONACCI_RATIOS.MINOR_ENTRY), // 0.382
    };
  }
}

// ──── Main FMCBR Strategy ────
export function calculateFMCBR(candles: Candle[]): FMCBRSignal | null {
  // CRITICAL: Use only closed candles to prevent repainting
  const closedCandles = candles.slice(0, candles.length - 1);
  
  // Require at least 200 candles for stable calculation (was 50)
  if (!closedCandles || closedCandles.length < 200) {
    return null;
  }
  
  // Use last 1000 candles for better swing detection and calibration (was all candles)
  const data = closedCandles.length > 1000 ? closedCandles.slice(-1000) : closedCandles;
  
  try {
    // Step 1: Detect IB or DB
    // Look for breaks in the last 50 candles (was 20) for more stable detection
    let breakType: 'IB' | 'DB' | null = null;
    let breakIndex = -1;
    
    const breakLookback = Math.min(50, data.length - 1);
    for (let i = Math.max(0, data.length - breakLookback); i < data.length - 1; i++) {
      const detectedBreak = detectBreak(data, i);
      if (detectedBreak) {
        breakType = detectedBreak;
        breakIndex = i;
        break;
      }
    }
    
    if (!breakType || breakIndex === -1) {
      return {
        breakType: null,
        cb1: false,
        direction: null,
        swingHigh: 0,
        swingLow: 0,
        base: 0,
        setup: 0,
        levels: [],
        entryMajor: 0,
        entryMinor: 0,
        status: 'WAITING_BREAK',
      };
    }
    
    // Determine direction
    const breakCandle = candles[breakIndex];
    const direction: 'BULLISH' | 'BEARISH' = breakCandle.close > breakCandle.open ? 'BULLISH' : 'BEARISH';
    
    // Step 2: Detect CB1
    const cb1Detected = detectCB1(candles, breakIndex);
    
    if (!cb1Detected) {
      // Find swing points for potential setup
      // Use larger window (50 candles) for better swing detection (was 20)
      const window = data.slice(Math.max(0, breakIndex - 50), breakIndex + 5);
      let swingHigh = -Infinity;
      let swingLow = Infinity;
      
      window.forEach(c => {
        if (c.high > swingHigh) swingHigh = c.high;
        if (c.low < swingLow) swingLow = c.low;
      });
      
      return {
        breakType,
        cb1: false,
        direction,
        swingHigh,
        swingLow,
        base: 0,
        setup: 0,
        levels: [],
        entryMajor: 0,
        entryMinor: 0,
        status: 'WAITING_CB1',
      };
    }
    
    // Step 3: Find swing points for Fibonacci calculation
    const pattern = findABCPattern(data, breakIndex);
    if (!pattern) {
      return {
        breakType,
        cb1: true,
        direction,
        swingHigh: 0,
        swingLow: 0,
        base: 0,
        setup: 0,
        levels: [],
        entryMajor: 0,
        entryMinor: 0,
        status: 'WAITING_RETEST',
      };
    }
    
    const swingHigh = direction === 'BULLISH' ? pattern.A : pattern.B;
    const swingLow = direction === 'BULLISH' ? pattern.B : pattern.A;
    
    // Step 4: Calculate Fibonacci levels
    const tpLevels = calculateFibonacciTP(swingHigh, swingLow, direction);
    const entryLevels = calculateFibonacciEntry(swingHigh, swingLow, direction);
    
    // Add entry levels to the levels array
    const allLevels: FMCBRLevel[] = [
      ...tpLevels,
      {
        price: entryLevels.majorEntry,
        label: 'Major Entry (23.6%)',
        type: 'entry',
        level: 'Major Entry',
      },
      {
        price: entryLevels.minorEntry,
        label: 'Minor Entry (38.2%)',
        type: 'entry',
        level: 'Minor Entry',
      },
    ];
    
    // Determine base and setup
    const base = direction === 'BULLISH' ? swingHigh : swingLow;
    const setup = direction === 'BULLISH' ? swingLow : swingHigh;
    
    return {
      breakType,
      cb1: true,
      direction,
      swingHigh,
      swingLow,
      base,
      setup,
      levels: allLevels.sort((a, b) => a.price - b.price),
      entryMajor: entryLevels.majorEntry,
      entryMinor: entryLevels.minorEntry,
      status: 'READY',
    };
  } catch (error) {
    console.error('Error calculating FMCBR:', error);
    return null;
  }
}
