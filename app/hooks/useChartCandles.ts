'use client';

import { useEffect } from 'react';
import { useCandlesStore, candleKey, type Candle } from '../store/candlesStore';
import { useTradingStore } from '../store/tradingStore';

/** Stable empty array so selector never returns a new reference when key is missing (avoids infinite effect loop). */
const EMPTY_CANDLES: Candle[] = [];

/**
 * Returns candles for the given symbol/interval from Zustand (backend-backed).
 * When user switches symbol, data is already in store so chart renders immediately
 * without clearing or waiting for a new fetch (no ghosting).
 */
export function useChartCandles(symbol: string, interval: string) {
  const key = candleKey(symbol, interval);
  const candles = useCandlesStore((state) => state.candlesByKey[key]) ?? EMPTY_CANDLES;
  const updateTradingData = useTradingStore((s) => s.updateTradingData);

  useEffect(() => {
    if (candles.length > 0) {
      const lastClose = candles[candles.length - 1].close;
      queueMicrotask(() => updateTradingData({ currentPrice: lastClose }));
    }
  }, [candles, updateTradingData]);

  const isLoading = candles.length === 0;

  return { candles, isLoading };
}
