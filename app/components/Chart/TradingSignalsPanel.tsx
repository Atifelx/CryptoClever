'use client';

import { useTradingStore } from '../../store/tradingStore';

export default function TradingSignalsPanel() {
  const { coreEngineAnalysis } = useTradingStore();

  if (!coreEngineAnalysis?.zones || coreEngineAnalysis.zones.length === 0) {
    return null;
  }

  // Get the most recent and strongest signals
  const buyZones = coreEngineAnalysis.zones
    .filter(z => z.type === 'BUY')
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3); // Show top 3 buy signals

  const sellZones = coreEngineAnalysis.zones
    .filter(z => z.type === 'SELL')
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3); // Show top 3 sell signals

  return (
    <div className="bg-[#1a1a1a] border-b border-gray-800 p-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Buy Signals */}
        {buyZones.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gray-500 font-semibold uppercase">BUY Signals:</span>
            {buyZones.map((zone, index) => (
              <div
                key={`buy-${index}`}
                className="flex items-center gap-2 bg-[#0d2818] border border-green-500/30 rounded-lg px-3 py-2"
              >
                {/* Upward Arrow */}
                <div className="flex flex-col items-center">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="text-green-500"
                  >
                    <path
                      d="M12 4L12 20M12 4L6 10M12 4L18 10"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="text-xs text-green-400 font-bold">BUY NOW</span>
                </div>
                
                {/* Price Info */}
                <div className="flex flex-col">
                  <div className="text-xs text-gray-400">Entry</div>
                  <div className="text-sm font-bold text-green-400">
                    ${zone.entryPrice.toFixed(4)}
                  </div>
                </div>
                
                {/* Arrow to Target */}
                <div className="flex items-center gap-1">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    className="text-green-500"
                  >
                    <path
                      d="M8 2L8 14M8 2L4 6M8 2L12 6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                
                {/* Target */}
                <div className="flex flex-col">
                  <div className="text-xs text-gray-400">Target</div>
                  <div className="text-sm font-bold text-green-300">
                    ${zone.profitTarget.toFixed(4)}
                  </div>
                </div>
                
                {/* Stop Loss */}
                <div className="flex flex-col ml-2 pl-2 border-l border-gray-700">
                  <div className="text-xs text-gray-400">Stop</div>
                  <div className="text-sm font-semibold text-red-400">
                    ${zone.stopLoss.toFixed(4)}
                  </div>
                </div>
                
                {/* Confidence Badge */}
                <div className="ml-2 px-2 py-1 bg-green-500/20 rounded text-xs text-green-400 font-semibold">
                  {zone.confidence.toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sell Signals */}
        {sellZones.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gray-500 font-semibold uppercase">SELL Signals:</span>
            {sellZones.map((zone, index) => (
              <div
                key={`sell-${index}`}
                className="flex items-center gap-2 bg-[#28180d] border border-red-500/30 rounded-lg px-3 py-2"
              >
                {/* Downward Arrow */}
                <div className="flex flex-col items-center">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="text-red-500"
                  >
                    <path
                      d="M12 20L12 4M12 20L6 14M12 20L18 14"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="text-xs text-red-400 font-bold">SELL NOW</span>
                </div>
                
                {/* Price Info */}
                <div className="flex flex-col">
                  <div className="text-xs text-gray-400">Entry</div>
                  <div className="text-sm font-bold text-red-400">
                    ${zone.entryPrice.toFixed(4)}
                  </div>
                </div>
                
                {/* Arrow to Target */}
                <div className="flex items-center gap-1">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    className="text-red-500"
                  >
                    <path
                      d="M8 14L8 2M8 14L4 10M8 14L12 10"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                
                {/* Target */}
                <div className="flex flex-col">
                  <div className="text-xs text-gray-400">Target</div>
                  <div className="text-sm font-bold text-red-300">
                    ${zone.profitTarget.toFixed(4)}
                  </div>
                </div>
                
                {/* Stop Loss */}
                <div className="flex flex-col ml-2 pl-2 border-l border-gray-700">
                  <div className="text-xs text-gray-400">Stop</div>
                  <div className="text-sm font-semibold text-green-400">
                    ${zone.stopLoss.toFixed(4)}
                  </div>
                </div>
                
                {/* Confidence Badge */}
                <div className="ml-2 px-2 py-1 bg-red-500/20 rounded text-xs text-red-400 font-semibold">
                  {zone.confidence.toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
