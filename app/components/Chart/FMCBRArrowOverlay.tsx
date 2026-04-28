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
      const seriesData = candleSeries.data();
      if (!seriesData || seriesData.length === 0) return;
      
      const lastCandle = seriesData[seriesData.length - 1];
      const lastX = timeScale.timeToCoordinate(lastCandle.time);
      
      if (lastX === null || Number.isNaN(lastX)) {
        setLayout(null);
        return;
      }

      const isUp = signal.direction === 'BULLISH';
      
      // Position the arrow just after the last candle (in the "future" space)
      // Anchor it near the latest price action as per user's screenshot
      const startX = lastX + 30;
      const endX = lastX + 160;
      
      // Vertical placement near the top, aligned with the price/trend indicator area
      const baseY = 70;
      // Bullish points UP (smaller Y), Bearish points DOWN (larger Y)
      const startY = isUp ? baseY + 40 : baseY - 40;
      const endY = isUp ? baseY - 40 : baseY + 40;

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
  const glowColor = isUp ? 'rgba(0, 255, 204, 0.4)' : 'rgba(255, 51, 102, 0.4)';

  // Arrowhead math
  const angle = Math.atan2(endY - startY, endX - startX);
  const headSize = 22; // Slightly larger head
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
        style={{ filter: 'drop-shadow(0 0 15px ' + glowColor + ')' }}
      >
        <defs>
          <linearGradient id={`grad-${direction}`} x1="0%" y1="100%" x2="0%" y2="0%">
            {/* Gradient from bottom to top as requested */}
            <stop offset="0%" stopColor={accentColor} stopOpacity="0.05" />
            <stop offset="100%" stopColor={accentColor} stopOpacity="0.5" />
          </linearGradient>
        </defs>

        {/* The Arrow Line */}
        <line
          x1={startX}
          y1={startY}
          x2={endX}
          y2={endY}
          stroke={`url(#grad-${direction})`}
          strokeWidth="10" 
          strokeLinecap="round"
          className="animate-pulse"
        />

        {/* The Arrow Head */}
        <path
          d={`M ${endX} ${endY} L ${x1} ${y1} L ${x2} ${y2} Z`}
          fill={accentColor}
          fillOpacity="0.5"
          className="animate-pulse"
        />

        {/* Label near the end of the arrow - also semi-transparent */}
        <foreignObject x={endX + 10} y={endY - 15} width="160" height="45">
          <div className="flex items-center gap-2 opacity-80">
            <div 
              className="rounded-full px-2 py-1 text-[11px] font-black italic tracking-tighter text-white shadow-xl backdrop-blur-md"
              style={{ 
                background: `linear-gradient(90deg, ${accentColor}CC 0%, rgba(0,0,0,0.6) 100%)`,
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
