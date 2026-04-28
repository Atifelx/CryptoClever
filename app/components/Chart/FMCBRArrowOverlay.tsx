'use client';

import { RefObject, useEffect, useState } from 'react';
import { ISeriesApi, IChartApi, Time } from 'lightweight-charts';
import type { FMCBRSignal } from '../../lib/indicators/fmcbr';

interface FMCBRArrowOverlayProps {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<'Candlestick'> | null;
  containerRef: RefObject<HTMLDivElement>;
  signal: FMCBRSignal | null;
  visible: boolean;
}

interface ArrowLayout {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  direction: 'BULLISH' | 'BEARISH';
}

/**
 * FMCBR Arrow Overlay (V2 - Diagonal Momentum Arrow)
 * Renders a large, diagonal glowing arrow as per user request (how.png).
 * Points from the breakout/signal point towards the expected target.
 */
export default function FMCBRArrowOverlay({
  chart,
  candleSeries,
  containerRef,
  signal,
  visible,
}: FMCBRArrowOverlayProps) {
  const [layout, setLayout] = useState<ArrowLayout | null>(null);

  useEffect(() => {
    if (!chart || !candleSeries || !containerRef.current || !signal || !visible) {
      setLayout(null);
      return;
    }

    // Allow all signal statuses that have a direction
    if (!signal.direction || !signal.status) {
      setLayout(null);
      return;
    }

    const updateLayout = () => {
      const timeScale = chart.timeScale();
      const signalTime = signal.signalTime;
      
      if (!signalTime) {
        setLayout(null);
        return;
      }

      const startX = timeScale.timeToCoordinate(signalTime as Time);
      if (startX === null || Number.isNaN(startX)) {
        setLayout(null);
        return;
      }

      // Calculate vertical range: from Base/Setup to TP1 or TP3
      const isUp = signal.direction === 'BULLISH';
      const startPrice = isUp ? signal.swingLow : signal.swingHigh;
      
      // Target price: use TP1 or TP3 depending on what's available
      const tpLevel = signal.levels.find(l => l.level === 'TP1')?.price || 
                      signal.levels.find(l => l.level === 'TP3')?.price || 
                      (isUp ? signal.swingHigh * 1.02 : signal.swingLow * 0.98);
      
      const startY = candleSeries.priceToCoordinate(startPrice);
      const endY = candleSeries.priceToCoordinate(tpLevel);

      if (startY === null || endY === null || Number.isNaN(startY) || Number.isNaN(endY)) {
        setLayout(null);
        return;
      }

      // Diagonal offset: point the arrow 60 pixels to the right
      const endX = startX + 60;

      setLayout({
        startX,
        startY,
        endX,
        endY,
        direction: signal.direction as 'BULLISH' | 'BEARISH',
      });
    };

    updateLayout();
    
    const interval = window.setInterval(updateLayout, 100);
    const onResize = () => updateLayout();
    window.addEventListener('resize', onResize);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('resize', onResize);
    };
  }, [chart, candleSeries, containerRef, signal, visible]);

  if (!layout) {
    return null;
  }

  const { startX, startY, endX, endY, direction } = layout;
  const isUp = direction === 'BULLISH';
  
  // SVG ViewBox math
  const minX = Math.min(startX, endX) - 20;
  const maxX = Math.max(startX, endX) + 20;
  const minY = Math.min(startY, endY) - 20;
  const maxY = Math.max(startY, endY) + 20;
  
  const width = maxX - minX;
  const height = maxY - minY;

  const accentColor = isUp ? '#00ffcc' : '#ff3366';
  const glowColor = isUp ? 'rgba(0, 255, 204, 0.5)' : 'rgba(255, 51, 102, 0.5)';

  // Arrowhead math
  const angle = Math.atan2(endY - startY, endX - startX);
  const headSize = 18;
  const x1 = endX - headSize * Math.cos(angle - Math.PI / 6);
  const y1 = endY - headSize * Math.sin(angle - Math.PI / 6);
  const x2 = endX - headSize * Math.cos(angle + Math.PI / 6);
  const y2 = endY - headSize * Math.sin(angle + Math.PI / 6);

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <svg
        width="100%"
        height="100%"
        className="absolute inset-0 overflow-visible"
        style={{ filter: 'drop-shadow(0 0 12px ' + glowColor + ')' }}
      >
        <defs>
          <linearGradient id={`grad-${direction}`} x1={startX} y1={startY} x2={endX} y2={endY} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={accentColor} stopOpacity="0.1" />
            <stop offset="100%" stopColor={accentColor} stopOpacity="0.9" />
          </linearGradient>
        </defs>

        {/* The Arrow Line */}
        <line
          x1={startX}
          y1={startY}
          x2={endX}
          y2={endY}
          stroke={`url(#grad-${direction})`}
          strokeWidth="6"
          strokeLinecap="round"
          className="animate-pulse"
        />

        {/* The Arrow Head */}
        <path
          d={`M ${endX} ${endY} L ${x1} ${y1} L ${x2} ${y2} Z`}
          fill={accentColor}
          fillOpacity="0.9"
          className="animate-pulse"
        />

        {/* Label near the end of the arrow */}
        <foreignObject x={endX + 10} y={endY - 10} width="150" height="40">
          <div className="flex items-center gap-2">
            <div 
              className="rounded-full px-2 py-0.5 text-[11px] font-black italic tracking-tighter text-white shadow-xl backdrop-blur-md"
              style={{ 
                background: `linear-gradient(90deg, ${accentColor} 0%, rgba(0,0,0,0.8) 100%)`,
                border: `1px solid ${accentColor}88`
              }}
            >
              FMCBR {direction}
            </div>
          </div>
        </foreignObject>
      </svg>
    </div>
  );
}
