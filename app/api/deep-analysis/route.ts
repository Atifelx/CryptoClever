/**
 * Deep Market Structure Analysis API
 * Fetches candles from Binance and runs deep analysis
 */

import { NextRequest, NextResponse } from 'next/server';
import { runDeepAnalysis, Candle } from '../../lib/engine';
import redis from '../../lib/redis';

// Valid timeframes for Binance (matching the app's timeframe selector)
// Note: App uses '1D' but Binance API expects '1d' (lowercase)
const VALID_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1D', '1d'];

/**
 * Map Binance klines response to Candle[] format
 */
function mapBinanceKlinesToCandles(klines: any[]): Candle[] {
  return klines.map((kline) => ({
    open: parseFloat(kline[1]),
    high: parseFloat(kline[2]),
    low: parseFloat(kline[3]),
    close: parseFloat(kline[4]),
    volume: parseFloat(kline[5]),
    time: kline[0], // Binance returns timestamp in milliseconds
  }));
}

/**
 * Fetch candles from Binance REST API
 */
async function fetchBinanceCandles(
  symbol: string,
  interval: string,
  limit: number = 500
): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.binance.com/',
      'Origin': 'https://www.binance.com',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
  }

  const klines = await response.json();
  
  if (!Array.isArray(klines) || klines.length === 0) {
    throw new Error('Invalid response from Binance API');
  }

  return mapBinanceKlinesToCandles(klines);
}

/**
 * POST handler for deep analysis
 */
export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { symbol, timeframe } = body;

    // Validate inputs
    if (!symbol || typeof symbol !== 'string') {
      return NextResponse.json(
        { error: 'Invalid symbol. Must be a non-empty string.' },
        { status: 400 }
      );
    }

    if (!timeframe || typeof timeframe !== 'string') {
      return NextResponse.json(
        { error: 'Invalid timeframe. Must be a non-empty string.' },
        { status: 400 }
      );
    }

    if (!VALID_TIMEFRAMES.includes(timeframe)) {
      return NextResponse.json(
        { error: `Invalid timeframe. Must be one of: ${VALID_TIMEFRAMES.join(', ')}` },
        { status: 400 }
      );
    }

    // Normalize symbol (remove spaces, uppercase)
    const normalizedSymbol = symbol.trim().toUpperCase();

    // Normalize timeframe: convert '1D' to '1d' for Binance API
    const normalizedTimeframe = timeframe === '1D' ? '1d' : timeframe.toLowerCase();

    // Check Redis cache first (use original timeframe for cache key)
    const cacheKey = `engine:${normalizedSymbol}:${timeframe}`;

    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          try {
            const cachedResult = JSON.parse(cached);
            // Validate cached result structure (including new fields)
            if (
              cachedResult &&
              typeof cachedResult === 'object' &&
              typeof cachedResult.structure === 'string' &&
              typeof cachedResult.regime === 'string' &&
              typeof cachedResult.impulseScore === 'number' &&
              typeof cachedResult.confidence === 'number' &&
              Array.isArray(cachedResult.pivots) &&
              (typeof cachedResult.reasoning === 'string' || cachedResult.reasoning === undefined) &&
              (Array.isArray(cachedResult.zones) || cachedResult.zones === undefined)
            ) {
              return NextResponse.json({
                ...cachedResult,
                cached: true,
              });
            }
          } catch (parseError) {
            // Invalid cached data, continue to fetch fresh
            console.warn('Invalid cached data, fetching fresh:', parseError);
          }
        }
      } catch (redisError) {
        // Redis error, continue without cache
        console.warn('Redis cache read error, continuing without cache:', redisError);
      }
    }

    // Fetch candles from Binance (use normalized timeframe)
    let candles: Candle[];
    try {
      candles = await fetchBinanceCandles(normalizedSymbol, normalizedTimeframe, 500);
    } catch (fetchError: any) {
      return NextResponse.json(
        { 
          error: 'Failed to fetch candles from Binance',
          details: fetchError.message || 'Unknown error'
        },
        { status: 500 }
      );
    }

    // Validate we have enough candles
    if (candles.length < 20) {
      return NextResponse.json(
        { error: `Insufficient candles. Got ${candles.length}, need at least 20.` },
        { status: 400 }
      );
    }

    // Run deep analysis
    const analysisResult = runDeepAnalysis(candles);

    // Store in Redis with TTL (15 minutes = 900 seconds)
    if (redis) {
      try {
        await redis.setex(
          cacheKey,
          900, // TTL: 15 minutes
          JSON.stringify(analysisResult)
        );
      } catch (redisError) {
        // Redis write error, but continue to return result
        console.warn('Redis cache write error, continuing without cache:', redisError);
      }
    }

    // Return analysis result
    return NextResponse.json({
      ...analysisResult,
      cached: false,
      symbol: normalizedSymbol,
      timeframe,
      candlesCount: candles.length,
    });

  } catch (error: any) {
    console.error('Deep analysis API error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error.message || 'Unknown error'
      },
      { status: 500 }
    );
  }
}
