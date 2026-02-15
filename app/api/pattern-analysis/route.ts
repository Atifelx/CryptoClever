import { NextRequest, NextResponse } from 'next/server';
import { detectPatterns } from '../../lib/indicators/patternRecognition';
import { Candle } from '../../lib/binance';

/**
 * Pattern Analysis API Route
 * 
 * Analyzes patterns across multiple timeframes for better accuracy.
 * Uses Redis caching to store analysis results.
 * 
 * POST /api/pattern-analysis
 * Body: { symbol: string, timeframe: string }
 * 
 * Returns: { patterns: PatternSignal[], timeframes: string[] }
 */

// Redis client (if available)
let redis: any = null;
try {
  const Redis = require('ioredis');
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  redis.on('error', () => {
    redis = null;
  });
} catch {
  // Redis not available
}

async function fetchCandles(symbol: string, interval: string, limit: number = 500): Promise<Candle[]> {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    
    // Helper to fetch with proxy fallback
    const fetchWithProxy = async (targetUrl: string): Promise<Response> => {
      try {
        const response = await fetch(targetUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.binance.com/',
            'Origin': 'https://www.binance.com',
          },
          next: { revalidate: 5 }
        });

        // If 451, try proxy
        if (response.status === 451) {
          console.log('Binance API blocked (451), trying proxy...');
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
          return await fetch(proxyUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
          });
        }

        return response;
      } catch (error) {
        // If direct fetch fails, try proxy
        console.log('Direct fetch failed, trying proxy...');
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
        return await fetch(proxyUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        });
      }
    };
    
    const response = await fetchWithProxy(url);

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbol, timeframe } = body;

    if (!symbol || !timeframe) {
      return NextResponse.json(
        { error: 'Missing symbol or timeframe' },
        { status: 400 }
      );
    }

    // Validate timeframe
    const validTimeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];
    if (!validTimeframes.includes(timeframe)) {
      return NextResponse.json(
        { error: 'Invalid timeframe' },
        { status: 400 }
      );
    }

    // Check Redis cache
    const cacheKey = `pattern:${symbol}:${timeframe}`;
    let cachedResult = null;

    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          cachedResult = JSON.parse(cached);
          // Return cached if less than 5 minutes old
          if (Date.now() - cachedResult.timestamp < 5 * 60 * 1000) {
            return NextResponse.json({
              patterns: cachedResult.patterns,
              timeframes: cachedResult.timeframes,
              cached: true,
            });
          }
        }
      } catch (err) {
        // Cache read failed, continue with fresh analysis
      }
    }

    // Fetch candles for current timeframe
    const candles = await fetchCandles(symbol, timeframe, 500);
    if (candles.length < 50) {
      return NextResponse.json(
        { error: 'Insufficient data' },
        { status: 400 }
      );
    }

    // Analyze patterns on current timeframe
    const patterns = detectPatterns(candles, 60);

    // Multi-timeframe analysis: Check higher timeframes for context
    const higherTimeframes: string[] = [];
    if (timeframe === '1m') higherTimeframes.push('15m', '1h');
    else if (timeframe === '5m') higherTimeframes.push('1h', '4h');
    else if (timeframe === '15m') higherTimeframes.push('4h', '1d');
    else if (timeframe === '1h') higherTimeframes.push('1d');

    const multiTimeframePatterns: any[] = [];
    const analyzedTimeframes: string[] = [timeframe];

    // Analyze higher timeframes for confluence
    for (const tf of higherTimeframes) {
      try {
        const tfCandles = await fetchCandles(symbol, tf, 200);
        if (tfCandles.length >= 50) {
          const tfPatterns = detectPatterns(tfCandles, 60);
          if (tfPatterns.length > 0) {
            multiTimeframePatterns.push(...tfPatterns.map(p => ({ ...p, timeframe: tf })));
            analyzedTimeframes.push(tf);
          }
        }
      } catch (err) {
        // Skip this timeframe if fetch fails
      }
    }

    // Combine patterns (prioritize current timeframe, but include higher TF context)
    const allPatterns = [...patterns, ...multiTimeframePatterns];

    // Cache result
    if (redis && allPatterns.length > 0) {
      try {
        await redis.setex(
          cacheKey,
          300, // 5 minutes TTL
          JSON.stringify({
            patterns: allPatterns,
            timeframes: analyzedTimeframes,
            timestamp: Date.now(),
          })
        );
      } catch (err) {
        // Cache write failed, continue
      }
    }

    return NextResponse.json({
      patterns: allPatterns,
      timeframes: analyzedTimeframes,
      cached: false,
    });
  } catch (error: any) {
    console.error('Pattern analysis error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
