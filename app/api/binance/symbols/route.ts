import { NextRequest, NextResponse } from 'next/server';
import { getCryptoLogoUrl } from '../../../lib/cryptoLogos';
import { getCachedCryptoLogo, cacheCryptoLogo } from '../../../lib/redis';

/**
 * API Route to fetch all available trading pairs from Binance
 * Returns all active trading pairs categorized by quote currency
 */
export async function GET(request: NextRequest) {
  try {
    // Fetch exchange info from Binance
    const url = 'https://api.binance.com/api/v3/exchangeInfo';
    
    // Create abort controller for timeout
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

    if (!data.symbols || !Array.isArray(data.symbols)) {
      return NextResponse.json(
        { error: 'Invalid response format from Binance API' },
        { status: 500 }
      );
    }

    // Filter only active spot trading pairs
    const activePairs = data.symbols.filter((symbol: any) => {
      const isTrading = symbol.status === 'TRADING';
      const hasSpotPermission = 
        (symbol.permissions && symbol.permissions.includes('SPOT')) ||
        (symbol.permissionSets && Array.isArray(symbol.permissionSets) && 
         symbol.permissionSets.some((set: any) => Array.isArray(set) && set.includes('SPOT'))) ||
        symbol.isSpotTradingAllowed === true;
      return isTrading && hasSpotPermission;
    });

    // Fetch 24h ticker data to get volume information and filter to top 80
    let topVolumePairs: Set<string> = new Set();
    try {
      const tickerUrl = 'https://api.binance.com/api/v3/ticker/24hr';
      const tickerController = new AbortController();
      const tickerTimeout = setTimeout(() => tickerController.abort(), 10000);
      
      const tickerResponse = await fetch(tickerUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.binance.com/',
          'Origin': 'https://www.binance.com',
        },
        signal: tickerController.signal,
      });
      
      clearTimeout(tickerTimeout);
      
      if (tickerResponse.ok) {
        const tickerData = await tickerResponse.json();
        if (Array.isArray(tickerData)) {
          // Filter USDT pairs, sort by volume (quoteVolume = USDT volume), take top 80
          const topPairs = tickerData
            .filter((t: any) => t.symbol.endsWith('USDT'))
            .map((t: any) => ({
              symbol: t.symbol,
              volume: parseFloat(t.quoteVolume || t.volume || '0'),
            }))
            .sort((a: any, b: any) => b.volume - a.volume)
            .slice(0, 80)
            .map((t: any) => t.symbol);
          
          topVolumePairs = new Set(topPairs);
          console.log(`Filtered to top ${topPairs.length} pairs by 24h volume`);
        }
      }
    } catch (error) {
      console.warn('Could not fetch ticker data for volume filtering, showing all pairs:', error);
      // Continue without filtering - show all pairs if ticker fails
    }

    // Categorize by quote currency
    const categorized: Record<string, any[]> = {
      USDT: [],
      BTC: [],
      ETH: [],
      BNB: [],
      BUSD: [],
      USDC: [],
      TUSD: [],
      DAI: [],
      PAX: [],
      TRY: [],
      EUR: [],
      GBP: [],
      RUB: [],
      AUD: [],
      BRL: [],
      UAH: [],
      IDRT: [],
      NGN: [],
      RON: [],
      ZAR: [],
      VND: [],
      OTHER: [],
    };

    // Process pairs - only include top 80 by volume if available
    const pairsToProcess = topVolumePairs.size > 0
      ? activePairs.filter((s: any) => topVolumePairs.has(s.symbol))
      : activePairs.slice(0, 80); // Fallback: take first 80 if no volume data
    
    // Process pairs and generate logos (ui-avatars is instant, no need for async)
    for (const symbol of pairsToProcess) {
      const quoteAsset = symbol.quoteAsset;
      const baseAsset = symbol.baseAsset;
      const symbolKey = symbol.symbol;
      
      // Generate logo URL (ui-avatars is 100% reliable, always works)
      const logoUrl = getCryptoLogoUrl(symbolKey, baseAsset);
      
      // Cache in Redis (async, don't block)
      getCachedCryptoLogo(symbolKey).then((cached) => {
        if (!cached) {
          cacheCryptoLogo(symbolKey, logoUrl, 86400).catch(() => {}); // Cache for 24 hours
        }
      }).catch(() => {});
      
      const pairInfo = {
        symbol: symbolKey,
        baseAsset: baseAsset,
        quoteAsset: quoteAsset,
        name: `${baseAsset}/${quoteAsset}`,
        status: symbol.status,
        logoUrl: logoUrl,
      };

      if (categorized[quoteAsset]) {
        categorized[quoteAsset].push(pairInfo);
      } else {
        categorized.OTHER.push(pairInfo);
      }
    }

    // Sort each category alphabetically
    Object.keys(categorized).forEach((key) => {
      categorized[key].sort((a, b) => a.baseAsset.localeCompare(b.baseAsset));
    });

    // Return categorized pairs
    return NextResponse.json(
      {
        pairs: categorized,
        total: pairsToProcess.length,
        categories: Object.keys(categorized).filter(key => categorized[key].length > 0),
      },
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=1800', // Cache for 1 hour
        },
      }
    );
  } catch (error) {
    console.error('Error fetching Binance symbols:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: `Failed to fetch symbols: ${errorMessage}` },
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
