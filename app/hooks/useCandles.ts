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
 * Supports: (1) flat object with timestamp (ms, from /ws/candles/{symbol}),
 *          (2) nested { type, symbol, interval, candle } with candle.time in seconds.
 */
function normalizeWsMessage(
  data: Record<string, unknown>,
  symbol: string
): Candle {
  const raw = (data.candle ?? data) as Record<string, unknown>;
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
  const base = (u && u.trim()) ? u.trim().replace(/\/$/, '') : 'http://localhost:8000';
  return base;
}

/** WebSocket base URL (ws or wss) from the same host/port as backend. */
function getBackendWsBaseUrl(): string {
  const base = getBackendBaseUrl();
  return base.replace(/^https/, 'wss').replace(/^http/, 'ws');
}

function normalizeCandles(
  rawCandles: Array<Record<string, unknown>>,
  symbol: string
): Candle[] {
  return rawCandles.map((c) => ({
    symbol,
    timestamp:
      typeof (c as { time?: number }).time === 'number'
        ? (c as { time: number }).time * 1000
        : ((c as { timestamp?: number }).timestamp ?? 0),
    open: Number((c as { open?: number }).open) || 0,
    high: Number((c as { high?: number }).high) || 0,
    low: Number((c as { low?: number }).low) || 0,
    close: Number((c as { close?: number }).close) || 0,
    volume: Number((c as { volume?: number }).volume) || 0,
    is_closed: true,
  }));
}

export function useCandles(symbol: string) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const fetchCandles = useCallback(
    (onSuccess?: (normalized: Candle[]) => void) => {
      const baseUrl = getBackendBaseUrl();
      const url = `${baseUrl}/candles/${symbol}/1m?limit=1000`;
      fetch(url)
        .then((response) => response.json())
        .then(
          (data: {
            symbol?: string;
            interval?: string;
            candles?: Array<Record<string, unknown>>;
          }) => {
            const rawCandles = Array.isArray(data.candles) ? data.candles : [];
            const normalized = normalizeCandles(rawCandles, symbol);
            setCandles(normalized);
            onSuccess?.(normalized);
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

    console.log(`Setting up connection for ${symbol}`);
    setCandles([]);

    // Initial REST load
    fetchCandles();

    const wsBase = getBackendWsBaseUrl();
    const websocketUrl = `${wsBase}/ws/candles/${symbol}`;

    function connect() {
      if (didUnmount) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) return;

      console.log(
        reconnectAttemptsRef.current === 0
          ? `Connecting to backend WebSocket: ${websocketUrl}`
          : `Reconnecting (attempt ${reconnectAttemptsRef.current + 1}/${MAX_RECONNECT_ATTEMPTS})...`
      );

      const ws = new WebSocket(websocketUrl);
      wsRef.current = ws;
      const isReconnect = reconnectAttemptsRef.current > 0;

      ws.onopen = () => {
        if (didUnmount) return;
        reconnectAttemptsRef.current = 0;
        console.log(`✅ Connected to backend for ${symbol}`);
        setIsConnected(true);

        // Option B: after reconnect, re-fetch last 1000 to align with backend
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
        const newCandle = normalizeWsMessage(data, symbol);

        setCandles((previousCandles) => {
          const updatedCandles = [...previousCandles];

          if (updatedCandles.length > 0) {
            const lastCandle = updatedCandles[updatedCandles.length - 1];

            if (lastCandle.timestamp === newCandle.timestamp) {
              updatedCandles[updatedCandles.length - 1] = newCandle;
              return updatedCandles;
            }

            // Optional: on forward gap, refetch in background to fill gap; still append so chart stays live
            if (newCandle.timestamp - lastCandle.timestamp > ONE_INTERVAL_MS) {
              fetchCandles();
            }

            updatedCandles.push(newCandle);
            if (updatedCandles.length > 1000) updatedCandles.shift();
          } else {
            updatedCandles.push(newCandle);
          }

          return updatedCandles;
        });
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
