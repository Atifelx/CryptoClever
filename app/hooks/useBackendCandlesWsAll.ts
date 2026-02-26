'use client';

import { useEffect, useRef } from 'react';
import { useTradingStore } from '../store/tradingStore';
import { useCandlesStore, type Candle } from '../store/candlesStore';

const BACKEND_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
];

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

function normalizeInterval(timeframe: string): string {
  const map: Record<string, string> = {
    '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h',
    '1D': '1d', '1d': '1d',
  };
  return map[timeframe] ?? timeframe.toLowerCase();
}

/**
 * Single app-level WebSocket to the backend; subscribes to all 5 symbols for the current interval.
 * Backend pushes live candles for each symbol; mergeCandle updates the store so all charts get real-time updates.
 * Call once at the app root (e.g. in the page that wraps the chart). Do not use useBackendCandlesWs per chart.
 */
export function useBackendCandlesWsAll() {
  const selectedTimeframe = useTradingStore((s) => s.selectedTimeframe);
  const mergeCandle = useCandlesStore((s) => s.mergeCandle);
  const wsRef = useRef<WebSocket | null>(null);

  const normInterval = normalizeInterval(selectedTimeframe);

  useEffect(() => {
    const url = getBackendWsUrl();
    if (!url) return;

    let cancelled = false;
    const openWs = () => {
      if (cancelled) return;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) {
          ws.close();
          return;
        }
        const subscriptions = BACKEND_SYMBOLS.map((symbol) => ({
          symbol,
          interval: normInterval,
        }));
        ws.send(JSON.stringify({ subscriptions }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            symbol?: string;
            interval?: string;
            candle?: Candle;
          };
          if (msg?.type !== 'candle' || !msg?.candle) return;
          const s = (msg.symbol ?? '').toString().toUpperCase();
          const i = (msg.interval ?? '').toString().toLowerCase();
          if (!s || !i) return;
          mergeCandle(s, i, msg.candle);
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!cancelled) setTimeout(openWs, 3000);
      };

      ws.onerror = () => {
        wsRef.current = null;
      };
    };

    const timeoutId = setTimeout(openWs, 150);

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
  }, [normInterval, mergeCandle]);
}
