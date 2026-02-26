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

interface AnalysisResult {
  structure: string;
  regime: string;
  impulseScore: number;
  confidence: number;
  pivots: Array<{
    type: string;
    price: number;
    index: number;
    time: number;
  }>;
  reasoning?: string;
  zones?: TradingZone[];
  cached?: boolean;
  symbol?: string;
  timeframe?: string;
  candlesCount?: number;
}

export default function LiveAnalysisToggle() {
  const { selectedSymbol, selectedTimeframe, setCoreEngineAnalysis, tradingData } = useTradingStore();
  const [isEnabled, setIsEnabled] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const previousStructureRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lockedZonesRef = useRef<Map<string, TradingZone>>(new Map()); // Track locked zones by time+type
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
      lockedZonesRef.current.clear();
      setCoreEngineAnalysis(null);
      
      prevSymbolRef.current = selectedSymbol;
      prevTimeframeRef.current = selectedTimeframe;
    }
  }, [selectedSymbol, selectedTimeframe, setCoreEngineAnalysis]);

  // Fetch analysis from API (try backend signals first when backend is configured, else deep-analysis)
  const fetchAnalysis = async () => {
    if (!selectedSymbol || !selectedTimeframe) return;

    setLoading(true);
    try {
      const timeframe = selectedTimeframe === '1D' ? '1d' : selectedTimeframe.toLowerCase();
      let data: AnalysisResult | null = null;

      const backendRes = await fetch(
        `/api/backend/signals/${encodeURIComponent(selectedSymbol)}/${encodeURIComponent(timeframe)}`
      );
      if (backendRes.ok) {
        const backendData = await backendRes.json();
        data = {
          structure: backendData.structure ?? 'Range',
          regime: backendData.regime ?? 'RANGE',
          impulseScore: 0,
          confidence: backendData.confidence ?? 0,
          pivots: backendData.pivots ?? [],
          reasoning: backendData.reasoning,
          zones: backendData.zones ?? [],
        };
      }

      if (!data) {
        const response = await fetch('/api/deep-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol: selectedSymbol,
            timeframe: selectedTimeframe,
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
      }

      if (!data) return;
      setAnalysis(data);
      
      // Get current price from trading data
      const currentPrice = tradingData.currentPrice || 0;
      
      // Merge new zones with locked zones:
      // 1. Keep existing locked zones (don't recalculate their targets)
      // 2. Add new zones that don't exist yet
      // 3. Remove zones that have been hit (price passed target or stop)
      const newZones = data.zones || [];
      const mergedZones: TradingZone[] = [];
      
      // First, check and update locked zones (remove if hit)
      for (const [key, lockedZone] of lockedZonesRef.current.entries()) {
        if (currentPrice === 0) {
          mergedZones.push(lockedZone);
          continue;
        }
        
        let isHit = false;
        if (lockedZone.type === 'BUY') {
          isHit = currentPrice >= lockedZone.profitTarget || currentPrice <= lockedZone.stopLoss;
        } else {
          isHit = currentPrice <= lockedZone.profitTarget || currentPrice >= lockedZone.stopLoss;
        }
        
        if (!isHit) {
          mergedZones.push(lockedZone);
        } else {
          // Remove hit zone from locked zones
          lockedZonesRef.current.delete(key);
        }
      }
      
      // Then, add new zones that aren't already locked
      for (const newZone of newZones) {
        const zoneKey = `${newZone.time}-${newZone.type}-${newZone.entryPrice.toFixed(2)}`;
        
        // Skip if zone already exists (locked)
        if (lockedZonesRef.current.has(zoneKey)) {
          continue;
        }
        
        // Check if zone should be added (not hit yet)
        if (currentPrice === 0) {
          mergedZones.push(newZone);
          lockedZonesRef.current.set(zoneKey, newZone);
        } else {
          let shouldAdd = false;
          if (newZone.type === 'BUY') {
            shouldAdd = currentPrice < newZone.profitTarget && currentPrice > newZone.stopLoss;
          } else {
            shouldAdd = currentPrice > newZone.profitTarget && currentPrice < newZone.stopLoss;
          }
          
          if (shouldAdd) {
            mergedZones.push(newZone);
            lockedZonesRef.current.set(zoneKey, newZone);
          }
        }
      }
      
      setCoreEngineAnalysis({
        structure: data.structure,
        regime: data.regime,
        confidence: data.confidence,
        reasoning: data.reasoning,
        zones: mergedZones,
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
    setIsEnabled(!isEnabled);
    // Reset previous structure when toggling off
    if (isEnabled) {
      console.log('🔴 Core Engine disabled - Clearing state');
      previousStructureRef.current = null;
      setAnalysis(null);
      lockedZonesRef.current.clear(); // Clear locked zones when disabling
      setCoreEngineAnalysis(null);
    } else {
      console.log('🟢 Core Engine enabled');
    }
  };
  
  // REMOVED: Redundant clear - now handled in the main useEffect above
  // Clear locked zones when symbol or timeframe changes

  return (
    <div className="flex items-center gap-3">
      {/* Core Engine Button */}
      <button
        onClick={() => {
          if (!isEnabled) {
            handleToggle();
          }
        }}
        className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
          analysis
            ? 'bg-[#26a69a] hover:bg-[#208a7e] text-white'
            : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
        }`}
        title="Core Engine Analysis"
      >
        Core Engine
      </button>

      {/* Live Analysis Toggle */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-sm text-gray-400">Keep Live Analysis</span>
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
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <div className="px-3 py-1 bg-[#1a1a1a] rounded border border-gray-800">
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
          <div className="px-3 py-1 bg-[#1a1a1a] rounded border border-gray-800">
            <span className="text-gray-400">Regime: </span>
            <span className="font-semibold text-white">{analysis.regime}</span>
          </div>
          <div className="px-3 py-1 bg-[#1a1a1a] rounded border border-gray-800">
            <span className="text-gray-400">Confidence: </span>
            <span className="font-semibold text-white">
              {analysis.confidence.toFixed(0)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
