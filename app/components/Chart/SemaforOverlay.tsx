'use client';

import { useEffect, useRef } from 'react';
import { ISeriesApi } from 'lightweight-charts';
import { SemaforPoint } from '../../lib/indicators/types';

interface SemaforOverlayProps {
  candleSeries: ISeriesApi<'Candlestick'> | null;
  points: SemaforPoint[];
  visible: boolean;
}

export default function SemaforOverlay({ candleSeries, points, visible }: SemaforOverlayProps) {
  const markersRef = useRef<any[]>([]);
  const lastPointsHashRef = useRef<string>('');

  useEffect(() => {
    if (!candleSeries || !visible) {
      // Clear markers if not visible
      if (candleSeries && markersRef.current.length > 0) {
        candleSeries.setMarkers([]);
        markersRef.current = [];
        lastPointsHashRef.current = '';
      }
      return;
    }

    // Create a hash of points to prevent unnecessary updates
    const pointsHash = points.map(p => `${p.time}-${p.price}-${p.type}-${p.signal || ''}`).join('|');
    if (pointsHash === lastPointsHashRef.current && markersRef.current.length > 0) {
      // Points haven't changed, skip update
      return;
    }
    lastPointsHashRef.current = pointsHash;

    // Deduplicate points by time (keep strongest one)
    const pointMap = new Map<number, typeof points[0]>();
    points.forEach(point => {
      const existing = pointMap.get(point.time);
      if (!existing) {
        pointMap.set(point.time, point);
      } else {
        // Keep the stronger point
        const existingStrength = existing.signalStrength || existing.strength;
        const newStrength = point.signalStrength || point.strength;
        if (newStrength > existingStrength) {
          pointMap.set(point.time, point);
        } else if (newStrength === existingStrength && point.signal && !existing.signal) {
          pointMap.set(point.time, point);
        }
      }
    });
    
    // Create markers for Semafor points with buy/sell signals
    // Show all points with strength >= 1, prioritize those with signals
    const markers = Array.from(pointMap.values())
      .filter(p => p.strength >= 1) // Show all points with strength >= 1
      .map(point => {
        // Determine color based on signal or type
        // Stronger signals = darker colors, bigger circles
        let color: string;
        if (point.signal === 'SELL') {
          // Orange for sell signals (stronger = darker orange)
          if (point.signalStrength === 3) {
            color = '#ff4500'; // Darker orange for strong sell
          } else if (point.signalStrength === 2) {
            color = '#ff6b35'; // Medium orange
          } else {
            color = '#ff8c5a'; // Light orange
          }
        } else if (point.signal === 'BUY') {
          // Teal/green for buy signals (stronger = darker teal)
          if (point.signalStrength === 3) {
            color = '#00897b'; // Darker teal for strong buy
          } else if (point.signalStrength === 2) {
            color = '#26a69a'; // Medium teal
          } else {
            color = '#4db6ac'; // Light teal
          }
        } else {
          // Fallback: Red for high pivots, Teal for low pivots
          // Stronger = darker
          if (point.type === 'high') {
            color = point.strength === 3 ? '#c62828' : point.strength === 2 ? '#ef5350' : '#e57373';
          } else {
            color = point.strength === 3 ? '#00897b' : point.strength === 2 ? '#26a69a' : '#4db6ac';
          }
        }
        
        // Size based on signal strength or pivot strength
        // Stronger = bigger circle (ONE big circle for strong signals)
        const size = point.signalStrength 
          ? (point.signalStrength === 3 ? 3.5 : point.signalStrength === 2 ? 2.5 : 2) // Bigger for strong signals
          : (point.strength === 3 ? 2.5 : point.strength === 2 ? 2 : 1.5);
        
        return {
          time: point.time as any,
          position: point.type === 'high' ? ('aboveBar' as const) : ('belowBar' as const),
          color,
          shape: 'circle' as const,
          size,
          text: point.signalStrength === 3 ? (point.signal === 'SELL' ? 'S' : 'B') : ''
        };
      });
    
    // Apply markers to chart
    if (markers.length > 0) {
      candleSeries.setMarkers(markers);
      markersRef.current = markers;
    } else {
      // Clear markers if none
      candleSeries.setMarkers([]);
      markersRef.current = [];
    }

    return () => {
      // Cleanup: clear markers
      if (candleSeries) {
        candleSeries.setMarkers([]);
        markersRef.current = [];
      }
    };
  }, [candleSeries, points, visible]);

  return null; // This is an overlay, no DOM rendering
}
