'use client';

import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { createChart, IChartApi, ISeriesApi, ColorType, Time } from 'lightweight-charts';
import { useCandles } from '../../hooks/useCandles';
import { useTradingStore } from '../../store/tradingStore';
import type { Candle } from '../../store/candlesStore';
import { calculateSemafor, getSemaforTrend } from '../../lib/indicators/semafor';
import { SemaforPoint } from '../../lib/indicators/types';
import type { SemaforTrend } from '../../lib/indicators/semafor';
import { generateScalpSignal, getScalpDisplayItems } from '../../lib/indicators/scalpSignal';
import type { ScalpDisplayItem } from '../../lib/indicators/scalpSignal';
import { getTrendDisplayItem } from '../../lib/indicators/trendIndicator';
import type { TrendMarker } from '../../lib/indicators/trendIndicator';
import { calculateFMCBR, getFMCBRRequiredCandles } from '../../lib/indicators/fmcbr';
import type { FMCBRSignal } from '../../lib/indicators/fmcbr';
import UnifiedMarkerManager from './UnifiedMarkerManager';
import FMCBROverlay from './FMCBROverlay';
import TrendIndicatorOverlay from './TrendIndicatorOverlay';
import CandleSizeControl from './CandleSizeControl';
import { formatIST } from '../../lib/utils/time';
import CoreEngineOverlay from './CoreEngineOverlay';
import AIPredictionOverlay from './AIPredictionOverlay';
import FMCBRArrowOverlay from './FMCBRArrowOverlay';
import SemaforOverlay from './SemaforOverlay';
import AISignalArrowOverlay from './AISignalArrowOverlay';

interface TradingChartProps {
  symbol: string;
  interval: string;
  enabledIndicators: Set<string>;
  onToggleIndicator: (id: string, enabled: boolean) => void;
  onIndicatorDataUpdate?: (data: {
    semaforPoints: SemaforPoint[];
    semaforTrend: SemaforTrend;
    scalpSignals: ScalpDisplayItem[];
    trendMarker: TrendMarker | null;
  }) => void;
}

export default function TradingChart({
  symbol,
  interval,
  enabledIndicators,
  onToggleIndicator,
  onIndicatorDataUpdate,
}: TradingChartProps) {
  const isForexSymbol = symbol.startsWith('C:');
  const { coreEngineAnalysis, keepLiveAnalysis } = useTradingStore();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [showBackendUnavailable, setShowBackendUnavailable] = useState(false);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  // Default zoom level (bar spacing) – tuned to match design screenshot.
  // Larger value => more zoomed-in view (fewer candles on screen).
  const [candleSize, setCandleSize] = useState<number>(6);
  const userInteractedRef = useRef<boolean>(false);
  const isPanningRef = useRef<boolean>(false);
  const panStartXRef = useRef<number>(0);
  const panStartPositionRef = useRef<number | null>(null);
  /** Set true during effect cleanup so resize/visibility handlers no-op. */
  const isCleaningUpRef = useRef<boolean>(false);

  const { candles, isConnected, isLoading } = useCandles(symbol);
  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  const lastCandleAgeSeconds = lastCandle ? Math.max(0, Math.floor(Date.now() / 1000) - lastCandle.time) : null;
  const connectionLabel = isConnected ? 'Live' : 'Disconnected';
  const priceStatusLabel = isConnected ? 'LIVE' : 'Disconnected';
  const priceStatusClass = isConnected ? 'text-green-500' : 'text-red-400';
  const priceDotClass = isConnected ? 'bg-green-500 w-[9.6px] h-[9.6px]' : 'bg-red-500 w-2 h-2';
  const lastUpdateLabel = lastCandle
    ? `Last candle ${formatIST(lastCandle.time)}`
    : 'Waiting for candle data';
  const staleLabel = isForexSymbol && lastCandleAgeSeconds !== null && lastCandleAgeSeconds > 3600
    ? `Source is ${Math.floor(lastCandleAgeSeconds / 3600)}h behind`
    : null;

  // ─── Single source of truth: candles are for the SELECTED symbol only (same logic as BTC).
  // useCandles(symbol) returns getCandlesForSymbol(symbol) from Zustand — never BTC or another symbol's data.
  // All indicators below read this same `candles` array; when user switches pair, symbol changes and candles
  // become the new symbol's data. Never use btcCandles or candlesBySymbol[other] here.

  // DEBUG: Log and verify data is for current symbol (dev-only)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && candles.length > 0) {
      const first3 = candles.slice(0, 3).map((c) => c.close.toFixed(2));
      const last3 = candles.slice(-3).map((c) => c.close.toFixed(2));
      console.log(`🎨 [TradingChart] symbol="${symbol}" count=${candles.length} FIRST=[${first3.join(',')}] LAST=[${last3.join(',')}]`);
      // Plausible range check: ensure we're not showing wrong symbol's data (e.g. BTC prices when SOL selected)
      const lastClose = candles[candles.length - 1]?.close ?? 0;
      const ranges: Record<string, [number, number]> = {
        BTCUSDT: [1000, 500_000],
        SOLUSDT: [1, 10_000],
        BNBUSDT: [10, 10_000],
        XRPUSDT: [0.01, 100],
      };
      const [min, max] = ranges[symbol] ?? [0, Infinity];
      if (lastClose < min || lastClose > max) {
        console.error(`[TradingChart] DATA MISMATCH? symbol=${symbol} but lastClose=${lastClose} outside [${min},${max}]. Check that candles are for selected symbol only.`);
      }
    }
  }, [symbol, candles]);

  // Candles from Zustand store are already in chart format (time in seconds)
  // isLoading is now provided by useCandles hook

  // Track previous symbol/interval and candle count for efficient updates
  const prevSymbolRef = useRef<string>(symbol);
  const prevIntervalRef = useRef<string>(interval);
  const prevCandlesLenRef = useRef<number>(0);
  /** Symbol for which we last set chart data; avoid applying stale data after symbol change. */
  const chartDataSymbolRef = useRef<string | null>(symbol);
  /** Track if this is the first data load after component mount - always use setData() */
  const isFirstDataLoadRef = useRef<boolean>(true);
  
  // Calculate Semafor when candles change
  const semaforPoints = useMemo((): SemaforPoint[] => {
    if (typeof window === 'undefined') return [];
    if (isLoading || candles.length < 20) return [];
    
    try {
      return calculateSemafor(candles, interval);
    } catch (error) {
      console.error('Semafor calc error:', error);
      return [];
    }
  }, [
    symbol,
    interval,
    candles.length,
    candles[candles.length - 1]?.time,
    candles[candles.length - 1]?.close,
    isLoading,
  ]);

  // Get trend info for display (EMA 20/50)
  const semaforTrend = useMemo((): SemaforTrend => {
    if (typeof window === 'undefined') return { trend: 'NEUTRAL', ema20: 0, ema50: 0 };
    if (isLoading || candles.length < 55) return { trend: 'NEUTRAL', ema20: 0, ema50: 0 };
    try {
      return getSemaforTrend(candles);
    } catch {
      return { trend: 'NEUTRAL', ema20: 0, ema50: 0 };
    }
  }, [candles.length, candles[candles.length - 1]?.time, symbol, isLoading]);

  // Scalp Signal Indicator — current-candle only, closed candles only (no repainting)
  // Returns array of one item (like Phoenix) so we always have something to draw when Scalp is on
  const scalpSignals = useMemo((): ScalpDisplayItem[] => {
    if (typeof window === 'undefined') return [];
    if (isLoading || candles.length < 101) return []; // need 100+ closed => 101+ total

    try {
      const result = generateScalpSignal(candles);
      const lastClosedTime = candles[candles.length - 2]?.time ?? 0;
      return getScalpDisplayItems(result, lastClosedTime);
    } catch (error) {
      console.error('[Scalp] Calculation error:', error);
      return [];
    }
  }, [
    candles.length,
    candles[candles.length - 2]?.time,
    candles[candles.length - 2]?.close,
    symbol,
    isLoading,
  ]);

  // Trend Indicator — analyzes last 1000 candles with EMA(20/50/200) and volume
  const trendMarker = useMemo((): TrendMarker | null => {
    if (typeof window === 'undefined') return null;
    if (isLoading || candles.length < 200) return null; // need at least 200 candles for EMA200

    try {
      return getTrendDisplayItem(candles);
    } catch (error) {
      console.error('[Trend] Calculation error:', error);
      return null;
    }
  }, [
    candles.length,
    candles[candles.length - 1]?.time,
    candles[candles.length - 1]?.close,
    symbol,
    isLoading,
  ]);

  // FMCBR — runs like other indicators when enabled. Needs 200+ closed candles (no dependency on Core Engine).
  const fmcbrSignal = useMemo((): FMCBRSignal | null => {
    if (typeof window === 'undefined') return null;
    const closedCandles = candles.slice(0, candles.length - 1);
    const requiredCandles = getFMCBRRequiredCandles(closedCandles);
    if (closedCandles.length < requiredCandles) {
      if (process.env.NODE_ENV === 'development' && closedCandles.length > 0) {
        console.log('[FMCBR] Waiting for more candles:', closedCandles.length, '/', requiredCandles);
      }
      return null;
    }

    try {
      const signal = calculateFMCBR(candles);
      if (process.env.NODE_ENV === 'development' && signal) {
        console.log('[FMCBR] Signal:', signal.status, signal.breakType, signal.direction);
      }
      return signal;
    } catch (error) {
      console.error('[FMCBR] Calculation error:', error);
      return null;
    }
  }, [
    symbol,
    candles,
    candles.length,
    candles[candles.length - 1]?.time,
    candles[candles.length - 1]?.close,
  ]);

  // Expose indicator data to parent component (deferred to avoid setState-during-render)
  useEffect(() => {
    if (!onIndicatorDataUpdate) return;
    const payload = { semaforPoints, semaforTrend, scalpSignals, trendMarker };
    queueMicrotask(() => {
      onIndicatorDataUpdate(payload);
    });
  }, [semaforPoints, semaforTrend, scalpSignals, trendMarker, onIndicatorDataUpdate]);

  // Initialize chart ONCE on mount. When symbol changes we only call setData() in the data effect — no dispose/recreate.
  // This avoids "Object is disposed" and follows lightweight-charts pattern: one chart, setData(newSymbolData) on symbol change.
  useEffect(() => {
    if (!chartContainerRef.current) return;
    if (chartRef.current) return; // Already created (e.g. Strict Mode double-mount)

    const container = chartContainerRef.current;
    let mutationObserver: MutationObserver | null = null;
    let observerTimeoutId: ReturnType<typeof setTimeout> | null = null;

    isCleaningUpRef.current = false;
    console.log(`🏗️ [Chart] Creating chart instance (once per component)`);

    // Single chart instance — symbol change is handled by setData() in the data effect, not by recreate
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#1a1a1a' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2a2a2a' },
        horzLines: { color: '#2a2a2a' },
      },
      width: container.clientWidth,
      height: container.clientHeight || 600,
      autoSize: true,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 6, // Default zoom – shows ~70-90 candles (2-3 hours for 1m)
        fixLeftEdge: false,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: false,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Convert time labels to IST using MutationObserver
    if (container) {
      mutationObserver = new MutationObserver(() => {
        const el = chartContainerRef.current;
        if (!el) return;
        const timeElements = el.querySelectorAll('[class*="pane"] [class*="time"], [class*="pane"] text') || [];
        timeElements.forEach((el) => {
          const text = el.textContent?.trim() || '';
          const timeMatch = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
          if (timeMatch) {
            // Time label - could convert to IST here if needed
          }
        });
      });
      observerTimeoutId = setTimeout(() => {
        if (chartContainerRef.current && mutationObserver) {
          mutationObserver.observe(chartContainerRef.current, {
            childList: true,
            subtree: true,
            characterData: true,
          });
        }
      }, 1000);
    }

    // Pan & Zoom handlers
    let cleanupPanZoom: (() => void) | null = null;

    if (container) {
      const handleMouseDown = (e: MouseEvent) => {
        if (e.button === 0) {
          isPanningRef.current = true;
          panStartXRef.current = e.clientX;
          panStartPositionRef.current = chart.timeScale().scrollPosition();
          userInteractedRef.current = true;
          container.style.cursor = 'grabbing';
        }
      };

      const handleMouseMove = (e: MouseEvent) => {
        if (isPanningRef.current && panStartPositionRef.current !== null) {
          const deltaX = e.clientX - panStartXRef.current;
          chart.timeScale().scrollToPosition(panStartPositionRef.current - deltaX, false);
        }
      };

      const handleMouseUp = () => {
        isPanningRef.current = false;
        panStartPositionRef.current = null;
        container.style.cursor = 'default';
      };

      const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        userInteractedRef.current = true;
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const ts = chart.timeScale();
        const vr = ts.getVisibleRange();
        if (!vr || typeof vr.from !== 'number' || typeof vr.to !== 'number') return;
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const width = rect.width;
        const pivot = ts.coordinateToTime(x) as number;
        if (pivot == null || typeof pivot !== 'number') return;
        const range = vr.to - vr.from;
        const newRange = Math.max(10, Math.min(range * zoomFactor, 10000));
        const ratio = width > 0 ? x / width : 0.5;
        const from = pivot - ratio * newRange;
        const to = pivot + (1 - ratio) * newRange;
        ts.setVisibleRange({
          from: from as Time,
          to: to as Time,
        });
      };

      container.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      container.addEventListener('wheel', handleWheel, { passive: false });

      cleanupPanZoom = () => {
        container.removeEventListener('mousedown', handleMouseDown);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        container.removeEventListener('wheel', handleWheel);
      };
    }

    const handleResize = () => {
      if (isCleaningUpRef.current) return;
      const ch = chartRef.current;
      const cont = chartContainerRef.current;
      if (!cont || !ch) return;
      try {
        ch.applyOptions({
          width: cont.clientWidth,
          height: cont.clientHeight || 600,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.toLowerCase().includes('disposed')) return;
        console.warn('[Chart] Resize error:', e);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      isCleaningUpRef.current = true;
      window.removeEventListener('resize', handleResize);
      if (cleanupPanZoom) cleanupPanZoom();
      if (observerTimeoutId != null) clearTimeout(observerTimeoutId);
      if (mutationObserver && chartContainerRef.current) {
        mutationObserver.disconnect();
      }
      const ch = chartRef.current;
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      if (ch) {
        try {
          ch.remove();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!msg.toLowerCase().includes('disposed')) console.warn('[Chart] Cleanup remove error:', e);
        }
      }
    };
  }, []); // Empty deps: create once on mount; cleanup only on unmount

  // Update candle size (barSpacing) when it changes
  useEffect(() => {
    const ch = chartRef.current;
    if (!ch) return;
    try {
      ch.timeScale().applyOptions({
        barSpacing: candleSize,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.toLowerCase().includes('disposed')) console.warn('[Chart] Candle size error:', e);
    }
  }, [candleSize]);

  // On symbol/interval change: clear chart BEFORE paint so library never shows stale symbol (useLayoutEffect per lightweight-charts React tips).
  // Update prevSymbolRef/prevIntervalRef here so we only clear ONCE per change; otherwise we'd clear again on every re-render until data effect runs.
  useLayoutEffect(() => {
    if (prevSymbolRef.current !== symbol || prevIntervalRef.current !== interval) {
      console.log(`[Chart] Symbol/interval changed to ${symbol}/${interval}`);
      
      prevSymbolRef.current = symbol;
      prevIntervalRef.current = interval;
      prevCandlesLenRef.current = 0;
      chartDataSymbolRef.current = null;
      userInteractedRef.current = false;
      
      try {
        if (candleSeriesRef.current && volumeSeriesRef.current) {
          candleSeriesRef.current.setData([]);
          volumeSeriesRef.current.setData([]);
        }
        if (chartRef.current) {
          chartRef.current.timeScale().resetTimeScale();
        }
      } catch (e) {
        console.error('[Chart] Error during symbol change cleanup:', e);
      }
    }
  }, [symbol, interval]);

  // Update chart data BEFORE paint so no flicker/wrong scale (useLayoutEffect per lightweight-charts React tips).
  useLayoutEffect(() => {
    console.log(`[Chart Data Effect] Triggered: symbol=${symbol}, candles=${candles.length}, seriesExists=${!!candleSeriesRef.current}`);
    
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    if (candles.length === 0) {
      prevCandlesLenRef.current = 0;
      try {
        candleSeriesRef.current.setData([]);
        volumeSeriesRef.current.setData([]);
      } catch {}
      return;
    }

    // CRITICAL FIX: On symbol change, chartDataSymbolRef is null, so allow the first setData
    // After that, guard against stale data from previous symbol
    if (chartDataSymbolRef.current !== null && symbol !== chartDataSymbolRef.current) {
      console.warn(`[Chart] BLOCKING stale data: chart has ${chartDataSymbolRef.current} but received ${symbol}`);
      return;
    }

    // Per HLD: never apply another symbol's candles. If price range doesn't match current symbol, skip (handles WS/store race).
    const expectedRanges: Record<string, [number, number]> = {
      BTCUSDT: [1000, 500_000],
      ETHUSDT: [100, 50_000],
      'C:XAUUSD': [100, 10_000],
      'C:GBPJPY': [10, 1000],
    };
    const range = expectedRanges[symbol];
    if (range && candles.length > 0) {
      const lastClose = candles[candles.length - 1]?.close ?? 0;
      if (lastClose < range[0] || lastClose > range[1]) {
        console.warn(`[Chart] SKIP setData: candles look like wrong symbol (${symbol} expects ${range[0]}-${range[1]}, got close=${lastClose})`);
        return;
      }
    }

    if (process.env.NODE_ENV === 'development' && candles.length > 0) {
      const lastCloses = candles.slice(-5).map((c) => c.close);
      console.log('📊 [TradingChart] Chart data update:', { symbol, candleCount: candles.length, lastCloses });
    }

    const prevLen = prevCandlesLenRef.current;
    const isInitialLoad = prevLen === 0;
    const hasNewCandle = candles.length !== prevLen;
    const isSymbolChange = prevSymbolRef.current !== symbol || prevIntervalRef.current !== interval;
    const isFirstLoad = isFirstDataLoadRef.current;

    console.log(`[Chart Data Effect] Decision: prevLen=${prevLen}, isInitialLoad=${isInitialLoad}, hasNewCandle=${hasNewCandle}, isSymbolChange=${isSymbolChange}, isFirstLoad=${isFirstLoad}`);
    console.log(`[Chart Data Effect] Refs: prevSymbol=${prevSymbolRef.current}, currentSymbol=${symbol}, prevInterval=${prevIntervalRef.current}`);

    // DECISION LOGIC:
    // 1. If it's a symbol/interval change or first load ever -> setData()
    // 2. If it's the same symbol and we have existing data -> update() with the last candle
    if (isFirstLoad || isSymbolChange || prevLen === 0) {
      isFirstDataLoadRef.current = false;
      const candlestickData = candles.map((c: Candle) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      const volumeData = candles.map((c: Candle) => ({
        time: c.time as Time,
        value: c.volume || 0,
        color: c.close >= c.open ? '#26a69a80' : '#ef535080',
      }));

      try {
        candleSeriesRef.current.setData(candlestickData);
        volumeSeriesRef.current.setData(volumeData);
        chartDataSymbolRef.current = symbol;
        const lastCandle = candles[candles.length - 1];
        if (lastCandle) setCurrentPrice(lastCandle.close);
        prevCandlesLenRef.current = candles.length;
        prevSymbolRef.current = symbol;
        prevIntervalRef.current = interval;

        // Initial visible range: only on symbol change or first load
        const ch = chartRef.current;
        if (ch && candlestickData.length > 0) {
          const visibleCandles = 80;
          const lastTime = candlestickData[candlestickData.length - 1].time as number;
          const firstVisibleIndex = Math.max(0, candlestickData.length - visibleCandles);
          const firstTime = candlestickData[firstVisibleIndex].time as number;
          ch.timeScale().setVisibleRange({ from: firstTime as Time, to: lastTime as Time });
        }
        console.log(`✅ [Chart] Initialized data for ${symbol} (${candlestickData.length} candles)`);
      } catch (error) {
        console.error('[Chart] Error setting initial chart data:', error);
      }
    } else {
      // INCREMENTAL UPDATE: Use update() to append or modify the last candle.
      // This is MUCH smoother than setData() and prevents the "jumping" UI glitch.
      const lastCandle = candles[candles.length - 1];
      if (lastCandle) {
        try {
          candleSeriesRef.current.update({
            time: lastCandle.time as Time,
            open: lastCandle.open,
            high: lastCandle.high,
            low: lastCandle.low,
            close: lastCandle.close,
          });
          volumeSeriesRef.current.update({
            time: lastCandle.time as Time,
            value: lastCandle.volume || 0,
            color: lastCandle.close >= lastCandle.open ? '#26a69a80' : '#ef535080',
          });
          setCurrentPrice(lastCandle.close);
          prevCandlesLenRef.current = candles.length;
        } catch (error) {
          console.error('[Chart] Update error:', error);
        }
      }
    }
  }, [candles, isLoading, symbol, interval]);

  const isEnabled = (id: string) => enabledIndicators.has(id);

  // Tab visibility — resize chart only when returning to tab; do not change zoom (fitContent would zoom out).
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible' || isCleaningUpRef.current) return;
      const ch = chartRef.current;
      const cont = chartContainerRef.current;
      if (!ch || !cont) return;
      try {
        ch.applyOptions({
          width: cont.clientWidth,
          height: cont.clientHeight || 600,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.toLowerCase().includes('disposed')) console.warn('[Chart] Visibility resize error:', e);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [candles.length]);

  // After 4s with no data, show backend-unavailable message (stable deps: always 3 elements)
  useEffect(() => {
    if (candles.length > 0) {
      setShowBackendUnavailable(false);
      return;
    }
    setShowBackendUnavailable(false);
    const t = setTimeout(() => setShowBackendUnavailable(true), 4000);
    return () => clearTimeout(t);
  }, [symbol, interval, candles.length]);

  // Zoom controls
  const handleZoomIn = () => {
    if (!chartRef.current) return;
    userInteractedRef.current = true;
    const ts = chartRef.current.timeScale();
    const vr = ts.getVisibleRange();
    if (!vr || typeof vr.from !== 'number' || typeof vr.to !== 'number') return;
    const range = vr.to - vr.from;
    const center = (vr.from + vr.to) / 2;
    const nr = range * 0.8;
    ts.setVisibleRange({ from: (center - nr / 2) as Time, to: (center + nr / 2) as Time });
  };

  const handleZoomOut = () => {
    if (!chartRef.current) return;
    userInteractedRef.current = true;
    const ts = chartRef.current.timeScale();
    const vr = ts.getVisibleRange();
    if (!vr || typeof vr.from !== 'number' || typeof vr.to !== 'number') return;
    const range = vr.to - vr.from;
    const center = (vr.from + vr.to) / 2;
    const nr = range * 1.25;
    ts.setVisibleRange({ from: (center - nr / 2) as Time, to: (center + nr / 2) as Time });
  };

  const handleResetZoom = () => {
    if (!chartRef.current) return;
    userInteractedRef.current = false;
    chartRef.current.timeScale().fitContent();
  };

  return (
    <div className="flex flex-col w-full h-full">
      {/* Connection status indicator */}
      <div className="flex items-center gap-2 mb-4 px-1">
        <span className="font-semibold text-white">{symbol}</span>
        {(isConnected || isForexSymbol) ? (
          <>
            <span
              className={`inline-block w-3 h-3 rounded-full flex-shrink-0 live-dot-glow-shrink ${isForexSymbol ? 'bg-amber-400' : 'bg-green-500'}`}
              aria-hidden
              title={connectionLabel}
            />
            <span className="text-sm text-gray-400">{connectionLabel}</span>
          </>
        ) : (
          <span className="text-sm text-gray-400">○ Disconnected</span>
        )}
      </div>

      <div className="relative flex-1 min-h-0">
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1a1a1a] bg-opacity-90 z-20">
            <div className="w-10 h-10 border-2 border-[#26a69a] border-t-transparent rounded-full animate-spin mb-3" />
            <div className="text-white font-medium">Loading {symbol}...</div>
            <div className="text-gray-500 text-sm mt-1">
              {showBackendUnavailable
                ? 'No data from backend. Ensure the backend is running (e.g. port 8000) and BACKEND_URL is set. Bootstrap may take 30–60s on first start.'
                : 'Loading data from backend'}
            </div>
          </div>
        )}
        
        {/* Zoom control - bottom right (TradingView style) */}
        <CandleSizeControl size={candleSize} onSizeChange={setCandleSize} />

        {/* Price display */}
        <div className="absolute top-4 right-4 z-10">
          <div className="bg-[#2a2a2a] px-4 py-2 rounded border border-[#3a3a3a]">
            <div className="text-sm text-gray-400">Current Price</div>
            <div className="text-2xl text-white font-bold">
              ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className={`text-xs flex items-center gap-1 mt-1 ${priceStatusClass}`}>
              <span
                className={`inline-block rounded-full flex-shrink-0 live-dot-glow-shrink ${priceDotClass}`}
                aria-hidden
              />
              {priceStatusLabel}
            </div>
            <div className="text-xs text-gray-500 mt-1">{lastUpdateLabel}</div>
            {staleLabel && <div className="text-xs text-amber-400 mt-1">{staleLabel}</div>}
          </div>
        </div>

        {/* Debug: verify chart data is per-symbol (only when NEXT_PUBLIC_DEBUG_CHART=1) */}
        {process.env.NEXT_PUBLIC_DEBUG_CHART === '1' && (
          <div className="absolute top-4 left-4 z-10 text-xs font-mono text-gray-500 bg-[#1a1a1a]/90 px-2 py-1 rounded border border-[#2a2a2a]">
            Symbol: <span className="text-gray-300">{symbol}</span>
            {' · '}
            Last close (from data):{' '}
            <span className="text-gray-300">
              {candles.length > 0
                ? candles[candles.length - 1].close.toLocaleString(undefined, { maximumFractionDigits: 4 })
                : '—'}
            </span>
          </div>
        )}

        {/* Chart container with overlays positioned inside */}
        <div key={`chart-container-${symbol}`} className="w-full h-full relative">
          {/* Chart canvas */}
          <div ref={chartContainerRef} className="w-full h-full" />

          <AIPredictionOverlay
            prediction={keepLiveAnalysis ? (coreEngineAnalysis?.prediction ?? null) : null}
            visible={keepLiveAnalysis}
          />
          <CoreEngineOverlay
            chart={chartRef.current}
            candleSeries={candleSeriesRef.current}
            containerRef={chartContainerRef}
            zone={keepLiveAnalysis ? (coreEngineAnalysis?.zones?.[0] ?? null) : null}
            supportResistance={keepLiveAnalysis ? (coreEngineAnalysis?.supportResistance ?? null) : null}
            prediction={keepLiveAnalysis ? (coreEngineAnalysis?.prediction ?? null) : null}
          />
          
          {/* Trend Indicator Overlay - Renders at top inside chart area with white circle at tail */}
          <TrendIndicatorOverlay
            trendMarker={isEnabled('trendIndicator') ? trendMarker : null}
            showTrend={isEnabled('trendIndicator')}
            scalpSignals={isEnabled('scalpSignal') ? scalpSignals : []}
            showScalp={isEnabled('scalpSignal')}
          />

          <FMCBRArrowOverlay
            chart={chartRef.current}
            candleSeries={candleSeriesRef.current}
            containerRef={chartContainerRef}
            signal={fmcbrSignal}
            visible={isEnabled('fmcbr')}
          />

          <SemaforOverlay
            chart={chartRef.current}
            candleSeries={candleSeriesRef.current}
            containerRef={chartContainerRef}
            points={semaforPoints}
            visible={isEnabled('semafor')}
          />

          {/* AI Signal Range Arrows — Scalp & Long trade visual on chart */}
          <AISignalArrowOverlay
            chart={chartRef.current}
            candleSeries={candleSeriesRef.current}
            containerRef={chartContainerRef}
            scalpTrade={keepLiveAnalysis ? (coreEngineAnalysis?.prediction?.scalpTrade ?? null) : null}
            longTrade={keepLiveAnalysis ? (coreEngineAnalysis?.prediction?.longTrade ?? null) : null}
            visible={keepLiveAnalysis}
          />
        </div>
        
        {/* Unified Marker Manager - Merges markers from all indicators */}
        {candleSeriesRef.current && (
          <>
            <UnifiedMarkerManager
              candleSeries={candleSeriesRef.current}
              semaforPoints={isEnabled('semafor') ? semaforPoints : []}
              scalpSignals={isEnabled('scalpSignal') ? scalpSignals : []}
              trendMarker={null} // Trend indicator now uses overlay, not markers
              fmcbrSignal={isEnabled('fmcbr') ? fmcbrSignal : null}
              trendScalpSignals={[]}
              currentCandleTime={candles.length > 0 ? candles[candles.length - 1]?.time : undefined}
              showSemafor={isEnabled('semafor')}
              showScalp={isEnabled('scalpSignal')}
              showTrend={false}
              showFMCBR={isEnabled('fmcbr')}
              showTrendScalp={false}
            />
            <FMCBROverlay
              candleSeries={candleSeriesRef.current}
              signal={isEnabled('fmcbr') ? fmcbrSignal : null}
              showFMCBR={isEnabled('fmcbr')}
            />
          </>
        )}
      </div>
    </div>
  );
}
