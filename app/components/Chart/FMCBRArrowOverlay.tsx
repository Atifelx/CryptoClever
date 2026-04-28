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
  x: number;
  yStart: number;
  yEnd: number;
  direction: 'BULLISH' | 'BEARISH';
}

/**
 * FMCBR Arrow Overlay
 * Renders a large, glowing, transparent arrow indicating momentum and target range.
 * Replaces the cluttered horizontal Fibonacci lines.
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

    if (!signal.direction || (signal.status !== 'READY' && signal.status !== 'WAITING_RETEST')) {
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

      const x = timeScale.timeToCoordinate(signalTime as Time);
      
      // Calculate vertical range: from Base to TP3 Extended
      const baseLevel = signal.base;
      const tp3ExtLevel = signal.levels.find(l => l.level === 'TP3 Extended')?.price || signal.levels.find(l => l.type === 'tp')?.price || signal.base;
      
      const yStart = candleSeries.priceToCoordinate(baseLevel);
      const yEnd = candleSeries.priceToCoordinate(tp3ExtLevel);

      if (
        x === null ||
        yStart === null ||
        yEnd === null ||
        Number.isNaN(x) ||
        Number.isNaN(yStart) ||
        Number.isNaN(yEnd)
      ) {
        setLayout(null);
        return;
      }

      setLayout({
        x,
        yStart,
        yEnd,
        direction: signal.direction as 'BULLISH' | 'BEARISH',
      });
    };

    updateLayout();
    
    // Update more frequently to keep up with pan/zoom
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

  const isUp = layout.direction === 'BULLISH';
  const height = Math.abs(layout.yStart - layout.yEnd);
  const arrowWidth = 40;
  const glowColor = isUp ? 'rgba(0, 255, 102, 0.4)' : 'rgba(255, 34, 34, 0.4)';
  const mainColor = isUp ? 'rgba(0, 255, 102, 0.25)' : 'rgba(255, 34, 34, 0.25)';
  const accentColor = isUp ? '#00ff66' : '#ff2222';

  // Position arrow slightly to the left of the signal candle if it's too close to the right edge
  // but usually we just center it on the candle time.
  const leftPos = layout.x - (arrowWidth / 2);
  const topPos = Math.min(layout.yStart, layout.yEnd);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <div
        className="absolute transition-all duration-300 ease-out"
        style={{
          left: `${leftPos}px`,
          top: `${topPos}px`,
          width: `${arrowWidth}px`,
          height: `${height}px`,
        }}
      >
        {/* The Arrow SVG */}
        <svg
          width={arrowWidth}
          height={height}
          viewBox={`0 0 ${arrowWidth} ${height}`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="animate-pulse"
        >
          <defs>
            <linearGradient id={`arrowGradient-${layout.direction}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={isUp ? accentColor : mainColor} stopOpacity={isUp ? 0.8 : 0.4} />
              <stop offset="100%" stopColor={isUp ? mainColor : accentColor} stopOpacity={isUp ? 0.4 : 0.8} />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="4" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          
          {/* Arrow Body */}
          {isUp ? (
            <path
              d={`M ${arrowWidth/2} 0 L ${arrowWidth} ${arrowWidth/2} L ${arrowWidth*0.75} ${arrowWidth/2} L ${arrowWidth*0.75} ${height} L ${arrowWidth*0.25} ${height} L ${arrowWidth*0.25} ${arrowWidth/2} L 0 ${arrowWidth/2} Z`}
              fill={`url(#arrowGradient-${layout.direction})`}
              filter="url(#glow)"
              style={{ opacity: 0.7 }}
            />
          ) : (
            <path
              d={`M ${arrowWidth*0.25} 0 L ${arrowWidth*0.75} 0 L ${arrowWidth*0.75} ${height - arrowWidth/2} L ${arrowWidth} ${height - arrowWidth/2} L ${arrowWidth/2} ${height} L 0 ${height - arrowWidth/2} L ${arrowWidth*0.25} ${height - arrowWidth/2} Z`}
              fill={`url(#arrowGradient-${layout.direction})`}
              filter="url(#glow)"
              style={{ opacity: 0.7 }}
            />
          )}
        </svg>
        
        {/* Label near the arrow tip */}
        <div 
          className="absolute whitespace-nowrap rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm"
          style={{
            [isUp ? 'top' : 'bottom']: '-20px',
            left: '50%',
            transform: 'translateX(-50%)',
            border: `1px solid ${accentColor}44`,
          }}
        >
          FMCBR {isUp ? 'BULLISH' : 'BEARISH'}
        </div>
      </div>
    </div>
  );
}
