'use client';

import type { TrendMarker } from '../../lib/indicators/trendIndicator';

interface TrendIndicatorOverlayProps {
  trendMarker: TrendMarker | null;
  showTrend: boolean;
}

/**
 * Trend Indicator Overlay
 * Displays trend indicator at the top of the chart with prominent arrow graphics
 */
export default function TrendIndicatorOverlay({
  trendMarker,
  showTrend,
}: TrendIndicatorOverlayProps) {
  if (!showTrend || !trendMarker) {
    return null;
  }

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
    </div>
  );
}
