'use client';

import { useEffect, useState, useMemo } from 'react';
import { useTradingStore, TradingPair } from '../../store/tradingStore';
import { Star, ChevronDown, ChevronRight, Loader } from 'lucide-react';
import { getCryptoLogoUrl } from '../../lib/cryptoLogos';
import { fetchTopTradingPairs, isPopularPair, getPairPriority } from '../../lib/popularPairs';
import PairFilter from './PairFilter';

const CATEGORY_ORDER = ['USDT', 'BTC', 'ETH', 'BNB', 'BUSD', 'USDC', 'OTHER'];
const CATEGORY_LABELS: Record<string, string> = {
  USDT: 'USDT Pairs',
  BTC: 'BTC Pairs',
  ETH: 'ETH Pairs',
  BNB: 'BNB Pairs',
  BUSD: 'BUSD Pairs',
  USDC: 'USDC Pairs',
  OTHER: 'Other Pairs',
};

export default function SymbolList() {
  const { 
    selectedSymbol, 
    favorites, 
    setSelectedSymbol, 
    toggleFavorite, 
    searchQuery,
    filterMode,
    categorizedPairs,
    allPairs,
    isLoadingPairs,
    setAllPairs,
    setLoadingPairs,
    tickerData,
    setTickerData,
  } = useTradingStore();

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['POPULAR', 'USDT']));
  const [isLoading, setIsLoading] = useState(false);
  const [topTradingPairs, setTopTradingPairs] = useState<Set<string>>(new Set());

  // Fetch ticker data for dynamic sorting (updates every minute)
  useEffect(() => {
    const fetchTickerData = async () => {
      try {
        const response = await fetch('/api/binance/ticker');
        if (response.ok) {
          const data = await response.json();
          const tickerMap: Record<string, { volume: number; priceChange: number; lastPrice: number; count: number }> = {};
          
          data.tickers?.forEach((ticker: any) => {
            tickerMap[ticker.symbol] = {
              volume: ticker.volume || 0,
              priceChange: ticker.priceChange || 0,
              lastPrice: ticker.lastPrice || 0,
              count: ticker.count || 0,
            };
          });
          
          setTickerData(tickerMap);
          
          // Update top trading pairs set
          const topPairs = data.tickers
            ?.slice(0, 80)
            .map((t: any) => t.symbol) || [];
          setTopTradingPairs(new Set(topPairs));
        }
      } catch (error) {
        console.error('Error fetching ticker data:', error);
      }
    };
    
    // Fetch immediately
    fetchTickerData();
    
    // Update every 60 seconds for dynamic data
    const interval = setInterval(fetchTickerData, 60000);
    
    return () => clearInterval(interval);
  }, [setTickerData]);

  // Fetch all pairs on mount (but filter to top 80 by volume)
  useEffect(() => {
    if (allPairs.length > 10) return; // Already loaded

    const fetchPairs = async () => {
      setIsLoading(true);
      setLoadingPairs(true);
      try {
        // First get top trading pairs by volume (returns array, convert to Set)
        const topPairsArray = await fetchTopTradingPairs(80);
        const topPairsSet = new Set(topPairsArray);
        
        // Then fetch all symbols
        const response = await fetch('/api/binance/symbols');
        if (response.ok) {
          const data = await response.json();
          const pairs: TradingPair[] = [];
          
          // Flatten categorized pairs and filter to top 80 by volume
          Object.values(data.pairs || {}).forEach((categoryPairs: any) => {
            if (Array.isArray(categoryPairs)) {
              categoryPairs.forEach((pair: any) => {
                // Only include if it's in top 80 by volume
                if (topPairsSet.has(pair.symbol)) {
                  pairs.push({
                    symbol: pair.symbol,
                    baseAsset: pair.baseAsset,
                    quoteAsset: pair.quoteAsset,
                    name: pair.name,
                    logoUrl: pair.logoUrl,
                  });
                }
              });
            }
          });

          // Create categorized object with only top pairs
          const filteredCategorized: Record<string, TradingPair[]> = {};
          pairs.forEach((pair) => {
            const category = pair.quoteAsset || 'OTHER';
            if (!filteredCategorized[category]) {
              filteredCategorized[category] = [];
            }
            filteredCategorized[category].push(pair);
          });

          setAllPairs(pairs, filteredCategorized);
          console.log(`Loaded ${pairs.length} top trading pairs (by volume)`);
        }
      } catch (error) {
        console.error('Error fetching trading pairs:', error);
      } finally {
        setIsLoading(false);
        setLoadingPairs(false);
      }
    };

    fetchPairs();
  }, [allPairs.length, setAllPairs, setLoadingPairs]);

  // Filter and sort pairs based on filter mode (dynamic)
  const filteredCategorized = useMemo(() => {
    const result: Record<string, TradingPair[]> = {};
    
    // Get all pairs with ticker data
    const pairsWithData = allPairs.map(pair => ({
      ...pair,
      volume: tickerData[pair.symbol]?.volume || 0,
      priceChange: tickerData[pair.symbol]?.priceChange || 0,
      lastPrice: tickerData[pair.symbol]?.lastPrice || 0,
      count: tickerData[pair.symbol]?.count || 0,
    }));
    
    // Apply filter mode
    let filteredPairs: TradingPair[] = [];
    
    switch (filterMode) {
      case 'trending':
        // Top trending: High volume + positive price change (profitable)
        filteredPairs = pairsWithData
          .filter(p => p.volume > 0 && p.priceChange > 0)
          .sort((a, b) => {
            // Sort by volume * price change (profit potential)
            const aScore = a.volume * (1 + a.priceChange / 100);
            const bScore = b.volume * (1 + b.priceChange / 100);
            return bScore - aScore;
          })
          .slice(0, 80);
        break;
        
      case 'mostTrades':
        // Most trades: Sort by number of trades (count)
        filteredPairs = pairsWithData
          .filter(p => p.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 80);
        break;
        
      case 'cheap':
        // Cheap: Sort by price low to high
        filteredPairs = pairsWithData
          .filter(p => p.lastPrice > 0)
          .sort((a, b) => a.lastPrice - b.lastPrice);
        break;
        
      case 'all':
      default:
        // All pairs: Show all, sorted by volume
        filteredPairs = pairsWithData
          .sort((a, b) => b.volume - a.volume);
        break;
    }
    
    // Apply search query if provided
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredPairs = filteredPairs.filter((pair) =>
        pair.symbol.toLowerCase().includes(query) ||
        pair.baseAsset.toLowerCase().includes(query) ||
        pair.name.toLowerCase().includes(query)
      );
    }
    
    // Categorize filtered pairs
    filteredPairs.forEach((pair) => {
      const category = pair.quoteAsset || 'OTHER';
      if (!result[category]) {
        result[category] = [];
      }
      result[category].push(pair);
    });
    
    return result;
  }, [allPairs, tickerData, filterMode, searchQuery]);

  // Get favorite pairs
  const favoritePairs = useMemo(() => {
    return allPairs.filter((pair) => favorites.includes(pair.symbol));
  }, [allPairs, favorites]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  // Separate component for pair item to use hooks
  const PairItem = ({ pair }: { pair: TradingPair }) => {
    const isSelected = selectedSymbol === pair.symbol;
    const isFavorite = favorites.includes(pair.symbol);
    const [logoUrl, setLogoUrl] = useState<string>(pair.logoUrl || '');
    const [imageError, setImageError] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);

    // Get logo URL immediately (no async needed - ui-avatars is instant)
    useEffect(() => {
      if (pair.logoUrl) {
        setLogoUrl(pair.logoUrl);
      } else {
        // Generate logo URL directly (ui-avatars is 100% reliable, no need for async)
        setLogoUrl(getCryptoLogoUrl(pair.symbol, pair.baseAsset));
      }
    }, [pair.symbol, pair.baseAsset, pair.logoUrl]);

    return (
      <div
        onClick={() => setSelectedSymbol(pair.symbol)}
        className={`w-full flex items-center justify-between p-2.5 rounded-lg transition-colors cursor-pointer ${
          isSelected
            ? 'bg-[#26a69a] text-white'
            : 'bg-[#1a1a1a] text-gray-300 hover:bg-[#2a2a2a]'
        }`}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Crypto Logo */}
          <div className="flex-shrink-0 relative">
            {!imageError ? (
              <img
                src={logoUrl}
                alt={pair.baseAsset}
                className="w-8 h-8 rounded-full object-cover border border-gray-700"
                onError={() => {
                  setImageError(true);
                }}
                onLoad={() => {
                  setImageLoaded(true);
                  setImageError(false);
                }}
                loading="lazy"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#26a69a] border border-gray-700 flex items-center justify-center">
                <span className="text-xs font-semibold text-white">
                  {pair.baseAsset.substring(0, 2).toUpperCase()}
                </span>
              </div>
            )}
          </div>
          
          {/* Symbol Info */}
          <div className="text-left flex-1 min-w-0">
            <div className="font-semibold text-sm truncate">{pair.baseAsset}</div>
            <div className="text-xs opacity-75 truncate">{pair.symbol}</div>
          </div>
        </div>
        
        {/* Favorite Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(pair.symbol);
          }}
          className={`p-1 rounded flex-shrink-0 ${
            isFavorite ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400'
          }`}
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>
    );
  };

  const renderPair = (pair: TradingPair) => {
    return <PairItem key={pair.symbol} pair={pair} />;
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      {/* Filter Component */}
      <PairFilter />
      
      {isLoading && (
        <div className="flex items-center justify-center p-4">
          <Loader className="animate-spin text-[#26a69a]" size={20} />
          <span className="ml-2 text-sm text-gray-400">Loading all pairs...</span>
        </div>
      )}

      <div className="p-2 space-y-2">
        {/* Favorites Section */}
        {favoritePairs.length > 0 && (
          <div>
            <div className="text-xs text-gray-500 uppercase px-2 py-1.5 font-semibold tracking-wider flex items-center">
              <Star size={12} className="mr-1 text-yellow-400" />
              Favorites ({favoritePairs.length})
            </div>
            <div className="space-y-1">
              {favoritePairs.map(renderPair)}
            </div>
          </div>
        )}

        {/* Dynamic Top Trading Pairs Section */}
        {!searchQuery && filterMode === 'trending' && (() => {
          const topPairs = Object.values(filteredCategorized)
            .flat()
            .slice(0, 80);
          
          if (topPairs.length > 0) {
            const isExpanded = expandedCategories.has('POPULAR');
            return (
              <div className="mb-4">
                <button
                  onClick={() => toggleCategory('POPULAR')}
                  className="w-full flex items-center justify-between px-2 py-1.5 text-xs text-yellow-400 uppercase font-semibold tracking-wider hover:text-yellow-300 transition-colors"
                >
                  <span>
                    ⭐ Top {topPairs.length} Trending Pairs (High Volume & Profit)
                  </span>
                  {isExpanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
                {isExpanded && (
                  <div className="space-y-1 mt-1">
                    {topPairs.map(renderPair)}
                  </div>
                )}
              </div>
            );
          }
          return null;
        })()}

        {/* Categorized Pairs */}
        {CATEGORY_ORDER.map((category) => {
          const pairs = filteredCategorized[category] || [];
          if (pairs.length === 0) return null;

          // For trending mode, top pairs are shown separately
          const displayPairs = (filterMode === 'trending' && !searchQuery)
            ? pairs.filter(p => {
                const topPairs = Object.values(filteredCategorized).flat().slice(0, 80);
                return !topPairs.find(tp => tp.symbol === p.symbol);
              })
            : pairs;
          
          if (displayPairs.length === 0 && !searchQuery && filterMode === 'trending') return null;

          const isExpanded = expandedCategories.has(category);

          return (
            <div key={category}>
              <button
                onClick={() => toggleCategory(category)}
                className="w-full flex items-center justify-between px-2 py-1.5 text-xs text-gray-500 uppercase font-semibold tracking-wider hover:text-gray-400 transition-colors"
              >
                <span>
                  {CATEGORY_LABELS[category] || `${category} Pairs`} ({displayPairs.length})
                </span>
                {isExpanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </button>
              {isExpanded && (
                <div className="space-y-1 mt-1">
                  {displayPairs.slice(0, 100).map(renderPair)}
                  {displayPairs.length > 100 && (
                    <div className="text-xs text-gray-500 px-2 py-1 text-center">
                      +{displayPairs.length - 100} more pairs
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Other Categories */}
        {Object.keys(filteredCategorized)
          .filter((cat) => !CATEGORY_ORDER.includes(cat))
          .map((category) => {
            const pairs = filteredCategorized[category] || [];
            if (pairs.length === 0) return null;

            const isExpanded = expandedCategories.has(category);

            return (
              <div key={category}>
                <button
                  onClick={() => toggleCategory(category)}
                  className="w-full flex items-center justify-between px-2 py-1.5 text-xs text-gray-500 uppercase font-semibold tracking-wider hover:text-gray-400 transition-colors"
                >
                  <span>
                    {category} Pairs ({pairs.length})
                  </span>
                  {isExpanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
                {isExpanded && (
                  <div className="space-y-1 mt-1">
                    {pairs.slice(0, 50).map(renderPair)}
                    {pairs.length > 50 && (
                      <div className="text-xs text-gray-500 px-2 py-1 text-center">
                        +{pairs.length - 50} more pairs
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

        {!isLoading && Object.keys(filteredCategorized).length === 0 && (
          <div className="text-center text-gray-500 text-sm py-8">
            No pairs found matching &quot;{searchQuery}&quot;
          </div>
        )}
      </div>
    </div>
  );
}
