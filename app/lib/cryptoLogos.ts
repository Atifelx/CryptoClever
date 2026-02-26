/**
 * Utility functions for fetching crypto logos
 * Primary: cryptoicon-api (https://farisaziz12.github.io/cryptoicon-api/icons/)
 * Fallback: ui-avatars.com when icon fails or base is invalid
 */

const CRYPTOICON_API_BASE = 'https://farisaziz12.github.io/cryptoicon-api/icons';

/**
 * Get fallback avatar URL (ui-avatars.com)
 * Used when cryptoicon-api icon is not available or fails to load
 */
export function getFallbackAvatarUrl(symbol: string, baseAsset?: string): string {
  let asset: string;
  if (baseAsset) {
    asset = baseAsset;
  } else {
    asset = symbol.replace(/USDT|BTC|ETH|BNB|BUSD|USDC|TRY|EUR|GBP|RUB|AUD|BRL|UAH|IDRT|NGN|RON|ZAR|VND|DAI|PAX|TUSD|RLUSD|USD1|U$/i, '');
  }

  if (!asset || asset.length === 0) {
    asset = symbol;
  }

  const displayName = asset.length > 4 ? asset.substring(0, 4).toUpperCase() : asset.toUpperCase();

  const colors = [
    '26a69a', '3b82f6', '8b5cf6', 'ec4899', 'f59e0b', '10b981', 'ef4444', '06b6d4', 'f97316', '6366f1',
  ];
  let hash = 0;
  const normalized = asset.toLowerCase().trim();
  for (let i = 0; i < normalized.length; i++) {
    hash = normalized.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorIndex = Math.abs(hash) % colors.length;
  const bgColor = colors[colorIndex];

  return `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=${bgColor}&color=fff&size=24&bold=true&format=png`;
}

/**
 * Get crypto logo URL
 * Primary: cryptoicon-api icons (e.g. eth.png, btc.png) for all symbols
 * Fallback: ui-avatars when derived base is empty or invalid
 */
export function getCryptoLogoUrl(symbol: string, baseAsset?: string): string {
  let asset: string;
  if (baseAsset) {
    asset = baseAsset;
  } else {
    asset = symbol.replace(/USDT|BTC|ETH|BNB|BUSD|USDC|TRY|EUR|GBP|RUB|AUD|BRL|UAH|IDRT|NGN|RON|ZAR|VND|DAI|PAX|TUSD|RLUSD|USD1|U$/i, '');
  }

  const normalized = asset?.trim().toLowerCase();
  if (!normalized || normalized.length === 0) {
    return getFallbackAvatarUrl(symbol, baseAsset);
  }

  return `${CRYPTOICON_API_BASE}/${normalized}.png`;
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
 * Check if an image URL is from cryptoicon-api (for cache TTL logic)
 */
export function isCryptoIconApiUrl(url: string): boolean {
  return url.includes('farisaziz12.github.io/cryptoicon-api');
}

/**
 * Check if an image URL is valid (client-side only)
 */
export async function isImageValid(url: string): Promise<boolean> {
  if (typeof window === 'undefined') return true;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
    setTimeout(() => resolve(false), 2000);
  });
}
