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

/** Stable empty array for missing/empty keys (avoids new reference on every read). */
const EMPTY: Candle[] = [];

/** Key = `${symbol}:${interval}` — must match backend (symbol upper, interval: 1D→1d else lower). */
export function candleKey(symbol: string, interval: string): string {
  const sym = symbol.toUpperCase();
  const iv = interval.toUpperCase() === '1D' ? '1d' : interval.toLowerCase();
  return `${sym}:${iv}`;
}

interface CandlesState {
  candlesByKey: Record<string, Candle[]>;
  setCandlesForSymbol: (symbol: string, interval: string, candles: Candle[]) => void;
  /** Merge one candle (from backend WS) into the buffer for symbol/interval; update existing by time or append. */
  mergeCandle: (symbol: string, interval: string, candle: Candle) => void;
  getCandles: (symbol: string, interval: string) => Candle[];
}

export const useCandlesStore = create<CandlesState>((set, get) => ({
  candlesByKey: {},

  setCandlesForSymbol: (symbol, interval, candles) => {
    const key = candleKey(symbol, interval);
    set((state) => ({
      candlesByKey: { ...state.candlesByKey, [key]: candles.length ? [...candles] : EMPTY },
    }));
  },

  mergeCandle: (symbol, interval, candle) => {
    const key = candleKey(symbol, interval);
    set((state) => {
      const prev = state.candlesByKey[key];
      if (!prev || prev.length === 0) return state;
      const time = candle.time;
      const next = [...prev];
      const i = next.findIndex((c) => c.time === time);
      if (i >= 0) next[i] = candle;
      else {
        next.push(candle);
        next.sort((a, b) => a.time - b.time);
        if (next.length > 1000) next.splice(0, next.length - 1000);
      }
      return { candlesByKey: { ...state.candlesByKey, [key]: next } };
    });
  },

  getCandles: (symbol, interval) => {
    const key = candleKey(symbol, interval);
    return get().candlesByKey[key] ?? EMPTY;
  },
}));
