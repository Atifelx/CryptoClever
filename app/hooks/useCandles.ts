'use client';

import { useEffect, useState, useRef } from 'react';

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

export function useCandles(symbol: string) {
  // Store candle data
  const [candles, setCandles] = useState<Candle[]>([]);

  // Track connection status
  const [isConnected, setIsConnected] = useState(false);

  // Store WebSocket reference
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    console.log(`Setting up connection for ${symbol}`);
    let didUnmount = false;

    // Clear candles on symbol change so the chart never shows the previous symbol's data
    setCandles([]);

    // STEP A: Load initial 1000 candles from your backend REST API
    // Backend: GET /candles/{symbol}/1m returns { symbol, interval, candles: [...] }
    const restUrl = `http://localhost:8000/candles/${symbol}/1m?limit=1000`;
    console.log(`Loading initial candles for ${symbol}...`);
    fetch(restUrl)
      .then((response) => response.json())
      .then((data: { symbol?: string; interval?: string; candles?: Array<Record<string, unknown>> }) => {
        if (didUnmount) return;
        const rawCandles = Array.isArray(data.candles) ? data.candles : [];
        // Normalize backend format { time, open, high, low, close, volume } to Candle
        const normalized: Candle[] = rawCandles.map((c) => ({
          symbol: symbol,
          timestamp: typeof (c as { time?: number }).time === 'number' ? (c as { time: number }).time * 1000 : (c as { timestamp?: number }).timestamp ?? 0,
          open: Number((c as { open?: number }).open) || 0,
          high: Number((c as { high?: number }).high) || 0,
          low: Number((c as { low?: number }).low) || 0,
          close: Number((c as { close?: number }).close) || 0,
          volume: Number((c as { volume?: number }).volume) || 0,
          is_closed: true,
        }));
        console.log(`Loaded ${normalized.length} initial candles for ${symbol}`);
        setCandles(normalized);
      })
      .catch((error) => {
        if (didUnmount) return;
        console.error(`Failed to load initial candles for ${symbol}:`, error);
      });

    // STEP B: Connect to YOUR backend WebSocket (NOT Binance!)
    const websocketUrl = `ws://localhost:8000/ws/candles/${symbol}`;
    console.log(`Connecting to backend WebSocket: ${websocketUrl}`);

    const ws = new WebSocket(websocketUrl);
    wsRef.current = ws;

    // When connection opens
    ws.onopen = () => {
      if (didUnmount) return;
      console.log(`✅ Connected to backend for ${symbol}`);
      setIsConnected(true);
    };

    // When we receive a message from backend
    ws.onmessage = (event) => {
      if (didUnmount) return;
      // Parse the candle data
      const newCandle: Candle = JSON.parse(event.data);
      console.log(`Received candle update for ${symbol}:`, newCandle);

      // Update the candles array
      setCandles((previousCandles) => {
        // Make a copy of the array
        const updatedCandles = [...previousCandles];

        // Check if this is updating the last candle or adding a new one
        if (updatedCandles.length > 0) {
          const lastCandle = updatedCandles[updatedCandles.length - 1];

          // Same timestamp = update the existing candle (it's still forming)
          if (lastCandle.timestamp === newCandle.timestamp) {
            console.log(`Updating existing candle at index ${updatedCandles.length - 1}`);
            updatedCandles[updatedCandles.length - 1] = newCandle;
          }
          // Different timestamp = new candle started
          else {
            console.log(`Adding new candle`);
            updatedCandles.push(newCandle);

            // Keep only the last 1000 candles
            if (updatedCandles.length > 1000) {
              updatedCandles.shift(); // Remove the oldest
            }
          }
        } else {
          // First candle
          updatedCandles.push(newCandle);
        }

        return updatedCandles;
      });
    };

    // When there's an error
    ws.onerror = (error) => {
      // In React strict-mode dev, effects mount/unmount twice; ignore errors after cleanup.
      if (didUnmount) return;
      console.error(`WebSocket error for ${symbol}:`, error);
    };

    // When connection closes
    ws.onclose = () => {
      if (didUnmount) return;
      console.log(`❌ Disconnected from backend for ${symbol}`);
      setIsConnected(false);
    };

    // Cleanup function - runs when component unmounts
    return () => {
      console.log(`Cleaning up connection for ${symbol}`);
      didUnmount = true;
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [symbol]); // Re-run if symbol changes

  // Return data and connection status
  return {
    candles,
    isConnected,
  };
}
