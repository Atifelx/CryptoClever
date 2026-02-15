'use client';

import { useEffect, useRef } from 'react';
import { ISeriesApi } from 'lightweight-charts';
import { SemaforPoint } from '../../lib/indicators/types';
import { PatternSignal } from '../../lib/indicators/patternRecognition';
import { getPatternName } from '../../lib/indicators/patternRecognition';

interface UnifiedMarkerManagerProps {
  candleSeries: ISeriesApi<'Candlestick'> | null;
  semaforPoints: SemaforPoint[];
  patternSignals: PatternSignal[];
  showSemafor: boolean;
  showPatternRecognition: boolean;
}

/**
 * Unified Marker Manager
 * 
 * Merges markers from multiple indicators to prevent rendering conflicts.
 * When both Semafor and Pattern Recognition are enabled, this component
 * combines their markers into a single setMarkers() call.
 */
export default function UnifiedMarkerManager({
  candleSeries,
  semaforPoints,
  patternSignals,
  showSemafor,
  showPatternRecognition,
}: UnifiedMarkerManagerProps) {
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (!candleSeries) return;

    const allMarkers: Array<{
      time: any;
      position: 'aboveBar' | 'belowBar' | 'inBar';
      color: string;
      shape: 'circle' | 'arrowUp' | 'arrowDown';
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

    // ──── PATTERN RECOGNITION MARKERS ────
    if (showPatternRecognition && patternSignals && patternSignals.length > 0) {
      for (const pattern of patternSignals) {
        const isBullish = pattern.direction === 'UP';
        const color = isBullish ? '#00ff66' : '#ff4400';
        const arrowColor = isBullish ? '#80ffbb' : '#ff9999';

        // Main pattern signal marker at completion point
        allMarkers.push({
          time: pattern.time as any,
          position: isBullish ? 'belowBar' : 'aboveBar',
          color,
          shape: 'circle',
          size: 3.5, // Slightly larger than Semafor to distinguish
          text: `${getPatternName(pattern.type)} (${pattern.confidence}%)`,
        });

        // Directional arrow
        allMarkers.push({
          time: pattern.time as any,
          position: isBullish ? 'belowBar' : 'aboveBar',
          color: arrowColor,
          shape: isBullish ? 'arrowUp' : 'arrowDown',
          size: 2.5,
        });

        // Mark pattern points (lows/highs that form the pattern)
        for (const point of pattern.patternPoints) {
          const isHigh = point.label.includes('High') || 
                        point.label.includes('Shoulder') || 
                        point.label.includes('Head');
          allMarkers.push({
            time: point.time as any,
            position: isHigh ? 'aboveBar' : 'belowBar',
            color: isBullish ? '#00cc0080' : '#ff440080', // Semi-transparent
            shape: 'circle',
            size: 1.5,
            text: point.label,
          });
        }
      }
    }

    // Sort all markers: time → position → shape
    const posOrder = { 'aboveBar': 0, 'inBar': 1, 'belowBar': 2 };
    const shapeOrder = { 'circle': 0, 'arrowDown': 1, 'arrowUp': 1 };
    
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
  }, [candleSeries, semaforPoints, patternSignals, showSemafor, showPatternRecognition]);

  return null;
}
