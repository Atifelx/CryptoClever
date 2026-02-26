/**
 * Binance Free API Integration
 * 100% free, no API key required, no authentication
 */

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export class BinanceWebSocket {
  private ws: WebSocket | null = null;
  private symbol: string;
  private interval: string;
  private onCandle: (candle: Candle) => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isManualClose = false;

  constructor(symbol: string, interval: string, onCandle: (candle: Candle) => void) {
    this.symbol = symbol.toLowerCase();
    this.interval = interval;
    this.onCandle = onCandle;
    this.connect();
  }

  private connect() {
    if (this.isManualClose) return;

    const url = `wss://stream.binance.com:9443/ws/${this.symbol}@kline_${this.interval}`;
    
    try {
      this.ws = new WebSocket(url);
      
      this.ws.onopen = () => {
        console.log(`Connected to Binance WebSocket: ${this.symbol}@${this.interval}`);
        this.reconnectAttempts = 0;
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.k) {
            const candle: Candle = {
              time: Math.floor(data.k.t / 1000), // Convert milliseconds to seconds
              open: parseFloat(data.k.o),
              high: parseFloat(data.k.h),
              low: parseFloat(data.k.l),
              close: parseFloat(data.k.c),
              volume: parseFloat(data.k.v)
            };
            
            // Cache to Redis (fire and forget, don't block)
            // Use AbortController with timeout to prevent hanging requests
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout
            
            fetch('/api/binance/cache', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                symbol: this.symbol.toUpperCase(),
                interval: this.interval,
                candle,
              }),
              signal: controller.signal,
            })
            .then(() => {
              clearTimeout(timeoutId);
            })
            .catch(() => {
              clearTimeout(timeoutId);
              // Silently fail - caching is optional, Redis may not be available
            });
            
            this.onCandle(candle);
          }
        } catch (error) {
          console.error('Error parsing Binance WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('Binance WebSocket error:', error);
      };

      this.ws.onclose = (event) => {
        // Only reconnect if it wasn't a manual close
        if (!this.isManualClose && event.code !== 1000) {
          console.log(`Binance WebSocket closed (code: ${event.code}), reconnecting...`);
          this.handleReconnect();
        } else if (this.isManualClose) {
          console.log('Binance WebSocket manually closed');
        }
      };
    } catch (error) {
      console.error('Failed to create Binance WebSocket:', error);
      if (!this.isManualClose) {
        this.handleReconnect();
      }
    }
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Reconnecting... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      this.reconnectTimeout = setTimeout(() => this.connect(), 3000);
    } else {
      console.error('Max reconnection attempts reached');
    }
  }

  disconnect() {
    this.isManualClose = true;
    
    // Clear any pending reconnection attempts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    // Close WebSocket connection
    if (this.ws) {
      // Remove all event listeners to prevent reconnection
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      
      // Close the connection
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      
      this.ws = null;
    }
  }

  updateSymbol(symbol: string, interval: string) {
    this.disconnect();
    this.isManualClose = false;
    this.reconnectAttempts = 0;
    this.symbol = symbol.toLowerCase();
    this.interval = interval;
    this.connect();
  }
}

export async function fetchBinanceHistory(
  symbol: string,
  interval: string,
  limit: number = 500,
  signal?: AbortSignal
): Promise<Candle[]> {
  try {
    // Use Next.js API route to avoid CORS issues
    const url = `/api/binance/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    
    const response = await fetch(url, { signal });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      const errorMessage = errorData.error || response.statusText;
      
      // Handle restricted location error (451/503)
      if (response.status === 503 && errorData.code === 'RESTRICTED_LOCATION') {
        throw new Error(`Binance API error: Service unavailable from a restricted location according to Binance terms. This may occur when the server is in a restricted region. Please try again later or contact support if you believe this is an error.`);
      }
      
      throw new Error(`Binance API error: ${errorMessage}`);
    }
    
    const data = await response.json();
    
    return data.map((d: any) => ({
      time: d.time, // Already in seconds from API route
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    console.error('Error fetching Binance history:', error);
    throw new Error(`Network error: Unable to connect to Binance API. ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Clear Redis klines cache for a symbol/interval.
 * Call on symbol switch so the next fetch gets fresh data from Binance (accuracy over speed).
 */
export async function clearKlinesCache(
  symbol: string,
  interval: string,
  signal?: AbortSignal
): Promise<void> {
  try {
    // Prefer DELETE; fallback POST with clear flag
    const deleteUrl = `/api/binance/cache?symbol=${encodeURIComponent(symbol.toUpperCase())}&interval=${encodeURIComponent(interval)}`;
    let response = await fetch(deleteUrl, { method: 'DELETE', signal });
    if (response.status === 404) {
      response = await fetch('/api/binance/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true, symbol: symbol.toUpperCase(), interval }),
        signal,
      });
    }
    if (!response.ok) {
      // Non-fatal: Redis may be unavailable or route not deployed
      console.warn('Cache clear request failed:', response.status);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    console.warn('Cache clear failed:', err);
  }
}
