'use client';

import IndicatorSelector from '../Indicators/IndicatorSelector';
import LiveAnalysisToggle from './LiveAnalysisToggle';

interface TimeframeSelectorProps {
  enabledIndicators: Set<string>;
  onToggleIndicator: (id: string, enabled: boolean) => void;
}

/**
 * Renders indicator selector and live analysis toggle.
 * Timeframe is fixed to 1m (no UI selector).
 */
export default function TimeframeSelector({
  enabledIndicators,
  onToggleIndicator,
}: TimeframeSelectorProps) {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <IndicatorSelector
        enabledIndicators={enabledIndicators}
        onToggleIndicator={onToggleIndicator}
      />
      <LiveAnalysisToggle />
    </div>
  );
}
