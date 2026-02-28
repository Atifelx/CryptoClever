'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

// Define the candle data structure
interface Candle {
  symbol: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  is_closed: boolean;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 4000, 4000];
/** 1m interval in ms; used to optionally trigger background refetch on gap. */
const ONE_INTERVAL_MS = 60 * 1000;

/**
 * Normalize WebSocket message to a single Candle with timestamp in ms.
 * Supports: (1) proposal API live_candle: flat { type, symbol, time (ms), open, high, low, close, volume, is_closed }
 *          (2) legacy nested { type, symbol, interval, candle } with candle.time in seconds (single feed /ws/candles).
 */
function normalizeWsMessage(
  data: Record<string, unknown>,
  symbol: string
): Candle {
  const isProposalLive = data.type === 'live_candle';
  const raw = isProposalLive ? data : (data.candle ?? data) as Record<string, unknown>;
  const t = raw.time ?? raw.timestamp;
  const ts =
    typeof t === 'number'
      ? t < 1e10
        ? t * 1000
        : t
      : 0;
  return {
    symbol: (raw.symbol ?? data.symbol ?? symbol) as string,
    timestamp: ts,
    open: Number(raw.open) || 0,
    high: Number(raw.high) || 0,
    low: Number(raw.low) || 0,
    close: Number(raw.close) || 0,
    volume: Number(raw.volume) || 0,
    is_closed: raw.is_closed !== false,
  };
}

/** Backend base URL for REST; fallback when NEXT_PUBLIC_BACKEND_URL is unset. */
function getBackendBaseUrl(): string {
  const u = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (u && u.trim()) return u.trim().replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location?.origin && !window.location.origin.includes('localhost'))
    return '';
  return 'http://localhost:8000';
}

/** WebSocket base URL (ws or wss) from the same host/port as backend. Empty when backend URL not set in production. */
function getBackendWsBaseUrl(): string {
  const base = getBackendBaseUrl();
  if (!base) return '';
  return base.replace(/^https/, 'wss').replace(/^http/, 'ws');
}

function normalizeCandles(
  rawCandles: Array<Record<string, unknown>>,
  symbol: string
): Candle[] {
  return rawCandles.map((c) => {
    const t = (c as { time?: number; timestamp?: number }).time ?? (c as { timestamp?: number }).timestamp;
    const ts =
      typeof t === 'number'
        ? t < 1e10
          ? t * 1000
          : t
        : 0;
    return {
      symbol,
      timestamp: ts,
      open: Number((c as { open?: number }).open) || 0,
      high: Number((c as { high?: number }).high) || 0,
      low: Number((c as { low?: number }).low) || 0,
      close: Number((c as { close?: number }).close) || 0,
      volume: Number((c as { volume?: number }).volume) || 0,
      is_closed: (c as { is_closed?: boolean }).is_closed !== false,
    };
  });
}

/**
 * Merge refetched REST candles with current state to fill a gap without losing
 * live WebSocket candles that arrived during or after the refetch.
 * Returns: refetched list + any current candles newer than last refetched, deduped, cap 1000.
 */
function mergeRefetchedWithCurrent(
  refetched: Candle[],
  current: Candle[]
): Candle[] {
  if (refetched.length === 0) return current;
  const lastRefetchedTs = refetched[refetched.length - 1].timestamp;
  const newer = current.filter((c) => c.timestamp > lastRefetchedTs);
  if (newer.length === 0) return refetched;
  const byTs = new Map<number, Candle>();
  refetched.forEach((c) => byTs.set(c.timestamp, c));
  newer.forEach((c) => byTs.set(c.timestamp, c));
  const merged = Array.from(byTs.values()).sort((a, b) => a.timestamp - b.timestamp);
  return merged.length > 1000 ? merged.slice(-1000) : merged;
}

export function useCandles(symbol: string) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const fetchCandles = useCallback(
    (options?: {
      onSuccess?: (normalized: Candle[]) => void;
      /** When true, do not replace state; caller merges refetched with current (used for gap refill). */
      mergeWithCurrent?: boolean;
    }) => {
      const baseUrl = getBackendBaseUrl();
      const url = baseUrl
        ? `${baseUrl}/api/historical/${encodeURIComponent(symbol)}?interval=1m&hours=12`
        : `/api/backend/candles/${symbol}/1m?limit=1000`;
      console.log('🟢 [useCandles] Fetching URL:', url, 'for symbol:', symbol);
      fetch(url)
        .then((response) => response.json())
        .then(
          (data: {
            symbol?: string;
            interval?: string;
            hours?: number;
            count?: number;
            data?: Array<Record<string, unknown>>;
            candles?: Array<Record<string, unknown>>;
          }) => {
            const rawCandles = Array.isArray(data.data)
              ? data.data
              : Array.isArray(data.candles)
                ? data.candles
                : [];
            const resSymbol = ((data.symbol ?? symbol) as string).toUpperCase();
            const reqSymbol = symbol.toUpperCase();
            if (resSymbol !== reqSymbol) {
              console.error('🔴 [useCandles] Symbol mismatch: requested', symbol, 'got', resSymbol, '- ignoring response');
              return;
            }
            console.log('🟡 [useCandles] Received data for symbol:', resSymbol, 'candles:', rawCandles.length);
            const normalized = normalizeCandles(rawCandles, reqSymbol);
            if (!options?.mergeWithCurrent) {
              setCandles(normalized);
            }
            options?.onSuccess?.(normalized);
          }
        )
        .catch((error) => {
          console.error(`Failed to load candles for ${symbol}:`, error);
        });
    },
    [symbol]
  );

  useEffect(() => {
    let didUnmount = false;
    reconnectAttemptsRef.current = 0;

    console.log('🔵 [useCandles] useEffect triggered for symbol:', symbol);
    setCandles([]);

    const wsBase = getBackendWsBaseUrl();
    const normSymbol = symbol.toUpperCase();
    const websocketUrl = wsBase ? `${wsBase}/ws/${encodeURIComponent(normSymbol)}` : '';

    function connect() {
      if (didUnmount) return;
      if (!websocketUrl || wsRef.current?.readyState === WebSocket.OPEN) return;

      console.log(
        reconnectAttemptsRef.current === 0
          ? `Connecting to backend WebSocket: ${websocketUrl} (proposal API: historical + live_candle)`
          : `Reconnecting (attempt ${reconnectAttemptsRef.current + 1}/${MAX_RECONNECT_ATTEMPTS})...`
      );

      const ws = new WebSocket(websocketUrl);
      wsRef.current = ws;
      const isReconnect = reconnectAttemptsRef.current > 0;

      ws.onopen = () => {
        if (didUnmount) return;
        reconnectAttemptsRef.current = 0;
        console.log(`✅ Connected to backend for ${normSymbol}`);
        setIsConnected(true);
        // Proposal API: server sends historical first, then live_candle; no subscription message needed.

        if (isReconnect) {
          fetchCandles();
        }
      };

      ws.onmessage = (event) => {
        if (didUnmount) return;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(event.data as string) as Record<string, unknown>;
        } catch {
          return;
        }

        if (data.type === 'error') {
          console.error('[useCandles] Server error:', (data as { message?: string }).message);
          return;
        }

        if (data.type === 'historical') {
          const rawCandles = Array.isArray(data.data) ? data.data : [];
          const normalized = normalizeCandles(rawCandles, normSymbol);
          setCandles(normalized);
          return;
        }

        if (data.type === 'live_candle') {
          const newCandle = normalizeWsMessage(data, normSymbol);

          setCandles((previousCandles) => {
            const updatedCandles = [...previousCandles];

            if (updatedCandles.length > 0) {
              const lastCandle = updatedCandles[updatedCandles.length - 1];

              if (lastCandle.timestamp === newCandle.timestamp) {
                updatedCandles[updatedCandles.length - 1] = newCandle;
                return updatedCandles;
              }

              if (newCandle.timestamp - lastCandle.timestamp > ONE_INTERVAL_MS) {
                fetchCandles({
                  mergeWithCurrent: true,
                  onSuccess: (normalized) => {
                    setCandles((prev) => mergeRefetchedWithCurrent(normalized, prev));
                  },
                });
              }

              updatedCandles.push(newCandle);
              if (updatedCandles.length > 1000) updatedCandles.shift();
            } else {
              updatedCandles.push(newCandle);
            }

            return updatedCandles;
          });
          return;
        }
      };

      ws.onerror = (error) => {
        if (didUnmount) return;
        console.error(`WebSocket error for ${symbol}:`, error);
      };

      ws.onclose = () => {
        if (didUnmount) return;
        wsRef.current = null;
        console.log(`❌ Disconnected from backend for ${symbol}`);
        setIsConnected(false);

        if (
          reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS
        ) {
          const delay =
            RECONNECT_DELAYS_MS[
              Math.min(reconnectAttemptsRef.current, RECONNECT_DELAYS_MS.length - 1)
            ];
          reconnectAttemptsRef.current += 1;
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connect();
          }, delay);
        }
      };
    }

    connect();

    return () => {
      console.log(`Cleaning up connection for ${symbol}`);
      didUnmount = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [symbol, fetchCandles]);

  return {
    candles,
    isConnected,
  };
}
