'use client';

import { useState } from 'react';
import IndicatorManager from './IndicatorManager';
import { INDICATOR_REGISTRY } from '../../lib/indicators/registry';

interface IndicatorSelectorProps {
  enabledIndicators: Set<string>;
  onToggleIndicator: (id: string, enabled: boolean) => void;
}

export default function IndicatorSelector({
  enabledIndicators,
  onToggleIndicator,
}: IndicatorSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const enabledCount = enabledIndicators.size;

  // Get enabled indicator names for display
  const enabledNames = Array.from(enabledIndicators)
    .map(id => INDICATOR_REGISTRY[id]?.name)
    .filter(Boolean)
    .slice(0, 2);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 bg-[#2a2a2a] hover:bg-[#3a3a3a] text-white rounded-lg transition-all flex items-center gap-2 border border-gray-700 hover:border-[#26a69a]/50 group"
        title="Add indicators to chart"
      >
        <svg 
          className="w-5 h-5 text-gray-400 group-hover:text-[#26a69a] transition-colors" 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <span className="font-medium">Indicators</span>
        {enabledCount > 0 && (
          <span className="px-2 py-0.5 bg-[#26a69a] text-white text-xs rounded-full font-semibold min-w-[20px] text-center">
            {enabledCount}
          </span>
        )}
      </button>

      {isOpen && (
        <IndicatorManager
          enabledIndicators={enabledIndicators}
          onToggleIndicator={onToggleIndicator}
          onClose={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
