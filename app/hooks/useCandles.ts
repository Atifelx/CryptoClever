'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useCandlesStore, type Candle as StoreCandle } from '../store/candlesStore';

/**
 * useCandles(symbol) — same live flow as BTC at d4900ca: WS /ws/{symbol}, historical + live_candle → store.
 * Must subscribe to the actual candle array so component re-renders when mergeCandleForSymbol updates (live).
 */
export function useCandles(symbol: string) {
  // Subscribe to this symbol's data so we re-render when store updates (live_candle merge).
  const candles = useCandlesStore((s) => s.getCandlesForSymbol(symbol));
  const setCandlesForSymbol = useCandlesStore((s) => s.setCandlesForSymbol);
  const mergeCandleForSymbol = useCandlesStore((s) => s.mergeCandleForSymbol);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const getBackendWsUrl = useCallback((sym: string): string => {
    if (typeof window === 'undefined') return '';
    const base = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (base) {
      return base.replace(/^http/, 'ws') + `/ws/${sym}`;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//127.0.0.1:8000/ws/${sym}`;
  }, []);

  useEffect(() => {
    let didUnmount = false;

    const connect = () => {
      if (didUnmount) return;
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }

      const wsUrl = getBackendWsUrl(symbol);
      if (!wsUrl) return;

      console.log('[useCandles] Connecting to:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (didUnmount) return;
        console.log('[useCandles] WebSocket connected for', symbol);
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        if (didUnmount) return;
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'historical') {
            const candlesData: StoreCandle[] = (data.data || []).map((c: any) => ({
              time: typeof c.time === 'number' ? (c.time >= 1e12 ? Math.floor(c.time / 1000) : c.time) : Math.floor((c.time || 0) / 1000),
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume ?? 0,
            }));
            setCandlesForSymbol(symbol, candlesData);
            return;
          }

          if (data.type === 'live_candle') {
            const candle: StoreCandle = {
              time: typeof data.time === 'number' ? (data.time >= 1e12 ? Math.floor(data.time / 1000) : data.time) : Math.floor((data.time || 0) / 1000),
              open: data.open,
              high: data.high,
              low: data.low,
              close: data.close,
              volume: data.volume ?? 0,
            };
            mergeCandleForSymbol(symbol, candle);
            return;
          }
        } catch (error) {
          console.error('[useCandles] Error processing message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('[useCandles] WebSocket error:', error);
      };

      ws.onclose = () => {
        if (didUnmount) return;
        console.log('[useCandles] WebSocket closed for', symbol, ', reconnecting in 3s...');
        setIsConnected(false);
        setTimeout(() => {
          if (!didUnmount) connect();
        }, 3000);
      };
    };

    connect();

    return () => {
      didUnmount = true;
      setIsConnected(false);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
    };
  }, [symbol, getBackendWsUrl, setCandlesForSymbol, mergeCandleForSymbol]);

  return {
    candles,
    isLoading: candles.length === 0,
    isConnected,
  };
}
