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

/** Store candles per symbol (BTCUSDT, SOLUSDT, BNBUSDT, XRPUSDT). Same flow as BTC: gap-fill on backend, REST/WS per symbol. */
interface CandlesState {
  /** Candles per symbol; key = symbol (e.g. BTCUSDT). Each symbol has its own array — never mix. */
  candlesBySymbol: Record<string, Candle[]>;
  /** Set full candle list for a symbol (e.g. from REST or WS historical). */
  setCandlesForSymbol: (symbol: string, candles: Candle[]) => void;
  /** Merge one candle (from backend WS) into a symbol's buffer; update by time or append. */
  mergeCandleForSymbol: (symbol: string, candle: Candle) => void;
  /** Get candles for a symbol only. Use this to ensure you never read another symbol's data. */
  getCandlesForSymbol: (symbol: string) => Candle[];
  /** Legacy: alias for BTCUSDT only; use getCandlesForSymbol('BTCUSDT') or candlesBySymbol[symbol] for multi-symbol. */
  btcCandles: Candle[];
  setBtcCandles: (candles: Candle[]) => void;
  mergeBtcCandle: (candle: Candle) => void;
}

const MAX_CANDLES_PER_SYMBOL = 1001;

/** Stable empty array so getCandlesForSymbol(symbol) doesn't return new [] each time (avoids infinite re-renders when symbol has no data). */
const EMPTY_CANDLES: Candle[] = [];

export const useCandlesStore = create<CandlesState>((set, get) => ({
  candlesBySymbol: {},

  setCandlesForSymbol: (symbol, candles) => {
    set((state) => ({
      candlesBySymbol: {
        ...state.candlesBySymbol,
        [symbol]: candles.length ? [...candles] : [],
      },
      ...(symbol === 'BTCUSDT' ? { btcCandles: candles.length ? [...candles] : [] } : {}),
    }));
  },

  mergeCandleForSymbol: (symbol, candle) => {
    set((state) => {
      const prev = state.candlesBySymbol[symbol] ?? [];
      const time = candle.time;
      let next: typeof prev;
      if (prev.length === 0) {
        // Same as BTC: allow first candle (e.g. live_candle before historical) so chart gets something.
        next = [candle];
      } else {
        next = [...prev];
        const i = next.findIndex((c) => c.time === time);
        if (i >= 0) {
          next[i] = candle;
        } else {
          next.push(candle);
          next.sort((a, b) => a.time - b.time);
          if (next.length > MAX_CANDLES_PER_SYMBOL) {
            next.splice(0, next.length - MAX_CANDLES_PER_SYMBOL);
          }
        }
      }
      return {
        candlesBySymbol: { ...state.candlesBySymbol, [symbol]: next },
        ...(symbol === 'BTCUSDT' ? { btcCandles: next } : {}),
      };
    });
  },

  getCandlesForSymbol: (symbol) => {
    return get().candlesBySymbol[symbol] ?? EMPTY_CANDLES;
  },

  btcCandles: [],

  setBtcCandles: (candles) => {
    get().setCandlesForSymbol('BTCUSDT', candles);
  },

  mergeBtcCandle: (candle) => {
    get().mergeCandleForSymbol('BTCUSDT', candle);
  },
}));
