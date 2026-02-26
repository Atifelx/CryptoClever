'use client';

import { useEffect, useState, useRef } from 'react';
import { BinanceWebSocket, fetchBinanceHistory, clearKlinesCache, Candle } from '../lib/binance';
import { useTradingStore } from '../store/tradingStore';

const TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1D': '1d',
};

// Wait before opening Binance fallback after backend fails or returns no data.
// Short delay so chart loads quickly when backend is down or still bootstrapping.
const SYMBOL_SWITCH_DELAY_MS = 2000;

// When using backend, poll every N ms for fresh candles (backend pushes to Redis via Binance WS).
const BACKEND_POLL_MS = 5000;
const BACKEND_POLL_MS_WHEN_WS = 30000;

function getBackendWsUrl(): string {
  if (typeof window === 'undefined') return '';
  const base = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!base) return '';
  return base.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws/candles';
}

export function useBinanceWebSocket(symbol: string, timeframe: string) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const wsRef = useRef<BinanceWebSocket | null>(null);
  const backendWsRef = useRef<WebSocket | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastSymbolRef = useRef<string>(symbol);
  const lastTimeframeRef = useRef<string>(timeframe);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  /** Set at start of effect so old WS callbacks skip updates when symbol changed (prevents mixed charts). */
  const activeSymbolRef = useRef<string>(symbol);
  const { updateTradingData } = useTradingStore();

  useEffect(() => {
    const deferUpdatePrice = (price: number) => {
      queueMicrotask(() => updateTradingData({ currentPrice: price }));
    };

    console.log('🔄 Symbol/Interval changed:', symbol, timeframe);

    activeSymbolRef.current = symbol;

    let isMounted = true;
    let timeoutId: NodeJS.Timeout;
    let fallbackTimeoutId: NodeJS.Timeout | null = null;
    let pollId: ReturnType<typeof setInterval> | null = null;
    const interval = TIMEFRAME_MAP[timeframe] || timeframe.toLowerCase();

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setCandles([]);
    setIsLoading(true);

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
      if (backendWsRef.current) {
        try { backendWsRef.current.close(); } catch (_) {}
        backendWsRef.current = null;
      }
    };

    cleanupWebSocket();

    /** Try to get candles from FastAPI backend (Redis). If 200, use and poll; else fall back to Binance. */
    const tryBackendThenBinance = async () => {
      if (!isMounted || abortControllerRef.current?.signal.aborted) return;

      const backendUrl = `/api/backend/candles/${encodeURIComponent(symbol)}/${encodeURIComponent(interval)}?limit=500`;
      try {
        const res = await fetch(backendUrl, { signal: abortControllerRef.current?.signal });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0 && isMounted && !abortControllerRef.current?.signal.aborted) {
            const candlesData = data.map((d: { time: number; open: number; high: number; low: number; close: number; volume?: number }) => ({
              time: d.time,
              open: d.open,
              high: d.high,
              low: d.low,
              close: d.close,
              volume: d.volume,
            }));
            if (process.env.NODE_ENV === 'development') {
              const last = candlesData[candlesData.length - 1];
              console.log('[candles] symbol:', symbol, 'url:', backendUrl, 'lastCandle:', last ? { time: last.time, close: last.close } : null);
            }
            setCandles(candlesData);
            deferUpdatePrice(candlesData[candlesData.length - 1].close);
            setIsLoading(false);
            if (pollId) clearInterval(pollId);
            const wsUrl = getBackendWsUrl();
            if (wsUrl && isMounted && !abortControllerRef.current?.signal.aborted) {
              try {
                const backendWs = new WebSocket(wsUrl);
                backendWsRef.current = backendWs;
                backendWs.onopen = () => {
                  if (backendWsRef.current === backendWs && isMounted && activeSymbolRef.current === symbol) {
                    backendWs.send(JSON.stringify({ symbol, interval }));
                  }
                };
                backendWs.onmessage = (event) => {
                  if (!isMounted || activeSymbolRef.current !== symbol) return;
                  try {
                    const msg = JSON.parse(event.data);
                    if (msg?.type === 'candle' && msg?.candle) {
                      const c = msg.candle as { time: number; open: number; high: number; low: number; close: number; volume?: number };
                      setCandles((prev) => {
                        const next = [...prev];
                        const i = next.findIndex((x) => x.time === c.time);
                        if (i >= 0) next[i] = c;
                        else {
                          next.push(c);
                          next.sort((a, b) => a.time - b.time);
                          if (next.length > 500) next.splice(0, next.length - 500);
                        }
                        return next;
                      });
                      deferUpdatePrice(c.close);
                    }
                  } catch (_) {}
                };
                backendWs.onerror = () => {};
                backendWs.onclose = () => { backendWsRef.current = null; };
              } catch (_) {}
            }
            const pollInterval = wsUrl ? BACKEND_POLL_MS_WHEN_WS : BACKEND_POLL_MS;
            pollId = setInterval(async () => {
              if (!isMounted || activeSymbolRef.current !== symbol) return;
              try {
                const r = await fetch(backendUrl);
                if (r.ok) {
                  const next = await r.json();
                  if (Array.isArray(next) && next.length > 0) {
                    setCandles(next.map((d: { time: number; open: number; high: number; low: number; close: number; volume?: number }) => ({
                      time: d.time,
                      open: d.open,
                      high: d.high,
                      low: d.low,
                      close: d.close,
                      volume: d.volume,
                    })));
                    deferUpdatePrice(next[next.length - 1].close);
                  }
                }
              } catch (_) {}
            }, pollInterval);
            return;
          }
        }
      } catch (_) {
        // Backend not available or aborted
      }

      // Fallback: Binance after delay (ensures old WS and in-flight callbacks drain)
      if (!isMounted || abortControllerRef.current?.signal.aborted) return;
      fallbackTimeoutId = setTimeout(async () => {
        if (!isMounted || abortControllerRef.current?.signal.aborted) return;
        console.log('🗑️ Using Binance fallback');
      const prevSymbol = lastSymbolRef.current;
      const prevIntervalMapped = TIMEFRAME_MAP[lastTimeframeRef.current] || lastTimeframeRef.current?.toLowerCase();
      try {
        if (prevSymbol && prevIntervalMapped && prevSymbol !== symbol) {
          await clearKlinesCache(prevSymbol, prevIntervalMapped, abortControllerRef.current?.signal);
        }
        if (!isMounted || abortControllerRef.current?.signal.aborted) return;
        await clearKlinesCache(symbol, interval, abortControllerRef.current?.signal);
      } catch (_) {}

      if (!isMounted || abortControllerRef.current?.signal.aborted) return;
      const history = await fetchBinanceHistory(symbol, interval, 500, abortControllerRef.current?.signal);
      if (!isMounted || abortControllerRef.current?.signal.aborted) return;

      if (history && history.length > 0) {
        setCandles(history);
        queueMicrotask(() => {
          if (isMounted && !abortControllerRef.current?.signal.aborted) {
            updateTradingData({ currentPrice: history[history.length - 1].close });
          }
        });
      }

      if (isMounted && !abortControllerRef.current?.signal.aborted) {
        cleanupWebSocket();
        await new Promise(resolve => setTimeout(resolve, 50));
        if (!isMounted || abortControllerRef.current?.signal.aborted) return;
        const wsSymbol = symbol;
        wsRef.current = new BinanceWebSocket(
          wsSymbol,
          interval,
          (candle: Candle) => {
            if (!isMounted || abortControllerRef.current?.signal.aborted) return;
            if (activeSymbolRef.current !== wsSymbol) return;
            setCandles((prev) => {
              if (abortControllerRef.current?.signal.aborted) return prev;
              const newCandles = [...prev];
              const existingIndex = newCandles.findIndex((c) => c.time === candle.time);
              if (existingIndex >= 0) {
                newCandles[existingIndex] = candle;
              } else {
                newCandles.push(candle);
                if (newCandles.length > 500) newCandles.shift();
              }
              requestAnimationFrame(() => {
                if (isMounted && !abortControllerRef.current?.signal.aborted && activeSymbolRef.current === wsSymbol) {
                  deferUpdatePrice(candle.close);
                }
              });
              return newCandles.sort((a, b) => a.time - b.time);
            });
          }
        );
      }
      setIsLoading(false);
    }, SYMBOL_SWITCH_DELAY_MS);
    };

    timeoutId = setTimeout(() => {
      if (isMounted && !abortControllerRef.current?.signal.aborted) {
        tryBackendThenBinance();
      }
    }, 500); // Short delay for backend try; Binance fallback runs inside tryBackendThenBinance after backend fails.

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      if (fallbackTimeoutId) clearTimeout(fallbackTimeoutId);
      if (pollId) clearInterval(pollId);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      cleanupWebSocket();
    };
  }, [symbol, timeframe, updateTradingData]);

  // Auto-refresh when tab becomes visible (within 1 second)
  useEffect(() => {
    const deferUpdatePrice = (price: number) => {
      queueMicrotask(() => updateTradingData({ currentPrice: price }));
    };

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
                  
                  deferUpdatePrice(history[history.length - 1].close);
                  
                  // Reconnect WebSocket
                  const newInterval = TIMEFRAME_MAP[timeframe] || timeframe.toLowerCase();
                  wsRef.current = new BinanceWebSocket(
                    symbol,
                    newInterval,
                    (candle: Candle) => {
                      if (activeSymbolRef.current !== symbol) return;
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

                        deferUpdatePrice(candle.close);
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
