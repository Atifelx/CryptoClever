'use client';

import { HalfTrendResult, getHalfTrendSignal } from '../../lib/indicators/halfTrend';

interface HalfTrendPanelProps {
  results: HalfTrendResult[];
  currentPrice: number;
}

export default function HalfTrendPanel({ results, currentPrice }: HalfTrendPanelProps) {
  if (results.length === 0) {
    return (
      <div className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-4">
        <div className="text-sm text-gray-500">Calculating Half Trend...</div>
      </div>
    );
  }

  const latest = results[results.length - 1];
  const signal = getHalfTrendSignal(results);
  
  const trendColor = latest.trend === 'up' 
    ? 'text-green-500 bg-green-500/20' 
    : 'text-red-500 bg-red-500/20';
  
  const signalColor = signal === 'BUY'
    ? 'text-green-500 bg-green-500/20'
    : signal === 'SELL'
    ? 'text-red-500 bg-red-500/20'
    : 'text-yellow-500 bg-yellow-500/20';

  const distance = currentPrice > 0 && latest.trendLine > 0
    ? ((currentPrice - latest.trendLine) / latest.trendLine * 100)
    : 0;

  const recentSignals = results
    .filter(r => r.buySignal || r.sellSignal)
    .slice(-3)
    .reverse();

  return (
    <div className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-bold">Half Trend Indicator</h3>
        <div className={`px-3 py-1 rounded font-semibold text-sm ${trendColor}`}>
          {latest.trend.toUpperCase()} TREND
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm mb-4">
        <div>
          <div className="text-gray-500 mb-1 text-xs">Signal</div>
          <div className={`font-bold px-2 py-1 rounded inline-block text-xs ${signalColor}`}>
            {signal}
          </div>
        </div>
        
        <div>
          <div className="text-gray-500 mb-1 text-xs">Trend Line</div>
          <div className="text-white font-mono text-sm">
            ${latest.trendLine.toFixed(2)}
          </div>
        </div>
        
        <div>
          <div className="text-gray-500 mb-1 text-xs">ATR</div>
          <div className="text-white font-mono text-sm">
            ${latest.atr.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Recent signals */}
      {recentSignals.length > 0 && (
        <div className="mb-4 pt-4 border-t border-gray-800">
          <div className="text-gray-500 text-xs mb-2">Recent Signals</div>
          <div className="space-y-1">
            {recentSignals.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className={r.buySignal ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>
                  {r.buySignal ? '↑ BUY' : '↓ SELL'}
                </span>
                <span className="text-gray-400">
                  ${r.trendLine.toFixed(2)}
                </span>
                <span className="text-gray-600">
                  {new Date(r.time * 1000).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Distance from trend line */}
      <div className="pt-4 border-t border-gray-800">
        <div className="text-gray-500 text-xs mb-1">Distance from Trend Line</div>
        <div className={`font-mono text-sm ${distance >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          {distance >= 0 ? '+' : ''}{distance.toFixed(2)}%
        </div>
      </div>
    </div>
  );
}
