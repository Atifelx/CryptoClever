/**
 * Top trading pairs - will be populated from Binance 24h volume data
 * This list is a fallback if API fails
 */
export const TOP_50_POPULAR_PAIRS = [
  'BTCUSDT',
  'ETHUSDT',
  'BNBUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'ADAUSDT',
  'DOGEUSDT',
  'MATICUSDT',
  'DOTUSDT',
  'LTCUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'ATOMUSDT',
  'ETCUSDT',
  'XLMUSDT',
  'ALGOUSDT',
  'VETUSDT',
  'ICPUSDT',
  'FILUSDT',
  'TRXUSDT',
  'EOSUSDT',
  'AAVEUSDT',
  'UNIUSDT',
  'AXSUSDT',
  'SANDUSDT',
  'MANAUSDT',
  'GALAUSDT',
  'ENJUSDT',
  'BATUSDT',
  'ZECUSDT',
  'DASHUSDT',
  'XMRUSDT',
  'ZRXUSDT',
  'COMPUSDT',
  'MKRUSDT',
  'YFIUSDT',
  'SNXUSDT',
  'CRVUSDT',
  '1INCHUSDT',
  'SUSHIUSDT',
  'NEARUSDT',
  'APTUSDT',
  'ARBUSDT',
  'OPUSDT',
  'INJUSDT',
  'SUIUSDT',
  'SEIUSDT',
  'TIAUSDT',
  'RENDERUSDT',
  'FETUSDT',
];

/**
 * Fetch top trading pairs by 24h volume from Binance
 * Returns top 80 pairs with highest trading volume (most liquid)
 */
export async function fetchTopTradingPairs(limit: number = 80): Promise<string[]> {
  try {
    const response = await fetch('/api/binance/ticker');
    if (!response.ok) {
      // Fallback to static list
      return TOP_50_POPULAR_PAIRS.slice(0, limit);
    }
    
    const data = await response.json();
    if (data.tickers && Array.isArray(data.tickers)) {
      // Return top N pairs by volume
      return data.tickers.slice(0, limit).map((ticker: any) => ticker.symbol);
    }
    
    return TOP_50_POPULAR_PAIRS.slice(0, limit);
  } catch (error) {
    console.error('Error fetching top trading pairs:', error);
    // Fallback to static list
    return TOP_50_POPULAR_PAIRS.slice(0, limit);
  }
}

/**
 * Check if a symbol is in the top 50 popular pairs
 */
export function isPopularPair(symbol: string): boolean {
  return TOP_50_POPULAR_PAIRS.includes(symbol.toUpperCase());
}

/**
 * Get priority for sorting (popular pairs first)
 */
export function getPairPriority(symbol: string): number {
  const index = TOP_50_POPULAR_PAIRS.indexOf(symbol.toUpperCase());
  return index >= 0 ? index : 9999; // Popular pairs get low numbers, others get high
}
