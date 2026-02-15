'use client';

import { useEffect } from 'react';
import { ISeriesApi } from 'lightweight-charts';
import { PatternSignal } from '../../lib/indicators/patternRecognition';
import { getPatternName } from '../../lib/indicators/patternRecognition';

interface PatternRecognitionOverlayProps {
  candleSeries: ISeriesApi<'Candlestick'> | null;
  patterns: PatternSignal[];
  visible: boolean;
}

/**
 * Pattern Recognition Overlay
 * 
 * Renders detected chart patterns on the chart:
 * - Double Bottom/Top: Green/Orange circles at pattern points
 * - Head & Shoulders: Connected lines showing the pattern
 * - Triangles: Trend lines
 * - Labels with confidence and direction
 */
export default function PatternRecognitionOverlay({
  candleSeries,
  patterns,
  visible,
}: PatternRecognitionOverlayProps) {
  useEffect(() => {
    if (!candleSeries) return;

    if (!visible || !patterns || patterns.length === 0) {
      try {
        candleSeries.setMarkers([]);
      } catch {}
      return;
    }

    const markers: Array<{
      time: any;
      position: 'aboveBar' | 'belowBar' | 'inBar';
      color: string;
      shape: 'circle' | 'arrowUp' | 'arrowDown';
      size: number;
      text?: string;
    }> = [];

    // Render each detected pattern
    for (const pattern of patterns) {
      const isBullish = pattern.direction === 'UP';
      const color = isBullish ? '#00ff66' : '#ff4400';
      const arrowColor = isBullish ? '#80ffbb' : '#ff9999';

      // Main pattern signal marker at the completion point
      markers.push({
        time: pattern.time as any,
        position: isBullish ? 'belowBar' : 'aboveBar',
        color,
        shape: 'circle',
        size: 3.0, // Large circle for pattern completion
        text: `${getPatternName(pattern.type)} (${pattern.confidence}%)`,
      });

      // Directional arrow
      markers.push({
        time: pattern.time as any,
        position: isBullish ? 'belowBar' : 'aboveBar',
        color: arrowColor,
        shape: isBullish ? 'arrowUp' : 'arrowDown',
        size: 2.0,
      });

      // Mark pattern points (lows/highs that form the pattern)
      for (const point of pattern.patternPoints) {
        const isHigh = point.label.includes('High') || point.label.includes('Shoulder') || point.label.includes('Head');
        markers.push({
          time: point.time as any,
          position: isHigh ? 'aboveBar' : 'belowBar',
          color: isBullish ? '#00cc0080' : '#ff440080', // Semi-transparent
          shape: 'circle',
          size: 1.5,
          text: point.label,
        });
      }

      // Target level marker (if available)
      if (pattern.target) {
        markers.push({
          time: pattern.time as any,
          position: isBullish ? 'aboveBar' : 'belowBar',
          color: isBullish ? '#00ff6680' : '#ff440080',
          shape: isBullish ? 'arrowUp' : 'arrowDown',
          size: 1.0,
        });
      }
    }

    // Sort by time
    markers.sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time;
      const posOrder = { 'aboveBar': 0, 'inBar': 1, 'belowBar': 2 };
      return (posOrder[a.position] || 1) - (posOrder[b.position] || 1);
    });

    try {
      candleSeries.setMarkers(markers);
    } catch (error) {
      console.error('Pattern recognition marker error:', error);
    }
  }, [candleSeries, patterns, visible]);

  return null;
}
