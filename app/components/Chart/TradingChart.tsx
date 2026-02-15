'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, IChartApi, ISeriesApi, ColorType, Time } from 'lightweight-charts';
import { useBinanceWebSocket } from '../../hooks/useBinanceWebSocket';
import { Candle } from '../../lib/binance';
import { calculateSemafor, getSemaforTrend } from '../../lib/indicators/semafor';
import { SemaforPoint } from '../../lib/indicators/types';
import SemaforOverlay from './SemaforOverlay';
import type { SemaforTrend } from '../../lib/indicators/semafor';

interface TradingChartProps {
  symbol: string;
  interval: string;
  enabledIndicators: Set<string>;
  onToggleIndicator: (id: string, enabled: boolean) => void;
}

export default function TradingChart({ 
  symbol, 
  interval,
  enabledIndicators,
  onToggleIndicator,
}: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
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
        barSpacing: 3,
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

  // Clear chart data on symbol/interval change
  useEffect(() => {
    if (prevSymbolRef.current !== symbol || prevIntervalRef.current !== interval) {
      try {
        if (candleSeriesRef.current) candleSeriesRef.current.setData([]);
        if (volumeSeriesRef.current) volumeSeriesRef.current.setData([]);
      } catch {}
      
      setCurrentPrice(0);
      setLoading(true);
      userInteractedRef.current = false;
      prevSymbolRef.current = symbol;
      prevIntervalRef.current = interval;
      prevCandlesLenRef.current = 0; // Force setData() on next load

      try {
        if (chartRef.current) chartRef.current.timeScale().resetTimeScale();
      } catch {}
    }
  }, [symbol, interval]);

  // Update chart data when candles change
  // CRITICAL: Use setData() only on initial load / symbol change
  // Use update() for real-time WebSocket ticks (faster, preserves markers)
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

    if (candles.length === 0) {
      setLoading(isLoading);
      prevCandlesLenRef.current = 0;
      return;
    }

    if (candles.length > 0) setLoading(false);

    try {
      const prevLen = prevCandlesLenRef.current;
      const isInitialLoad = prevLen === 0;
      const hasNewCandle = candles.length !== prevLen;

      if (isInitialLoad || hasNewCandle) {
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
          candleSeriesRef.current.setData(candlestickData);
          volumeSeriesRef.current.setData(volumeData);

          if (!userInteractedRef.current) {
            requestAnimationFrame(() => {
              setTimeout(() => {
                try {
                  if (chartRef.current && candlestickData.length > 0) {
                    chartRef.current.timeScale().fitContent();
                  }
                } catch {}
              }, 50);
            });
          }
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
        }
      }

      prevCandlesLenRef.current = candles.length;

      if (candles.length > 0) {
        setCurrentPrice(candles[candles.length - 1].close);
      }
    } catch (error) {
      console.error('Chart data error:', error);
      setLoading(false);
    }
  }, [candles, isLoading]);

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
        
        {/* Semafor Overlay */}
        {candleSeriesRef.current && isEnabled('semafor') && (
          <SemaforOverlay 
            candleSeries={candleSeriesRef.current}
            points={semaforPoints}
            visible={true}
          />
        )}
      </div>
      
      {/* Indicator info */}
      <div className="p-4 space-y-3 border-t border-gray-800 bg-[#1a1a1a]">
        {isEnabled('semafor') && (
          <div className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-3">
            <div className="text-white font-semibold text-sm flex items-center gap-2">
              Semafor
              <span className="px-2 py-0.5 bg-teal-600/20 text-teal-500 text-xs rounded">ON</span>
              <span className={`px-2 py-0.5 text-xs rounded font-semibold ${
                semaforTrend.trend === 'BULL' ? 'bg-green-600/20 text-green-400' :
                semaforTrend.trend === 'BEAR' ? 'bg-red-600/20 text-red-400' :
                'bg-gray-600/20 text-gray-400'
              }`}>
                {semaforTrend.trend === 'BULL' ? '↑ Uptrend' : semaforTrend.trend === 'BEAR' ? '↓ Downtrend' : '→ Neutral'}
              </span>
              <span className="text-[10px] text-gray-600">No-Repaint</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {semaforPoints.filter(p => !p.isLive).length} pivots • 
              <span className="text-orange-400 ml-1">{semaforPoints.filter(p => p.type === 'high' && !p.isLive).length} sells</span>
              <span className="text-green-400 ml-1">{semaforPoints.filter(p => p.type === 'low' && !p.isLive).length} buys</span>
              {semaforPoints.filter(p => p.isLive).length > 0 && (
                <span className="ml-2 px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-[10px] font-semibold">
                  📍 {semaforPoints.filter(p => p.isLive).map(p => p.pattern).join(', ')}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
