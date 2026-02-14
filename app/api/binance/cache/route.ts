import { NextRequest, NextResponse } from 'next/server';
import { appendCachedCandle, getCachedCandles, CachedCandle } from '../../../lib/redis';

/**
 * API Route to update Redis cache with new WebSocket candle data
 * Called when WebSocket receives new candle updates
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbol, interval, candle } = body;

    if (!symbol || !interval || !candle) {
      return NextResponse.json(
        { error: 'Missing required parameters: symbol, interval, candle' },
        { status: 400 }
      );
    }

    // Append candle to cache (silently fail if Redis is not available)
    const updatedCandles = await appendCachedCandle(
      symbol.toUpperCase(),
      interval,
      candle as CachedCandle
    );

    // Always return success - caching is optional
    return NextResponse.json(
      { success: true, candles: updatedCandles || [] },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      }
    );
  } catch (error) {
    // Silently fail - caching is optional, Redis may not be available
    // Return success anyway to prevent client errors
    return NextResponse.json(
      { success: true, candles: [] },
      { 
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * Get cached candles
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const symbol = searchParams.get('symbol');
    const interval = searchParams.get('interval');

    if (!symbol || !interval) {
      return NextResponse.json(
        { error: 'Missing required parameters: symbol and interval' },
        { status: 400 }
      );
    }

    const cached = await getCachedCandles(symbol.toUpperCase(), interval);

    return NextResponse.json(
      { candles: cached || [] },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      }
    );
  } catch (error) {
    console.error('Error getting cache:', error);
    return NextResponse.json(
      { error: 'Failed to get cache' },
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
