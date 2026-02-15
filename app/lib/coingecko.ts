/**
 * CoinGecko API Integration
 * Free API with no geographical restrictions
 * Used as fallback when Binance API is blocked
 */

export interface CoinGeckoCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Map Binance symbols to CoinGecko IDs
 */
const SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  'BTCUSDT': 'bitcoin',
  'ETHUSDT': 'ethereum',
  'BNBUSDT': 'binancecoin',
  'SOLUSDT': 'solana',
  'XRPUSDT': 'ripple',
  'ADAUSDT': 'cardano',
  'DOGEUSDT': 'dogecoin',
  'MATICUSDT': 'matic-network',
  'DOTUSDT': 'polkadot',
  'LTCUSDT': 'litecoin',
  'AVAXUSDT': 'avalanche-2',
  'LINKUSDT': 'chainlink',
  'ATOMUSDT': 'cosmos',
  'ETCUSDT': 'ethereum-classic',
  'XLMUSDT': 'stellar',
  'ALGOUSDT': 'algorand',
  'VETUSDT': 'vechain',
  'ICPUSDT': 'internet-computer',
  'FILUSDT': 'filecoin',
  'TRXUSDT': 'tron',
  'EOSUSDT': 'eos',
  'AAVEUSDT': 'aave',
  'UNIUSDT': 'uniswap',
  'AXSUSDT': 'axie-infinity',
  'SANDUSDT': 'the-sandbox',
  'MANAUSDT': 'decentraland',
  'GALAUSDT': 'gala',
  'ENJUSDT': 'enjincoin',
  'BATUSDT': 'basic-attention-token',
  'ZECUSDT': 'zcash',
  'DASHUSDT': 'dash',
  'XMRUSDT': 'monero',
  'ZRXUSDT': '0x',
  'COMPUSDT': 'compound-governance-token',
  'MKRUSDT': 'maker',
  'YFIUSDT': 'yearn-finance',
  'SNXUSDT': 'havven',
  'CRVUSDT': 'curve-dao-token',
  '1INCHUSDT': '1inch',
  'SUSHIUSDT': 'sushi',
  'USDTUSDT': 'tether',
  'USDCUSDT': 'usd-coin',
  'BUSDUSDT': 'binance-usd',
  'DAIUSDT': 'dai',
};

/**
 * Map Binance intervals to CoinGecko days
 * CoinGecko OHLC endpoint uses days, not intervals
 */
const INTERVAL_TO_DAYS: Record<string, number> = {
  '1m': 1,   // 1 day of data (CoinGecko minimum)
  '5m': 1,   // 1 day of data
  '15m': 1,  // 1 day of data
  '30m': 1,  // 1 day of data
  '1h': 7,   // 7 days of data
  '4h': 30,  // 30 days of data
  '1d': 365, // 365 days of data
  '1D': 365, // 365 days of data
};

/**
 * Get CoinGecko ID from Binance symbol
 */
export function getCoinGeckoId(symbol: string): string | null {
  const upperSymbol = symbol.toUpperCase();
  return SYMBOL_TO_COINGECKO_ID[upperSymbol] || null;
}

/**
 * Fetch OHLC data from CoinGecko
 * @param symbol Binance symbol (e.g., BTCUSDT)
 * @param interval Binance interval (e.g., 1h)
 * @param limit Number of candles (CoinGecko returns all available, we'll limit)
 */
export async function fetchCoinGeckoOHLC(
  symbol: string,
  interval: string,
  limit: number = 500
): Promise<CoinGeckoCandle[]> {
  const coinGeckoId = getCoinGeckoId(symbol);
  
  if (!coinGeckoId) {
    throw new Error(`CoinGecko ID not found for symbol: ${symbol}`);
  }

  const days = INTERVAL_TO_DAYS[interval] || INTERVAL_TO_DAYS['1h'];
  const url = `https://api.coingecko.com/api/v3/coins/${coinGeckoId}/ohlc?vs_currency=usd&days=${days}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      // Add timeout
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error('Invalid response format from CoinGecko API');
    }

    // Transform CoinGecko format [timestamp, open, high, low, close] to our format
    // CoinGecko returns timestamps in milliseconds
    const candles: CoinGeckoCandle[] = data
      .map(([timestamp, open, high, low, close]: number[]) => {
        // CoinGecko timestamp is in milliseconds, convert to seconds
        const timeInSeconds = Math.floor(timestamp / 1000);
        return {
          time: timeInSeconds,
          open: parseFloat(open.toString()),
          high: parseFloat(high.toString()),
          low: parseFloat(low.toString()),
          close: parseFloat(close.toString()),
          volume: 0, // CoinGecko OHLC doesn't include volume
        };
      })
      .filter((candle) => candle.time > 0) // Filter out invalid timestamps
      .slice(-limit); // Take last N candles

    return candles;
  } catch (error) {
    console.error('Error fetching CoinGecko OHLC:', error);
    throw error;
  }
}

/**
 * Check if CoinGecko supports a symbol
 */
export function isCoinGeckoSupported(symbol: string): boolean {
  return getCoinGeckoId(symbol) !== null;
}
