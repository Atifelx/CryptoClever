'use client';

import { useEffect, useRef } from 'react';
import { useCandlesStore, Candle } from '../store/candlesStore';

/**
 * Polls backend REST for BTC 1m candles only.
 * Runs bootstrap fetch immediately, then polls every 30s.
 * Simplified for BTC-only operation.
 */
export function useBackendCandlesLoader() {
  const setBtcCandles = useCandlesStore((s) => s.setBtcCandles);
  const pollIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bootstrapEndRef = useRef<number>(0);

  useEffect(() => {
    const fetchBtc = async () => {
      const apiBase = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';
      const url = `${apiBase}/candles/BTCUSDT/1m?limit=1000`;
      
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.error('[BackendLoader] Failed to fetch BTC candles:', res.status);
          return;
        }
        
        const data = await res.json();
        const candles: Candle[] = (data.candles || []).map((c: any) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume ?? 0,
        }));

        if (candles.length > 0) {
          setBtcCandles(candles);
          
          if (process.env.NODE_ENV === 'development') {
            const first3 = candles.slice(0, 3).map(c => c.close.toFixed(2));
            const last3 = candles.slice(-3).map(c => c.close.toFixed(2));
            console.log(`🔄 [BackendLoader] BTC | count=${candles.length} FIRST=[${first3.join(',')}] LAST=[${last3.join(',')}]`);
          }
        }
      } catch (error) {
        console.error('[BackendLoader] Error fetching BTC candles:', error);
      }
    };

    // Bootstrap immediately
    const now = Date.now();
    if (bootstrapEndRef.current === 0 || now > bootstrapEndRef.current + 300_000) {
      console.log('[BackendLoader] ⚡ Bootstrap: fetching BTC 1m candles...');
      fetchBtc().then(() => {
        bootstrapEndRef.current = Date.now();
      });
    }

    // Poll every 30s
    if (pollIdRef.current) clearInterval(pollIdRef.current);
    pollIdRef.current = setInterval(() => {
      fetchBtc();
    }, 30_000);

    return () => {
      if (pollIdRef.current) clearInterval(pollIdRef.current);
    };
  }, [setBtcCandles]);
}
