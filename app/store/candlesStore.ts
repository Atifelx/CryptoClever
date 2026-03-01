'use client';

import { create } from 'zustand';

/** Candle shape aligned with backend and chart (time in seconds). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Simplified store: BTC 1m only */
interface CandlesState {
  btcCandles: Candle[];
  setBtcCandles: (candles: Candle[]) => void;
  /** Merge one candle (from backend WS) into the BTC buffer; update existing by time or append. */
  mergeBtcCandle: (candle: Candle) => void;
}

export const useCandlesStore = create<CandlesState>((set, get) => ({
  btcCandles: [],

  setBtcCandles: (candles) => {
    set({ btcCandles: candles.length ? [...candles] : [] });
  },

  mergeBtcCandle: (candle) => {
    set((state) => {
      const prev = state.btcCandles;
      if (prev.length === 0) return state;
      
      const time = candle.time;
      const next = [...prev];
      const i = next.findIndex((c) => c.time === time);
      
      if (i >= 0) {
        next[i] = candle;
      } else {
        next.push(candle);
        next.sort((a, b) => a.time - b.time);
        // Keep max 1000 candles
        if (next.length > 1000) {
          next.splice(0, next.length - 1000);
        }
      }
      
      return { btcCandles: next };
    });
  },
}));
