'use client';

import { useTradingStore } from '../../store/tradingStore';

export default function TradingSignalsPanel() {
  const { coreEngineAnalysis, keepLiveAnalysis } = useTradingStore();

  if (!keepLiveAnalysis || !coreEngineAnalysis?.prediction) {
    return null;
  }

  const { prediction, zones, supportResistance, aiPowered } = coreEngineAnalysis;
  const zone = zones?.[0];

  return (
    <div className="bg-[#1a1a1a] border-b border-gray-800 px-4 py-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`max-w-xl rounded-lg border px-3 py-2 ${
            prediction.direction === 'BUY'
              ? 'bg-[#0d2818] border-green-500/30'
              : 'bg-[#28180d] border-red-500/30'
          }`}>
            <div className="text-[11px] text-gray-500 uppercase">AI Recommendation</div>
            <div className={`text-2xl font-bold leading-none ${prediction.direction === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
              {prediction.direction} for {prediction.tradeStyle}
            </div>
            <div className="mt-1 text-sm text-gray-300">{prediction.summary}</div>
          </div>

          {zone && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="bg-[#111] border border-gray-800 rounded-lg px-3 py-2">
                <div className="text-xs text-gray-500">Entry</div>
                <div className="text-sm font-semibold text-white">${zone.entryPrice.toFixed(4)}</div>
              </div>
              <div className="bg-[#111] border border-gray-800 rounded-lg px-3 py-2">
                <div className="text-xs text-gray-500">Target</div>
                <div className="text-sm font-semibold text-green-400">${zone.profitTarget.toFixed(4)}</div>
              </div>
              <div className="bg-[#111] border border-gray-800 rounded-lg px-3 py-2">
                <div className="text-xs text-gray-500">Stop</div>
                <div className="text-sm font-semibold text-red-400">${zone.stopLoss.toFixed(4)}</div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap text-xs text-gray-400">
          <div className="px-3 py-2 bg-[#111] border border-gray-800 rounded-lg">
            Confidence: <span className="text-white font-semibold">{prediction.confidence.toFixed(0)}%</span>
          </div>
          <div className="px-3 py-2 bg-[#111] border border-gray-800 rounded-lg">
            Horizon: <span className="text-white font-semibold">{prediction.horizon}</span>
          </div>
          <div className="px-3 py-2 bg-[#111] border border-gray-800 rounded-lg">
            News: <span className="text-white font-semibold capitalize">{prediction.newsBias}</span>
          </div>
          {supportResistance?.lastSwingLow !== undefined && supportResistance?.lastSwingLow !== null && (
            <div className="px-3 py-2 bg-[#111] border border-gray-800 rounded-lg">
              Support: <span className="text-white font-semibold">${supportResistance.lastSwingLow.toFixed(4)}</span>
            </div>
          )}
          {supportResistance?.lastSwingHigh !== undefined && supportResistance?.lastSwingHigh !== null && (
            <div className="px-3 py-2 bg-[#111] border border-gray-800 rounded-lg">
              Resistance: <span className="text-white font-semibold">${supportResistance.lastSwingHigh.toFixed(4)}</span>
            </div>
          )}
          <div className="px-3 py-2 bg-[#111] border border-gray-800 rounded-lg">
            Source: <span className="text-white font-semibold">{aiPowered ? 'Azure AI' : 'Fallback'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
