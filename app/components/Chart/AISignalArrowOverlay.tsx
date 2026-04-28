'use client';

import { RefObject, useEffect, useState } from 'react';
import { ISeriesApi, IChartApi } from 'lightweight-charts';

interface TradeSetup {
  direction: 'BUY' | 'SELL';
  entry: number;
  target: number;
  stop: number;
  expectedDuration: string;
  reasoning: string;
  confidence: number;
}

interface AISignalArrowOverlayProps {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<'Candlestick'> | null;
  containerRef: RefObject<HTMLDivElement>;
  scalpTrade: TradeSetup | null;
  longTrade: TradeSetup | null;
  visible: boolean;
}

interface ArrowLayout {
  // Scalp trade coordinates
  scalpEntryY: number;
  scalpTargetY: number;
  scalpStopY: number;
  // Long trade coordinates
  longEntryY: number;
  longTargetY: number;
  longStopY: number;
}

export default function AISignalArrowOverlay({
  chart,
  candleSeries,
  containerRef,
  scalpTrade,
  longTrade,
  visible,
}: AISignalArrowOverlayProps) {
  const [layout, setLayout] = useState<ArrowLayout | null>(null);

  useEffect(() => {
    if (!chart || !candleSeries || !containerRef.current || !visible || (!scalpTrade && !longTrade)) {
      setLayout(null);
      return;
    }

    const updateLayout = () => {
      try {
        const newLayout: Partial<ArrowLayout> = {};

        if (scalpTrade) {
          const ey = candleSeries.priceToCoordinate(scalpTrade.entry);
          const ty = candleSeries.priceToCoordinate(scalpTrade.target);
          const sy = candleSeries.priceToCoordinate(scalpTrade.stop);
          if (ey !== null && ty !== null && sy !== null) {
            newLayout.scalpEntryY = ey;
            newLayout.scalpTargetY = ty;
            newLayout.scalpStopY = sy;
          }
        }

        if (longTrade) {
          const ey = candleSeries.priceToCoordinate(longTrade.entry);
          const ty = candleSeries.priceToCoordinate(longTrade.target);
          const sy = candleSeries.priceToCoordinate(longTrade.stop);
          if (ey !== null && ty !== null && sy !== null) {
            newLayout.longEntryY = ey;
            newLayout.longTargetY = ty;
            newLayout.longStopY = sy;
          }
        }

        // Only set layout if we have at least one complete set
        if (
          (newLayout.scalpEntryY !== undefined) ||
          (newLayout.longEntryY !== undefined)
        ) {
          setLayout(newLayout as ArrowLayout);
        } else {
          setLayout(null);
        }
      } catch {
        setLayout(null);
      }
    };

    updateLayout();
    const interval = window.setInterval(updateLayout, 300);
    const onResize = () => updateLayout();
    window.addEventListener('resize', onResize);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('resize', onResize);
    };
  }, [chart, candleSeries, containerRef, scalpTrade, longTrade, visible]);

  if (!visible || !layout || (!scalpTrade && !longTrade)) {
    return null;
  }

  // Scalp arrows on the left side, Long arrows further left
  const scalpX = 60; // px from right edge
  const longX = 30;  // px from right edge

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* ─── Scalp Trade Arrow ─── */}
      {scalpTrade && layout.scalpEntryY !== undefined && layout.scalpTargetY !== undefined && layout.scalpStopY !== undefined && (
        <>
          {/* Scalp: vertical range bar (entry to target) */}
          <div
            className="absolute rounded-sm"
            style={{
              right: `${scalpX}px`,
              top: `${Math.min(layout.scalpEntryY, layout.scalpTargetY)}px`,
              width: '4px',
              height: `${Math.abs(layout.scalpTargetY - layout.scalpEntryY)}px`,
              background: scalpTrade.direction === 'BUY'
                ? 'linear-gradient(to top, rgba(38, 166, 154, 0.3), rgba(38, 166, 154, 0.8))'
                : 'linear-gradient(to bottom, rgba(239, 83, 80, 0.3), rgba(239, 83, 80, 0.8))',
              boxShadow: scalpTrade.direction === 'BUY'
                ? '0 0 8px rgba(38, 166, 154, 0.4)'
                : '0 0 8px rgba(239, 83, 80, 0.4)',
            }}
          />

          {/* Scalp: stop loss dash */}
          <div
            className="absolute"
            style={{
              right: `${scalpX - 6}px`,
              top: `${layout.scalpStopY}px`,
              width: '16px',
              height: '2px',
              backgroundColor: 'rgba(239, 83, 80, 0.7)',
              transform: 'translateY(-1px)',
            }}
          />

          {/* Scalp: arrow head at target */}
          <div
            className="absolute"
            style={{
              right: `${scalpX - 4}px`,
              top: `${layout.scalpTargetY}px`,
              transform: scalpTrade.direction === 'BUY' ? 'translateY(-100%)' : 'translateY(0)',
            }}
          >
            <div
              style={{
                width: 0,
                height: 0,
                borderLeft: '6px solid transparent',
                borderRight: '6px solid transparent',
                ...(scalpTrade.direction === 'BUY'
                  ? { borderBottom: '10px solid rgba(38, 166, 154, 0.9)' }
                  : { borderTop: '10px solid rgba(239, 83, 80, 0.9)' }),
              }}
            />
          </div>

          {/* Scalp: entry dot */}
          <div
            className="absolute rounded-full"
            style={{
              right: `${scalpX - 2}px`,
              top: `${layout.scalpEntryY}px`,
              width: '8px',
              height: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.8)',
              transform: 'translate(0, -50%)',
              boxShadow: '0 0 6px rgba(255, 255, 255, 0.4)',
            }}
          />

          {/* Scalp: label */}
          <div
            className="absolute text-[9px] font-bold tracking-wider uppercase"
            style={{
              right: `${scalpX + 10}px`,
              top: `${Math.min(layout.scalpEntryY, layout.scalpTargetY) + Math.abs(layout.scalpTargetY - layout.scalpEntryY) / 2}px`,
              transform: 'translateY(-50%) rotate(-90deg)',
              transformOrigin: 'center center',
              color: scalpTrade.direction === 'BUY' ? 'rgba(38, 166, 154, 0.7)' : 'rgba(239, 83, 80, 0.7)',
              whiteSpace: 'nowrap',
            }}
          >
            SCALP
          </div>
        </>
      )}

      {/* ─── Long Trade Arrow ─── */}
      {longTrade && layout.longEntryY !== undefined && layout.longTargetY !== undefined && layout.longStopY !== undefined && (
        <>
          {/* Long: vertical range bar (entry to target) */}
          <div
            className="absolute rounded-sm"
            style={{
              right: `${longX}px`,
              top: `${Math.min(layout.longEntryY, layout.longTargetY)}px`,
              width: '6px',
              height: `${Math.abs(layout.longTargetY - layout.longEntryY)}px`,
              background: longTrade.direction === 'BUY'
                ? 'linear-gradient(to top, rgba(38, 166, 154, 0.2), rgba(38, 166, 154, 0.6))'
                : 'linear-gradient(to bottom, rgba(239, 83, 80, 0.2), rgba(239, 83, 80, 0.6))',
              boxShadow: longTrade.direction === 'BUY'
                ? '0 0 12px rgba(38, 166, 154, 0.3)'
                : '0 0 12px rgba(239, 83, 80, 0.3)',
            }}
          />

          {/* Long: stop loss dash */}
          <div
            className="absolute"
            style={{
              right: `${longX - 8}px`,
              top: `${layout.longStopY}px`,
              width: '22px',
              height: '2px',
              backgroundColor: 'rgba(239, 83, 80, 0.5)',
              transform: 'translateY(-1px)',
              borderStyle: 'dashed',
            }}
          />

          {/* Long: arrow head at target */}
          <div
            className="absolute"
            style={{
              right: `${longX - 5}px`,
              top: `${layout.longTargetY}px`,
              transform: longTrade.direction === 'BUY' ? 'translateY(-100%)' : 'translateY(0)',
            }}
          >
            <div
              style={{
                width: 0,
                height: 0,
                borderLeft: '8px solid transparent',
                borderRight: '8px solid transparent',
                ...(longTrade.direction === 'BUY'
                  ? { borderBottom: '14px solid rgba(38, 166, 154, 0.7)' }
                  : { borderTop: '14px solid rgba(239, 83, 80, 0.7)' }),
              }}
            />
          </div>

          {/* Long: entry dot */}
          <div
            className="absolute rounded-full"
            style={{
              right: `${longX - 3}px`,
              top: `${layout.longEntryY}px`,
              width: '10px',
              height: '10px',
              backgroundColor: 'rgba(255, 255, 255, 0.6)',
              border: '2px solid rgba(255, 255, 255, 0.3)',
              transform: 'translate(0, -50%)',
              boxShadow: '0 0 8px rgba(255, 255, 255, 0.3)',
            }}
          />

          {/* Long: label */}
          <div
            className="absolute text-[9px] font-bold tracking-wider uppercase"
            style={{
              right: `${longX + 12}px`,
              top: `${Math.min(layout.longEntryY, layout.longTargetY) + Math.abs(layout.longTargetY - layout.longEntryY) / 2}px`,
              transform: 'translateY(-50%) rotate(-90deg)',
              transformOrigin: 'center center',
              color: longTrade.direction === 'BUY' ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
              whiteSpace: 'nowrap',
            }}
          >
            LONG
          </div>
        </>
      )}

      {/* ─── Target Price Labels (right edge) ─── */}
      {scalpTrade && layout.scalpTargetY !== undefined && (
        <div
          className="absolute rounded-sm px-1.5 py-0.5 text-[9px] font-mono font-semibold"
          style={{
            right: '2px',
            top: `${layout.scalpTargetY}px`,
            transform: 'translateY(-50%)',
            backgroundColor: scalpTrade.direction === 'BUY' ? 'rgba(38, 166, 154, 0.15)' : 'rgba(239, 83, 80, 0.15)',
            color: scalpTrade.direction === 'BUY' ? 'rgba(38, 166, 154, 0.9)' : 'rgba(239, 83, 80, 0.9)',
            border: `1px solid ${scalpTrade.direction === 'BUY' ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)'}`,
          }}
        >
          S {scalpTrade.target > 100 ? scalpTrade.target.toFixed(0) : scalpTrade.target.toFixed(2)}
        </div>
      )}
      {longTrade && layout.longTargetY !== undefined && (
        <div
          className="absolute rounded-sm px-1.5 py-0.5 text-[9px] font-mono font-semibold"
          style={{
            right: '2px',
            top: `${layout.longTargetY}px`,
            transform: 'translateY(-50%)',
            backgroundColor: longTrade.direction === 'BUY' ? 'rgba(38, 166, 154, 0.1)' : 'rgba(239, 83, 80, 0.1)',
            color: longTrade.direction === 'BUY' ? 'rgba(38, 166, 154, 0.7)' : 'rgba(239, 83, 80, 0.7)',
            border: `1px solid ${longTrade.direction === 'BUY' ? 'rgba(38, 166, 154, 0.2)' : 'rgba(239, 83, 80, 0.2)'}`,
          }}
        >
          L {longTrade.target > 100 ? longTrade.target.toFixed(0) : longTrade.target.toFixed(2)}
        </div>
      )}
    </div>
  );
}
