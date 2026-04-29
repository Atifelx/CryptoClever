'use client';

import { useTradingStore } from '../../store/tradingStore';
import { useState } from 'react';

export default function TradingSignalsPanel() {
  const { coreEngineAnalysis, keepLiveAnalysis } = useTradingStore();
  const [showDeepAnalysis, setShowDeepAnalysis] = useState(false);

  if (!keepLiveAnalysis || !coreEngineAnalysis?.prediction) {
    return null;
  }

  const { prediction, zones, supportResistance, aiPowered } = coreEngineAnalysis;
  const zone = zones?.[0];

  return (
    <div className="bg-[#121212] border-b border-white/5 overflow-hidden shadow-2xl">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <div className={`relative overflow-hidden max-w-xl rounded-xl border px-4 py-3 transition-all duration-300 ${
              prediction.direction === 'BUY'
                ? 'bg-green-500/5 border-green-500/20 shadow-[0_0_20px_rgba(34,197,94,0.05)]'
                : 'bg-red-500/5 border-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.05)]'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <div className="text-[10px] text-gray-500 uppercase font-bold tracking-tighter">AI Core Strategy</div>
                {aiPowered && (
                  <div className="bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-[8px] px-1.5 py-0.5 rounded-full font-bold animate-pulse">
                    AGENT MODE ACTIVE
                  </div>
                )}
              </div>
              <div className={`text-2xl font-black leading-none tracking-tight ${prediction.direction === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                {prediction.direction} <span className="text-gray-400 font-light">/</span> {prediction.tradeStyle}
              </div>
              <div className="mt-1 text-sm text-gray-200 font-medium">{prediction.summary}</div>
            </div>

            {zone && (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                  <div className="text-[9px] text-gray-500 uppercase font-bold">Entry</div>
                  <div className="text-sm font-mono font-bold text-white">${zone.entryPrice.toFixed(4)}</div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                  <div className="text-[9px] text-gray-500 uppercase font-bold">Target</div>
                  <div className="text-sm font-mono font-bold text-green-400">${zone.profitTarget.toFixed(4)}</div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                  <div className="text-[9px] text-gray-500 uppercase font-bold">Stop</div>
                  <div className="text-sm font-mono font-bold text-red-400">${zone.stopLoss.toFixed(4)}</div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs">
              <span className="text-gray-500 font-bold mr-1">CONF:</span>
              <span className="text-white font-black">{prediction.confidence.toFixed(0)}%</span>
            </div>
            <div className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs">
              <span className="text-gray-500 font-bold mr-1">NEWS:</span>
              <span className={`font-black uppercase ${prediction.newsBias === 'bullish' ? 'text-green-400' : prediction.newsBias === 'bearish' ? 'text-red-400' : 'text-gray-300'}`}>
                {prediction.newsBias}
              </span>
            </div>
            <button 
              onClick={() => setShowDeepAnalysis(!showDeepAnalysis)}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-300 border ${
                showDeepAnalysis 
                  ? 'bg-white/10 border-white/20 text-white shadow-inner' 
                  : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20'
              }`}
            >
              {showDeepAnalysis ? 'HIDE REASONING' : 'VIEW DEEP ANALYSIS'}
            </button>
          </div>
        </div>

        {/* ─── Deep Analysis Dropdown ─── */}
        {showDeepAnalysis && (
          <div className="mt-4 border-t border-white/5 pt-4 animate-in slide-in-from-top duration-300">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4">
                <div className="text-[10px] text-cyan-400 font-bold uppercase mb-2 tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                  Senior Analyst Reasoning
                </div>
                <div className="text-sm text-gray-300 leading-relaxed font-light italic">
                  "{prediction.reasoning}"
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1 bg-green-500/5 border border-green-500/10 rounded-lg p-3">
                    <div className="text-[9px] text-green-500 font-bold uppercase mb-1">Bullish Drivers</div>
                    <div className="text-xs text-gray-400">{prediction.whyUp || 'No major bullish drivers identified.'}</div>
                  </div>
                  <div className="flex-1 bg-red-500/5 border border-red-500/10 rounded-lg p-3">
                    <div className="text-[9px] text-red-500 font-bold uppercase mb-1">Bearish Risks</div>
                    <div className="text-xs text-gray-400">{prediction.whyDown || 'No major bearish risks identified.'}</div>
                  </div>
                </div>
                <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3 text-xs flex justify-between items-center">
                  <span className="text-gray-500 font-medium italic">Verified by Agentic Loop (gpt-5.3-codex)</span>
                  <span className="text-gray-400 font-mono">Duration: {prediction.expectedDuration}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
