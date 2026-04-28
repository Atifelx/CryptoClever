'use client';

interface TradeSetup {
  direction: 'BUY' | 'SELL';
  entry: number;
  target: number;
  stop: number;
  expectedDuration: string;
  reasoning: string;
  confidence: number;
}

interface PredictionOverlayProps {
  prediction: {
    direction: 'BUY' | 'SELL';
    tradeStyle: 'SCALP' | 'HOLD';
    confidence: number;
    chartLabel: string;
    summary?: string;
    expectedPath: string;
    horizon: string;
    whyUp?: string;
    whyDown?: string;
    scalpTrade?: TradeSetup | null;
    longTrade?: TradeSetup | null;
    newsBias?: string;
  } | null;
  visible: boolean;
}

export default function AIPredictionOverlay({
  prediction,
  visible,
}: PredictionOverlayProps) {
  if (!visible || !prediction) {
    return null;
  }

  const bullish = prediction.direction === 'BUY';

  // Helper: format price
  const fmt = (p: number) => {
    if (!p) return '—';
    if (p > 100) return p.toFixed(2);
    if (p > 1) return p.toFixed(4);
    return p.toFixed(6);
  };

  return (
    <div className="absolute left-4 top-4 z-10 max-w-[22rem] rounded-xl border border-gray-800 bg-[#111]/92 px-3.5 py-2.5 shadow-2xl backdrop-blur-sm">
      {/* Header: Signal + Confidence */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-xs font-bold uppercase tracking-wide ${bullish ? 'text-green-400' : 'text-red-400'}`}>
          {prediction.chartLabel}
        </span>
        <span className="rounded bg-gray-800 px-2 py-0.5 text-[10px] text-gray-300 font-medium">
          {prediction.confidence.toFixed(0)}%
        </span>
        {prediction.newsBias && prediction.newsBias !== 'neutral' && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            prediction.newsBias === 'bullish' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
          }`}>
            📰 {prediction.newsBias}
          </span>
        )}
      </div>

      {/* Summary */}
      <div className="text-[11px] leading-[16px] text-gray-200 mb-2">
        {prediction.summary || prediction.expectedPath}
      </div>

      {/* Scalp & Long trade mini cards */}
      {(prediction.scalpTrade || prediction.longTrade) && (
        <div className="flex gap-2 mb-2">
          {prediction.scalpTrade && (
            <div className={`flex-1 rounded-md border px-2 py-1.5 ${
              prediction.scalpTrade.direction === 'BUY'
                ? 'border-green-500/25 bg-green-950/30'
                : 'border-red-500/25 bg-red-950/30'
            }`}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-medium">⚡ Scalp</span>
                <span className={`text-[9px] font-bold ${
                  prediction.scalpTrade.direction === 'BUY' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {prediction.scalpTrade.direction}
                </span>
              </div>
              <div className="text-[10px] text-gray-400 space-y-0.5">
                <div className="flex justify-between">
                  <span>T</span>
                  <span className="text-green-400 font-mono">{fmt(prediction.scalpTrade.target)}</span>
                </div>
                <div className="flex justify-between">
                  <span>S</span>
                  <span className="text-red-400 font-mono">{fmt(prediction.scalpTrade.stop)}</span>
                </div>
                <div className="text-[9px] text-gray-500">{prediction.scalpTrade.expectedDuration}</div>
              </div>
            </div>
          )}
          {prediction.longTrade && (
            <div className={`flex-1 rounded-md border px-2 py-1.5 ${
              prediction.longTrade.direction === 'BUY'
                ? 'border-green-500/25 bg-green-950/30'
                : 'border-red-500/25 bg-red-950/30'
            }`}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 font-medium">📈 Long</span>
                <span className={`text-[9px] font-bold ${
                  prediction.longTrade.direction === 'BUY' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {prediction.longTrade.direction}
                </span>
              </div>
              <div className="text-[10px] text-gray-400 space-y-0.5">
                <div className="flex justify-between">
                  <span>T</span>
                  <span className="text-green-400 font-mono">{fmt(prediction.longTrade.target)}</span>
                </div>
                <div className="flex justify-between">
                  <span>S</span>
                  <span className="text-red-400 font-mono">{fmt(prediction.longTrade.stop)}</span>
                </div>
                <div className="text-[9px] text-gray-500">{prediction.longTrade.expectedDuration}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Why Up / Why Down reasoning */}
      {(prediction.whyUp || prediction.whyDown) && (
        <div className="space-y-1.5 mb-1.5">
          {prediction.whyUp && (
            <div className="text-[10px] leading-[14px]">
              <span className="text-green-500/80 font-medium">▲ </span>
              <span className="text-gray-400">{prediction.whyUp}</span>
            </div>
          )}
          {prediction.whyDown && (
            <div className="text-[10px] leading-[14px]">
              <span className="text-red-500/80 font-medium">▼ </span>
              <span className="text-gray-400">{prediction.whyDown}</span>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="text-[10px] text-gray-600">
        Horizon: {prediction.horizon}
      </div>
    </div>
  );
}
