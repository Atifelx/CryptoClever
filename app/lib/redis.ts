/**
 * Redis Client for caching WebSocket stream data
 * Caches historical candle data and WebSocket updates for faster loading
 */

import Redis from 'ioredis';

// Initialize Redis client (optional - app works without Redis)
// For local development, use: redis://localhost:6379
// For production, use environment variable: REDIS_URL
let redis: Redis | null = null;
let redisEnabled = false;

try {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  redis = new Redis(redisUrl, {
    retryStrategy: (times) => {
      // Don't retry if Redis is not available
      if (times > 3) return null;
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true, // Don't connect immediately
  });

  redis.on('error', (err) => {
    console.warn('Redis not available, running without cache:', err.message);
    redisEnabled = false;
  });

  redis.on('connect', () => {
    console.log('Redis Client Connected - Caching enabled');
    redisEnabled = true;
  });

  // Try to connect
  redis.connect().catch(() => {
    console.warn('Redis connection failed, running without cache');
    redisEnabled = false;
  });
} catch (error) {
  console.warn('Redis initialization failed, running without cache');
  redisEnabled = false;
}

export interface CachedCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Generate cache key for symbol and interval
 */
function getCacheKey(symbol: string, interval: string): string {
  return `candles:${symbol.toUpperCase()}:${interval}`;
}

/**
 * Get cached candles from Redis
 */
export async function getCachedCandles(
  symbol: string,
  interval: string
): Promise<CachedCandle[] | null> {
  if (!redis || !redisEnabled) return null;
  
  try {
    const key = getCacheKey(symbol, interval);
    const cached = await redis.get(key);
    
    if (cached) {
      const candles = JSON.parse(cached) as CachedCandle[];
      // Check if cache is still valid (not older than 5 minutes)
      if (candles.length > 0) {
        return candles;
      }
    }
    return null;
  } catch (error) {
    // Silently fail - Redis is optional
    return null;
  }
}

/**
 * Cache candles in Redis with TTL
 */
export async function setCachedCandles(
  symbol: string,
  interval: string,
  candles: CachedCandle[],
  ttl: number = 300 // 5 minutes default TTL
): Promise<void> {
  if (!redis || !redisEnabled) return;
  
  try {
    const key = getCacheKey(symbol, interval);
    await redis.setex(key, ttl, JSON.stringify(candles));
  } catch (error) {
    // Silently fail - Redis is optional
  }
}

/**
 * Append new candle to cached data (for WebSocket updates)
 */
export async function appendCachedCandle(
  symbol: string,
  interval: string,
  candle: CachedCandle
): Promise<CachedCandle[]> {
  if (!redis || !redisEnabled) return [];
  
  try {
    const key = getCacheKey(symbol, interval);
    const cached = await redis.get(key);
    
    let candles: CachedCandle[] = [];
    if (cached) {
      candles = JSON.parse(cached) as CachedCandle[];
    }
    
    // Find if candle with same time exists
    const existingIndex = candles.findIndex((c) => c.time === candle.time);
    
    if (existingIndex >= 0) {
      // Update existing candle
      candles[existingIndex] = candle;
    } else {
      // Add new candle
      candles.push(candle);
      // Keep only last 500 candles
      if (candles.length > 500) {
        candles.shift();
      }
      // Sort by time
      candles.sort((a, b) => a.time - b.time);
    }
    
    // Update cache
    await redis.setex(key, 300, JSON.stringify(candles));
    
    return candles;
  } catch (error) {
    // Silently fail - Redis is optional
    return [];
  }
}

/**
 * Clear cache for a specific symbol/interval
 */
export async function clearCache(symbol: string, interval: string): Promise<void> {
  if (!redis || !redisEnabled) return;
  
  try {
    const key = getCacheKey(symbol, interval);
    await redis.del(key);
  } catch (error) {
    // Silently fail
  }
}

/**
 * Get Redis connection status
 */
export async function isRedisConnected(): Promise<boolean> {
  if (!redis || !redisEnabled) return false;
  
  try {
    await redis.ping();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Cache crypto logo URL in Redis
 */
export async function cacheCryptoLogo(symbol: string, logoUrl: string, ttl: number = 86400): Promise<void> {
  if (!redis || !redisEnabled) return;
  
  try {
    const key = `logo:${symbol.toUpperCase()}`;
    await redis.setex(key, ttl, logoUrl); // Cache for 24 hours by default
  } catch (error) {
    // Silently fail - caching is optional
  }
}

/**
 * Get cached crypto logo URL from Redis
 */
export async function getCachedCryptoLogo(symbol: string): Promise<string | null> {
  if (!redis || !redisEnabled) return null;
  
  try {
    const key = `logo:${symbol.toUpperCase()}`;
    const cached = await redis.get(key);
    return cached;
  } catch (error) {
    return null;
  }
}

/**
 * Batch get cached crypto logos
 */
export async function getCachedCryptoLogos(symbols: string[]): Promise<Record<string, string>> {
  if (!redis || !redisEnabled) return {};
  
  try {
    const keys = symbols.map(s => `logo:${s.toUpperCase()}`);
    const values = await redis.mget(...keys);
    const result: Record<string, string> = {};
    
    symbols.forEach((symbol, index) => {
      if (values[index]) {
        result[symbol.toUpperCase()] = values[index] as string;
      }
    });
    
    return result;
  } catch (error) {
    return {};
  }
}

export default redis;
