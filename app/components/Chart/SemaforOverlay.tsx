'use client';

import { RefObject, useEffect, useState } from 'react';
import { ISeriesApi, IChartApi } from 'lightweight-charts';
import { SemaforPoint } from '../../lib/indicators/types';

interface SemaforOverlayProps {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<'Candlestick'> | null;
  containerRef: RefObject<HTMLDivElement>;
  points: SemaforPoint[];
  visible: boolean;
}

interface StructuralMarker {
  x: number;
  y: number;
  type: 'high' | 'low';
}

/**
 * Semafor Structural Overlay
 * Renders the "Major Structure" points (Level 3) with an arrow inside a circle,
 * matching the exact MT4 aesthetic.
 */
export default function SemaforOverlay({
  chart,
  candleSeries,
  containerRef,
  points,
  visible,
}: SemaforOverlayProps) {
  const [markers, setMarkers] = useState<StructuralMarker[]>([]);

  useEffect(() => {
    if (!chart || !candleSeries || !containerRef.current || !visible || !points.length) {
      setMarkers([]);
      return;
    }

    const updateLayout = () => {
      const timeScale = chart.timeScale();
      const lvl3Points = points.filter(p => p.strength === 3);
      
      const newMarkers: StructuralMarker[] = [];
      
      for (const p of lvl3Points) {
        const x = timeScale.timeToCoordinate(p.time as any);
        const y = candleSeries.priceToCoordinate(p.price);
        
        if (x !== null && y !== null && !Number.isNaN(x) && !Number.isNaN(y)) {
          newMarkers.push({ x, y, type: p.type as 'high' | 'low' });
        }
      }
      
      setMarkers(newMarkers);
    };

    updateLayout();
    
    // Update on a timer to catch chart scrolls/zooms
    const interval = window.setInterval(updateLayout, 100);
    const onResize = () => updateLayout();
    window.addEventListener('resize', onResize);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('resize', onResize);
    };
  }, [chart, candleSeries, containerRef, points, visible]);

  if (!visible || !markers.length) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <svg width="100%" height="100%" className="absolute inset-0 overflow-visible">
        {markers.map((m, i) => {
          const isHigh = m.type === 'high';
          const color = isHigh ? '#ff2222' : '#0066ff';
          const shadowColor = isHigh ? 'rgba(255, 34, 34, 0.5)' : 'rgba(0, 102, 255, 0.5)';
          
          // Offset Y slightly to be above/below the wick
          const offsetY = isHigh ? m.y - 25 : m.y + 25;
          
          return (
            <g key={i} style={{ filter: `drop-shadow(0 0 8px ${shadowColor})` }}>
              {/* The Outer Circle */}
              <circle
                cx={m.x}
                cy={offsetY}
                r="14"
                fill={color}
                stroke="#ffffff"
                strokeWidth="2"
              />
              
              {/* The Arrow Inside */}
              {isHigh ? (
                // Arrow Down
                <path
                  d={`M ${m.x - 6} ${offsetY - 4} L ${m.x + 6} ${offsetY - 4} L ${m.x} ${offsetY + 7} Z`}
                  fill="#ffffff"
                />
              ) : (
                // Arrow Up
                <path
                  d={`M ${m.x - 6} ${offsetY + 4} L ${m.x + 6} ${offsetY + 4} L ${m.x} ${offsetY - 7} Z`}
                  fill="#ffffff"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
