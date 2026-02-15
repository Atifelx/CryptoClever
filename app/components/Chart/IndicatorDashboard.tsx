'use client';

import { SemaforPoint } from '../../lib/indicators/types';
import type { SemaforTrend } from '../../lib/indicators/semafor';
import { PatternSignal } from '../../lib/indicators/patternRecognition';

interface IndicatorDashboardProps {
  enabledIndicators: Set<string>;
  semaforPoints: SemaforPoint[];
  semaforTrend: SemaforTrend;
  patternSignals: PatternSignal[];
}

export default function IndicatorDashboard({
  enabledIndicators,
  semaforPoints,
  semaforTrend,
  patternSignals,
}: IndicatorDashboardProps) {
  const isEnabled = (id: string) => enabledIndicators.has(id);

  return (
    <div className="flex gap-2 flex-wrap">
      {isEnabled('semafor') && (
        <div className="bg-[#1a1a1a] border border-gray-800 rounded px-3 py-1.5 flex items-center gap-2">
          <span className="text-white font-semibold text-xs">Semafor</span>
          <span className="px-1.5 py-0.5 bg-teal-600/20 text-teal-500 text-[10px] rounded">ON</span>
          <span className={`px-1.5 py-0.5 text-[10px] rounded font-semibold ${
            semaforTrend.trend === 'BULL' ? 'bg-green-600/20 text-green-400' :
            semaforTrend.trend === 'BEAR' ? 'bg-red-600/20 text-red-400' :
            'bg-gray-600/20 text-gray-400'
          }`}>
            {semaforTrend.trend === 'BULL' ? '↑' : semaforTrend.trend === 'BEAR' ? '↓' : '→'}
          </span>
          <span className="text-[10px] text-gray-500">
            {semaforPoints.filter(p => !p.isLive).length} pivots
          </span>
          {semaforPoints.filter(p => p.isLive).length > 0 && (
            <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-[10px]">
              📍
            </span>
          )}
        </div>
      )}

      {isEnabled('patternRecognition') && (
        <div className="bg-[#1a1a1a] border border-gray-800 rounded px-3 py-1.5 flex items-center gap-2">
          <span className="text-white font-semibold text-xs">Pattern Recognition</span>
          <span className="px-1.5 py-0.5 bg-purple-600/20 text-purple-400 text-[10px] rounded">ON</span>
          {patternSignals.length > 0 ? (
            <>
              <span className={`text-xs font-semibold ${
                patternSignals[0].direction === 'UP' ? 'text-green-400' : 'text-red-400'
              }`}>
                {patternSignals[0].description.split(' - ')[0]}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                patternSignals[0].confidence >= 80 ? 'bg-green-600/20 text-green-400' :
                patternSignals[0].confidence >= 60 ? 'bg-yellow-600/20 text-yellow-400' :
                'bg-gray-600/20 text-gray-400'
              }`}>
                {patternSignals[0].confidence}%
              </span>
            </>
          ) : (
            <span className="text-[10px] text-gray-500">No patterns</span>
          )}
        </div>
      )}
    </div>
  );
}
