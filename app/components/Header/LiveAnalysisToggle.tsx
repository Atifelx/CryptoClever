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

      // Then poll every 15 seconds
      pollingIntervalRef.current = setInterval(() => {
        fetchAnalysisRef.current();
      }, 15000); // 15 seconds

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
  
  // REMOVED: Redundant clear - now handled in the main useEffect above
  // Clear locked zones when symbol or timeframe changes

  return (
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

      {/* Analysis Display (when available) */}
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
            <span className="text-gray-400">Regime: </span>
            <span className="font-semibold text-white">{analysis.regime}</span>
          </div>
          <div className="px-2 py-1 sm:px-3 sm:py-1 bg-[#1a1a1a] rounded border border-gray-800">
            <span className="text-gray-400">Confidence: </span>
            <span className="font-semibold text-white">
              {analysis.confidence.toFixed(0)}%
            </span>
          </div>
          {analysis.prediction && (
            <div className="px-2 py-1 sm:px-3 sm:py-1 bg-[#1a1a1a] rounded border border-gray-800">
              <span className="text-gray-400">AI Call: </span>
              <span className={`font-semibold ${analysis.prediction.direction === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                {analysis.prediction.direction} {analysis.prediction.tradeStyle}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
