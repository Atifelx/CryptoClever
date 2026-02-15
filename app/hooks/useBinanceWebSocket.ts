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
  const lastSymbolRef = useRef<string>(symbol);
  const lastTimeframeRef = useRef<string>(timeframe);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { updateTradingData } = useTradingStore();

  useEffect(() => {
    console.log('🔄 Symbol/Interval changed:', { symbol, timeframe });
    
    let isMounted = true;
    let timeoutId: NodeJS.Timeout;
    // Map '1D' to '1d' for Binance API
    const interval = TIMEFRAME_MAP[timeframe] || timeframe.toLowerCase();

    // Abort any pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    // CRITICAL: Clear old data immediately
    console.log('🗑️ Clearing old candles');
    setCandles([]);
    setIsLoading(true);

    // Disconnect previous WebSocket immediately and wait for cleanup
    const cleanupWebSocket = () => {
      if (wsRef.current) {
        try {
          console.log('📤 Disconnecting old WebSocket');
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
        console.log('📥 Fetching historical data for:', { symbol, interval });
        const history = await fetchBinanceHistory(symbol, interval, 500, abortControllerRef.current?.signal);
        
        if (!isMounted || abortControllerRef.current?.signal.aborted) {
          console.log('⚠️ Fetch aborted or unmounted');
          return;
        }

        // Only set data if we got valid history
        if (history && history.length > 0) {
          console.log('✅ Fetched historical data:', {
            symbol,
            candles: history.length
          });
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

  // Auto-refresh when tab becomes visible (within 1 second)
  useEffect(() => {
    const handleVisibilityChange = () => {
      // Only refresh if tab becomes visible (not when hidden)
      if (document.visibilityState === 'visible') {
        console.log('👁️ Tab became visible - Refreshing chart state...');
        
        // Clear any pending refresh
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
        }
        
        // Refresh within 1 second as requested
        refreshTimeoutRef.current = setTimeout(() => {
          // Only refresh if symbol/timeframe haven't changed
          if (lastSymbolRef.current === symbol && lastTimeframeRef.current === timeframe) {
            console.log('🔄 Auto-refreshing chart after tab switch');
            
            // Disconnect and reconnect WebSocket
            if (wsRef.current) {
              try {
                wsRef.current.disconnect();
              } catch (error) {
                console.warn('Error disconnecting WebSocket on refresh:', error);
              }
              wsRef.current = null;
            }
            
            // Re-fetch historical data to ensure we have latest
            const interval = TIMEFRAME_MAP[timeframe] || timeframe.toLowerCase();
            
            // Create new abort controller for refresh
            if (abortControllerRef.current) {
              abortControllerRef.current.abort();
            }
            abortControllerRef.current = new AbortController();
            
            // Re-fetch and reconnect
            fetchBinanceHistory(symbol, interval, 500, abortControllerRef.current.signal)
              .then(history => {
                if (history && history.length > 0) {
                  console.log('✅ Refreshed historical data:', history.length, 'candles');
                  setCandles(history);
                  
                  // Update current price
                  updateTradingData({ currentPrice: history[history.length - 1].close });
                  
                  // Reconnect WebSocket
                  const newInterval = TIMEFRAME_MAP[timeframe] || timeframe.toLowerCase();
                  wsRef.current = new BinanceWebSocket(
                    symbol,
                    newInterval,
                    (candle: Candle) => {
                      setCandles((prev) => {
                        const newCandles = [...prev];
                        const existingIndex = newCandles.findIndex((c) => c.time === candle.time);

                        if (existingIndex >= 0) {
                          newCandles[existingIndex] = candle;
                        } else {
                          newCandles.push(candle);
                          if (newCandles.length > 500) {
                            newCandles.shift();
                          }
                        }

                        updateTradingData({ currentPrice: candle.close });
                        return newCandles.sort((a, b) => a.time - b.time);
                      });
                    }
                  );
                  
                  setIsLoading(false);
                }
              })
              .catch(error => {
                if (error.name !== 'AbortError') {
                  console.error('Error refreshing chart:', error);
                }
              });
          }
        }, 1000); // Refresh within 1 second
      }
    };

    // Add visibility change listener
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // Cleanup
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [symbol, timeframe, updateTradingData]);

  // Update refs when symbol/timeframe change
  useEffect(() => {
    lastSymbolRef.current = symbol;
    lastTimeframeRef.current = timeframe;
  }, [symbol, timeframe]);

  return { candles, isLoading };
}
