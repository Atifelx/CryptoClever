'use client';

import { useEffect, useState, useRef } from 'react';
import { BinanceWebSocket, fetchBinanceHistory, Candle } from '../lib/binance';
import { useTradingStore } from '../store/tradingStore';

const TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1D': '1d',
};

export function useBinanceWebSocket(symbol: string, timeframe: string) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const wsRef = useRef<BinanceWebSocket | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { updateTradingData } = useTradingStore();

  useEffect(() => {
    let isMounted = true;
    let timeoutId: NodeJS.Timeout;
    // Map '1D' to '1d' for Binance API
    const interval = TIMEFRAME_MAP[timeframe] || timeframe.toLowerCase();

    // Abort any pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    // Clear previous data immediately when symbol/interval changes
    setCandles([]);
    setIsLoading(true);

    // Disconnect previous WebSocket immediately and wait for cleanup
    const cleanupWebSocket = () => {
      if (wsRef.current) {
        try {
          wsRef.current.disconnect();
        } catch (error) {
          console.warn('Error disconnecting WebSocket:', error);
        }
        wsRef.current = null;
      }
    };

    cleanupWebSocket();

    const initBinance = async () => {
      if (!isMounted || abortControllerRef.current?.signal.aborted) return;
      
      try {
        setIsLoading(true);

        // Fetch historical data first with abort signal
        const history = await fetchBinanceHistory(symbol, interval, 500, abortControllerRef.current?.signal);
        
        if (!isMounted || abortControllerRef.current?.signal.aborted) {
          return;
        }

        // Only set data if we got valid history
        if (history && history.length > 0) {
          setCandles(history);
          
          // Update current price
          requestAnimationFrame(() => {
            if (isMounted && !abortControllerRef.current?.signal.aborted) {
              updateTradingData({ currentPrice: history[history.length - 1].close });
            }
          });
        } else {
          console.warn(`No historical data for ${symbol} ${interval}`);
        }

        // Start WebSocket for real-time updates
        if (isMounted && !abortControllerRef.current?.signal.aborted) {
          // Ensure previous WebSocket is fully disconnected
          cleanupWebSocket();
          
          // Small delay to ensure cleanup
          await new Promise(resolve => setTimeout(resolve, 50));
          
          if (!isMounted || abortControllerRef.current?.signal.aborted) return;
          
          wsRef.current = new BinanceWebSocket(
            symbol,
            interval,
            (candle: Candle) => {
              if (!isMounted || abortControllerRef.current?.signal.aborted) return;

              setCandles((prev) => {
                // Check if this update is still relevant
                if (abortControllerRef.current?.signal.aborted) return prev;
                
                const newCandles = [...prev];
                const existingIndex = newCandles.findIndex((c) => c.time === candle.time);

                if (existingIndex >= 0) {
                  // Update existing candle
                  newCandles[existingIndex] = candle;
                } else {
                  // Add new candle
                  newCandles.push(candle);
                  // Keep only last 500 candles
                  if (newCandles.length > 500) {
                    newCandles.shift();
                  }
                }

                // Update current price
                requestAnimationFrame(() => {
                  if (isMounted && !abortControllerRef.current?.signal.aborted) {
                    updateTradingData({ currentPrice: candle.close });
                  }
                });

                return newCandles.sort((a, b) => a.time - b.time);
              });
            }
          );
        }

        setIsLoading(false);
      } catch (error) {
        if (!isMounted || abortControllerRef.current?.signal.aborted) return;
        
        // Only log if it's not an abort error
        if (error instanceof Error && error.name !== 'AbortError') {
          console.error(`Binance connection error for ${symbol} ${interval}:`, error);
        }
        
        setIsLoading(false);
        // Set empty array on error
        setCandles([]);
      }
    };

    // Delay to ensure cleanup completes before new connection
    timeoutId = setTimeout(() => {
      if (isMounted && !abortControllerRef.current?.signal.aborted) {
        initBinance();
      }
    }, 200);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      
      // Abort any pending requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      
      // Cleanup WebSocket
      cleanupWebSocket();
    };
  }, [symbol, timeframe, updateTradingData]);

  return { candles, isLoading };
}
