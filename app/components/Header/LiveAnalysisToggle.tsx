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

      // Then poll every 5 minutes (matches backend cache TTL)
      pollingIntervalRef.current = setInterval(() => {
        fetchAnalysisRef.current();
      }, 300000); // 5 minutes — prevents flip-flop signals

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
        <div className="bg-[#111] border border-gray-800 rounded-lg p-3 sm:p-4 mx-0 animate-in fade-in duration-200">
          {/* Summary */}
          <div className="mb-3 text-sm text-gray-300">
            {analysis.prediction.summary}
          </div>

          {/* Trade Plans Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            {/* Scalp Trade */}
            {analysis.prediction.scalpTrade && (
              <div className={`rounded-lg border p-3 ${
                analysis.prediction.scalpTrade.direction === 'BUY'
                  ? 'bg-[#0d2818]/60 border-green-500/30'
                  : 'bg-[#28180d]/60 border-red-500/30'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">⚡ Scalp Trade</div>
                  <div className={`text-xs font-bold px-2 py-0.5 rounded ${
                    analysis.prediction.scalpTrade.direction === 'BUY' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {analysis.prediction.scalpTrade.direction}
                  </div>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Entry</span>
                    <span className="text-white font-mono">{fmtPrice(analysis.prediction.scalpTrade.entry)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Target</span>
                    <span className="text-green-400 font-mono">{fmtPrice(analysis.prediction.scalpTrade.target)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Stop</span>
                    <span className="text-red-400 font-mono">{fmtPrice(analysis.prediction.scalpTrade.stop)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Duration</span>
                    <span className="text-[#26a69a] font-medium">{analysis.prediction.scalpTrade.expectedDuration}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Confidence</span>
                    <span className="text-white font-medium">{analysis.prediction.scalpTrade.confidence?.toFixed(0) ?? '—'}%</span>
                  </div>
                </div>
                {analysis.prediction.scalpTrade.reasoning && (
                  <div className="mt-2 text-[11px] text-gray-400 leading-tight">
                    {analysis.prediction.scalpTrade.reasoning}
                  </div>
                )}
              </div>
            )}

            {/* Long Trade */}
            {analysis.prediction.longTrade && (
              <div className={`rounded-lg border p-3 ${
                analysis.prediction.longTrade.direction === 'BUY'
                  ? 'bg-[#0d2818]/60 border-green-500/30'
                  : 'bg-[#28180d]/60 border-red-500/30'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">📈 Long Trade</div>
                  <div className={`text-xs font-bold px-2 py-0.5 rounded ${
                    analysis.prediction.longTrade.direction === 'BUY' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {analysis.prediction.longTrade.direction}
                  </div>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Entry</span>
                    <span className="text-white font-mono">{fmtPrice(analysis.prediction.longTrade.entry)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Target</span>
                    <span className="text-green-400 font-mono">{fmtPrice(analysis.prediction.longTrade.target)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Stop</span>
                    <span className="text-red-400 font-mono">{fmtPrice(analysis.prediction.longTrade.stop)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Duration</span>
                    <span className="text-[#26a69a] font-medium">{analysis.prediction.longTrade.expectedDuration}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Confidence</span>
                    <span className="text-white font-medium">{analysis.prediction.longTrade.confidence?.toFixed(0) ?? '—'}%</span>
                  </div>
                </div>
                {analysis.prediction.longTrade.reasoning && (
                  <div className="mt-2 text-[11px] text-gray-400 leading-tight">
                    {analysis.prediction.longTrade.reasoning}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Why Up / Why Down */}
          {(analysis.prediction.whyUp || analysis.prediction.whyDown) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
              {analysis.prediction.whyUp && (
                <div className="bg-[#0d2818]/40 border border-green-500/20 rounded-lg p-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-green-500/70 font-medium mb-1">📈 Why Price May Go Up</div>
                  <div className="text-xs text-gray-300 leading-relaxed">{analysis.prediction.whyUp}</div>
                </div>
              )}
              {analysis.prediction.whyDown && (
                <div className="bg-[#28180d]/40 border border-red-500/20 rounded-lg p-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-red-500/70 font-medium mb-1">📉 Why Price May Go Down</div>
                  <div className="text-xs text-gray-300 leading-relaxed">{analysis.prediction.whyDown}</div>
                </div>
              )}
            </div>
          )}

          {/* Meta info */}
          <div className="flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
            <span>News Bias: <span className={`font-medium ${
              analysis.prediction.newsBias === 'bullish' ? 'text-green-400' :
              analysis.prediction.newsBias === 'bearish' ? 'text-red-400' : 'text-gray-400'
            }`}>{analysis.prediction.newsBias}</span></span>
            <span>Horizon: <span className="text-gray-400">{analysis.prediction.horizon}</span></span>
            <span>Source: <span className="text-gray-400">{analysis.aiPowered ? 'Azure AI' : 'Fallback Engine'}</span></span>
            <span>Updates: <span className="text-gray-400">Every 5 min</span></span>
          </div>
        </div>
      )}
    </div>
  );
}
