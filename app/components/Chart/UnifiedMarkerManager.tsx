'use client';

import { useEffect, useRef } from 'react';
import { ISeriesApi } from 'lightweight-charts';
import { SemaforPoint } from '../../lib/indicators/types';
import type { ScalpDisplayItem } from '../../lib/indicators/scalpSignal';
import type { TrendMarker } from '../../lib/indicators/trendIndicator';
import type { FMCBRSignal } from '../../lib/indicators/fmcbr';

interface UnifiedMarkerManagerProps {
  candleSeries: ISeriesApi<'Candlestick'> | null;
  semaforPoints: SemaforPoint[];
  scalpSignals: ScalpDisplayItem[];
  trendMarker: TrendMarker | null;
  fmcbrSignal: FMCBRSignal | null;
  currentCandleTime?: number; // Current candle time for FMCBR markers
  showSemafor: boolean;
  showScalp: boolean;
  showTrend: boolean;
  showFMCBR: boolean;
}

/**
 * Unified Marker Manager
 *
 * Merges markers from Semafor and Scalp Signal into a single setMarkers() call.
 */
export default function UnifiedMarkerManager({
  candleSeries,
  semaforPoints,
  scalpSignals,
  trendMarker,
  fmcbrSignal,
  currentCandleTime,
  showSemafor,
  showScalp,
  showTrend,
  showFMCBR,
}: UnifiedMarkerManagerProps) {
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (!candleSeries) return;

    const allMarkers: Array<{
      time: any;
      position: 'aboveBar' | 'belowBar' | 'inBar';
      color: string;
      shape: 'circle' | 'arrowUp' | 'arrowDown' | 'square';
      size: number;
      text?: string;
    }> = [];

    // ──── SEMAFOR MARKERS ────
    if (showSemafor && semaforPoints && semaforPoints.length > 0) {
      const sorted = [...semaforPoints].sort((a, b) => a.time - b.time);

      for (const point of sorted) {
        const isHigh = point.type === 'high';
        const isLive = !!point.isLive;
        const direction = point.direction;
        const pattern = point.pattern;

        if (isLive && direction) {
          // LIVE SIGNAL — Big Circle + Directional Arrow
          const isUp = direction === 'UP';
          const circleColor = isUp ? '#00ff66' : '#ff2222';
          const circleSize = point.strength === 3 ? 3.0 : point.strength === 2 ? 2.5 : 2.0;

          allMarkers.push({
            time: point.time as any,
            position: isUp ? 'belowBar' : 'aboveBar',
            color: circleColor,
            shape: 'circle',
            size: circleSize,
            text: pattern || (isUp ? 'BUY' : 'SELL'),
          });

          // Directional arrow
          const arrowColor = isUp ? '#80ffbb' : '#ff9999';
          allMarkers.push({
            time: point.time as any,
            position: 'inBar',
            color: arrowColor,
            shape: isUp ? 'arrowUp' : 'arrowDown',
            size: circleSize - 0.5,
          });
        } else {
          // HISTORICAL PIVOT — standard Semafor circles
          const color = isHigh
            ? (point.strength === 3 ? '#ff4400' : point.strength === 2 ? '#ff6600' : '#ff8800')
            : (point.strength === 3 ? '#00cc00' : point.strength === 2 ? '#00bb44' : '#00aa66');

          const size = point.strength === 3 ? 2.0
                     : point.strength === 2 ? 1.5
                     : 1.0;

          allMarkers.push({
            time: point.time as any,
            position: isHigh ? 'aboveBar' : 'belowBar',
            color,
            shape: 'circle',
            size,
          });
        }
      }
    }

    // ──── TREND INDICATOR MARKERS (visual trend line markers) ────
    if (showTrend && trendMarker) {
      const { trend, action, confidence } = trendMarker;
      
      // Color based on trend
      let markerColor: string;
      let arrowColor: string;
      let arrowShape: 'arrowUp' | 'arrowDown';
      let position: 'aboveBar' | 'belowBar';
      
      if (trend === 'UPTREND' && action === 'BUY_ALLOWED') {
        markerColor = '#00ff66'; // Green for uptrend
        arrowColor = '#80ffbb';
        arrowShape = 'arrowUp';
        position = 'belowBar';
      } else if (trend === 'DOWNTREND') {
        markerColor = '#ff2222'; // Red for downtrend
        arrowColor = '#ff9999';
        arrowShape = 'arrowDown';
        position = 'aboveBar';
      } else {
        // SIDEWAYS
        markerColor = '#ffaa00'; // Orange for sideways
        arrowColor = '#ffcc66';
        arrowShape = 'arrowUp'; // Neutral
        position = 'inBar';
      }
      
      // Main trend marker circle
      allMarkers.push({
        time: trendMarker.time as any,
        position,
        color: markerColor,
        shape: 'circle',
        size: confidence > 80 ? 3.0 : confidence > 60 ? 2.5 : 2.0,
        text: `${trend} (${confidence}%)`,
      });
      
      // Directional arrow
      if (trend !== 'SIDEWAYS') {
        allMarkers.push({
          time: trendMarker.time as any,
          position: 'inBar',
          color: arrowColor,
          shape: arrowShape,
          size: 2.0,
        });
      }
    }

    // ──── SCALP SIGNAL MARKERS (white circle + arrow; WAIT = grey circle) ────
    if (showScalp && scalpSignals && scalpSignals.length > 0) {
      for (const item of scalpSignals) {
        if (item.signal === 'LONG' || item.signal === 'SHORT') {
          const isBuy = item.signal === 'LONG';
          const rsiText = item.rsi != null ? `RSI: ${item.rsi.toFixed(0)}` : '';
          const tp2Text = `TP2: ${item.takeProfit2.toFixed(0)}`;
          const slText = `SL: ${item.stopLoss.toFixed(0)}`;
          const label = `Scalp ${item.signal}${rsiText ? ` | ${rsiText}` : ''} | ${tp2Text} | ${slText}`;

          allMarkers.push({
            time: item.time as any,
            position: isBuy ? 'belowBar' : 'aboveBar',
            color: '#FFFFFF',
            shape: 'circle',
            size: 2.5,
            text: label,
          });

          const arrowColor = isBuy ? '#4CAF50' : '#F44336';
          allMarkers.push({
            time: item.time as any,
            position: isBuy ? 'belowBar' : 'aboveBar',
            color: arrowColor,
            shape: isBuy ? 'arrowUp' : 'arrowDown',
            size: 2.0,
          });
        } else {
          // WAIT: show one grey circle so the indicator is visible
          allMarkers.push({
            time: item.time as any,
            position: 'belowBar',
            color: '#888888',
            shape: 'circle',
            size: 2.0,
            text: `Scalp: WAIT (${item.reason})`,
          });
        }
      }
    }

    // Sort all markers: time → position → shape
    const posOrder = { 'aboveBar': 0, 'inBar': 1, 'belowBar': 2 };
    const shapeOrder = { 'circle': 0, 'square': 1, 'arrowDown': 2, 'arrowUp': 2 };
    
    allMarkers.sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      const pa = posOrder[a.position] ?? 1;
      const pb = posOrder[b.position] ?? 1;
      if (pa !== pb) return pa - pb;
      const sa = shapeOrder[a.shape] ?? 0;
      const sb = shapeOrder[b.shape] ?? 0;
      return sa - sb;
    });

    // Apply all markers in one call
    try {
      candleSeries.setMarkers(allMarkers);
      markersRef.current = allMarkers;
    } catch (error) {
      console.error('Unified marker error:', error);
    }
  }, [candleSeries, semaforPoints, scalpSignals, trendMarker, fmcbrSignal, currentCandleTime, showSemafor, showScalp, showTrend, showFMCBR]);

  return null;
}
