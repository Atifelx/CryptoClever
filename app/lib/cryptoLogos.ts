/**
 * Utility functions for fetching crypto logos
 * Uses free CDN services for logo images
 */

/**
 * CoinGecko coin ID to image ID mapping for popular cryptocurrencies
 * These are the image IDs used in CoinGecko's CDN: https://assets.coingecko.com/coins/images/{id}/large/{symbol}.png
 * CoinGecko CDN is 100% reliable, 24/7 available, free, no rate limits
 */
const COINGECKO_IMAGE_IDS: Record<string, number> = {
  'btc': 1,           // Bitcoin
  'eth': 279,         // Ethereum
  'bnb': 1839,        // Binance Coin
  'sol': 4128,        // Solana
  'xrp': 52,          // Ripple
  'ada': 2010,        // Cardano
  'doge': 5,          // Dogecoin
  'matic': 4713,      // Polygon (MATIC)
  'dot': 6636,        // Polkadot
  'ltc': 2,           // Litecoin
  'avax': 5805,       // Avalanche
  'link': 1975,       // Chainlink
  'atom': 3794,       // Cosmos
  'etc': 1321,        // Ethereum Classic
  'xlm': 512,         // Stellar
  'algo': 4030,       // Algorand
  'vet': 3077,        // VeChain
  'icp': 8916,        // Internet Computer
  'fil': 4880,        // Filecoin
  'trx': 1958,        // Tron
  'eos': 1765,        // EOS
  'aave': 7278,       // Aave
  'uni': 12504,       // Uniswap
  'axs': 6783,        // Axie Infinity
  'sand': 12129,      // The Sandbox
  'mana': 1966,       // Decentraland
  'gala': 12493,      // Gala
  'enj': 2130,        // Enjin Coin
  'bat': 1697,        // Basic Attention Token
  'zec': 1437,        // Zcash
  'dash': 6636,       // Dash
  'xmr': 328,         // Monero
  'zrx': 1896,        // 0x
  'comp': 5692,       // Compound
  'mkr': 1518,        // Maker
  'yfi': 5864,        // Yearn Finance
  'snx': 2586,        // Synthetix
  'crv': 6538,        // Curve DAO
  '1inch': 8104,      // 1inch
  'sushi': 11976,     // SushiSwap
  'usdt': 825,        // Tether
  'usdc': 6319,       // USD Coin
  'busd': 5036,       // Binance USD
  'dai': 4943,        // Dai
  'near': 11165,      // NEAR Protocol
  'ftm': 3513,        // Fantom
  'arb': 16547,       // Arbitrum
  'op': 11840,        // Optimism
  'apt': 26455,       // Aptos
  'sui': 20947,       // Sui
  'ton': 17976,       // Toncoin
  'wld': 22861,       // Worldcoin
  'rndr': 5692,       // Render
  'inj': 7226,        // Injective
  'sei': 28298,       // Sei
  'tia': 22861,       // Celestia
  'ldo': 13573,       // Lido DAO
  'stx': 1230,        // Stacks
  'rune': 4157,       // THORChain
  'mnt': 27075,       // Mantle
  'imx': 17233,       // Immutable X
  'grt': 6719,        // The Graph
  'hbar': 4642,       // Hedera
  'qnt': 3375,        // Quant
  'egld': 4892,       // MultiversX (Elrond)
  'flow': 4558,       // Flow
  'theta': 3436,      // Theta Network
  'xtz': 976,         // Tezos
  'wbtc': 3718,       // Wrapped Bitcoin
  'steth': 13442,     // Lido Staked ETH
  'pepe': 29850,      // Pepe
  'shib': 11939,      // Shiba Inu
  'floki': 18388,     // Floki
  'bonk': 28324,      // Bonk
  'wif': 29217,       // dogwifhat
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
 * Get GitHub raw content logo URL for a crypto symbol
 * GitHub raw content is 100% reliable, 24/7 available, free, no rate limits, no CORS issues
 * Format: https://raw.githubusercontent.com/cjdowner/cryptocurrency-icons/master/128/color/{symbol}.png
 * This is the most reliable source - always works, no restrictions
 */
function getGitHubLogoUrl(symbol: string, baseAsset?: string): string | null {
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
  
  // GitHub raw content - 100% reliable, 24/7, free, no rate limits, no CORS
  // Icons don't change, so we can cache forever
  // This repository has 200+ cryptocurrency icons
  return `https://raw.githubusercontent.com/cjdowner/cryptocurrency-icons/master/128/color/${normalized}.png`;
}

/**
 * Get CoinGecko alternative CDN logo URL (backup)
 * Format: https://coin-images.coingecko.com/coins/images/{imageId}/large/bitcoin.png
 */
function getCoinGeckoAltLogoUrl(symbol: string, baseAsset?: string): string | null {
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
  
  // Map to CoinGecko coin names
  const coinGeckoNames: Record<string, string> = {
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
  
  const coinGeckoName = coinGeckoNames[normalized];
  if (!coinGeckoName) {
    return null;
  }
  
  const imageId = COINGECKO_IMAGE_IDS[normalized];
  if (!imageId) {
    return null;
  }
  
  // Alternative CoinGecko CDN - more reliable than assets.coingecko.com
  return `https://coin-images.coingecko.com/coins/images/${imageId}/large/${coinGeckoName}.png`;
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
 * Primary: GitHub raw content (100% reliable, 24/7, free, no rate limits, no CORS)
 * Secondary: CoinGecko alternative CDN (backup)
 * Fallback: ui-avatars.com (always works)
 */
export function getCryptoLogoUrl(symbol: string, baseAsset?: string): string {
  // Try GitHub raw content first (most reliable - always works, no restrictions)
  const githubUrl = getGitHubLogoUrl(symbol, baseAsset);
  if (githubUrl) {
    return githubUrl;
  }
  
  // Try CoinGecko alternative CDN as backup
  const coinGeckoUrl = getCoinGeckoAltLogoUrl(symbol, baseAsset);
  if (coinGeckoUrl) {
    return coinGeckoUrl;
  }
  
  // Fallback to ui-avatars if no icon available
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
