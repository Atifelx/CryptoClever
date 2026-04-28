'use client';

import { RefObject, useEffect, useState } from 'react';
import { ISeriesApi, IChartApi } from 'lightweight-charts';

interface TradingZone {
  type: 'BUY' | 'SELL';
  entryPrice: number;
  profitTarget: number;
  stopLoss: number;
  confidence: number;
  reasoning: string;
  time: number;
}

interface SupportResistance {
  supportLevels: number[];
  resistanceLevels: number[];
  lastSwingLow?: number | null;
  lastSwingHigh?: number | null;
}

interface CoreEngineOverlayProps {
  chart: IChartApi | null;
  candleSeries: ISeriesApi<'Candlestick'> | null;
  containerRef: RefObject<HTMLDivElement>;
  zone: TradingZone | null;
  supportResistance?: SupportResistance | null;
  prediction?: {
    direction: 'BUY' | 'SELL';
    tradeStyle: 'SCALP' | 'HOLD';
  } | null;
}

interface OverlayLayout {
  entryY: number;
  supportY: number;
  resistanceY: number;
}

export default function CoreEngineOverlay({
  chart,
  candleSeries,
  containerRef,
  zone,
  supportResistance,
  prediction,
}: CoreEngineOverlayProps) {
  const [layout, setLayout] = useState<OverlayLayout | null>(null);

  useEffect(() => {
    if (!chart || !candleSeries || !containerRef.current || !zone) {
      setLayout(null);
      return;
    }

    const updateLayout = () => {
      const entryY = candleSeries.priceToCoordinate(zone.entryPrice);
      const supportPrice = supportResistance?.lastSwingLow ?? zone.stopLoss;
      const resistancePrice = supportResistance?.lastSwingHigh ?? zone.profitTarget;
      const supportY = candleSeries.priceToCoordinate(supportPrice);
      const resistanceY = candleSeries.priceToCoordinate(resistancePrice);

      if (
        entryY === null ||
        supportY === null ||
        resistanceY === null ||
        Number.isNaN(entryY) ||
        Number.isNaN(supportY) ||
        Number.isNaN(resistanceY)
      ) {
        setLayout(null);
        return;
      }

      setLayout({
        entryY,
        supportY,
        resistanceY,
      });
    };

    updateLayout();
    const interval = window.setInterval(updateLayout, 250);
    const onResize = () => updateLayout();
    window.addEventListener('resize', onResize);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('resize', onResize);
    };
  }, [chart, candleSeries, containerRef, zone, supportResistance, prediction]);

  if (!zone || !layout) {
    return null;
  }

  const direction = prediction?.direction ?? zone.type;
  const lineWidth = 132;
  const labelRight = 12;
  const lineRight = 104;
  const arrowRight = 250;
  const supportPrice = supportResistance?.lastSwingLow ?? zone.stopLoss;
  const resistancePrice = supportResistance?.lastSwingHigh ?? zone.profitTarget;

  const shortLines = [
    {
      key: 'resistance',
      y: layout.resistanceY,
      color: 'rgba(255, 120, 120, 0.9)',
      label: `R ${resistancePrice.toFixed(2)}`,
    },
    {
      key: 'support',
      y: layout.supportY,
      color: 'rgba(80, 220, 160, 0.9)',
      label: `S ${supportPrice.toFixed(2)}`,
    },
  ];

  const arrowClass = direction === 'BUY'
    ? 'border-l-[7px] border-r-[7px] border-b-[12px] border-l-transparent border-r-transparent border-b-yellow-400'
    : 'border-l-[7px] border-r-[7px] border-t-[12px] border-l-transparent border-r-transparent border-t-yellow-400';

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {shortLines.map((line) => (
        <div key={line.key}>
          <div
            className="absolute rounded-full"
            style={{
              top: `${line.y}px`,
              right: `${lineRight}px`,
              width: `${lineWidth}px`,
              height: '2px',
              backgroundColor: line.color,
              transform: 'translateY(-1px)',
              boxShadow: `0 0 12px ${line.color}`,
            }}
          />
          <div
            className="absolute rounded-md border border-gray-700/80 bg-[#101010]/90 px-2 py-0.5 text-[10px] font-semibold text-gray-200"
            style={{
              top: `${line.y}px`,
              right: `${labelRight}px`,
              transform: 'translateY(-50%)',
            }}
          >
            {line.label}
          </div>
        </div>
      ))}

      <div
        className="absolute flex items-center gap-2"
        style={{
          top: `${layout.entryY}px`,
          right: `${arrowRight}px`,
          transform: 'translateY(-50%)',
        }}
      >
        <div className={arrowClass} />
        <div className="rounded-full border border-yellow-500/40 bg-[#111]/85 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-yellow-300">
          {direction}
        </div>
      </div>
    </div>
  );
}
