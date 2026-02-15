import { NextRequest, NextResponse } from 'next/server';
import { getCachedCandles, setCachedCandles } from '../../../lib/redis';

// Configure runtime to use Node.js with specific regions (configured in vercel.json)
export const runtime = 'nodejs';

/**
 * Next.js API Route to proxy Binance API requests with Redis caching
 * Caches historical data for faster loading
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const symbol = searchParams.get('symbol');
    const interval = searchParams.get('interval');
    const limit = searchParams.get('limit') || '500';

    if (!symbol || !interval) {
      return NextResponse.json(
        { error: 'Missing required parameters: symbol and interval' },
        { status: 400 }
      );
    }

    // Validate symbol format
    const upperSymbol = symbol.toUpperCase();
    
    // Validate interval
    const validIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];
    if (!validIntervals.includes(interval)) {
      return NextResponse.json(
        { error: `Invalid interval: ${interval}` },
        { status: 400 }
      );
    }

    // Validate limit
    const limitNum = parseInt(limit, 10);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
      return NextResponse.json(
        { error: 'Limit must be between 1 and 1000' },
        { status: 400 }
      );
    }

    // Try to get from Redis cache first
    try {
      const cached = await getCachedCandles(upperSymbol, interval);
      if (cached && cached.length > 0) {
        // Return cached data (limit to requested amount)
        const limitedCached = cached.slice(-limitNum);
        console.log(`Returning ${limitedCached.length} cached candles for ${upperSymbol} ${interval}`);
        
        return NextResponse.json(limitedCached, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'X-Cache': 'HIT',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        });
      }
    } catch (redisError) {
      console.warn('Redis cache miss or error, fetching from Binance:', redisError);
    }

    // Fetch from Binance API if cache miss
    const url = `https://api.binance.com/api/v3/klines?symbol=${upperSymbol}&interval=${interval}&limit=${limitNum}`;
    
    console.log('Fetching from Binance API:', url);

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    // Fetch with proper headers
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.binance.com/',
        'Origin': 'https://www.binance.com',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Binance API error: ${response.status} ${response.statusText}`;
      
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.msg) {
          errorMessage = errorData.msg;
        }
      } catch (e) {
        // Use default error message
      }
      
      console.error('Binance API error:', response.status, errorText);
      return NextResponse.json(
        { error: errorMessage },
        { 
          status: response.status >= 500 ? 503 : response.status,
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      return NextResponse.json(
        { error: 'Invalid response format from Binance API' },
        { status: 500 }
      );
    }

    // Transform data to match our CandleData format
    const candles = data.map((d: any[]) => ({
      time: Math.floor(d[0] / 1000), // Convert milliseconds to seconds
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]),
    }));

    // Cache the candles in Redis (async, don't wait)
    setCachedCandles(upperSymbol, interval, candles, 300).catch((err) => {
      console.error('Error caching candles:', err);
    });

    // Return with CORS headers
    return NextResponse.json(candles, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Cache': 'MISS',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Error in Binance API proxy:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: `Failed to fetch from Binance: ${errorMessage}` },
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

// Handle OPTIONS for CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
