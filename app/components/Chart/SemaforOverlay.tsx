'use client';

import { useEffect } from 'react';
import { ISeriesApi } from 'lightweight-charts';
import { SemaforPoint } from '../../lib/indicators/types';

interface SemaforOverlayProps {
  candleSeries: ISeriesApi<'Candlestick'> | null;
  points: SemaforPoint[];
  visible: boolean;
}

/**
 * Semafor Overlay — renders on the chart:
 * 
 * HISTORICAL PIVOTS (ZigZag):
 *   • Green circles at swing LOWS (buy zones)  
 *   • Orange circles at swing HIGHS (sell zones)
 *   • Size 1-2 based on strength
 * 
 * LIVE SIGNALS (candle pattern detection):
 *   • BIG green circle + green ▲ arrow for bullish patterns
 *   • BIG red circle + red ▼ arrow for bearish patterns
 *   • Circle at wick end, Arrow at center (inBar) with 50% alpha color
 *   • Pattern name shown as text label
 */
export default function SemaforOverlay({ candleSeries, points, visible }: SemaforOverlayProps) {

  useEffect(() => {
    if (!candleSeries) return;

    // Clear markers when not visible or no points
    if (!visible || !points || points.length === 0) {
      try { candleSeries.setMarkers([]); } catch {}
      return;
    }

    // Sort by time (required by lightweight-charts)
    const sorted = [...points].sort((a, b) => a.time - b.time);

    const markers: Array<{
      time: any;
      position: 'aboveBar' | 'belowBar' | 'inBar';
      color: string;
      shape: 'circle' | 'arrowUp' | 'arrowDown';
      size: number;
      text?: string;
    }> = [];

    for (const point of sorted) {
      const isHigh = point.type === 'high';
      const isLive = !!point.isLive;
      const direction = point.direction;
      const pattern = point.pattern;

      if (isLive && direction) {
        // ═══════════════════════════════════════════════
        //  LIVE SIGNAL — Big Circle + Directional Arrow
        // ═══════════════════════════════════════════════
        const isUp = direction === 'UP';

        // 1) BIG CIRCLE at wick end — bright, prominent
        const circleColor = isUp ? '#00ff66' : '#ff2222';
        const circleSize = point.strength === 3 ? 3.0 : point.strength === 2 ? 2.5 : 2.0;

        markers.push({
          time: point.time as any,
          position: isUp ? 'belowBar' : 'aboveBar',
          color: circleColor,
          shape: 'circle',
          size: circleSize,
          text: pattern || (isUp ? 'BUY' : 'SELL'),
        });

        // 2) DIRECTIONAL ARROW at candle center — 50% alpha (lighter color)
        const arrowColor = isUp ? '#80ffbb' : '#ff9999'; // lighter = simulates 50% alpha

        markers.push({
          time: point.time as any,
          position: 'inBar', // renders at close price level (center of candle)
          color: arrowColor,
          shape: isUp ? 'arrowUp' : 'arrowDown',
          size: circleSize - 0.5,
        });

      } else {
        // ═══════════════════════════════════════════════
        //  HISTORICAL PIVOT — standard Semafor circles
        // ═══════════════════════════════════════════════
        const color = isHigh
          ? (point.strength === 3 ? '#ff4400' : point.strength === 2 ? '#ff6600' : '#ff8800')
          : (point.strength === 3 ? '#00cc00' : point.strength === 2 ? '#00bb44' : '#00aa66');

        const size = point.strength === 3 ? 2.0
                   : point.strength === 2 ? 1.5
                   : 1.0;

        markers.push({
          time: point.time as any,
          position: isHigh ? 'aboveBar' : 'belowBar',
          color,
          shape: 'circle',
          size,
        });
      }
    }

    // Sort: lightweight-charts requires ascending time order
    // For same time: position order (aboveBar → inBar → belowBar) then shape (circle → arrow)
    const posOrder = { 'aboveBar': 0, 'inBar': 1, 'belowBar': 2 };
    const shapeOrder = { 'circle': 0, 'arrowDown': 1, 'arrowUp': 1 };
    
    markers.sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      const pa = posOrder[a.position] ?? 1;
      const pb = posOrder[b.position] ?? 1;
      if (pa !== pb) return pa - pb;
      const sa = shapeOrder[a.shape] ?? 0;
      const sb = shapeOrder[b.shape] ?? 0;
      return sa - sb;
    });

    try {
      candleSeries.setMarkers(markers);
    } catch (error) {
      console.error('Semafor marker error:', error);
    }

    // NO cleanup function — prevents markers from disappearing on WebSocket ticks
  }, [candleSeries, points, visible]);

  return null;
}
