'use client';

import type { TrendMarker } from '../../lib/indicators/trendIndicator';
import type { ScalpDisplayItem } from '../../lib/indicators/scalpSignal';

interface TrendIndicatorOverlayProps {
  trendMarker: TrendMarker | null;
  showTrend: boolean;
  scalpSignals?: ScalpDisplayItem[];
  showScalp?: boolean;
}

/**
 * Trend Indicator Overlay
 * Displays trend indicator at the top of the chart with prominent arrow graphics
 */
export default function TrendIndicatorOverlay({
  trendMarker,
  showTrend,
  scalpSignals,
  showScalp,
}: TrendIndicatorOverlayProps) {
  if (!showTrend || !trendMarker) {
    return null;
  }

  // Find latest Scalp Signal (LONG or SHORT) for white circle
  const latestScalpSignal = showScalp && scalpSignals && scalpSignals.length > 0
    ? scalpSignals.filter(item => item.signal === 'LONG' || item.signal === 'SHORT').slice(-1)[0]
    : null;

  const { trend, action, confidence } = trendMarker;

  // Determine colors and arrow direction
  let bgColor: string;
  let arrowColor: string;
  let arrowDirection: 'up' | 'down';
  let trendText: string;

  if (trend === 'UPTREND' && action === 'BUY_ALLOWED') {
    bgColor = 'bg-green-500/20';
    arrowColor = '#00ff66';
    arrowDirection = 'up';
    trendText = 'UPTREND';
  } else if (trend === 'DOWNTREND') {
    bgColor = 'bg-red-500/20';
    arrowColor = '#ff2222';
    arrowDirection = 'down';
    trendText = 'DOWNTREND';
  } else {
    bgColor = 'bg-orange-500/20';
    arrowColor = '#ffaa00';
    arrowDirection = 'up';
    trendText = 'SIDEWAYS';
  }

  return (
    <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-30 pointer-events-none">
      <div className="flex flex-col items-center gap-2">
        {/* Trend Indicator Box */}
        <div className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${bgColor} border-opacity-30 backdrop-blur-sm`}>
          {/* Prominent Arrow */}
          {arrowDirection === 'up' ? (
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="animate-pulse"
            >
              <path
                d="M12 4L12 20M12 4L6 10M12 4L18 10"
                stroke={arrowColor}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="animate-pulse"
            >
              <path
                d="M12 20L12 4M12 20L6 14M12 20L18 14"
                stroke={arrowColor}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          
          {/* Trend Text */}
          <div className="flex flex-col">
            <span className="text-sm font-bold" style={{ color: arrowColor }}>
              {trendText}
            </span>
            <span className="text-xs opacity-75" style={{ color: arrowColor }}>
              {confidence}% Confidence
            </span>
          </div>
        </div>

        {/* White Circle at Tail/End of Arrow - Moves with arrow */}
        {latestScalpSignal && (
          <div className="flex flex-col items-center gap-1 mt-1">
            {/* Pulsing White Circle - positioned at tail/end of arrow */}
            <div className="relative">
              {/* Outer glow ring (pulsing) */}
              <div 
                className="absolute inset-0 rounded-full animate-ping"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.3)',
                  width: '24px',
                  height: '24px',
                  margin: '-4px',
                }}
              />
              {/* Middle glow ring */}
              <div 
                className="absolute inset-0 rounded-full"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.5)',
                  width: '20px',
                  height: '20px',
                  margin: '-2px',
                  boxShadow: '0 0 10px rgba(255, 255, 255, 0.8), 0 0 20px rgba(255, 255, 255, 0.4)',
                }}
              />
              {/* Inner white circle */}
              <div 
                className="relative rounded-full bg-white"
                style={{
                  width: '16px',
                  height: '16px',
                  boxShadow: '0 0 8px rgba(255, 255, 255, 1), 0 0 16px rgba(255, 255, 255, 0.6)',
                }}
              />
            </div>
            
            {/* Signal Label */}
            {latestScalpSignal.signal === 'LONG' || latestScalpSignal.signal === 'SHORT' ? (
              <div className="px-3 py-1 rounded bg-black/80 backdrop-blur-sm border border-white/20">
                <span className="text-xs font-semibold text-white whitespace-nowrap">
                  {latestScalpSignal.signal === 'LONG' || latestScalpSignal.signal === 'SHORT' ? (
                    <>
                      Scalp {latestScalpSignal.signal}
                      {latestScalpSignal.rsi != null ? ` | RSI: ${latestScalpSignal.rsi.toFixed(0)}` : ''}
                      {` | TP2: ${latestScalpSignal.takeProfit2.toFixed(0)}`}
                      {` | SL: ${latestScalpSignal.stopLoss.toFixed(0)}`}
                    </>
                  ) : latestScalpSignal.reason}
                </span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
