import { NextRequest, NextResponse } from 'next/server';
import { getCachedCryptoLogo, cacheCryptoLogo } from '../../../lib/redis';
import { getCryptoLogoUrl, isCryptoIconApiUrl } from '../../../lib/cryptoLogos';

/**
 * API Route to get crypto logo URL with Redis caching
 * GET /api/crypto/logo?symbol=BTCUSDT&baseAsset=BTC
 *
 * Uses cryptoicon-api as primary source (https://farisaziz12.github.io/cryptoicon-api/icons/)
 * Falls back to ui-avatars.com when icon is invalid or fails
 *
 * Icons are cached in Redis (long-lived for cryptoicon-api)
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

    // Try to get from Redis cache first (icons don't change, cache forever)
    const cachedLogo = await getCachedCryptoLogo(symbol);
    if (cachedLogo) {
      return NextResponse.json(
        { logoUrl: cachedLogo, cached: true, source: 'redis' },
        {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Cache-Control': 'public, s-maxage=31536000, immutable', // Cache for 1 year (icons don't change)
          },
        }
      );
    }

    // Generate logo URL (cryptoicon-api first, fallback to ui-avatars)
    const logoUrl = getCryptoLogoUrl(symbol, baseAsset || undefined);

    const isCryptoIcon = isCryptoIconApiUrl(logoUrl);
    const source = isCryptoIcon ? 'cryptoicon-api' : 'ui-avatars';

    // Cache in Redis - cryptoicon-api icons long-lived, fallback 30 days
    const ttl = isCryptoIcon ? 0 : 2592000;
    cacheCryptoLogo(symbol, logoUrl, ttl).catch(() => {});

    return NextResponse.json(
      { logoUrl, cached: false, source },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Cache-Control': isCryptoIcon
            ? 'public, s-maxage=31536000, immutable'
            : 'public, s-maxage=2592000, stale-while-revalidate=86400',
        },
      }
    );
  } catch (error) {
    // Even on error, return a valid logo URL (fallback always works)
    const searchParams = request.nextUrl.searchParams;
    const symbol = searchParams.get('symbol');
    const baseAsset = searchParams.get('baseAsset');
    const logoUrl = getCryptoLogoUrl(symbol || 'CRYPTO', baseAsset || undefined);
    
    return NextResponse.json(
      { logoUrl, cached: false, source: 'fallback' },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=43200',
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
