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

    // ──── FMCBR CORE ENGINE MARKERS (render levels as circles like Semafor) ────
    if (showFMCBR && fmcbrSignal && fmcbrSignal.status === 'READY') {
      const { levels, direction, breakType, cb1 } = fmcbrSignal;
      
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
      
      // Get reference time for marker placement
      let referenceTime: number | null = currentCandleTime || null;
      
      if (referenceTime === null) {
        if (semaforPoints.length > 0) {
          referenceTime = semaforPoints[semaforPoints.length - 1].time;
        } else if (scalpSignals.length > 0) {
          referenceTime = scalpSignals[scalpSignals.length - 1].time;
        } else if (trendMarker) {
          referenceTime = trendMarker.time;
        }
      }
      
      // If no reference time, skip rendering (will render when candles are available)
      if (referenceTime !== null) {
        // Render each level as a circle marker
        levels.forEach(level => {
          let color = '#888888';
          let size = 1.5;
          let position: 'aboveBar' | 'belowBar' | 'inBar' = 'inBar';
          
          // Determine position and style based on level type
          if (level.type === 'base') {
            color = scheme.base;
            size = 2.5;
            position = direction === 'BULLISH' ? 'aboveBar' : 'belowBar';
          } else if (level.type === 'setup') {
            color = scheme.setup;
            size = 2.5;
            position = direction === 'BULLISH' ? 'belowBar' : 'aboveBar';
          } else if (level.type === 'entry') {
            color = scheme.entry;
            size = 2.0;
            position = direction === 'BULLISH' ? 'belowBar' : 'aboveBar';
          } else if (level.type === 'tp') {
            color = scheme.tp;
            size = 1.5;
            position = direction === 'BULLISH' ? 'aboveBar' : 'belowBar';
          }
          
          // Create marker for this level with price info in text
          allMarkers.push({
            time: referenceTime as any,
            position,
            color,
            shape: 'circle',
            size,
            text: `${level.label}: ${level.price.toFixed(2)}`,
          });
        });
        
        // Add break type indicator marker
        if (breakType) {
          allMarkers.push({
            time: referenceTime as any,
            position: 'inBar',
            color: breakType === 'DB' ? '#ff6600' : '#ffaa00',
            shape: 'circle',
            size: 2.0,
            text: `FMCBR: ${breakType}${cb1 ? ' + CB1' : ''}`,
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
