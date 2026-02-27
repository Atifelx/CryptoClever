'use client';

import { useEffect, useRef } from 'react';
import { useTradingStore } from '../store/tradingStore';
import { useCandlesStore, Candle } from '../store/candlesStore';

const BACKEND_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
];

const POLL_MS = 30_000; // 30 seconds once stable
const POLL_MS_BOOTSTRAP = 3_000; // 3 seconds for first 60s (backend bootstrap can take 30-60s)
const BOOTSTRAP_POLL_DURATION_MS = 60_000;
const LIMIT = 1000;

function normalizeInterval(timeframe: string): string {
  const map: Record<string, string> = {
    '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h',
    '1D': '1d', '1d': '1d',
  };
  return map[timeframe] ?? timeframe.toLowerCase();
}

/**
 * Loads candle data for all 5 symbols from backend into Zustand on mount,
 * and polls every 30s. For the first 60s polls every 3s so we catch data as soon as backend bootstrap completes.
 */
export function useBackendCandlesLoader() {
  const selectedTimeframe = useTradingStore((s) => s.selectedTimeframe);
  const setCandlesForSymbol = useCandlesStore((s) => s.setCandlesForSymbol);
  const interval = normalizeInterval(selectedTimeframe);
  const pollIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bootstrapEndRef = useRef<number>(0);

  const fetchAll = async () => {
    const promises = BACKEND_SYMBOLS.map(async (requestedSymbol) => {
      try {
        const res = await fetch(
          `/api/backend/candles/${encodeURIComponent(requestedSymbol)}/${encodeURIComponent(interval)}?limit=${LIMIT}`,
          { headers: { Accept: 'application/json' }, cache: 'no-store' }
        );
        if (!res.ok) return;
        const contentType = (res.headers.get('Content-Type') || '').toLowerCase();
        if (!contentType.includes('application/json')) return;
        let raw: unknown;
        try {
          raw = await res.json();
        } catch {
          return;
        }
        const obj = raw as { symbol?: string; interval?: string; candles?: unknown[] };
        const candlesArr = Array.isArray(obj?.candles) ? obj.candles : [];
        const resSymbol = typeof obj?.symbol === 'string' ? obj.symbol.toUpperCase() : '';
        const resInterval = typeof obj?.interval === 'string' ? (obj.interval.toUpperCase() === '1D' ? '1d' : obj.interval.toLowerCase()) : '';
        if (resSymbol !== requestedSymbol.toUpperCase() || !resInterval) return;
        const candles = (candlesArr
          .filter((d): d is Record<string, unknown> => d != null && typeof d === 'object')
          .map((d) => {
            const t = Number((d as { time?: unknown }).time);
            const o = Number((d as { open?: unknown }).open);
            const h = Number((d as { high?: unknown }).high);
            const l = Number((d as { low?: unknown }).low);
            const c = Number((d as { close?: unknown }).close);
            const v = (d as { volume?: unknown }).volume;
            if (!Number.isFinite(t)) return null;
            return {
              time: t,
              open: Number.isFinite(o) ? o : 0,
              high: Number.isFinite(h) ? h : 0,
              low: Number.isFinite(l) ? l : 0,
              close: Number.isFinite(c) ? c : 0,
              volume: typeof v === 'number' && Number.isFinite(v) ? v : undefined,
            } as Candle;
          })
          .filter((c): c is Candle => c !== null)) as Candle[];
        if (candles.length > 0) setCandlesForSymbol(resSymbol, resInterval, candles);
      } catch {
        // ignore per-symbol errors
      }
    });
    await Promise.all(promises);
  };

  useEffect(() => {
    fetchAll();
    const earlyRetry = setTimeout(fetchAll, 2500);
    const bootstrapEnd = Date.now() + BOOTSTRAP_POLL_DURATION_MS;
    bootstrapEndRef.current = bootstrapEnd;

    const runBootstrapPoll = () => {
      fetchAll();
      if (Date.now() < bootstrapEndRef.current) {
        pollIdRef.current = setTimeout(runBootstrapPoll, POLL_MS_BOOTSTRAP);
      } else {
        pollIdRef.current = setInterval(fetchAll, POLL_MS);
      }
    };
    pollIdRef.current = setTimeout(runBootstrapPoll, POLL_MS_BOOTSTRAP);

    return () => {
      clearTimeout(earlyRetry);
      if (pollIdRef.current != null) {
        clearInterval(pollIdRef.current);
        clearTimeout(pollIdRef.current);
        pollIdRef.current = null;
      }
    };
  }, [interval]);
}
