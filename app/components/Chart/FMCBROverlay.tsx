'use client';

import { useEffect, useRef } from 'react';
import { IPriceLine, ISeriesApi } from 'lightweight-charts';
import type { LineWidth } from 'lightweight-charts';
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
    if (!candleSeries) {
      return;
    }

    // Clear existing lines first
    priceLinesRef.current.forEach(line => {
      try {
        candleSeries.removePriceLine(line);
      } catch (e) {
        // Ignore errors during cleanup
      }
    });
    priceLinesRef.current = [];

    // Only render if enabled and signal exists
    if (!showFMCBR || !signal) {
      return;
    }
    
    if (!signal.levels || signal.levels.length === 0) {
      return;
    }

    // User requested "avoid all horizontal line in FMCBR"
    // We only keep Support/Resistance levels if they are present, which are separate from Fibonacci levels
    const visibleLevels = levels.filter(level => level.type === 'support' || level.type === 'resistance');

    if (visibleLevels.length === 0) {
      return;
    }

    // Dotted lines: green = bullish (price could go up), red = bearish (price could go down)
    const colors = {
      bullish: {
        entry: '#00cc66',      // Green dotted — entry zone
        tp: '#00ff88',        // Lighter green dotted — TP targets
        base: '#ff4444',      // Red solid — base (stop)
        setup: '#00aaff',     // Blue solid — setup
      },
      bearish: {
        entry: '#ff4444',     // Red dotted — entry zone
        tp: '#ff6666',        // Lighter red dotted — TP targets
        base: '#00cc66',      // Green solid — base (stop)
        setup: '#00aaff',     // Blue solid — setup
      },
    };

    const scheme = direction === 'BULLISH' ? colors.bullish : colors.bearish;

    // Render all levels: Base/Setup = solid; Entry/TP = dotted (green bullish / red bearish)
    visibleLevels.forEach(level => {
      let color = '#888888';
      let lineWidth: LineWidth = 1;
      let lineStyle: 0 | 1 | 2 = 1; // 0=Solid, 1=Dotted, 2=Dashed
      let title = level.label;

      if (level.type === 'base') {
        color = scheme.base;
        lineWidth = 2;
        lineStyle = 0;
        title = `Base (${breakType})`;
      } else if (level.type === 'setup') {
        color = scheme.setup;
        lineWidth = 2;
        lineStyle = 0;
        title = `Setup (CB1: ${cb1 ? '✓' : '✗'})`;
      } else if (level.type === 'entry') {
        color = scheme.entry;
        lineWidth = 2;
        lineStyle = 1; // Dotted — where price could go
        title = level.label;
      } else if (level.type === 'tp') {
        color = scheme.tp;
        lineWidth = 2;
        lineStyle = 1; // Dotted — target levels
        title = level.label;
      } else if (level.type === 'support') {
        color = '#4ade80';
        lineWidth = 1;
        lineStyle = 2;
        title = level.label;
      } else if (level.type === 'resistance') {
        color = '#f87171';
        lineWidth = 1;
        lineStyle = 2;
        title = level.label;
      }

      try {
        const line = candleSeries.createPriceLine({
          price: level.price,
          color,
          lineWidth,
          lineStyle,
          axisLabelVisible: true,
          title,
        });
        
        priceLinesRef.current.push(line);
      } catch (error) {
        console.error(`[FMCBR] Error creating price line for ${level.label}:`, error);
      }
    });

    return () => {
      // Cleanup on unmount or when dependencies change
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
  }, [candleSeries, signal, showFMCBR]);

  return null;
}
