'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, IChartApi, ISeriesApi, ColorType, Time } from 'lightweight-charts';
import { useBinanceWebSocket } from '../../hooks/useBinanceWebSocket';
import { Candle } from '../../lib/binance';
import { calculateSemafor } from '../../lib/indicators/semafor';
import { SemaforPoint } from '../../lib/indicators/types';
import { getAllIndicatorIds, INDICATOR_REGISTRY } from '../../lib/indicators/registry';
import SemaforOverlay from './SemaforOverlay';

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
  const prevSymbolRef = useRef<string>('');
  const prevIntervalRef = useRef<string>('');

  const { candles, isLoading } = useBinanceWebSocket(symbol, interval);
  
  // Calculate Semafor indicator when candles change (only on client)
  // Memoize based on candle data hash to prevent unnecessary recalculations
  const semaforPoints = useMemo(() => {
    // Safety check: ensure we're on client and have enough data
    if (typeof window === 'undefined' || candles.length < 20) {
      return [];
    }
    
    try {
      // Limit candles to prevent performance issues (use last 500 candles max)
      const limitedCandles = candles.slice(-500);
      
      // Create a hash of the last candle to detect actual changes
      const lastCandle = limitedCandles[limitedCandles.length - 1];
      const dataHash = lastCandle 
        ? `${lastCandle.time}-${lastCandle.close}-${limitedCandles.length}` 
        : 'empty';
      
      // Only recalculate if we have enough candles and data actually changed
      if (limitedCandles.length < 20) {
        return [];
      }
      
      return calculateSemafor(limitedCandles);
    } catch (error) {
      console.error('Error calculating Semafor:', error);
      return [];
    }
  }, [candles.length, candles[candles.length - 1]?.time, candles[candles.length - 1]?.close]);

  // Initialize chart (only once)
  useEffect(() => {
    if (!chartContainerRef.current || chartRef.current) return;

    // Create chart
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
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Handle resize
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
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        candleSeriesRef.current = null;
        volumeSeriesRef.current = null;
      }
    };
  }, []);

  // Clear chart data when symbol or interval changes
  useEffect(() => {
    const symbolChanged = prevSymbolRef.current !== symbol;
    const intervalChanged = prevIntervalRef.current !== interval;
    
    if (symbolChanged || intervalChanged) {
      // Clear existing data immediately when switching symbols/intervals
      try {
        if (candleSeriesRef.current) {
          candleSeriesRef.current.setData([]);
        }
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.setData([]);
        }
      } catch (error) {
        console.warn('Error clearing chart data:', error);
      }
      
      setCurrentPrice(0);
      setLoading(true);
      
      // Reset refs immediately
      prevSymbolRef.current = symbol;
      prevIntervalRef.current = interval;
      
      // Force chart to reset view
      try {
        if (chartRef.current) {
          chartRef.current.timeScale().resetTimeScale();
        }
      } catch (error) {
        console.warn('Error resetting chart time scale:', error);
      }
    }
  }, [symbol, interval]);

  // Update chart data when candles change
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) {
      return;
    }

    // Show loading if no candles yet and still loading
    if (candles.length === 0) {
      setLoading(isLoading);
      return;
    }

    // If we have candles, we're done loading
    if (candles.length > 0) {
      setLoading(false);
    }

    try {
      const candlestickData = candles.map((candle: Candle) => ({
        time: candle.time as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      const volumeData = candles.map((candle: Candle) => ({
        time: candle.time as Time,
        value: candle.volume || 0,
        color: candle.close >= candle.open ? '#26a69a80' : '#ef535080',
      }));

      // Use setData to replace all data (faster than update)
      if (candlestickData.length > 0) {
        candleSeriesRef.current.setData(candlestickData);
        volumeSeriesRef.current.setData(volumeData);

        // Auto-fit content after data is set
        requestAnimationFrame(() => {
          setTimeout(() => {
            try {
              if (chartRef.current && candlestickData.length > 0) {
                chartRef.current.timeScale().fitContent();
              }
            } catch (error) {
              console.warn('Error fitting chart content:', error);
            }
          }, 50);
        });
      }

      // Update current price
      if (candles.length > 0) {
        setCurrentPrice(candles[candles.length - 1].close);
      }
    } catch (error) {
      console.error('Error updating chart data:', error);
      setLoading(false);
    }
  }, [candles, isLoading]);

  // Update overlays when indicators change
  useEffect(() => {
    // This effect ensures overlays update when indicators recalculate
    // The overlay components handle their own updates via their useEffect hooks
  }, [semaforPoints, enabledIndicators]);

  // Helper function to check if indicator is enabled
  const isEnabled = (id: string) => enabledIndicators.has(id);

  return (
    <div className="flex flex-col w-full h-full">
      <div className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a1a] bg-opacity-75 z-10">
            <div className="text-white">Loading {symbol}...</div>
          </div>
        )}
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
    </div>
  );
}
