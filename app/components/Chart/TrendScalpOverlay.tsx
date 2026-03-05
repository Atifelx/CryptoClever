'use client';

import { useEffect, useRef } from 'react';
import { IPriceLine, ISeriesApi } from 'lightweight-charts';
import type { LineWidth } from 'lightweight-charts';
import type { TrendScalpResult } from '../../lib/indicators/trendScalp';

interface TrendScalpOverlayProps {
  candleSeries: ISeriesApi<'Candlestick'> | null;
  result: TrendScalpResult | null;
  showTrendScalp: boolean;
}

/**
 * TrendScalp overlay: 1 support + 1 resistance from algorithm (720-bar swing + findSrZones).
 * Recalculates as chart progresses; levels chosen so recent price respects them for trading.
 */
export default function TrendScalpOverlay({
  candleSeries,
  result,
  showTrendScalp,
}: TrendScalpOverlayProps) {
  const priceLinesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    if (!candleSeries) return;

    priceLinesRef.current.forEach(line => {
      try {
        candleSeries.removePriceLine(line);
      } catch (e) {
        // ignore
      }
    });
    priceLinesRef.current = [];

    if (!showTrendScalp || !result) return;

    const lines: Array<{ price: number; color: string; title: string; lineStyle?: 0 | 1 | 2; lineWidth?: LineWidth }> = [];

    // 1 support (nearest below price — level price respects)
    const supports = (result.supportZones || []).slice(0, 1);
    supports.forEach(price => {
      lines.push({
        price,
        color: '#22aa66',
        title: 'Support',
        lineStyle: 0,
        lineWidth: 1,
      });
    });

    // 1 resistance (nearest above price — level price respects)
    const resistances = (result.resistanceZones || []).slice(0, 1);
    resistances.forEach(price => {
      lines.push({
        price,
        color: '#cc4444',
        title: 'Resistance',
        lineStyle: 0,
        lineWidth: 1,
      });
    });

    lines.forEach(({ price, color, title, lineStyle = 0, lineWidth = 1 }) => {
      try {
        const line = candleSeries.createPriceLine({
          price,
          color,
          lineWidth,
          lineStyle,
          axisLabelVisible: true,
          title,
        });
        priceLinesRef.current.push(line);
      } catch (err) {
        console.error('[TrendScalp] Error creating price line:', err);
      }
    });

    return () => {
      if (candleSeries) {
        priceLinesRef.current.forEach(line => {
          try {
            candleSeries.removePriceLine(line);
          } catch (e) {
            // ignore
          }
        });
        priceLinesRef.current = [];
      }
    };
  }, [candleSeries, result, showTrendScalp]);

  return null;
}
