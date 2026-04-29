'use client';

import { useEffect, useRef } from 'react';
import { useCandlesStore, Candle } from '../store/candlesStore';

/**
 * Same logic as BTC: REST bootstrap for selected symbol + live from WebSocket (useCandles).
 * - On mount and on every symbol change: fetch GET /candles/{symbol}/5m immediately (bootstrap).
 * - Then poll every 30s for refresh/gap recovery.
 * This ensures every symbol gets REST data right away like BTC did; WS in useCandles adds live.
 */
export function useBackendCandlesLoader(selectedSymbol: string) {
  const setCandlesForSymbol = useCandlesStore((s) => s.setCandlesForSymbol);
  const pollIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSymbolRef = useRef<string>('');

  useEffect(() => {
    if (!selectedSymbol) return;

    const fetchCandles = async () => {
      const apiBase = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';
      const url = `${apiBase}/candles/${selectedSymbol}/5m?limit=2000`;

      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.error('[BackendLoader] Failed to fetch candles:', selectedSymbol, res.status);
          return;
        }

        const data = await res.json();
        const candles: Candle[] = (data.candles || []).map((c: any) => ({
          time: typeof c.time === 'number' ? (c.time >= 1e12 ? Math.floor(c.time / 1000) : c.time) : Math.floor((c.time || 0) / 1000),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume ?? 0,
        }));

        if (candles.length > 0) {
          setCandlesForSymbol(selectedSymbol, candles);

          if (process.env.NODE_ENV === 'development') {
            const first3 = candles.slice(0, 3).map((c) => c.close.toFixed(2));
            const last3 = candles.slice(-3).map((c) => c.close.toFixed(2));
            console.log(`🔄 [BackendLoader] ${selectedSymbol} | count=${candles.length} FIRST=[${first3.join(',')}] LAST=[${last3.join(',')}]`);
          }
        }
      } catch (error) {
        console.error('[BackendLoader] Error fetching candles:', selectedSymbol, error);
      }
    };

    // Same as BTC: bootstrap immediately when symbol changes (REST first, then WS adds live).
    const symbolChanged = lastSymbolRef.current !== selectedSymbol;
    if (symbolChanged) {
      lastSymbolRef.current = selectedSymbol;
      console.log('[BackendLoader] ⚡ Bootstrap: fetching', selectedSymbol, '5m candles (same as BTC)...');
      fetchCandles();
    }

    if (pollIdRef.current) clearInterval(pollIdRef.current);
    pollIdRef.current = setInterval(() => {
      fetchCandles();
    }, 30_000);

    return () => {
      if (pollIdRef.current) clearInterval(pollIdRef.current);
    };
  }, [selectedSymbol, setCandlesForSymbol]);
}
