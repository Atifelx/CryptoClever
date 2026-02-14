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
  // Dynamic trading metrics
  volume?: number;
  priceChange?: number;
  lastPrice?: number;
  count?: number; // Number of trades
}

export interface TradingData {
  currentPrice: number;
  balance: number;
  openPositions: any[];
  orderHistory: any[];
}

interface TradingState {
  // Selected trading pair and timeframe
  selectedSymbol: string;
  selectedTimeframe: Timeframe;
  
  // Favorites
  favorites: string[];
  
  // Trading data
  tradingData: TradingData;
  
  // Search
  searchQuery: string;
  
  // Filter mode
  filterMode: 'trending' | 'all' | 'cheap' | 'mostTrades';
  
  // All trading pairs (loaded from Binance)
  allPairs: TradingPair[];
  categorizedPairs: Record<string, TradingPair[]>;
  isLoadingPairs: boolean;
  
  // Ticker data for dynamic sorting
  tickerData: Record<string, {
    volume: number;
    priceChange: number;
    lastPrice: number;
    count: number;
  }>;
  
  // Actions
  setSelectedSymbol: (symbol: string) => void;
  setSelectedTimeframe: (timeframe: Timeframe) => void;
  toggleFavorite: (symbol: string) => void;
  updateTradingData: (data: Partial<TradingData>) => void;
  setSearchQuery: (query: string) => void;
  setFilterMode: (mode: 'trending' | 'all' | 'cheap' | 'mostTrades') => void;
  setAllPairs: (pairs: TradingPair[], categorized: Record<string, TradingPair[]>) => void;
  setLoadingPairs: (loading: boolean) => void;
  setTickerData: (data: Record<string, { volume: number; priceChange: number; lastPrice: number; count: number }>) => void;
}

// Popular pairs for initial display
export const POPULAR_PAIRS: TradingPair[] = [
  { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', name: 'BTC/USDT', displayName: 'Bitcoin' },
  { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', name: 'ETH/USDT', displayName: 'Ethereum' },
  { symbol: 'BNBUSDT', baseAsset: 'BNB', quoteAsset: 'USDT', name: 'BNB/USDT', displayName: 'Binance Coin' },
  { symbol: 'SOLUSDT', baseAsset: 'SOL', quoteAsset: 'USDT', name: 'SOL/USDT', displayName: 'Solana' },
  { symbol: 'XRPUSDT', baseAsset: 'XRP', quoteAsset: 'USDT', name: 'XRP/USDT', displayName: 'Ripple' },
  { symbol: 'ADAUSDT', baseAsset: 'ADA', quoteAsset: 'USDT', name: 'ADA/USDT', displayName: 'Cardano' },
  { symbol: 'DOGEUSDT', baseAsset: 'DOGE', quoteAsset: 'USDT', name: 'DOGE/USDT', displayName: 'Dogecoin' },
  { symbol: 'MATICUSDT', baseAsset: 'MATIC', quoteAsset: 'USDT', name: 'MATIC/USDT', displayName: 'Polygon' },
  { symbol: 'DOTUSDT', baseAsset: 'DOT', quoteAsset: 'USDT', name: 'DOT/USDT', displayName: 'Polkadot' },
  { symbol: 'LTCUSDT', baseAsset: 'LTC', quoteAsset: 'USDT', name: 'LTC/USDT', displayName: 'Litecoin' },
];

export const TIMEFRAMES = [
  { label: '1m', value: '1m' as Timeframe },
  { label: '5m', value: '5m' as Timeframe },
  { label: '15m', value: '15m' as Timeframe },
  { label: '1h', value: '1h' as Timeframe },
  { label: '4h', value: '4h' as Timeframe },
  { label: '1D', value: '1D' as Timeframe },
];

export const useTradingStore = create<TradingState>()(
  persist(
    (set) => ({
      // Initial state
      selectedSymbol: 'BTCUSDT',
      selectedTimeframe: '1m',
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

      // Actions
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
          if (typeof window !== 'undefined') {
            try {
              localStorage.removeItem('trading-storage');
            } catch (e) {
              console.error('Error clearing storage:', e);
            }
          }
        } else if (state) {
          // Validate and fix old data format
          if (state.selectedSymbol && typeof state.selectedSymbol === 'object') {
            const oldSymbol = state.selectedSymbol as any;
            state.selectedSymbol = oldSymbol.name || oldSymbol.symbol || 'BTCUSDT';
            console.warn('Migrated old symbol format to new format');
          }
          if (typeof state.selectedSymbol !== 'string') {
            state.selectedSymbol = 'BTCUSDT';
          }
        }
      },
    }
  )
);
