'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, IChartApi, ISeriesApi, ColorType, Time } from 'lightweight-charts';
import { useBinanceWebSocket } from '../../hooks/useBinanceWebSocket';
import { Candle } from '../../lib/binance';
import { calculateSemafor, getSemaforTrend } from '../../lib/indicators/semafor';
import { SemaforPoint } from '../../lib/indicators/types';
import type { SemaforTrend } from '../../lib/indicators/semafor';
import { detectPatterns } from '../../lib/indicators/patternRecognition';
import { PatternSignal } from '../../lib/indicators/patternRecognition';
import UnifiedMarkerManager from './UnifiedMarkerManager';
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
    patternSignals: PatternSignal[];
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
  const [loading, setLoading] = useState(true);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [candleSize, setCandleSize] = useState<number>(3); // Default barSpacing
  const userInteractedRef = useRef<boolean>(false);
  const isPanningRef = useRef<boolean>(false);
  const panStartXRef = useRef<number>(0);
  const panStartPositionRef = useRef<number | null>(null);

  const { candles, isLoading } = useBinanceWebSocket(symbol, interval);
  
  // Track previous symbol/interval and candle count for efficient updates
  const prevSymbolRef = useRef<string>(symbol);
  const prevIntervalRef = useRef<string>(interval);
  const prevCandlesLenRef = useRef<number>(0);
  
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

  // Pattern Recognition with locking mechanism
  // Only recalculate when a NEW CANDLE CLOSES (not on every WebSocket tick)
  const lastClosedCandleTimeRef = useRef<number>(0);
  const lockedPatternRef = useRef<PatternSignal[]>([]);

  const patternSignals = useMemo((): PatternSignal[] => {
    if (typeof window === 'undefined') return lockedPatternRef.current;
    if (isLoading || candles.length < 50) return lockedPatternRef.current;

    try {
      // Only analyze CLOSED candles (exclude forming candle)
      const closedCandles = candles.slice(0, candles.length - 1);
      if (closedCandles.length < 50) return lockedPatternRef.current;

      // Get the last CLOSED candle time
      const lastClosedTime = closedCandles[closedCandles.length - 1]?.time || 0;

      // Only recalculate if a NEW candle has closed (time changed)
      if (lastClosedTime === lastClosedCandleTimeRef.current) {
        // No new candle closed - return locked pattern
        return lockedPatternRef.current;
      }

      // New candle closed - recalculate patterns
      lastClosedCandleTimeRef.current = lastClosedTime;

      // Lower threshold for single-candle patterns (Hammer, Doji, etc.) - they're more immediate
      const newPatterns = detectPatterns(candles, 60); // Lowered to 60% to catch more patterns

      // Only update if we found a valid pattern
      if (newPatterns.length > 0) {
        const newPattern = newPatterns[0];
        const lockedPattern = lockedPatternRef.current[0];

        if (!lockedPattern) {
          // No locked pattern - lock the new one
          lockedPatternRef.current = newPatterns;
          console.log('🔒 Pattern locked:', newPattern.description, `(${newPattern.confidence}%)`);
          return newPatterns;
        }

        // Check how old the locked pattern is (in candles)
        const lockedPatternIndex = closedCandles.findIndex(c => c.time === lockedPattern.time);
        const newPatternIndex = closedCandles.findIndex(c => c.time === newPattern.time);
        
        // If locked pattern is very old (10+ candles), allow replacement
        const lockedPatternAge = closedCandles.length - 1 - lockedPatternIndex;
        
        // Update if:
        // 1. New pattern is on a different candle AND locked pattern is old (5+ candles), OR
        // 2. New pattern has significantly higher confidence (+15% not just +10%), OR
        // 3. Locked pattern is very old (10+ candles) - time to refresh
        if ((newPattern.time !== lockedPattern.time && lockedPatternAge >= 5) ||
            (newPattern.confidence >= lockedPattern.confidence + 15) ||
            (lockedPatternAge >= 10)) {
          lockedPatternRef.current = newPatterns;
          console.log('🔒 Pattern updated:', newPattern.description, `(${newPattern.confidence}%) - Old pattern was ${lockedPatternAge} candles old`);
          return newPatterns;
        }
      }

      // Keep locked pattern if new detection is weaker or too recent
      // This prevents rapid repainting
      return lockedPatternRef.current;
    } catch (error) {
      console.error('Pattern recognition calc error:', error);
      return lockedPatternRef.current;
    }
  }, [
    symbol,
    interval,
    candles.length,
    // Only depend on the last CLOSED candle time, not the forming candle
    candles.length > 1 ? candles[candles.length - 2]?.time : 0,
    isLoading,
  ]);

  // Reset locked pattern when symbol/interval changes
  useEffect(() => {
    lockedPatternRef.current = [];
    lastClosedCandleTimeRef.current = 0;
  }, [symbol, interval]);

  // Expose indicator data to parent component
  useEffect(() => {
    if (onIndicatorDataUpdate) {
      onIndicatorDataUpdate({
        semaforPoints,
        semaforTrend,
        patternSignals,
      });
    }
  }, [semaforPoints, semaforTrend, patternSignals, onIndicatorDataUpdate]);

  // Initialize chart (only once)
  useEffect(() => {
    if (!chartContainerRef.current || chartRef.current) return;

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
        rightOffset: 0,
        barSpacing: candleSize,
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
        const range = vr.to - vr.from;
        const center = (vr.from + vr.to) / 2;
        const newRange = range * zoomFactor;
        ts.setVisibleRange({
          from: (center - newRange / 2) as Time,
          to: (center + newRange / 2) as Time,
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
        chartRef.current.remove();
        chartRef.current = null;
        candleSeriesRef.current = null;
        volumeSeriesRef.current = null;
      }
    };
  }, []);

  // Update candle size (barSpacing) when it changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.timeScale().applyOptions({
        barSpacing: candleSize,
      });
    }
  }, [candleSize]);

  // Clear chart data on symbol/interval change
  useEffect(() => {
    if (prevSymbolRef.current !== symbol || prevIntervalRef.current !== interval) {
      console.log('🔄 Symbol/Interval changed, clearing chart:', { 
        oldSymbol: prevSymbolRef.current, 
        newSymbol: symbol,
        oldInterval: prevIntervalRef.current,
        newInterval: interval 
      });
      
      try {
        // Clear all chart data
        if (candleSeriesRef.current) {
          candleSeriesRef.current.setData([]);
        }
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.setData([]);
        }
      } catch (error) {
        console.warn('Error clearing chart data:', error);
      }
      
      // Reset all state
      setCurrentPrice(0);
      setLoading(true);
      userInteractedRef.current = false;
      prevCandlesLenRef.current = 0; // CRITICAL: Reset to force setData() on next load
      
      // Update refs
      prevSymbolRef.current = symbol;
      prevIntervalRef.current = interval;

      // Reset time scale and force chart refresh
      try {
        if (chartRef.current) {
          chartRef.current.timeScale().resetTimeScale();
          
          // Force chart resize to ensure it's visible
          if (chartContainerRef.current) {
            requestAnimationFrame(() => {
              if (chartRef.current && chartContainerRef.current) {
                chartRef.current.applyOptions({
                  width: chartContainerRef.current.clientWidth,
                  height: chartContainerRef.current.clientHeight || 600,
                });
                console.log('✅ Chart resized after symbol change');
              }
            });
          }
        }
      } catch (error) {
        console.warn('Error resetting time scale:', error);
      }
    }
  }, [symbol, interval]);

  // Update chart data when candles change
  // CRITICAL: Use setData() only on initial load / symbol change
  // Use update() for real-time WebSocket ticks (faster, preserves markers)
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) {
      console.log('⚠️ Chart series not ready, skipping update');
      return;
    }

    if (candles.length === 0) {
      setLoading(isLoading);
      prevCandlesLenRef.current = 0;
      return;
    }

    if (candles.length > 0) {
      setLoading(false);
    }

    try {
      const prevLen = prevCandlesLenRef.current;
      const isInitialLoad = prevLen === 0;
      const hasNewCandle = candles.length !== prevLen;
      
      // Check if symbol/interval changed by comparing with current values
      // This ensures we detect changes even if refs were updated in previous effect
      const currentSymbol = symbol;
      const currentInterval = interval;
      const symbolChanged = prevSymbolRef.current !== currentSymbol;
      const intervalChanged = prevIntervalRef.current !== currentInterval;
      const isSymbolChange = symbolChanged || intervalChanged;

      // CRITICAL: Always use setData() if:
      // 1. Initial load (prevLen === 0)
      // 2. Symbol/interval changed (force full refresh)
      // 3. New candle added (length changed)
      if (isInitialLoad || isSymbolChange || hasNewCandle) {
        console.log('📊 Updating chart data:', {
          isInitialLoad,
          isSymbolChange,
          hasNewCandle,
          candleCount: candles.length,
          prevLen,
          symbol,
          interval
        });

        // Full data replacement: initial load, new candle added, or symbol change
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

        if (candlestickData.length > 0) {
          // CRITICAL: Always set data when symbol changes or initial load
          try {
            candleSeriesRef.current.setData(candlestickData);
            volumeSeriesRef.current.setData(volumeData);
            console.log('✅ Chart data set:', { count: candlestickData.length, symbol, interval });
          } catch (error) {
            console.error('❌ Error setting chart data:', error);
            // Force chart refresh on error
            if (chartRef.current && chartContainerRef.current) {
              try {
                chartRef.current.applyOptions({
                  width: chartContainerRef.current.clientWidth,
                  height: chartContainerRef.current.clientHeight || 600,
                });
              } catch (e) {
                console.error('Error refreshing chart:', e);
              }
            }
          }
          
          // Update current price
          const lastCandle = candles[candles.length - 1];
          if (lastCandle) {
            setCurrentPrice(lastCandle.close);
          }

          // Fit content if user hasn't interacted or symbol changed
          if (!userInteractedRef.current || isSymbolChange) {
            // Use multiple requestAnimationFrame for better reliability
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                setTimeout(() => {
                  try {
                    if (chartRef.current && candlestickData.length > 0) {
                      chartRef.current.timeScale().fitContent();
                      // Force a resize to ensure chart renders
                      if (chartContainerRef.current) {
                        chartRef.current.applyOptions({
                          width: chartContainerRef.current.clientWidth,
                          height: chartContainerRef.current.clientHeight || 600,
                        });
                      }
                      console.log('✅ Chart data updated, fitted, and refreshed');
                    }
                  } catch (error) {
                    console.warn('Error fitting content:', error);
                  }
                }, 150); // Increased delay to ensure chart is ready
              });
            });
          }
          
          // Update previous length AFTER setting data
          prevCandlesLenRef.current = candles.length;
          
          // Update symbol/interval refs AFTER data is set (for next comparison)
          if (isSymbolChange) {
            prevSymbolRef.current = currentSymbol;
            prevIntervalRef.current = currentInterval;
          }
        } else {
          console.warn('⚠️ No candlestick data to set');
        }
      } else {
        // Real-time tick update: only update the last candle (fast, preserves markers)
        const lastCandle = candles[candles.length - 1];
        if (lastCandle) {
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
          
          // Update current price for real-time updates
          setCurrentPrice(lastCandle.close);
          
          // Update previous length
          prevCandlesLenRef.current = candles.length;
        }
      }
    } catch (error) {
      console.error('Chart data error:', error);
      setLoading(false);
    }
  }, [candles, isLoading, symbol, interval]); // CRITICAL: Include symbol and interval to re-run on symbol change

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
      <div className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a1a] bg-opacity-75 z-10">
            <div className="text-white">Loading {symbol}...</div>
          </div>
        )}
        
        {/* Candle Size Control - Top Middle */}
        <CandleSizeControl size={candleSize} onSizeChange={setCandleSize} />

        {/* Price display */}
        <div className="absolute top-4 right-4 z-10">
          <div className="bg-[#2a2a2a] px-4 py-2 rounded border border-[#3a3a3a]">
            <div className="text-sm text-gray-400">Current Price</div>
            <div className="text-2xl text-white font-bold">
              ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-green-500 flex items-center gap-1 mt-1">
              <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              LIVE
            </div>
          </div>
        </div>

        {/* Chart container */}
        <div ref={chartContainerRef} className="w-full h-full" />
        
        {/* Unified Marker Manager - Merges markers from all indicators */}
        {candleSeriesRef.current && (
          <UnifiedMarkerManager
            candleSeries={candleSeriesRef.current}
            semaforPoints={isEnabled('semafor') ? semaforPoints : []}
            patternSignals={isEnabled('patternRecognition') ? patternSignals : []}
            showSemafor={isEnabled('semafor')}
            showPatternRecognition={isEnabled('patternRecognition')}
          />
        )}
      </div>
    </div>
  );
}
