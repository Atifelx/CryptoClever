'use client';

import { useEffect, useState } from 'react';
import TradingChart from './components/Chart/TradingChart';
import TradingSignalsPanel from './components/Chart/TradingSignalsPanel';
import IndicatorDashboard from './components/Chart/IndicatorDashboard';
import SymbolList from './components/Sidebar/SymbolList';
import SearchBar from './components/Sidebar/SearchBar';
import TimeframeSelector from './components/Header/TimeframeSelector';
import Navbar from './components/Header/Navbar';
import AccountInfo from './components/Footer/AccountInfo';
import { useTradingStore } from './store/tradingStore';
import { useBackendSettingsSync } from './hooks/useBackendSettingsSync';
import { useBackendCandlesLoader } from './hooks/useBackendCandlesLoader';
import { INDICATOR_REGISTRY } from './lib/indicators/registry';
import { SemaforPoint } from './lib/indicators/types';
import type { SemaforTrend } from './lib/indicators/semafor';
import type { ScalpDisplayItem } from './lib/indicators/scalpSignal';
import type { TrendMarker } from './lib/indicators/trendIndicator';

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const { selectedSymbol, selectedTimeframe } = useTradingStore();
  useBackendSettingsSync();
  useBackendCandlesLoader(); // Load all 10 symbols into Zustand, poll backend every 30s
  // Live candles are provided by `useCandles()` inside `TradingChart` (per-symbol WS).
  
  // Initialize enabled indicators from registry defaults
  const [enabledIndicators, setEnabledIndicators] = useState<Set<string>>(() => {
    const defaultSet = new Set<string>();
    Object.values(INDICATOR_REGISTRY).forEach(ind => {
      if (ind.defaultEnabled) {
        defaultSet.add(ind.id);
      }
    });
    return defaultSet;
  });

  useEffect(() => {
    // Ensure component is mounted on client side
    setIsMounted(true);
    
    // Load saved indicator preferences from localStorage
    // CRITICAL: filter to only valid registry IDs to prevent stale entries
    try {
      const saved = localStorage.getItem('enabled-indicators');
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        if (Array.isArray(parsed)) {
          const validIds = parsed.filter(id => INDICATOR_REGISTRY[id]);
          const savedSet = new Set<string>(validIds);
          setEnabledIndicators(savedSet);
          // Clean up stale entries in localStorage
          if (validIds.length !== parsed.length) {
            localStorage.setItem('enabled-indicators', JSON.stringify(validIds));
          }
        }
      } else {
        // No saved preferences - use registry defaults
        const defaultSet = new Set<string>();
        Object.values(INDICATOR_REGISTRY).forEach(ind => {
          if (ind.defaultEnabled) {
            defaultSet.add(ind.id);
          }
        });
        setEnabledIndicators(defaultSet);
        localStorage.setItem('enabled-indicators', JSON.stringify(Array.from(defaultSet)));
      }
    } catch (e) {
      console.warn('Error loading indicator preferences:', e);
    }
  }, []);

  // Save indicator preferences to localStorage
  const handleToggleIndicator = (id: string, enabled: boolean) => {
    setEnabledIndicators(prev => {
      const newSet = new Set(prev);
      if (enabled) {
        newSet.add(id);
      } else {
        newSet.delete(id);
      }
      
      // Save to localStorage
      try {
        localStorage.setItem('enabled-indicators', JSON.stringify(Array.from(newSet)));
      } catch (e) {
        console.warn('Error saving indicator preferences:', e);
      }
      
      return newSet;
    });
  };

  // Indicator data state (updated by TradingChart)
  const [indicatorData, setIndicatorData] = useState<{
    semaforPoints: SemaforPoint[];
    semaforTrend: SemaforTrend;
    scalpSignals: ScalpDisplayItem[];
    trendMarker: TrendMarker | null;
  }>({
    semaforPoints: [],
    semaforTrend: { trend: 'NEUTRAL', ema20: 0, ema50: 0 },
    scalpSignals: [],
    trendMarker: null,
  });

  // Use safe defaults during SSR
  const safeSymbol = isMounted ? selectedSymbol : 'BTCUSDT';
  const safeTimeframe = isMounted ? selectedTimeframe : '1m';

  return (
    <div className="flex h-screen bg-[#0a0a0a]">
      {/* Sidebar */}
      <div className="w-64 bg-[#1a1a1a] border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-2xl font-bold text-white">CryptoClever</h1>
          <p className="text-xs text-gray-500">
            Build by{' '}
            <a 
              href="https://www.linkedin.com/in/atif-shaikh" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-[#26a69a] hover:text-[#208a7e] hover:underline transition-colors"
            >
              Atif Shaikh
            </a>
          </p>
        </div>
        <SearchBar />
        <SymbolList />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header + compact controls (Indicators, Semafor, Core Engine in one row) */}
        <Navbar />
        <div className="bg-[#1a1a1a] border-b border-gray-800 py-2 px-4 flex flex-wrap items-center justify-between gap-2">
          <TimeframeSelector 
            enabledIndicators={enabledIndicators}
            onToggleIndicator={handleToggleIndicator}
          />
          <IndicatorDashboard
            enabledIndicators={enabledIndicators}
            semaforPoints={indicatorData.semaforPoints}
            semaforTrend={indicatorData.semaforTrend}
          />
        </div>

        {/* Trading Signals Panel - Above Chart */}
        <TradingSignalsPanel />

        {/* Chart */}
        <div key={`chart-${safeSymbol}-${safeTimeframe}`} className="flex-1 p-4 min-h-0">
          <TradingChart
            key={`tradingview-${safeSymbol}-${safeTimeframe}`}
            symbol={safeSymbol}
            interval={safeTimeframe}
            enabledIndicators={enabledIndicators}
            onToggleIndicator={handleToggleIndicator}
            onIndicatorDataUpdate={setIndicatorData}
          />
        </div>

        {/* Footer */}
        <AccountInfo />
      </div>
    </div>
  );
}
