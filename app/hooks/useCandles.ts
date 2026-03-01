'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useCandlesStore, type Candle as StoreCandle } from '../store/candlesStore';

/**
 * Simplified useCandles for BTC 1m only
 * Reads from Zustand store and subscribes to WebSocket for live updates
 */
export function useCandles() {
  const btcCandles = useCandlesStore((state) => state.btcCandles);
  const mergeBtcCandle = useCandlesStore((s) => s.mergeBtcCandle);
  const setBtcCandles = useCandlesStore((s) => s.setBtcCandles);
  
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const getBackendWsUrl = useCallback((): string => {
    if (typeof window === 'undefined') return '';
    const base = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (base) {
      return base.replace(/^http/, 'ws') + '/ws/BTCUSDT';
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//127.0.0.1:8000/ws/BTCUSDT`;
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

      const wsUrl = getBackendWsUrl();
      if (!wsUrl) return;

      console.log('[useCandles] Connecting to:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (didUnmount) return;
        console.log('[useCandles] WebSocket connected');
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        if (didUnmount) return;
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'historical') {
            // Initial historical data
            const candles: StoreCandle[] = (data.data || []).map((c: any) => ({
              time: Math.floor(c.time / 1000), // Convert ms to seconds
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume ?? 0,
            }));
            setBtcCandles(candles);
            return;
          }

          if (data.type === 'live_candle') {
            // Live candle update
            const candle: StoreCandle = {
              time: Math.floor(data.time / 1000), // Convert ms to seconds
              open: data.open,
              high: data.high,
              low: data.low,
              close: data.close,
              volume: data.volume ?? 0,
            };
            mergeBtcCandle(candle);
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
        console.log('[useCandles] WebSocket closed, reconnecting in 3s...');
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
  }, [getBackendWsUrl, setBtcCandles, mergeBtcCandle]);

  return {
    candles: btcCandles,
    isLoading: btcCandles.length === 0,
    isConnected,
  };
}
