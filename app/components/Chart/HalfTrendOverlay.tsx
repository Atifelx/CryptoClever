'use client';

import { useEffect, useRef } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';
import { HalfTrendResult } from '../../lib/indicators/halfTrend';

interface HalfTrendOverlayProps {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<'Candlestick'> | null;
  results: HalfTrendResult[];
  showLine: boolean;
  showArrows: boolean;
}

export default function HalfTrendOverlay({
  chart,
  candleSeries,
  results,
  showLine,
  showArrows
}: HalfTrendOverlayProps) {
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (!chart || !candleSeries || results.length === 0) {
      // Cleanup if no data
      if (lineSeriesRef.current) {
        chart?.removeSeries(lineSeriesRef.current);
        lineSeriesRef.current = null;
      }
      if (candleSeries && markersRef.current.length > 0) {
        candleSeries.setMarkers([]);
        markersRef.current = [];
      }
      return;
    }

    // Draw Half Trend line
    if (showLine) {
      // Remove existing line series if any
      if (lineSeriesRef.current) {
        chart.removeSeries(lineSeriesRef.current);
        lineSeriesRef.current = null;
      }

      const lineSeries = chart.addLineSeries({
        color: '#26a69a',
        lineWidth: 2,
        title: 'Half Trend',
        priceLineVisible: false,
        lastValueVisible: true,
      });
      
      const lineData = results.map(r => ({
        time: r.time as any,
        value: r.trendLine,
      }));
      
      lineSeries.setData(lineData);
      lineSeriesRef.current = lineSeries;
    } else {
      // Remove line if not showing
      if (lineSeriesRef.current) {
        chart.removeSeries(lineSeriesRef.current);
        lineSeriesRef.current = null;
      }
    }

    // Draw buy/sell arrows
    if (showArrows) {
      const markers = results
        .filter(r => r.buySignal || r.sellSignal)
        .map(r => ({
          time: r.time as any,
          position: r.buySignal ? ('belowBar' as const) : ('aboveBar' as const),
          color: r.buySignal ? '#26a69a' : '#ef5350',
          shape: r.buySignal ? ('arrowUp' as const) : ('arrowDown' as const),
          text: r.buySignal ? 'BUY' : 'SELL',
          size: 2
        }));
      
      candleSeries.setMarkers(markers as any);
      markersRef.current = markers;
    } else {
      // Clear markers if not showing
      if (candleSeries && markersRef.current.length > 0) {
        candleSeries.setMarkers([]);
        markersRef.current = [];
      }
    }

    return () => {
      // Cleanup on unmount
      if (lineSeriesRef.current && chart) {
        try {
          chart.removeSeries(lineSeriesRef.current);
        } catch (e) {
          // Ignore errors during cleanup
        }
        lineSeriesRef.current = null;
      }
      if (candleSeries && markersRef.current.length > 0) {
        try {
          candleSeries.setMarkers([]);
        } catch (e) {
          // Ignore errors during cleanup
        }
        markersRef.current = [];
      }
    };
  }, [chart, candleSeries, results, showLine, showArrows]);

  return null;
}
