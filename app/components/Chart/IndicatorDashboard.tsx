'use client';

import { SemaforPoint } from '../../lib/indicators/types';
import type { SemaforTrend } from '../../lib/indicators/semafor';

interface IndicatorDashboardProps {
  enabledIndicators: Set<string>;
  semaforPoints: SemaforPoint[];
  semaforTrend: SemaforTrend;
}

export default function IndicatorDashboard({
  enabledIndicators,
  semaforPoints,
  semaforTrend,
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
    </div>
  );
}
