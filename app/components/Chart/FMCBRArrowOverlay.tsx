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
  tpLines: { y: number; label: string; price: number }[];
  direction: 'BULLISH' | 'BEARISH';
}

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
      
      // Calculate Y coordinates for signals
      const startY = candleSeries.priceToCoordinate(signal.setup) ?? 100;
      
      // Get TP and Entry levels for localized rendering
      const targetLevels = signal.levels.filter(l => l.type === 'tp' || l.type === 'entry');
      const tp3 = signal.levels.find(l => l.label.includes('Complete Cycle'));
      const endY = tp3 ? (candleSeries.priceToCoordinate(tp3.price) ?? startY + 100) : startY + 100;

      // Localized lines to render
      const tpLines = targetLevels.map(l => ({
        y: candleSeries.priceToCoordinate(l.price) ?? 0,
        label: l.label,
        price: l.price
      }));

      setLayout({
        startX: lastX + 30,
        startY,
        endX: lastX + 150,
        endY,
        tpLines,
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

  if (!layout) return null;

  const { startX, startY, endX, endY, direction, tpLines } = layout;
  const isUp = direction === 'BULLISH';
  const accentColor = isUp ? '#00ffcc' : '#ff3366';
  const glowColor = isUp ? 'rgba(0, 255, 204, 0.4)' : 'rgba(255, 51, 102, 0.4)';

  // Arrowhead math
  const angle = Math.atan2(endY - startY, endX - startX);
  const headSize = 18;
  const hx1 = endX - headSize * Math.cos(angle - Math.PI / 6);
  const hy1 = endY - headSize * Math.sin(angle - Math.PI / 6);
  const hx2 = endX - headSize * Math.cos(angle + Math.PI / 6);
  const hy2 = endY - headSize * Math.sin(angle + Math.PI / 6);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <svg width="100%" height="100%" className="absolute inset-0 overflow-visible">
        <defs>
          <linearGradient id={`fmcbr-grad-${direction}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={accentColor} stopOpacity="0.8" />
            <stop offset="100%" stopColor={accentColor} stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* ─── Localized TP & Entry Lines (Kept within the active zone) ─── */}
        {layout.tpLines.map((line, i) => (
          <g key={i}>
            <line
              x1={startX - 5}
              y1={line.y}
              x2={startX + 240}
              y2={line.y}
              stroke={accentColor}
              strokeWidth="1.5"
              strokeDasharray="4,4"
              opacity="0.6"
            />
            <text
              x={startX + 140}
              y={line.y - 4}
              fill={accentColor}
              fontSize="10"
              fontWeight="900"
              className="italic tracking-tighter"
              style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }}
            >
              {line.label}: ${line.price.toFixed(2)}
            </text>
          </g>
        ))}

        {/* ─── Bended Diagonal Path (Curved towards signal box) ─── */}
        <path
          d={`M ${startX} ${startY} Q ${startX + (endX - startX) * 0.1} ${startY + (endY - startY) * 0.95}, ${endX} ${endY}`}
          stroke={`url(#fmcbr-grad-${direction})`}
          strokeWidth="8"
          strokeLinecap="round"
          fill="none"
          opacity="0.75"
          style={{ filter: `drop-shadow(0 0 15px ${glowColor})` }}
        />
        <path
          d={`M ${endX} ${endY} L ${hx1} ${hy1} L ${hx2} ${hy2} Z`}
          fill={accentColor}
          opacity="1"
          style={{ filter: `drop-shadow(0 0 12px ${glowColor})` }}
        />

        {/* ─── Structure Break Circle (Semafor-like) ─── */}
        <circle
          cx={startX}
          cy={startY}
          r="12"
          fill="rgba(0,0,0,0.8)"
          stroke={accentColor}
          strokeWidth="2"
        />
        <path
          d={isUp ? `M ${startX} ${startY + 6} L ${startX} ${startY - 6} M ${startX - 4} ${startY - 2} L ${startX} ${startY - 6} L ${startX + 4} ${startY - 2}` : `M ${startX} ${startY - 6} L ${startX} ${startY + 6} M ${startX - 4} ${startY + 2} L ${startX} ${startY + 6} L ${startX + 4} ${startY + 2}`}
          stroke="white"
          strokeWidth="2"
          fill="none"
        />

        {/* ─── Signal Label at Start (Shifted Right to avoid candles) ─── */}
        <foreignObject x={startX + 20} y={startY - 40} width="160" height="100">
          <div 
            className="rounded-lg px-2.5 py-1.5 text-[11px] font-black italic tracking-tighter text-white shadow-2xl backdrop-blur-xl border border-white/20"
            style={{ 
              background: `linear-gradient(135deg, ${accentColor}CC 0%, rgba(10,10,10,0.9) 100%)`,
              boxShadow: `0 4px 20px rgba(0,0,0,0.5), inset 0 0 10px rgba(255,255,255,0.05)`
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="whitespace-nowrap">FMCBR {direction}</span>
              <span className="text-[7px] bg-white/20 px-1 rounded opacity-50">V3.0</span>
            </div>
            <div className="text-[8px] font-bold opacity-70 mt-0.5 leading-tight">
              {signal.status === 'READY' ? `Confirmed ${signal.breakType}` : 'Waiting for CB1...'}
            </div>
          </div>
        </foreignObject>
      </svg>
    </div>
  );
}
