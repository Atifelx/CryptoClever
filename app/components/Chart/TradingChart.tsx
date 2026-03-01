'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
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
import { calculateFMCBR } from '../../lib/indicators/fmcbr';
import type { FMCBRSignal } from '../../lib/indicators/fmcbr';
import UnifiedMarkerManager from './UnifiedMarkerManager';
import FMCBROverlay from './FMCBROverlay';
import TrendIndicatorOverlay from './TrendIndicatorOverlay';
import ScalpSignalOverlay from './ScalpSignalOverlay';
import CandleSizeControl from './CandleSizeControl';
import { formatIST } from '../../lib/utils/time';

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
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [showBackendUnavailable, setShowBackendUnavailable] = useState(false);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [candleSize, setCandleSize] = useState<number>(3);
  const userInteractedRef = useRef<boolean>(false);
  const isPanningRef = useRef<boolean>(false);
  const panStartXRef = useRef<number>(0);
  const panStartPositionRef = useRef<number | null>(null);

  const { candles, isConnected, isLoading } = useCandles();
  const { keepLiveAnalysis } = useTradingStore();

  // DEBUG: Log what data TradingChart receives from useCandles
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && candles.length > 0) {
      const first3 = candles.slice(0, 3).map((c) => c.close.toFixed(2));
      const last3 = candles.slice(-3).map((c) => c.close.toFixed(2));
      console.log(`🎨 [TradingChart] symbol="${symbol}" count=${candles.length} FIRST=[${first3.join(',')}] LAST=[${last3.join(',')}]`);
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
  }, [candles.length, candles[candles.length - 1]?.time, isLoading]);

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
    isLoading,
  ]);

  // FMCBR Core Engine — Official FMCBR 3.0 Algorithm
  const fmcbrSignal = useMemo((): FMCBRSignal | null => {
    if (typeof window === 'undefined') return null;
    // Require at least 200 closed candles for stable calculation (was 50)
    const closedCandles = candles.slice(0, candles.length - 1);
    if (isLoading || closedCandles.length < 200) {
      console.log('[FMCBR] Not calculating - isLoading:', isLoading, 'closedCandles:', closedCandles.length);
      return null;
    }

    try {
      // Pass all candles - function will use closed candles internally
      const signal = calculateFMCBR(candles);
      console.log('[FMCBR] Calculated signal:', {
        status: signal?.status,
        breakType: signal?.breakType,
        direction: signal?.direction,
        cb1: signal?.cb1,
        levelsCount: signal?.levels?.length || 0,
        hasLevels: signal?.levels && signal.levels.length > 0,
        candlesUsed: closedCandles.length,
      });
      return signal;
    } catch (error) {
      console.error('[FMCBR] Calculation error:', error);
      return null;
    }
  }, [
    candles.length,
    candles[candles.length - 1]?.time,
    candles[candles.length - 1]?.close,
    isLoading,
  ]);

  // Expose indicator data to parent component (deferred to avoid setState-during-render)
  useEffect(() => {
    if (!onIndicatorDataUpdate) return;
    const payload = { semaforPoints, semaforTrend, scalpSignals, trendMarker };
    queueMicrotask(() => {
      onIndicatorDataUpdate(payload);
    });
  }, [semaforPoints, semaforTrend, scalpSignals, trendMarker, onIndicatorDataUpdate]);

  // Initialize chart - RECREATE when symbol changes to ensure clean state
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    console.log(`🏗️ [Chart] Creating NEW chart instance for ${symbol}`);
    
    // CRITICAL FIX: Always clean up existing chart before creating new one
    if (chartRef.current) {
      try {
        console.log(`🗑️ [Chart] Removing old chart instance for ${symbol}`);
        
        // Remove series first to clear their internal state
        if (candleSeriesRef.current) {
          try {
            chartRef.current.removeSeries(candleSeriesRef.current);
          } catch (e) {
            console.warn('[Chart] Error removing candle series:', e);
          }
        }
        if (volumeSeriesRef.current) {
          try {
            chartRef.current.removeSeries(volumeSeriesRef.current);
          } catch (e) {
            console.warn('[Chart] Error removing volume series:', e);
          }
        }
        
        // Then remove the chart
        chartRef.current.remove();
      } catch (e) {
        console.error('[Chart] Error removing old chart:', e);
      }
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    }
    
    // NUCLEAR OPTION: Clear the entire DOM container to force TradingView to start fresh
    if (chartContainerRef.current) {
      chartContainerRef.current.innerHTML = '';
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#1a1a1a' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2a2a2a' },
        horzLines: { color: '#2a2a2a' },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight || 600,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 4, // Medium spacing - shows ~120-150 candles (4-5 hours for 1m)
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
    // lightweight-charts renders time labels in the DOM, so we intercept and convert them
    if (chartContainerRef.current) {
      const observer = new MutationObserver(() => {
        // Find all time labels in the chart
        const timeElements = chartContainerRef.current?.querySelectorAll('[class*="pane"] [class*="time"], [class*="pane"] text') || [];
        timeElements.forEach((el) => {
          const text = el.textContent?.trim() || '';
          // Check if it's a time format (HH:MM or HH:MM:SS)
          const timeMatch = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
          if (timeMatch) {
            // This is a time label - we need to convert it from UTC/local to IST
            // But we don't have the original timestamp, so we'll use a different approach
            // Instead, we'll rely on the Date prototype override
          }
        });
      });

      // Start observing after a short delay to let the chart render
      setTimeout(() => {
        if (chartContainerRef.current) {
          observer.observe(chartContainerRef.current, {
            childList: true,
            subtree: true,
            characterData: true,
          });
        }
      }, 1000);
    }

    // Pan & Zoom handlers
    const container = chartContainerRef.current;
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
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight || 600,
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (cleanupPanZoom) cleanupPanZoom();
      if (chartRef.current) {
        console.log(`[Chart] Cleaning up chart for ${symbol}`);
        chartRef.current.remove();
        chartRef.current = null;
        candleSeriesRef.current = null;
        volumeSeriesRef.current = null;
      }
    };
  }, [symbol]); // CRITICAL: Recreate chart when symbol changes

  // Update candle size (barSpacing) when it changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.timeScale().applyOptions({
        barSpacing: candleSize,
      });
    }
  }, [candleSize]);

  // On symbol/interval change: clear chart immediately so no stale data from previous symbol is shown.
  useEffect(() => {
    if (prevSymbolRef.current !== symbol || prevIntervalRef.current !== interval) {
      console.log(`[Chart] Symbol/interval changed to ${symbol}/${interval}`);
      
      // DON'T update prevSymbolRef here - let the data effect handle it!
      // This ensures isSymbolChange detection works correctly
      prevCandlesLenRef.current = 0;
      chartDataSymbolRef.current = null; // CRITICAL: Clear this to prevent stale data guard
      userInteractedRef.current = false;
      // Loading state is now managed by useCandles hook
      
      try {
        if (candleSeriesRef.current && volumeSeriesRef.current) {
          console.log('[Chart] Clearing all series data');
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

  // Update chart data when candles change (from useCandles; candles are for current symbol after clear on symbol change).
  useEffect(() => {
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

    // CRITICAL: Always use setData on first data load after component mount OR symbol/interval change OR new candle
    if (isFirstLoad || isInitialLoad || isSymbolChange || hasNewCandle) {
      // Mark that first load is complete
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
        if (process.env.NODE_ENV === 'development') {
          const lastClose = candles[candles.length - 1]?.close;
          const first3Times = candlestickData.slice(0, 3).map(c => c.time);
          const first3Closes = candlestickData.slice(0, 3).map(c => c.close);
          const last3Times = candlestickData.slice(-3).map(c => c.time);
          const last3Closes = candlestickData.slice(-3).map(c => c.close);
          console.log(`[TradingChart] setData for ${symbol}: count=${candlestickData.length}`);
          console.log(`  FIRST times: ${first3Times.join(',')} closes: ${first3Closes.join(',')}`);
          console.log(`  LAST times: ${last3Times.join(',')} closes: ${last3Closes.join(',')}`);
          
          // VALIDATION: Check if we're rendering the correct symbol's data
          const mid3Index = Math.floor(candlestickData.length / 2);
          const mid3 = candlestickData.slice(mid3Index, mid3Index + 3);
          console.log(`  MIDDLE [${mid3Index}]: times=${mid3.map(c => c.time).join(',')} closes=${mid3.map(c => c.close).join(',')}`);
          console.log(`  ⚠️ VERIFY: Chart instance ID: ${chartRef.current ? 'exists' : 'null'}, Series ID: ${candleSeriesRef.current ? 'exists' : 'null'}`);
          
          // CRITICAL VALIDATION: Check if price range matches the expected symbol
          const avgPrice = (first3Closes[0] + mid3[0].close + last3Closes[0]) / 3;
          console.log(`  🔍 PRICE CHECK: symbol=${symbol}, avgPrice=${avgPrice.toFixed(2)}`);
          
          // Expected price ranges for validation
          const expectedRanges: Record<string, [number, number]> = {
            'BTCUSDT': [50000, 100000],
            'ETHUSDT': [1000, 10000],
            'SOLUSDT': [50, 500],
            'BNBUSDT': [200, 1000],
            'XRPUSDT': [0.5, 10]
          };
          
          const range = expectedRanges[symbol];
          if (range && (avgPrice < range[0] || avgPrice > range[1])) {
            console.error(`❌ DATA MISMATCH! ${symbol} should be ${range[0]}-${range[1]} but got ${avgPrice.toFixed(2)}`);
          } else {
            console.log(`  ✅ PRICE VALIDATION PASSED for ${symbol}`);
          }
          
          // Log a sample of the actual data object being passed
          console.log('  Sample candlestick data:', JSON.stringify(candlestickData.slice(0, 2)));
        }
        candleSeriesRef.current.setData(candlestickData);
        volumeSeriesRef.current.setData(volumeData);
        console.log(`✅ [Chart] Successfully called setData for ${symbol} (${candlestickData.length} candles)`);
        chartDataSymbolRef.current = symbol;
        const lastCandle = candles[candles.length - 1];
        if (lastCandle) setCurrentPrice(lastCandle.close);
        prevCandlesLenRef.current = candles.length;
        prevSymbolRef.current = symbol;
        prevIntervalRef.current = interval;

        if (!userInteractedRef.current || isSymbolChange) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setTimeout(() => {
                try {
                  if (chartRef.current && candlestickData.length > 0) {
                    // Set zoom to show ~120 candles (4 hours for 1m timeframe) - matches image
                    // This shows approximately 4-5 hours of data, perfect for scalping view
                    const visibleCandles = 120;
                    const lastTime = candlestickData[candlestickData.length - 1].time as number;
                    const firstVisibleIndex = Math.max(0, candlestickData.length - visibleCandles);
                    const firstTime = candlestickData[firstVisibleIndex].time as number;
                    
                    chartRef.current.timeScale().setVisibleRange({
                      from: firstTime as Time,
                      to: lastTime as Time,
                    });
                    
                    if (chartContainerRef.current && chartRef.current)
                      chartRef.current.applyOptions({
                        width: chartContainerRef.current.clientWidth,
                        height: chartContainerRef.current.clientHeight || 600,
                      });
                  }
                } catch {}
              }, 150);
            });
          });
        }
      } catch (error) {
        console.error('[Chart] Error setting chart data:', error);
      }
    } else {
      // Same length, only last candle updated (e.g. from poll): use update().
      console.log(`[Chart] Using UPDATE (not setData) for ${symbol} - same candle count: ${candles.length}`);
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
        } catch {}
      }
    }
  }, [candles, isLoading, symbol, interval]);

  const isEnabled = (id: string) => enabledIndicators.has(id);

  // Tab visibility — refresh chart on return
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && chartRef.current && chartContainerRef.current) {
        try {
          chartRef.current.applyOptions({
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight || 600,
          });
          setTimeout(() => {
            if (chartRef.current && candles.length > 0) {
              chartRef.current.timeScale().fitContent();
            }
          }, 100);
        } catch {}
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
        {isConnected ? (
          <>
            <span
              className="inline-block w-3 h-3 rounded-full flex-shrink-0 bg-green-500 live-dot-glow-shrink"
              aria-hidden
              title="Connected"
            />
            <span className="text-sm text-gray-400">Live</span>
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
            <div className="text-xs text-green-500 flex items-center gap-1 mt-1">
              <span
                className={`inline-block rounded-full flex-shrink-0 live-dot-glow-shrink ${isConnected ? 'bg-green-500 w-[9.6px] h-[9.6px]' : 'bg-red-500 w-2 h-2'}`}
                aria-hidden
              />
              {isConnected ? 'LIVE' : 'Disconnected'}
            </div>
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
          
          {/* Trend Indicator Overlay - Renders at top inside chart area */}
          <TrendIndicatorOverlay
            trendMarker={isEnabled('trendIndicator') ? trendMarker : null}
            showTrend={isEnabled('trendIndicator')}
          />
          
          {/* Scalp Signal Overlay - White circle below Trend Indicator arrow, inside chart area */}
          <ScalpSignalOverlay
            scalpSignals={isEnabled('scalpSignal') ? scalpSignals : []}
            trendMarker={isEnabled('trendIndicator') ? trendMarker : null}
            showScalp={isEnabled('scalpSignal')}
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
              fmcbrSignal={keepLiveAnalysis ? fmcbrSignal : null}
              currentCandleTime={candles.length > 0 ? candles[candles.length - 1]?.time : undefined}
              showSemafor={isEnabled('semafor')}
              showScalp={isEnabled('scalpSignal')}
              showTrend={false} // Trend indicator now uses overlay, not markers
              showFMCBR={keepLiveAnalysis}
            />
            {/* FMCBR Price Lines Overlay - Shows horizontal lines for levels */}
            <FMCBROverlay
              candleSeries={candleSeriesRef.current}
              signal={keepLiveAnalysis ? fmcbrSignal : null}
              showFMCBR={keepLiveAnalysis}
            />
          </>
        )}
      </div>
    </div>
  );
}
