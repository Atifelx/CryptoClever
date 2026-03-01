'use client';

import { useEffect, useRef } from 'react';
import { IPriceLine, ISeriesApi } from 'lightweight-charts';
import type { FMCBRSignal } from '../../lib/indicators/fmcbr';

interface FMCBROverlayProps {
  candleSeries: ISeriesApi<'Candlestick'> | null;
  signal: FMCBRSignal | null;
  showFMCBR: boolean;
}

/**
 * FMCBR 3.0 Visual Overlay
 * Displays Fibonacci levels as clean price lines with text labels
 */
export default function FMCBROverlay({ 
  candleSeries,
  signal, 
  showFMCBR
}: FMCBROverlayProps) {
  const priceLinesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    if (!candleSeries || !showFMCBR || !signal || signal.status !== 'READY') {
      // Clear all lines if series, signal not available, or not ready
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

    const { levels, direction, breakType, cb1 } = signal;

    // Color scheme
    const colors = {
      bullish: {
        entry: '#00ff66',      // Green for entries
        tp: '#ffaa00',         // Orange for TP
        base: '#ff2222',       // Red for base
        setup: '#00aaff',      // Blue for setup
      },
      bearish: {
        entry: '#ff2222',     // Red for entries
        tp: '#ffaa00',         // Orange for TP
        base: '#00ff66',       // Green for base
        setup: '#00aaff',      // Blue for setup
      },
    };

    const scheme = direction === 'BULLISH' ? colors.bullish : colors.bearish;

    // Render all levels as clean horizontal lines
    levels.forEach(level => {
      let color = '#888888';
      let lineWidth = 1;
      let lineStyle: 0 | 1 | 2 = 2; // Dashed by default
      let title = level.label;

      // Style based on level type
      if (level.type === 'base') {
        color = scheme.base;
        lineWidth = 2;
        lineStyle = 0; // Solid
        title = `Base (${breakType})`;
      } else if (level.type === 'setup') {
        color = scheme.setup;
        lineWidth = 2;
        lineStyle = 0; // Solid
        title = `Setup (CB1: ${cb1 ? '✓' : '✗'})`;
      } else if (level.type === 'entry') {
        color = scheme.entry;
        lineWidth = 1.5;
        lineStyle = 1; // Solid
        title = level.label;
      } else if (level.type === 'tp') {
        color = scheme.tp;
        lineWidth = 1;
        lineStyle = 2; // Dashed
        title = level.label;
      }

      const line = candleSeries.createPriceLine({
        price: level.price,
        color,
        lineWidth,
        lineStyle,
        axisLabelVisible: true,
        title,
      });
      
      priceLinesRef.current.push(line);
    });

  }, [candleSeries, signal, showFMCBR]);

  return null;
}
