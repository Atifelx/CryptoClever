'use client';

import { useEffect, useState, useRef } from 'react';

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

export function useCandlesDebug(symbol: string) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  console.log(`🔍 [useCandlesDebug] Hook called for symbol: ${symbol}`);

  useEffect(() => {
    console.log(`🔍 [useCandlesDebug] useEffect triggered for symbol: ${symbol}`);

    // Load initial data
    const restUrl = `http://localhost:8000/candles/${symbol}/1m?limit=1000`;
    console.log(`🔍 [useCandlesDebug] Fetching REST: ${restUrl}`);

    fetch(restUrl)
      .then((response) => response.json())
      .then((data: { symbol?: string; candles?: Array<Record<string, unknown>> }) => {
        console.log(`🔍 [useCandlesDebug] REST response for ${symbol}:`, {
          symbol: data.symbol,
          candleCount: data.candles?.length,
          firstCandle: data.candles?.[0],
          lastCandle: data.candles?.[(data.candles?.length ?? 1) - 1],
        });

        // Check if symbol matches
        if (data.symbol !== symbol) {
          console.error(`🚨 [useCandlesDebug] MISMATCH! Requested ${symbol}, got ${data.symbol}`);
        }

        if (data.candles) {
          const rawCandles = Array.isArray(data.candles) ? data.candles : [];
          setCandles(
            rawCandles.map((c: Record<string, unknown>) => ({
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
            }))
          );
        }
      })
      .catch((error) => {
        console.error(`❌ [useCandlesDebug] REST error for ${symbol}:`, error);
      });

    // WebSocket connection: single endpoint, subscribe to (symbol, 1m)
    const wsUrl = `ws://localhost:8000/ws/candles`;
    console.log(`🔍 [useCandlesDebug] Connecting WebSocket: ${wsUrl}, subscribing to ${symbol} 1m`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`✅ [useCandlesDebug] WebSocket connected for ${symbol}`);
      setIsConnected(true);
      ws.send(JSON.stringify({ symbol, interval: '1m' }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data as string) as Record<string, unknown>;
      if (data.type !== 'candle') return;
      const raw = (data.candle ?? data) as Record<string, unknown>;
      const t = raw.time ?? raw.timestamp;
      const ts = typeof t === 'number' ? (t < 1e10 ? t * 1000 : t) : 0;
      const newCandle: Candle = {
        symbol: (raw.symbol ?? data.symbol ?? symbol) as string,
        timestamp: ts,
        open: Number(raw.open) || 0,
        high: Number(raw.high) || 0,
        low: Number(raw.low) || 0,
        close: Number(raw.close) || 0,
        volume: Number(raw.volume) || 0,
        is_closed: raw.is_closed !== false,
      };
      if (newCandle.symbol !== symbol) return;

      console.log(`📨 [useCandlesDebug] Received for ${symbol}:`, {
        receivedSymbol: newCandle.symbol,
        requestedSymbol: symbol,
        close: newCandle.close,
        timestamp: newCandle.timestamp,
      });

      // CRITICAL CHECK
      if (newCandle.symbol !== symbol) {
        console.error(`🚨 [useCandlesDebug] SYMBOL MISMATCH!`);
        console.error(`   Requested: ${symbol}`);
        console.error(`   Received:  ${newCandle.symbol}`);
        console.error(`   WebSocket URL was: ${wsUrl}`);
      }

      setCandles((prev) => {
        console.log(
          `🔍 [useCandlesDebug] Updating candles for ${symbol}, current count: ${prev.length}`
        );

        const updated = [...prev];

        if (updated.length > 0) {
          const lastCandle = updated[updated.length - 1];

          if (lastCandle.timestamp === newCandle.timestamp) {
            console.log(`🔄 [useCandlesDebug] Updating existing candle for ${symbol}`);
            updated[updated.length - 1] = newCandle;
          } else {
            console.log(`➕ [useCandlesDebug] Adding new candle for ${symbol}`);
            updated.push(newCandle);

            if (updated.length > 1000) {
              updated.shift();
            }
          }
        } else {
          updated.push(newCandle);
        }

        return updated;
      });
    };

    ws.onerror = (error) => {
      console.error(`❌ [useCandlesDebug] WebSocket error for ${symbol}:`, error);
    };

    ws.onclose = () => {
      console.log(`❌ [useCandlesDebug] WebSocket closed for ${symbol}`);
      setIsConnected(false);
    };

    return () => {
      console.log(`🧹 [useCandlesDebug] Cleanup for ${symbol}, closing WebSocket`);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [symbol]);

  return { candles, isConnected };
}
