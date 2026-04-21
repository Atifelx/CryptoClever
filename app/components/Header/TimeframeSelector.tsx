'use client';

import IndicatorSelector from '../Indicators/IndicatorSelector';

interface TimeframeSelectorProps {
  enabledIndicators: Set<string>;
  onToggleIndicator: (id: string, enabled: boolean) => void;
}

/**
 * Renders indicator selector. Core Engine moved to Navbar (top bar).
 * Timeframe is fixed to 15m (no UI selector).
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
    </div>
  );
}
