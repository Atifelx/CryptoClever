'use client';

import { useEffect, useRef } from 'react';
import { ISeriesApi, IChartApi } from 'lightweight-charts';
import { TradingZone } from '../../lib/engine/types';

interface CoreEngineOverlayProps {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<'Candlestick'> | null;
  zones: TradingZone[];
}

export default function CoreEngineOverlay({
  chart,
  candleSeries,
  zones,
}: CoreEngineOverlayProps) {
  const priceLinesRef = useRef<Array<{ id: string; line: any }>>([]);

  useEffect(() => {
    if (!chart || !candleSeries || zones.length === 0) {
      // Clear existing lines
      priceLinesRef.current.forEach(({ line }) => {
        try {
          candleSeries?.removePriceLine(line);
        } catch (e) {
          // Ignore errors
        }
      });
      priceLinesRef.current = [];
      return;
    }

    // Clear existing lines
    priceLinesRef.current.forEach(({ line }) => {
      try {
        candleSeries.removePriceLine(line);
      } catch (e) {
        // Ignore errors
      }
    });
    priceLinesRef.current = [];

    // Render zones
    zones.forEach((zone, index) => {
      try {
        // Entry line
        const entryLine = candleSeries.createPriceLine({
          price: zone.entryPrice,
          color: zone.type === 'BUY' ? '#00ff88' : '#ff4444',
          lineWidth: 2,
          lineStyle: zone.type === 'BUY' ? 0 : 0, // Solid
          axisLabelVisible: true,
          title: `${zone.type} @ ${zone.entryPrice.toFixed(2)}`,
        });
        priceLinesRef.current.push({ id: `entry-${index}`, line: entryLine });

        // Profit target line
        const profitLine = candleSeries.createPriceLine({
          price: zone.profitTarget,
          color: zone.type === 'BUY' ? '#00ff88' : '#ff4444',
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: `Target: ${zone.profitTarget.toFixed(2)}`,
        });
        priceLinesRef.current.push({ id: `profit-${index}`, line: profitLine });

        // Stop loss line
        const stopLine = candleSeries.createPriceLine({
          price: zone.stopLoss,
          color: '#888888',
          lineWidth: 1,
          lineStyle: 3, // Dotted
          axisLabelVisible: true,
          title: `Stop: ${zone.stopLoss.toFixed(2)}`,
        });
        priceLinesRef.current.push({ id: `stop-${index}`, line: stopLine });
      } catch (error) {
        console.warn('Error creating price line:', error);
      }
    });

    // Cleanup function
    return () => {
      priceLinesRef.current.forEach(({ line }) => {
        try {
          candleSeries?.removePriceLine(line);
        } catch (e) {
          // Ignore errors
        }
      });
      priceLinesRef.current = [];
    };
  }, [chart, candleSeries, zones]);

  return null; // This component only renders price lines
}
