/**
 * Utility functions for fetching crypto logos
 * Uses free CDN services for logo images
 */

/**
 * Get CoinGecko coin ID mapping for popular cryptocurrencies
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
 * Get logo URL for a crypto symbol
 * Uses reliable free avatar service that always works (100% free, no rate limits)
 */
export function getCryptoLogoUrl(symbol: string, baseAsset?: string): string {
  // Remove quote asset (e.g., BTCUSDT -> BTC)
  const asset = baseAsset || symbol.replace(/USDT|BTC|ETH|BNB|BUSD|USDC|TRY|EUR|GBP|RUB|AUD|BRL|UAH|IDRT|NGN|RON|ZAR|VND|DAI|PAX|TUSD|RLUSD|USD1|U$/i, '');
  const normalized = asset.toLowerCase().trim();

  // Use ui-avatars.com - 100% free, reliable, no rate limits, always works
  // Generates beautiful colored avatars with crypto symbol initials
  const displayName = asset.length > 4 ? asset.substring(0, 4).toUpperCase() : asset.toUpperCase();
  
  // Generate a consistent color based on the symbol (so same symbol always gets same color)
  const colors = [
    '26a69a', // Teal (primary brand color)
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
  
  // Simple hash function to get consistent color for same symbol
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = normalized.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorIndex = Math.abs(hash) % colors.length;
  const bgColor = colors[colorIndex];
  
  // Return reliable avatar URL that always works
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=${bgColor}&color=fff&size=128&bold=true&format=png`;
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
 * Get CoinGecko image ID for common cryptocurrencies
 * These are the image IDs used in CoinGecko's CDN
 */
function getCoinGeckoImageId(symbol: string): string {
  const mapping: Record<string, string> = {
    'btc': '1',
    'eth': '279',
    'bnb': '1839',
    'sol': '4128',
    'xrp': '52',
    'ada': '2010',
    'doge': '5',
    'matic': '4713',
    'dot': '6636',
    'ltc': '2',
    'avax': '5805',
    'link': '1975',
    'atom': '3794',
    'etc': '1321',
    'xlm': '512',
    'algo': '4030',
    'vet': '3077',
    'icp': '8916',
    'fil': '4880',
    'trx': '1958',
    'eos': '1765',
    'aave': '7278',
    'uni': '12504',
    'axs': '6783',
    'sand': '12129',
    'mana': '1966',
    'gala': '12493',
    'enj': '2130',
    'bat': '1697',
    'zec': '1437',
    'dash': '6636',
    'xmr': '328',
    'zrx': '1896',
    'comp': '5692',
    'mkr': '1518',
    'yfi': '5864',
    'snx': '2586',
    'crv': '6538',
    '1inch': '8104',
    'sushi': '11976',
    'usdt': '825',
    'usdc': '6319',
    'busd': '5036',
    'dai': '4943',
  };

  return mapping[symbol] || '1'; // Default to Bitcoin if not found
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
