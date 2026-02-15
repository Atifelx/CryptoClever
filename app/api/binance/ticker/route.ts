import { NextRequest, NextResponse } from 'next/server';

/**
 * API Route to fetch 24h ticker statistics from Binance
 * Returns volume and price data for all trading pairs
 * Used to filter by trading volume/liquidity
 */
export async function GET(request: NextRequest) {
  try {
    const url = 'https://api.binance.com/api/v3/ticker/24hr';
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

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
      // Handle 451 (restricted location) error
      if (response.status === 451) {
        return NextResponse.json(
          { 
            error: 'Service unavailable from a restricted location. This may occur when the server is in a restricted region.',
            code: 'RESTRICTED_LOCATION'
          },
          { status: 503 } // Return 503 instead of 451
        );
      }
      return NextResponse.json(
        { error: `Binance API error: ${response.status}` },
        { status: response.status >= 500 ? 503 : response.status }
      );
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      return NextResponse.json(
        { error: 'Invalid response format from Binance API' },
        { status: 500 }
      );
    }

    // Filter only USDT pairs and include all trading metrics
    const usdtPairs = data
      .filter((ticker: any) => ticker.symbol.endsWith('USDT'))
      .map((ticker: any) => ({
        symbol: ticker.symbol,
        volume: parseFloat(ticker.quoteVolume || ticker.volume || '0'), // Use quoteVolume (USDT volume)
        priceChange: parseFloat(ticker.priceChangePercent || '0'),
        lastPrice: parseFloat(ticker.lastPrice || '0'),
        highPrice: parseFloat(ticker.highPrice || '0'),
        lowPrice: parseFloat(ticker.lowPrice || '0'),
        count: parseFloat(ticker.count || '0'), // Number of trades in 24h
        priceChangePercent: parseFloat(ticker.priceChangePercent || '0'),
      }));

    return NextResponse.json(
      {
        tickers: usdtPairs,
        total: usdtPairs.length,
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30', // Cache for 1 minute (dynamic data)
        },
      }
    );
  } catch (error) {
    console.error('Error fetching Binance ticker:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: `Failed to fetch ticker data: ${errorMessage}` },
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
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
