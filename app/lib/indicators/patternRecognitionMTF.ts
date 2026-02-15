import { Candle } from './types';
import { detectPatterns, PatternSignal } from './patternRecognition';

/**
 * Multi-Timeframe Pattern Recognition
 * 
 * Professional traders use multi-timeframe analysis:
 * 1. Higher timeframe (HTF) determines the trend/context
 * 2. Lower timeframe (LTF) provides entry signals
 * 3. Patterns are more reliable when confirmed across timeframes
 * 
 * This module analyzes patterns across multiple timeframes and
 * only signals when there's confluence (agreement across timeframes).
 */

export interface MTFPatternAnalysis {
  primaryPattern: PatternSignal | null;
  htfPattern: PatternSignal | null; // Higher timeframe pattern
  ltfPattern: PatternSignal | null; // Lower timeframe pattern
  confluence: number; // 0-100, how many timeframes agree
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  confidence: number; // Combined confidence score
  timeframes: string[];
}

/**
 * Get higher timeframes for the given timeframe
 * Professional approach: Check 3-5x higher timeframe for trend context
 */
function getHigherTimeframes(currentTF: string): string[] {
  const tfMap: Record<string, string[]> = {
    '1m': ['5m', '15m', '1h'],
    '5m': ['15m', '1h', '4h'],
    '15m': ['1h', '4h', '1d'],
    '1h': ['4h', '1d'],
    '4h': ['1d'],
    '1d': [],
  };
  return tfMap[currentTF] || [];
}

/**
 * Get lower timeframes for the given timeframe
 * Used for entry timing
 */
function getLowerTimeframes(currentTF: string): string[] {
  const tfMap: Record<string, string[]> = {
    '1m': [],
    '5m': ['1m'],
    '15m': ['5m', '1m'],
    '1h': ['15m', '5m'],
    '4h': ['1h', '15m'],
    '1d': ['4h', '1h'],
  };
  return tfMap[currentTF] || [];
}

/**
 * Fetch candles for a specific timeframe from Binance
 */
async function fetchTimeframeCandles(
  symbol: string,
  interval: string,
  limit: number = 200
): Promise<Candle[]> {
  try {
    const response = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
      { next: { revalidate: 10 } }
    );

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data = await response.json();
    return data.map((k: any[]) => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch (error) {
    console.error(`Error fetching ${interval} candles for ${symbol}:`, error);
    return [];
  }
}

/**
 * Analyze patterns across multiple timeframes
 * 
 * Professional Trading Approach:
 * 1. Check higher timeframe (HTF) for trend direction
 * 2. Check current timeframe for pattern formation
 * 3. Check lower timeframe (LTF) for entry timing
 * 4. Only signal when there's confluence (agreement)
 * 
 * @param currentCandles - Candles for the current timeframe
 * @param symbol - Trading pair symbol
 * @param currentTimeframe - Current chart timeframe (e.g., '15m')
 * @returns Multi-timeframe pattern analysis
 */
export async function analyzeMTFPatterns(
  currentCandles: Candle[],
  symbol: string,
  currentTimeframe: string
): Promise<MTFPatternAnalysis> {
  if (!currentCandles || currentCandles.length < 50) {
    return {
      primaryPattern: null,
      htfPattern: null,
      ltfPattern: null,
      confluence: 0,
      direction: 'NEUTRAL',
      confidence: 0,
      timeframes: [],
    };
  }

  // Analyze current timeframe pattern
  const currentPatterns = detectPatterns(currentCandles, 70);
  const currentPattern = currentPatterns.length > 0 ? currentPatterns[0] : null;

  // Get higher timeframes for trend context
  const higherTFs = getHigherTimeframes(currentTimeframe);
  let htfPattern: PatternSignal | null = null;
  let htfDirection: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';

  // Analyze highest timeframe first (most important for trend)
  if (higherTFs.length > 0) {
    try {
      const htfCandles = await fetchTimeframeCandles(symbol, higherTFs[0], 200);
      if (htfCandles.length >= 50) {
        const htfPatterns = detectPatterns(htfCandles, 70);
        if (htfPatterns.length > 0) {
          htfPattern = htfPatterns[0];
          htfDirection = htfPattern.direction;
        }
      }
    } catch (error) {
      console.error('HTF analysis error:', error);
    }
  }

  // Get lower timeframes for entry timing
  const lowerTFs = getLowerTimeframes(currentTimeframe);
  let ltfPattern: PatternSignal | null = null;

  if (lowerTFs.length > 0 && currentPattern) {
    try {
      const ltfCandles = await fetchTimeframeCandles(symbol, lowerTFs[0], 100);
      if (ltfCandles.length >= 50) {
        const ltfPatterns = detectPatterns(ltfCandles, 70);
        if (ltfPatterns.length > 0) {
          ltfPattern = ltfPatterns[0];
        }
      }
    } catch (error) {
      console.error('LTF analysis error:', error);
    }
  }

  // Calculate confluence (how many timeframes agree)
  let confluence = 0;
  let direction: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  let confidence = 0;
  const timeframes: string[] = [currentTimeframe];

  if (currentPattern) {
    direction = currentPattern.direction;
    confidence = currentPattern.confidence;
    confluence = 1; // Current timeframe confirms

    // HTF confluence (most important)
    if (htfPattern) {
      timeframes.push(higherTFs[0]);
      if (htfPattern.direction === currentPattern.direction) {
        confluence += 2; // HTF gets double weight
        confidence = Math.min(confidence + 10, 100); // Boost confidence
      } else {
        // HTF disagrees - reduce confidence significantly
        confidence = Math.max(confidence - 20, 0);
        direction = htfDirection; // HTF trend takes precedence
      }
    }

    // LTF confluence (for entry timing)
    if (ltfPattern) {
      timeframes.push(lowerTFs[0]);
      if (ltfPattern.direction === currentPattern.direction) {
        confluence += 1;
        confidence = Math.min(confidence + 5, 100);
      }
    }

    // Professional rule: Only signal if HTF and current TF agree
    if (htfPattern && htfPattern.direction !== currentPattern.direction) {
      // HTF trend is opposite - don't signal (wait for alignment)
      return {
        primaryPattern: null,
        htfPattern,
        ltfPattern,
        confluence: 0,
        direction: htfDirection,
        confidence: 0,
        timeframes,
      };
    }
  }

  // Minimum confluence required: HTF + Current TF (professional standard)
  const minConfluence = htfPattern ? 3 : 1; // HTF (2) + Current (1) = 3

  if (confluence < minConfluence || !currentPattern) {
    return {
      primaryPattern: null,
      htfPattern,
      ltfPattern,
      confluence,
      direction,
      confidence: 0,
      timeframes,
    };
  }

  return {
    primaryPattern: currentPattern,
    htfPattern,
    ltfPattern,
    confluence,
    direction,
    confidence: Math.min(confidence, 100),
    timeframes,
  };
}

/**
 * Client-side MTF analysis (uses cached data, no API calls)
 * For real-time updates without blocking
 */
export function analyzeMTFPatternsClient(
  currentCandles: Candle[],
  htfCandles: Candle[] | null,
  ltfCandles: Candle[] | null
): MTFPatternAnalysis {
  if (!currentCandles || currentCandles.length < 50) {
    return {
      primaryPattern: null,
      htfPattern: null,
      ltfPattern: null,
      confluence: 0,
      direction: 'NEUTRAL',
      confidence: 0,
      timeframes: [],
    };
  }

  // Analyze current timeframe
  const currentPatterns = detectPatterns(currentCandles, 70);
  const currentPattern = currentPatterns.length > 0 ? currentPatterns[0] : null;

  // Analyze HTF if available
  let htfPattern: PatternSignal | null = null;
  let htfDirection: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  if (htfCandles && htfCandles.length >= 50) {
    const htfPatterns = detectPatterns(htfCandles, 70);
    if (htfPatterns.length > 0) {
      htfPattern = htfPatterns[0];
      htfDirection = htfPattern.direction;
    }
  }

  // Analyze LTF if available
  let ltfPattern: PatternSignal | null = null;
  if (ltfCandles && ltfCandles.length >= 50) {
    const ltfPatterns = detectPatterns(ltfCandles, 70);
    if (ltfPatterns.length > 0) {
      ltfPattern = ltfPatterns[0];
    }
  }

  // Calculate confluence
  let confluence = 0;
  let direction: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  let confidence = 0;

  if (currentPattern) {
    direction = currentPattern.direction;
    confidence = currentPattern.confidence;
    confluence = 1;

    if (htfPattern) {
      if (htfPattern.direction === currentPattern.direction) {
        confluence += 2;
        confidence = Math.min(confidence + 10, 100);
      } else {
        confidence = Math.max(confidence - 20, 0);
        direction = htfDirection;
      }
    }

    if (ltfPattern && ltfPattern.direction === currentPattern.direction) {
      confluence += 1;
      confidence = Math.min(confidence + 5, 100);
    }

    // Professional rule: HTF must agree
    if (htfPattern && htfPattern.direction !== currentPattern.direction) {
      return {
        primaryPattern: null,
        htfPattern,
        ltfPattern,
        confluence: 0,
        direction: htfDirection,
        confidence: 0,
        timeframes: [],
      };
    }
  }

  const minConfluence = htfPattern ? 3 : 1;

  if (confluence < minConfluence || !currentPattern) {
    return {
      primaryPattern: null,
      htfPattern,
      ltfPattern,
      confluence,
      direction,
      confidence: 0,
      timeframes: [],
    };
  }

  return {
    primaryPattern: currentPattern,
    htfPattern,
    ltfPattern,
    confluence,
    direction,
    confidence: Math.min(confidence, 100),
    timeframes: [],
  };
}
