'use client';

import { useTradingStore, TIMEFRAMES } from '../../store/tradingStore';
import IndicatorSelector from '../Indicators/IndicatorSelector';
import LiveAnalysisToggle from './LiveAnalysisToggle';

interface TimeframeSelectorProps {
  enabledIndicators: Set<string>;
  onToggleIndicator: (id: string, enabled: boolean) => void;
}

export default function TimeframeSelector({
  enabledIndicators,
  onToggleIndicator,
}: TimeframeSelectorProps) {
  const { selectedTimeframe, setSelectedTimeframe } = useTradingStore();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-2">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setSelectedTimeframe(tf.value)}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                selectedTimeframe === tf.value
                  ? 'bg-[#26a69a] text-white'
                  : 'bg-[#1a1a1a] text-gray-300 hover:bg-[#2a2a2a]'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
        
        <IndicatorSelector
          enabledIndicators={enabledIndicators}
          onToggleIndicator={onToggleIndicator}
        />
      </div>
      
      {/* Live Analysis Toggle */}
      <div className="flex items-center justify-end">
        <LiveAnalysisToggle />
      </div>
    </div>
  );
}
