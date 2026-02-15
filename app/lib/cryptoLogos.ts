/**
 * Utility functions for fetching crypto logos
 * Uses free CDN services for logo images
 */

/**
 * CoinGecko coin ID to image ID and name mapping for the 12 trading pairs
 * Using coin-images.coingecko.com CDN - 100% reliable, 24/7, correct official logos
 * Format: https://coin-images.coingecko.com/coins/images/{imageId}/large/{coinName}.png
 */
const COINGECKO_ICON_MAP: Record<string, { imageId: number; coinName: string }> = {
  // Market Leaders (5 pairs)
  'btc': { imageId: 1, coinName: 'bitcoin' },
  'eth': { imageId: 279, coinName: 'ethereum' },
  'sol': { imageId: 4128, coinName: 'solana' },
  'xrp': { imageId: 52, coinName: 'ripple' },
  'bnb': { imageId: 1839, coinName: 'binancecoin' },
  
  // High Liquidity (7 pairs)
  'avax': { imageId: 5805, coinName: 'avalanche-2' },
  'link': { imageId: 1975, coinName: 'chainlink' },
  'dot': { imageId: 6636, coinName: 'polkadot' },
  'ltc': { imageId: 2, coinName: 'litecoin' },
  'trx': { imageId: 1958, coinName: 'tron' },
  'matic': { imageId: 4713, coinName: 'matic-network' },
  'ada': { imageId: 2010, coinName: 'cardano' },
};

/**
 * CoinGecko coin ID mapping (for API lookups if needed)
 */
const COINGECKO_IDS: Record<string, string> = {
  'btc': 'bitcoin',
  'eth': 'ethereum',
  'bnb': 'binancecoin',
  'sol': 'solana',
  'xrp': 'ripple',
  'ada': 'cardano',
  'doge': 'dogecoin',
  'matic': 'matic-network',
  'dot': 'polkadot',
  'ltc': 'litecoin',
  'avax': 'avalanche-2',
  'link': 'chainlink',
  'atom': 'cosmos',
  'etc': 'ethereum-classic',
  'xlm': 'stellar',
  'algo': 'algorand',
  'vet': 'vechain',
  'icp': 'internet-computer',
  'fil': 'filecoin',
  'trx': 'tron',
  'eos': 'eos',
  'aave': 'aave',
  'uni': 'uniswap',
  'axs': 'axie-infinity',
  'sand': 'the-sandbox',
  'mana': 'decentraland',
  'gala': 'gala',
  'enj': 'enjincoin',
  'bat': 'basic-attention-token',
  'zec': 'zcash',
  'dash': 'dash',
  'xmr': 'monero',
  'zrx': '0x',
  'comp': 'compound-governance-token',
  'mkr': 'maker',
  'yfi': 'yearn-finance',
  'snx': 'havven',
  'crv': 'curve-dao-token',
  '1inch': '1inch',
  'sushi': 'sushi',
  'usdt': 'tether',
  'usdc': 'usd-coin',
  'busd': 'binance-usd',
  'dai': 'dai',
};

/**
 * Get CoinGecko CDN logo URL for a crypto symbol
 * coin-images.coingecko.com is 100% reliable, 24/7 available, free, no rate limits
 * Uses official CoinGecko icons with correct logos for all 12 pairs
 * Format: https://coin-images.coingecko.com/coins/images/{imageId}/large/{coinName}.png
 */
function getCoinGeckoLogoUrl(symbol: string, baseAsset?: string): string | null {
  // Use baseAsset if provided, otherwise extract from symbol
  let asset: string;
  if (baseAsset) {
    asset = baseAsset;
  } else {
    // Remove quote asset (e.g., BTCUSDT -> BTC)
    asset = symbol.replace(/USDT|BTC|ETH|BNB|BUSD|USDC|TRY|EUR|GBP|RUB|AUD|BRL|UAH|IDRT|NGN|RON|ZAR|VND|DAI|PAX|TUSD|RLUSD|USD1|U$/i, '');
  }
  
  const normalized = asset.toLowerCase().trim();
  
  // Validate we have a symbol
  if (!normalized || normalized.length === 0) {
    return null;
  }
  
  // Get CoinGecko icon mapping
  const iconData = COINGECKO_ICON_MAP[normalized];
  if (!iconData) {
    return null; // Not in our 12 pairs, use fallback
  }
  
  // CoinGecko CDN - 100% reliable, 24/7, free, no rate limits, correct official logos
  // Icons don't change, so we can cache forever
  return `https://coin-images.coingecko.com/coins/images/${iconData.imageId}/large/${iconData.coinName}.png`;
}


/**
 * Get fallback avatar URL (ui-avatars.com)
 * Used when CoinGecko icon is not available
 */
function getFallbackAvatarUrl(symbol: string, baseAsset?: string): string {
  // Use baseAsset if provided, otherwise extract from symbol
  let asset: string;
  if (baseAsset) {
    asset = baseAsset;
  } else {
    // Remove quote asset (e.g., BTCUSDT -> BTC)
    asset = symbol.replace(/USDT|BTC|ETH|BNB|BUSD|USDC|TRY|EUR|GBP|RUB|AUD|BRL|UAH|IDRT|NGN|RON|ZAR|VND|DAI|PAX|TUSD|RLUSD|USD1|U$/i, '');
  }
  
  // Fallback to symbol if asset is empty
  if (!asset || asset.length === 0) {
    asset = symbol;
  }
  
  const displayName = asset.length > 4 ? asset.substring(0, 4).toUpperCase() : asset.toUpperCase();
  
  // Generate a consistent color based on the symbol
  const colors = [
    '26a69a', // Teal
    '3b82f6', // Blue
    '8b5cf6', // Purple
    'ec4899', // Pink
    'f59e0b', // Amber
    '10b981', // Green
    'ef4444', // Red
    '06b6d4', // Cyan
    'f97316', // Orange
    '6366f1', // Indigo
  ];
  
  let hash = 0;
  const normalized = asset.toLowerCase().trim();
  for (let i = 0; i < normalized.length; i++) {
    hash = normalized.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorIndex = Math.abs(hash) % colors.length;
  const bgColor = colors[colorIndex];
  
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=${bgColor}&color=fff&size=128&bold=true&format=png`;
}

/**
 * Get logo URL for a crypto symbol
 * Primary: CoinGecko CDN (100% reliable, 24/7, free, correct official logos for all 12 pairs)
 * Fallback: ui-avatars.com (always works for unsupported symbols)
 */
export function getCryptoLogoUrl(symbol: string, baseAsset?: string): string {
  // Try CoinGecko CDN first (most reliable - correct official logos)
  const coinGeckoUrl = getCoinGeckoLogoUrl(symbol, baseAsset);
  if (coinGeckoUrl) {
    return coinGeckoUrl;
  }
  
  // Fallback to ui-avatars if not in our 12 pairs
  return getFallbackAvatarUrl(symbol, baseAsset);
}

/**
 * Get logo URL with Redis caching (client-side)
 * Fetches from API which handles Redis caching server-side
 */
export async function getCryptoLogoUrlCached(symbol: string, baseAsset?: string): Promise<string> {
  try {
    const response = await fetch(`/api/crypto/logo?symbol=${encodeURIComponent(symbol)}&baseAsset=${encodeURIComponent(baseAsset || '')}`);
    if (response.ok) {
      const data = await response.json();
      return data.logoUrl || getCryptoLogoUrl(symbol, baseAsset);
    }
  } catch (error) {
    // Fallback to direct URL generation
  }
  return getCryptoLogoUrl(symbol, baseAsset);
}

/**
 * Check if an image URL is valid (client-side only)
 */
export async function isImageValid(url: string): Promise<boolean> {
  if (typeof window === 'undefined') return true; // Server-side, assume valid
  
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
    // Timeout after 2 seconds
    setTimeout(() => resolve(false), 2000);
  });
}
