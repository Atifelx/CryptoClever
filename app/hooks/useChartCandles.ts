'use client';

import { useEffect } from 'react';
import { useCandlesStore, type Candle } from '../store/candlesStore';
import { useTradingStore } from '../store/tradingStore';

/**
 * Returns BTC candles from Zustand store (simplified for BTC-only operation)
 */
export function useChartCandles() {
  const candles = useCandlesStore((state) => state.btcCandles);
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
