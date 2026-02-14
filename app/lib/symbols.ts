/**
 * Symbol management and fetching from Binance
 */

export interface TradingPair {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  name: string;
  displayName: string;
}

export interface CategorizedPairs {
  [quoteAsset: string]: TradingPair[];
}

/**
 * Fetch all trading pairs from Binance API
 */
export async function fetchAllTradingPairs(): Promise<CategorizedPairs> {
  try {
    const response = await fetch('/api/binance/symbols');
    
    if (!response.ok) {
      throw new Error(`Failed to fetch symbols: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.pairs || {};
  } catch (error) {
    console.error('Error fetching trading pairs:', error);
    // Return empty object on error
    return {};
  }
}

/**
 * Get popular/featured pairs (for initial load)
 */
export function getPopularPairs(): TradingPair[] {
  return [
    { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', name: 'BTC/USDT', displayName: 'Bitcoin' },
    { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', name: 'ETH/USDT', displayName: 'Ethereum' },
    { symbol: 'BNBUSDT', baseAsset: 'BNB', quoteAsset: 'USDT', name: 'BNB/USDT', displayName: 'Binance Coin' },
    { symbol: 'SOLUSDT', baseAsset: 'SOL', quoteAsset: 'USDT', name: 'SOL/USDT', displayName: 'Solana' },
    { symbol: 'XRPUSDT', baseAsset: 'XRP', quoteAsset: 'USDT', name: 'XRP/USDT', displayName: 'Ripple' },
    { symbol: 'ADAUSDT', baseAsset: 'ADA', quoteAsset: 'USDT', name: 'ADA/USDT', displayName: 'Cardano' },
    { symbol: 'DOGEUSDT', baseAsset: 'DOGE', quoteAsset: 'USDT', name: 'DOGE/USDT', displayName: 'Dogecoin' },
    { symbol: 'MATICUSDT', baseAsset: 'MATIC', quoteAsset: 'USDT', name: 'MATIC/USDT', displayName: 'Polygon' },
    { symbol: 'DOTUSDT', baseAsset: 'DOT', quoteAsset: 'USDT', name: 'DOT/USDT', displayName: 'Polkadot' },
    { symbol: 'LTCUSDT', baseAsset: 'LTC', quoteAsset: 'USDT', name: 'LTC/USDT', displayName: 'Litecoin' },
  ];
}
