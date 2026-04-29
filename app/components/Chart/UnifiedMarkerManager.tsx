'use client';

import { useEffect, useRef } from 'react';
import { ISeriesApi } from 'lightweight-charts';
import { SemaforPoint } from '../../lib/indicators/types';
import type { ScalpDisplayItem } from '../../lib/indicators/scalpSignal';
import type { TrendMarker } from '../../lib/indicators/trendIndicator';
import type { FMCBRSignal } from '../../lib/indicators/fmcbr';
import type { TrendScalpDisplayItem } from '../../lib/indicators/trendScalp';

interface UnifiedMarkerManagerProps {
  candleSeries: ISeriesApi<'Candlestick'> | null;
  semaforPoints: SemaforPoint[];
  scalpSignals: ScalpDisplayItem[];
  trendMarker: TrendMarker | null;
  fmcbrSignal: FMCBRSignal | null;
  trendScalpSignals: TrendScalpDisplayItem[];
  currentCandleTime?: number; // Current candle time for FMCBR markers
  showSemafor: boolean;
  showScalp: boolean;
  showTrend: boolean;
  showFMCBR: boolean;
  showTrendScalp: boolean;
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
  trendScalpSignals,
  currentCandleTime,
  showSemafor,
  showScalp,
  showTrend,
  showFMCBR,
  showTrendScalp,
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
          // HISTORICAL PIVOT — standard Semafor circles (Lvl 1 & 2 only)
          if (point.strength === 3) continue; // Handled by SemaforOverlay

          const color = isHigh
            ? (point.strength === 2 ? '#ff6600' : '#ff8800')
            : (point.strength === 2 ? '#00bb44' : '#00aa66');

          const size = point.strength === 2 ? 2.0 : 1.0;

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

    // ──── TREND INDICATOR MARKERS ────
    // REMOVED: Trend indicator now renders as overlay at top of chart (see TrendIndicatorOverlay.tsx)
    // This prevents visibility issues with markers overlapping candles

    // ──── SCALP SIGNAL MARKERS ────
    // White circle now also renders as overlay (see ScalpSignalOverlay.tsx)
    // But keep markers as fallback for visibility on chart
    if (showScalp && scalpSignals && scalpSignals.length > 0) {
      for (const item of scalpSignals) {
        if (item.signal === 'LONG' || item.signal === 'SHORT') {
          const isBuy = item.signal === 'LONG';
          const rsiText = item.rsi != null ? `RSI: ${item.rsi.toFixed(0)}` : '';
          const tp2Text = `TP2: ${item.takeProfit2.toFixed(0)}`;
          const slText = `SL: ${item.stopLoss.toFixed(0)}`;
          const label = `Scalp ${item.signal}${rsiText ? ` | ${rsiText}` : ''} | ${tp2Text} | ${slText}`;

          // Keep arrow marker on chart for visibility
          const arrowColor = isBuy ? '#4CAF50' : '#F44336';
          allMarkers.push({
            time: item.time as any,
            position: isBuy ? 'belowBar' : 'aboveBar',
            color: arrowColor,
            shape: isBuy ? 'arrowUp' : 'arrowDown',
            size: 2.5,
            text: label,
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

    // ──── TRENDSCALP MARKERS ────
    if (showTrendScalp) {
      let referenceTime: number | null = currentCandleTime || null;
      if (referenceTime === null) {
        if (semaforPoints.length > 0) {
          referenceTime = semaforPoints[semaforPoints.length - 1].time;
        } else if (scalpSignals.length > 0) {
          referenceTime = scalpSignals[scalpSignals.length - 1].time;
        } else if (trendMarker) {
          referenceTime = trendMarker.time;
        } else {
          referenceTime = Math.floor(Date.now() / 1000);
        }
      }
      
      if (trendScalpSignals && trendScalpSignals.length > 0) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[TrendScalp] Rendering markers:', {
            showTrendScalp,
            signalsCount: trendScalpSignals.length,
            signals: trendScalpSignals.map(s => ({ 
              signal: s.signal, 
              time: s.time,
              timeValid: s.time > 0,
            })),
            referenceTime,
          });
        }
        
        for (const item of trendScalpSignals) {
          let markerTime = item.time;
          if (!markerTime || markerTime === 0) {
            markerTime = referenceTime || Math.floor(Date.now() / 1000);
            if (process.env.NODE_ENV === 'development') {
              console.warn('[TrendScalp] Using fallback time for marker:', markerTime);
            }
          }
          
          if (item.signal === 'LONG' || item.signal === 'SHORT') {
            const marker = item as Extract<typeof item, { signal: 'LONG' | 'SHORT' }>;
            const isBuy = marker.signal === 'LONG';
            const signalStrength = marker.signalStrength;
            const confidence = marker.confidence;
            const regime = (marker as any).regime || '';
            
            const arrowColor = isBuy ? '#00ff66' : '#ff2222';
            const circleColor = isBuy ? '#4CAF50' : '#F44336';
            const size = Math.min(3.0, Math.max(2.0, Math.abs(signalStrength) / 30));
            const label = `TrendScalp ${marker.signal} | Strength: ${signalStrength.toFixed(0)} | Conf: ${confidence}%${regime ? ` | ${regime}` : ''}`;
            
            allMarkers.push({
              time: markerTime as any,
              position: isBuy ? 'belowBar' : 'aboveBar',
              color: circleColor,
              shape: 'circle',
              size: size,
              text: label,
            });
            
            allMarkers.push({
              time: markerTime as any,
              position: 'inBar',
              color: arrowColor,
              shape: isBuy ? 'arrowUp' : 'arrowDown',
              size: size - 0.5,
            });
          } else if (item.signal === 'WAIT') {
            const waitItem = item as Extract<typeof item, { signal: 'WAIT' }>;
            allMarkers.push({
              time: markerTime as any,
              position: 'belowBar',
              color: '#888888',
              shape: 'circle',
              size: 2.0,
              text: `TrendScalp: WAIT${waitItem.reason ? ` (${waitItem.reason.substring(0, 50)})` : ''}`,
            });
          }
        }
      } else {
        if (process.env.NODE_ENV === 'development') {
          console.log('[TrendScalp] No signals to render, adding fallback WAIT marker:', {
            showTrendScalp,
            signalsCount: trendScalpSignals?.length || 0,
            hasSignals: !!trendScalpSignals,
            referenceTime,
          });
        }
        
        allMarkers.push({
          time: (referenceTime || Math.floor(Date.now() / 1000)) as any,
          position: 'belowBar',
          color: '#888888',
          shape: 'circle',
          size: 2.0,
          text: 'TrendScalp: WAIT (Calculating...)',
        });
      }
    }

    // ──── FMCBR CORE ENGINE MARKERS (REMOVED: Now handled by FMCBRArrowOverlay for cleaner UI) ────
    /*
    if (showFMCBR && fmcbrSignal) {
      ...
    }
    */

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
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('disposed')) return; // Chart was disposed (e.g. symbol change)
      console.error('Unified marker error:', error);
    }
  }, [candleSeries, semaforPoints, scalpSignals, trendMarker, fmcbrSignal, trendScalpSignals, currentCandleTime, showSemafor, showScalp, showTrend, showFMCBR, showTrendScalp]);

  return null;
}
