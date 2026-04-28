'use client';

interface PredictionOverlayProps {
  prediction: {
    direction: 'BUY' | 'SELL';
    tradeStyle: 'SCALP' | 'HOLD';
    confidence: number;
    chartLabel: string;
    summary?: string;
    expectedPath: string;
    horizon: string;
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

  return (
    <div className="absolute left-4 top-4 z-10 max-w-[18rem] rounded-xl border border-gray-800 bg-[#111]/90 px-3 py-2 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2">
        <span className={`text-xs font-semibold uppercase ${bullish ? 'text-green-400' : 'text-red-400'}`}>
          {prediction.chartLabel}
        </span>
        <span className="rounded bg-gray-800 px-2 py-0.5 text-[10px] text-gray-300">
          {prediction.confidence.toFixed(0)}%
        </span>
      </div>
      <div className="mt-1 text-xs leading-5 text-gray-200">
        {prediction.summary || prediction.expectedPath}
      </div>
      <div className="mt-1 text-[11px] text-gray-500">Horizon: {prediction.horizon}</div>
    </div>
  );
}
