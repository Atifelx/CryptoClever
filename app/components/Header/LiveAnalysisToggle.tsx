'use client';

import { useState, useEffect, useRef } from 'react';
import { useTradingStore } from '../../store/tradingStore';
import toast from 'react-hot-toast';

interface TradingZone {
  type: 'BUY' | 'SELL';
  entryPrice: number;
  profitTarget: number;
  stopLoss: number;
  confidence: number;
  reasoning: string;
  time: number;
}

interface PredictionResult {
  direction: 'BUY' | 'SELL';
  tradeStyle: 'SCALP' | 'HOLD';
  confidence: number;
  summary: string;
  reasoning: string;
  horizon: string;
  currentPrice: number;
  targetPrice: number;
  stopLoss: number;
  chartLabel: string;
  expectedPath: string;
  newsBias: string;
}

interface SupportResistance {
  supportLevels: number[];
  resistanceLevels: number[];
  lastSwingLow?: number | null;
  lastSwingHigh?: number | null;
}

interface AnalysisResult {
  structure: string;
  regime: string;
  impulseScore: number;
  confidence: number;
  trend?: string;
  pivots: Array<{
    type: string;
    price: number;
    index: number;
    time: number;
  }>;
  reasoning?: string;
  zones?: TradingZone[];
  prediction?: PredictionResult;
  supportResistance?: SupportResistance;
  aiPowered?: boolean;
  analysisSource?: string;
  cached?: boolean;
  symbol?: string;
  timeframe?: string;
  candlesCount?: number;
}

export default function LiveAnalysisToggle() {
  const { selectedSymbol, selectedTimeframe, setCoreEngineAnalysis, keepLiveAnalysis, setKeepLiveAnalysis, tradingData } = useTradingStore();
  const [isEnabled, setIsEnabled] = useState(keepLiveAnalysis);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const previousStructureRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const prevSymbolRef = useRef<string>(selectedSymbol);
  const prevTimeframeRef = useRef<string>(selectedTimeframe);

  // CRITICAL: Clear all state immediately when symbol/timeframe changes
  useEffect(() => {
    if (prevSymbolRef.current !== selectedSymbol || prevTimeframeRef.current !== selectedTimeframe) {
      console.log('🔄 Core Engine: Symbol/Timeframe changed - Clearing stale analysis:', {
        from: { symbol: prevSymbolRef.current, timeframe: prevTimeframeRef.current },
        to: { symbol: selectedSymbol, timeframe: selectedTimeframe }
      });
      
      // Clear all state immediately
      setAnalysis(null);
      previousStructureRef.current = null;
      setCoreEngineAnalysis(null);
      
      prevSymbolRef.current = selectedSymbol;
      prevTimeframeRef.current = selectedTimeframe;
    }
  }, [selectedSymbol, selectedTimeframe, setCoreEngineAnalysis]);

  // Fetch analysis from backend; frontend only renders the returned payload.
  const fetchAnalysis = async () => {
    if (!selectedSymbol || !selectedTimeframe) return;

    setLoading(true);
    try {
      const timeframe = selectedTimeframe === '1D' ? '1d' : selectedTimeframe.toLowerCase();
      const backendRes = await fetch(
        `/api/backend/signals/${encodeURIComponent(selectedSymbol)}/${encodeURIComponent(timeframe)}`
      );
      if (!backendRes.ok) throw new Error(`HTTP ${backendRes.status}`);
      const data: AnalysisResult = await backendRes.json();
      setAnalysis(data);
      const primaryZone = data.zones?.[0];
      const currentPrice = tradingData.currentPrice || 0;
      const isZoneStillValid = !primaryZone
        ? false
        : primaryZone.type === 'BUY'
          ? currentPrice === 0 || (currentPrice < primaryZone.profitTarget && currentPrice > primaryZone.stopLoss)
          : currentPrice === 0 || (currentPrice > primaryZone.profitTarget && currentPrice < primaryZone.stopLoss);
      const activeZones = primaryZone && isZoneStillValid ? [primaryZone] : primaryZone && currentPrice === 0 ? [primaryZone] : [];
      
      setCoreEngineAnalysis({
        structure: data.structure,
        regime: data.regime,
        confidence: data.confidence,
        reasoning: data.reasoning,
        zones: activeZones,
        prediction: data.prediction,
        supportResistance: data.supportResistance,
        aiPowered: data.aiPowered,
        analysisSource: data.analysisSource,
      });

      // Detect structure change
      if (previousStructureRef.current !== null && previousStructureRef.current !== data.structure) {
        // Structure changed - trigger notification
        toast.success(
          `Structure Changed: ${previousStructureRef.current} → ${data.structure}`,
          {
            icon: '📊',
            duration: 5000,
          }
        );
      }

      previousStructureRef.current = data.structure;
    } catch (error: any) {
      console.error('Error fetching analysis:', error);
      toast.error('Failed to fetch analysis', {
        icon: '❌',
      });
    } finally {
      setLoading(false);
    }
  };

  // Memoize fetchAnalysis to avoid recreating on every render
  const fetchAnalysisRef = useRef(fetchAnalysis);
  fetchAnalysisRef.current = fetchAnalysis;

  // Start polling
  useEffect(() => {
    if (isEnabled && selectedSymbol && selectedTimeframe) {
      console.log('▶️ Starting Core Engine polling:', { selectedSymbol, selectedTimeframe });
      
      // Fetch immediately
      fetchAnalysisRef.current();

      // Then poll every 10 minutes (matches backend cache TTL)
      pollingIntervalRef.current = setInterval(() => {
        fetchAnalysisRef.current();
      }, 600000); // 10 minutes — AI runs 6x/hour, cached data served between runs

      return () => {
        console.log('⏹️ Stopping Core Engine polling');
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      };
    } else {
      // Stop polling
      if (pollingIntervalRef.current) {
        console.log('⏹️ Stopping Core Engine polling (disabled)');
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
  }, [isEnabled, selectedSymbol, selectedTimeframe]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const handleToggle = () => {
    const newValue = !isEnabled;
    setIsEnabled(newValue);
    setKeepLiveAnalysis(newValue); // Sync with store
    // Reset previous structure when toggling off
    if (isEnabled) {
      console.log('🔴 Core Engine disabled - Clearing state');
      previousStructureRef.current = null;
      setAnalysis(null);
      setCoreEngineAnalysis(null);
    } else {
      console.log('🟢 Core Engine enabled');
    }
  };
  const [showDetails, setShowDetails] = useState(false);

  // Helper: format price for display (auto-detect decimals)
  const fmtPrice = (p: number) => {
    if (!p) return '—';
    if (p > 100) return p.toFixed(2);
    if (p > 1) return p.toFixed(4);
    return p.toFixed(6);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Top row: Core Engine button + Toggle */}
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
        {/* Core Engine Button */}
        <button
          onClick={() => {
            if (!isEnabled) {
              handleToggle();
            }
          }}
          className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg font-semibold transition-colors text-sm sm:text-base ${
            analysis
              ? 'bg-[#26a69a] hover:bg-[#208a7e] text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
          title="Core Engine Analysis"
        >
          Core Engine
        </button>

        {/* Live Analysis Toggle */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer">
            <span className="text-xs sm:text-sm text-gray-400 whitespace-nowrap">Keep Live</span>
            <div className="relative">
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={handleToggle}
                className="sr-only"
              />
              <div
                className={`w-11 h-6 rounded-full transition-colors ${
                  isEnabled ? 'bg-[#26a69a]' : 'bg-gray-700'
                }`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    isEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </div>
            </div>
          </label>
          {loading && (
            <div className="w-4 h-4 border-2 border-[#26a69a] border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        {/* Compact analysis badges */}
        {analysis && (
          <div className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm flex-wrap">
            <div className="px-2 py-1 sm:px-3 sm:py-1 bg-[#1a1a1a] rounded border border-gray-800">
              <span className="text-gray-400">Structure: </span>
              <span
                className={`font-semibold ${
                  analysis.structure === 'Bullish'
                    ? 'text-green-400'
                    : analysis.structure === 'Bearish'
                    ? 'text-red-400'
                    : 'text-yellow-400'
                }`}
              >
                {analysis.structure}
              </span>
            </div>
            <div className="px-2 py-1 sm:px-3 sm:py-1 bg-[#1a1a1a] rounded border border-gray-800">
              <span className="text-gray-400">Confidence: </span>
              <span className="font-semibold text-white">
                {analysis.confidence.toFixed(0)}%
              </span>
            </div>
            {analysis.prediction && (
              <>
                <div className="px-2 py-1 sm:px-3 sm:py-1 bg-[#1a1a1a] rounded border border-gray-800">
                  <span className="text-gray-400">AI Call: </span>
                  <span className={`font-semibold ${analysis.prediction.direction === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                    {analysis.prediction.direction} {analysis.prediction.tradeStyle}
                  </span>
                </div>
                <button
                  onClick={() => setShowDetails(d => !d)}
                  className="px-2 py-1 sm:px-3 sm:py-1 bg-[#1a1a1a] rounded border border-gray-800 text-[#26a69a] hover:bg-gray-800 transition-colors cursor-pointer text-xs sm:text-sm"
                >
                  {showDetails ? '▲ Hide' : '▼ Details'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Expanded details panel: Scalp + Long + Why */}
      {analysis?.prediction && showDetails && (
        <div className="bg-[#0a0a0a] border border-gray-800/60 rounded-xl p-4 sm:p-5 mt-2 animate-in slide-in-from-top-2 duration-300 shadow-2xl">
          {/* Section: Overview */}
          <div className="mb-5 pb-4 border-b border-gray-800/50">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.15em] mb-2">Market Intelligence</h3>
            <p className="text-sm text-gray-200 leading-relaxed font-medium">
              {analysis.prediction.summary}
            </p>
          </div>

          {/* Section: Trade Execution Plans */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
            {/* Scalp Strategy */}
            {analysis.prediction.scalpTrade && (
              <div className={`relative overflow-hidden rounded-xl border p-4 transition-all hover:shadow-lg ${
                analysis.prediction.scalpTrade.direction === 'BUY'
                  ? 'bg-green-500/[0.03] border-green-500/20 hover:border-green-500/40'
                  : 'bg-red-500/[0.03] border-red-500/20 hover:border-red-500/40'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${
                      analysis.prediction.scalpTrade.direction === 'BUY' ? 'bg-green-500/20' : 'bg-red-500/20'
                    }`}>
                      <span className="text-base">⚡</span>
                    </div>
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Scalp Strategy</span>
                  </div>
                  <div className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase ${
                    analysis.prediction.scalpTrade.direction === 'BUY' 
                      ? 'bg-green-500 text-white' 
                      : 'bg-red-500 text-white'
                  }`}>
                    {analysis.prediction.scalpTrade.direction}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">Entry</div>
                    <div className="text-sm font-mono text-white font-bold">{fmtPrice(analysis.prediction.scalpTrade.entry)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">Target</div>
                    <div className="text-sm font-mono text-green-400 font-bold">{fmtPrice(analysis.prediction.scalpTrade.target)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">Stop Loss</div>
                    <div className="text-sm font-mono text-red-400 font-bold">{fmtPrice(analysis.prediction.scalpTrade.stop)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">Duration</div>
                    <div className="text-sm text-[#26a69a] font-bold">{analysis.prediction.scalpTrade.expectedDuration}</div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-800/40">
                  <div className="text-[10px] text-gray-500 uppercase font-bold mb-1">Reasoning</div>
                  <p className="text-[11px] text-gray-400 leading-normal italic">
                    "{analysis.prediction.scalpTrade.reasoning || 'No specific reasoning provided for this scalp setup.'}"
                  </p>
                </div>
              </div>
            )}

            {/* Long Strategy */}
            {analysis.prediction.longTrade && (
              <div className={`relative overflow-hidden rounded-xl border p-4 transition-all hover:shadow-lg ${
                analysis.prediction.longTrade.direction === 'BUY'
                  ? 'bg-green-500/[0.03] border-green-500/20 hover:border-green-500/40'
                  : 'bg-red-500/[0.03] border-red-500/20 hover:border-red-500/40'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${
                      analysis.prediction.longTrade.direction === 'BUY' ? 'bg-green-500/20' : 'bg-red-500/20'
                    }`}>
                      <span className="text-base">📈</span>
                    </div>
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Long Strategy</span>
                  </div>
                  <div className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase ${
                    analysis.prediction.longTrade.direction === 'BUY' 
                      ? 'bg-green-500 text-white' 
                      : 'bg-red-500 text-white'
                  }`}>
                    {analysis.prediction.longTrade.direction}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-y-3 gap-x-4">
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">Entry</div>
                    <div className="text-sm font-mono text-white font-bold">{fmtPrice(analysis.prediction.longTrade.entry)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">Target</div>
                    <div className="text-sm font-mono text-green-400 font-bold">{fmtPrice(analysis.prediction.longTrade.target)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">Stop Loss</div>
                    <div className="text-sm font-mono text-red-400 font-bold">{fmtPrice(analysis.prediction.longTrade.stop)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-500 uppercase font-bold mb-0.5">Duration</div>
                    <div className="text-sm text-[#26a69a] font-bold">{analysis.prediction.longTrade.expectedDuration}</div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-800/40">
                  <div className="text-[10px] text-gray-500 uppercase font-bold mb-1">Reasoning</div>
                  <p className="text-[11px] text-gray-400 leading-normal italic">
                    "{analysis.prediction.longTrade.reasoning || 'No specific reasoning provided for this long-term setup.'}"
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Section: Rationales */}
          {(analysis.prediction.whyUp || analysis.prediction.whyDown) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              {analysis.prediction.whyUp && (
                <div className="bg-green-500/[0.02] border border-green-500/10 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-green-500 text-xs">▲</span>
                    <span className="text-[10px] font-black text-green-500/80 uppercase tracking-widest">Upside Factors</span>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed font-medium">{analysis.prediction.whyUp}</p>
                </div>
              )}
              {analysis.prediction.whyDown && (
                <div className="bg-red-500/[0.02] border border-red-500/10 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-red-500 text-xs">▼</span>
                    <span className="text-[10px] font-black text-red-500/80 uppercase tracking-widest">Downside Factors</span>
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed font-medium">{analysis.prediction.whyDown}</p>
                </div>
              )}
            </div>
          )}

          {/* Section: Footer Metadata */}
          <div className="flex items-center gap-x-6 gap-y-2 text-[10px] text-gray-600 font-bold uppercase tracking-widest flex-wrap mt-2">
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${
                analysis.prediction.newsBias === 'bullish' ? 'bg-green-500' :
                analysis.prediction.newsBias === 'bearish' ? 'bg-red-500' : 'bg-gray-500'
              }`} />
              <span>News Bias: <span className={
                analysis.prediction.newsBias === 'bullish' ? 'text-green-400' :
                analysis.prediction.newsBias === 'bearish' ? 'text-red-400' : 'text-gray-400'
              }>{analysis.prediction.newsBias}</span></span>
            </div>
            <span>Horizon: <span className="text-gray-400">{analysis.prediction.horizon}</span></span>
            <span>Source: <span className="text-gray-400">{analysis.aiPowered ? 'Azure Deep-Research' : 'Heuristic Engine'}</span></span>
            <span>Refresh: <span className="text-gray-400">Every 10m</span></span>
          </div>
        </div>
      )}
    </div>
  );
}
