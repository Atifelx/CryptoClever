import { NextRequest, NextResponse } from 'next/server';
import { getCachedCryptoLogo, cacheCryptoLogo } from '../../../lib/redis';
import { getCryptoLogoUrl } from '../../../lib/cryptoLogos';

/**
 * API Route to get crypto logo URL with Redis caching
 * GET /api/crypto/logo?symbol=BTCUSDT&baseAsset=BTC
 * Uses ui-avatars.com - 100% free, reliable, always works
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const symbol = searchParams.get('symbol');
    const baseAsset = searchParams.get('baseAsset');

    if (!symbol) {
      return NextResponse.json(
        { error: 'Missing required parameter: symbol' },
        { status: 400 }
      );
    }

    // Try to get from Redis cache first
    const cachedLogo = await getCachedCryptoLogo(symbol);
    if (cachedLogo) {
      return NextResponse.json(
        { logoUrl: cachedLogo, cached: true },
        {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200', // Cache for 24 hours
          },
        }
      );
    }

    // Generate logo URL (ui-avatars.com - always works, 100% free)
    const logoUrl = getCryptoLogoUrl(symbol, baseAsset || undefined);

    // Cache in Redis (async, don't wait)
    cacheCryptoLogo(symbol, logoUrl, 86400).catch(() => {}); // Cache for 24 hours

    return NextResponse.json(
      { logoUrl, cached: false },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200',
        },
      }
    );
  } catch (error) {
    // Even on error, return a valid logo URL (ui-avatars always works)
    const searchParams = request.nextUrl.searchParams;
    const symbol = searchParams.get('symbol');
    const baseAsset = searchParams.get('baseAsset');
    const logoUrl = getCryptoLogoUrl(symbol || 'CRYPTO', baseAsset || undefined);
    
    return NextResponse.json(
      { logoUrl, cached: false },
      {
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
