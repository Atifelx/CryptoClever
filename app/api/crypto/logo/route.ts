import { NextRequest, NextResponse } from 'next/server';
import { getCachedCryptoLogo, cacheCryptoLogo } from '../../../lib/redis';
import { getCryptoLogoUrl } from '../../../lib/cryptoLogos';

/**
 * API Route to get crypto logo URL with Redis caching
 * GET /api/crypto/logo?symbol=BTCUSDT&baseAsset=BTC
 * 
 * Uses CoinGecko CDN as primary source (100% reliable, 24/7, free, no rate limits)
 * Falls back to ui-avatars.com if CoinGecko icon not available
 * 
 * Icons are cached in Redis forever (since CoinGecko icons don't change)
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

    // Generate logo URL (CoinGecko CDN first, fallback to ui-avatars)
    const logoUrl = getCryptoLogoUrl(symbol, baseAsset || undefined);
    
    // Determine source
    const isCoinGecko = logoUrl.includes('coin-images.coingecko.com');
    const source = isCoinGecko ? 'coingecko' : 'ui-avatars';

    // Cache in Redis - CoinGecko icons cache forever (no expiry), fallback cache for 30 days
    // Since CoinGecko icons don't change, we can cache them indefinitely
    const ttl = isCoinGecko ? 0 : 2592000; // 0 = no expiry for CoinGecko, 30 days for fallback
    cacheCryptoLogo(symbol, logoUrl, ttl).catch(() => {});

    return NextResponse.json(
      { logoUrl, cached: false, source },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Cache-Control': isCoinGecko
            ? 'public, s-maxage=31536000, immutable' // CoinGecko icons: cache forever
            : 'public, s-maxage=2592000, stale-while-revalidate=86400', // Fallback: 30 days
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
