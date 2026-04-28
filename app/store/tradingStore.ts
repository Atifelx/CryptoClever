import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1D';

export interface TradingPair {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  name: string;
  displayName?: string;
  logoUrl?: string;
  volume?: number;
  priceChange?: number;
  lastPrice?: number;
  count?: number;
}

export interface TradingData {
  currentPrice: number;
  balance: number;
  openPositions: any[];
  orderHistory: any[];
}

interface TradingZone {
  type: 'BUY' | 'SELL';
  entryPrice: number;
  profitTarget: number;
  stopLoss: number;
  confidence: number;
  reasoning: string;
  time: number;
}

interface TradeSetup {
  direction: 'BUY' | 'SELL';
  entry: number;
  target: number;
  stop: number;
  expectedDuration: string;
  reasoning: string;
  confidence: number;
}

interface CoreEnginePrediction {
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
  whyUp: string;
  whyDown: string;
  expectedDuration: string;
  scalpTrade: TradeSetup | null;
  longTrade: TradeSetup | null;
}

interface SupportResistance {
  supportLevels: number[];
  resistanceLevels: number[];
  lastSwingLow?: number | null;
  lastSwingHigh?: number | null;
}

interface TradingState {
  selectedSymbol: string;
  selectedTimeframe: Timeframe;
  favorites: string[];
  tradingData: TradingData;
  searchQuery: string;
  filterMode: 'trending' | 'all' | 'cheap' | 'mostTrades';
  allPairs: TradingPair[];
  categorizedPairs: Record<string, TradingPair[]>;
  isLoadingPairs: boolean;
  tickerData: Record<string, {
    volume: number;
    priceChange: number;
    lastPrice: number;
    count: number;
  }>;
  showHistory: boolean;
  keepLiveAnalysis: boolean;
  coreEngineAnalysis: {
    structure: string;
    regime: string;
    confidence: number;
    reasoning?: string;
    zones?: TradingZone[];
    prediction?: CoreEnginePrediction;
    supportResistance?: SupportResistance;
    aiPowered?: boolean;
    analysisSource?: string;
  } | null;
  setSelectedSymbol: (symbol: string) => void;
  setSelectedTimeframe: (timeframe: Timeframe) => void;
  toggleFavorite: (symbol: string) => void;
  updateTradingData: (data: Partial<TradingData>) => void;
  setSearchQuery: (query: string) => void;
  setFilterMode: (mode: 'trending' | 'all' | 'cheap' | 'mostTrades') => void;
  setAllPairs: (pairs: TradingPair[], categorized: Record<string, TradingPair[]>) => void;
  setLoadingPairs: (loading: boolean) => void;
  setTickerData: (data: Record<string, { volume: number; priceChange: number; lastPrice: number; count: number }>) => void;
  setCoreEngineAnalysis: (analysis: any | null) => void;
  setKeepLiveAnalysis: (enabled: boolean) => void;
  setShowHistory: (show: boolean) => void;
}

export const BACKEND_SYMBOLS_FALLBACK: TradingPair[] = [
  { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', name: 'BTC/USDT', displayName: 'Bitcoin' },
  { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', name: 'ETH/USDT', displayName: 'Ethereum' },
  { symbol: 'C:XAUUSD', baseAsset: 'XAU', quoteAsset: 'USD', name: 'XAU/USD', displayName: 'Gold' },
  { symbol: 'C:GBPJPY', baseAsset: 'GBP', quoteAsset: 'JPY', name: 'GBP/JPY', displayName: 'British Pound / Yen' },
];

export const SYMBOL_DISPLAY: Record<string, { name: string; base: string; quote: string }> = Object.fromEntries(
  BACKEND_SYMBOLS_FALLBACK.map((p) => [p.symbol, { name: p.displayName || p.name, base: p.baseAsset, quote: p.quoteAsset }])
);

export const POPULAR_PAIRS: TradingPair[] = [...BACKEND_SYMBOLS_FALLBACK];

export const TIMEFRAMES = [
  { label: '5m', value: '5m' as Timeframe },
];

export const useTradingStore = create<TradingState>()(
  persist(
    (set) => ({
      selectedSymbol: 'BTCUSDT',
      selectedTimeframe: '5m',
      favorites: [],
      tradingData: {
        currentPrice: 0,
        balance: 10000,
        openPositions: [],
        orderHistory: [],
      },
      searchQuery: '',
      filterMode: 'trending',
      allPairs: POPULAR_PAIRS,
      categorizedPairs: { USDT: POPULAR_PAIRS },
      isLoadingPairs: false,
      tickerData: {},
      coreEngineAnalysis: null,
      keepLiveAnalysis: false,
      showHistory: false,

      setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
      setSelectedTimeframe: (timeframe) => set({ selectedTimeframe: timeframe }),
      toggleFavorite: (symbol) =>
        set((state) => {
          const newFavorites = state.favorites.includes(symbol)
            ? state.favorites.filter((s) => s !== symbol)
            : [...state.favorites, symbol];
          return { favorites: newFavorites };
        }),
      updateTradingData: (data) =>
        set((state) => ({
          tradingData: { ...state.tradingData, ...data },
        })),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setFilterMode: (mode) => set({ filterMode: mode }),
      setAllPairs: (pairs, categorized) => 
        set({ allPairs: pairs, categorizedPairs: categorized }),
      setLoadingPairs: (loading) => set({ isLoadingPairs: loading }),
      setTickerData: (data) => set({ tickerData: data }),
      setCoreEngineAnalysis: (analysis) => set({ coreEngineAnalysis: analysis }),
      setKeepLiveAnalysis: (enabled) => set({ keepLiveAnalysis: enabled }),
      setShowHistory: (show) => set({ showHistory: show }),
    }),
    {
      name: 'trading-storage',
      partialize: (state) => ({
        favorites: state.favorites,
        selectedSymbol: state.selectedSymbol,
        selectedTimeframe: state.selectedTimeframe,
      }),
      skipHydration: true,
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('Error rehydrating store:', error);
        } else if (state) {
          if (typeof state.selectedSymbol !== 'string') {
            state.selectedSymbol = 'BTCUSDT';
          }
          // Force 5m timeframe for everyone
          state.selectedTimeframe = '5m';
        }
      },
    }
  )
);
