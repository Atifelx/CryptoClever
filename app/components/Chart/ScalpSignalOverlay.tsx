'use client';

import type { ScalpDisplayItem } from '../../lib/indicators/scalpSignal';
import type { TrendMarker } from '../../lib/indicators/trendIndicator';

interface ScalpSignalOverlayProps {
  scalpSignals: ScalpDisplayItem[];
  trendMarker: TrendMarker | null;
  showScalp: boolean;
}

/**
 * Scalp Signal Overlay
 * Displays white circle below Trend Indicator arrow with pulsing glow animation
 */
export default function ScalpSignalOverlay({
  scalpSignals,
  trendMarker,
  showScalp,
}: ScalpSignalOverlayProps) {
  // Only show if Scalp is enabled and we have a signal
  if (!showScalp || !scalpSignals || scalpSignals.length === 0) {
    return null;
  }

  // Find the latest signal (LONG or SHORT, not WAIT)
  const latestSignal = scalpSignals
    .filter(item => item.signal === 'LONG' || item.signal === 'SHORT')
    .slice(-1)[0];

  if (!latestSignal || latestSignal.signal === 'WAIT') {
    return null;
  }

  const isLong = latestSignal.signal === 'LONG';
  const rsiText = latestSignal.rsi != null ? `RSI: ${latestSignal.rsi.toFixed(0)}` : '';
  const tp2Text = `TP2: ${latestSignal.takeProfit2.toFixed(0)}`;
  const slText = `SL: ${latestSignal.stopLoss.toFixed(0)}`;
  const label = `Scalp ${latestSignal.signal}${rsiText ? ` | ${rsiText}` : ''} | ${tp2Text} | ${slText}`;

  // Position inside chart area: below Trend Indicator arrow (top-16) or at top if no trend indicator
  // Use percentage-based positioning to stay within chart bounds
  const topPosition = trendMarker ? 'top-[60px]' : 'top-2';

  return (
    <div className={`absolute ${topPosition} left-1/2 transform -translate-x-1/2 z-20 pointer-events-none`}>
      {/* White Circle with Pulsing Glow Animation */}
      <div className="flex flex-col items-center gap-2">
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
        <div className="px-3 py-1 rounded bg-black/80 backdrop-blur-sm border border-white/20">
          <span className="text-xs font-semibold text-white whitespace-nowrap">
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}
