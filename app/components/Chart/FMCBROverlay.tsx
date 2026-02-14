'use client';

import { useEffect, useRef } from 'react';
import { IPriceLine, ISeriesApi } from 'lightweight-charts';
import { FMCBRLevels } from '../../lib/indicators/types';

interface FMCBROverlayProps {
  candleSeries: ISeriesApi<'Candlestick'> | null;
  levels: FMCBRLevels | null;
  showFibonacci: boolean;
  showCamarilla: boolean;
  showBollinger: boolean;
  showMurrayMath: boolean;
}

export default function FMCBROverlay({ 
  candleSeries,
  levels, 
  showFibonacci,
  showCamarilla,
  showBollinger,
  showMurrayMath
}: FMCBROverlayProps) {
  const priceLinesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    if (!candleSeries || !levels) {
      // Clear all lines if series or levels not available
      if (candleSeries && priceLinesRef.current.length > 0) {
        priceLinesRef.current.forEach(line => {
          try {
            candleSeries.removePriceLine(line);
          } catch (e) {
            // Ignore errors during cleanup
          }
        });
        priceLinesRef.current = [];
      }
      return;
    }

    // Clear existing lines
    priceLinesRef.current.forEach(line => {
      try {
        candleSeries.removePriceLine(line);
      } catch (e) {
        // Ignore errors during cleanup
      }
    });
    priceLinesRef.current = [];

    // Fibonacci levels
    if (showFibonacci) {
      levels.fibonacci.forEach(fib => {
        const line = candleSeries.createPriceLine({
          price: fib.price,
          color: '#ffa726',
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: fib.label
        });
        priceLinesRef.current.push(line);
      });
    }

    // Camarilla levels
    if (showCamarilla) {
      Object.entries(levels.camarilla).forEach(([key, value]) => {
        if (typeof value === 'number' && value > 0) {
          const line = candleSeries.createPriceLine({
            price: value,
            color: key.startsWith('R') ? '#ef5350' : '#26a69a',
            lineWidth: key === 'R4' || key === 'S4' ? 2 : 1,
            lineStyle: key === 'PP' ? 0 : 1, // Solid for PP, dashed for others
            axisLabelVisible: true,
            title: key
          });
          priceLinesRef.current.push(line);
        }
      });
    }

    // Bollinger Bands
    if (showBollinger) {
      ['upper', 'middle', 'lower'].forEach(band => {
        const price = levels.bollinger[band as keyof typeof levels.bollinger] as number;
        const line = candleSeries.createPriceLine({
          price,
          color: '#9c27b0',
          lineWidth: band === 'middle' ? 1 : 1,
          lineStyle: band === 'middle' ? 0 : 2, // Solid middle, dashed upper/lower
          axisLabelVisible: true,
          title: `BB ${band}`
        });
        priceLinesRef.current.push(line);
      });
    }

    // Murray Math levels
    if (showMurrayMath) {
      levels.murrayMath.forEach((price, index) => {
        if (price > 0) {
          const line = candleSeries.createPriceLine({
            price,
            color: '#607d8b',
            lineWidth: 1,
            lineStyle: 2, // Dashed
            axisLabelVisible: false,
            title: `M${index}`
          });
          priceLinesRef.current.push(line);
        }
      });
    }

    return () => {
      // Clean up lines
      if (candleSeries) {
        priceLinesRef.current.forEach(line => {
          try {
            candleSeries.removePriceLine(line);
          } catch (e) {
            // Ignore errors during cleanup
          }
        });
        priceLinesRef.current = [];
      }
    };
  }, [candleSeries, levels, showFibonacci, showCamarilla, showBollinger, showMurrayMath]);

  return null; // This is an overlay, no DOM rendering
}
