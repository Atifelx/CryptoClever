/**
 * Top trading pairs - will be populated from Binance 24h volume data
 * This list is a fallback if API fails
 */
export const TOP_50_POPULAR_PAIRS = [
  'BTCUSDT',
];

/**
 * Fetch top trading pairs by 24h volume from Binance
 * Returns top 80 pairs with highest trading volume (most liquid)
 */
export async function fetchTopTradingPairs(limit: number = 80): Promise<string[]> {
  // BTC only
  return ['BTCUSDT'];
}

/**
 * Check if a symbol is in the top 50 popular pairs
 */
export function isPopularPair(symbol: string): boolean {
  return symbol.toUpperCase() === 'BTCUSDT';
}

/**
 * Get priority for sorting (popular pairs first)
 */
export function getPairPriority(symbol: string): number {
  return symbol.toUpperCase() === 'BTCUSDT' ? 0 : 9999;
}
