'use client';

import { useEffect, useRef } from 'react';
import { useCandlesStore, type Candle } from '../store/candlesStore';

function getBackendWsUrl(): string {
  if (typeof window === 'undefined') return '';
  const base = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (base) {
    const host = base.startsWith('http') ? base.replace(/^http/, 'ws') : `ws://${base}`;
    return host.replace(/\/$/, '') + '/ws/candles';
  }
  if (process.env.NODE_ENV === 'development')
    return 'ws://127.0.0.1:8000/ws/candles';
  return '';
}

/**
 * Subscribes to backend WebSocket for live candle updates for the given symbol/interval.
 * Backend is single source of truth: Binance WS updates backend, backend pushes to this client.
 * Merges each incoming candle into the candles store so the chart updates in real time.
 */
export function useBackendCandlesWs(symbol: string, interval: string) {
  const mergeCandle = useCandlesStore((s) => s.mergeCandle);
  const wsRef = useRef<WebSocket | null>(null);
  const symbolRef = useRef(symbol);
  const intervalRef = useRef(interval);

  const normInterval = interval.toUpperCase() === '1D' ? '1d' : interval.toLowerCase();
  const normSymbol = symbol.toUpperCase();

  useEffect(() => {
    symbolRef.current = normSymbol;
    intervalRef.current = normInterval;

    const url = getBackendWsUrl();
    if (!url) return;

    let cancelled = false;
    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) {
          ws.close();
          return;
        }
        ws.send(JSON.stringify({ symbol: normSymbol, interval: normInterval }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as { type?: string; symbol?: string; interval?: string; candle?: Candle };
          if (msg?.type !== 'candle' || !msg?.candle) return;
          const s = (msg.symbol ?? '').toString().toUpperCase();
          const i = (msg.interval ?? '').toString().toLowerCase();
          if (s !== symbolRef.current || i !== intervalRef.current) return;
          const candle = msg.candle as Candle;
          mergeCandle(s, i, candle);
        } catch {
          // ignore parse errors
        }
      };
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      const ws = wsRef.current;
      if (ws) {
        wsRef.current = null;
        try {
          if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close();
        } catch {
          // ignore
        }
      }
    };
  }, [normSymbol, normInterval, mergeCandle]);
}
