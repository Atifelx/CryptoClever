'use client';

import { useEffect, useState } from 'react';
import { useTradingStore } from '../../store/tradingStore';
import { Star } from 'lucide-react';
import { getCryptoLogoUrl } from '../../lib/cryptoLogos';

// CURATED LIST: Only high-quality, liquid trading pairs
const CURATED_PAIRS = {
  marketLeaders: [
    { symbol: 'BTCUSDT', name: 'Bitcoin', base: 'BTC' },
    { symbol: 'ETHUSDT', name: 'Ethereum', base: 'ETH' },
    { symbol: 'SOLUSDT', name: 'Solana', base: 'SOL' },
    { symbol: 'XRPUSDT', name: 'XRP', base: 'XRP' },
    { symbol: 'BNBUSDT', name: 'BNB', base: 'BNB' },
  ],
  highLiquidity: [
    { symbol: 'AVAXUSDT', name: 'Avalanche', base: 'AVAX' },
    { symbol: 'LINKUSDT', name: 'Chainlink', base: 'LINK' },
    { symbol: 'DOTUSDT', name: 'Polkadot', base: 'DOT' },
    { symbol: 'LTCUSDT', name: 'Litecoin', base: 'LTC' },
    { symbol: 'TRXUSDT', name: 'Tron', base: 'TRX' },
    { symbol: 'MATICUSDT', name: 'Polygon', base: 'MATIC' },
    { symbol: 'ADAUSDT', name: 'Cardano', base: 'ADA' },
  ],
};

export default function SymbolList() {
  const { 
    selectedSymbol, 
    favorites, 
    setSelectedSymbol, 
    toggleFavorite, 
    searchQuery,
  } = useTradingStore();

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['MARKET_LEADERS', 'HIGH_LIQUIDITY'])
  );

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(section)) {
        newSet.delete(section);
      } else {
        newSet.add(section);
      }
      return newSet;
    });
  };

  const handleSymbolClick = (symbol: string) => {
    console.log('📍 Symbol selected:', symbol);
    setSelectedSymbol(symbol);
  };

  // Filter pairs based on search query
  const filterPairs = (pairs: typeof CURATED_PAIRS.marketLeaders) => {
    if (!searchQuery) return pairs;
    const query = searchQuery.toLowerCase();
    return pairs.filter(pair => 
      pair.symbol.toLowerCase().includes(query) ||
      pair.name.toLowerCase().includes(query) ||
      pair.base.toLowerCase().includes(query)
    );
  };

  const filteredMarketLeaders = filterPairs(CURATED_PAIRS.marketLeaders);
  const filteredHighLiquidity = filterPairs(CURATED_PAIRS.highLiquidity);

  const PairItem = ({ symbol, name, base }: { symbol: string; name: string; base: string }) => {
    const isFavorite = favorites.includes(symbol);
    const isSelected = selectedSymbol === symbol;

    return (
      <div
        className={`flex items-center justify-between px-3 py-2.5 cursor-pointer transition-colors ${
          isSelected
            ? 'bg-[#26a69a] bg-opacity-20 border-l-2 border-[#26a69a]'
            : 'hover:bg-gray-800'
        }`}
        onClick={() => handleSymbolClick(symbol)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <img
            src={getCryptoLogoUrl(symbol, base)}
            alt={name}
            className="w-6 h-6 rounded-full flex-shrink-0"
            onError={(e) => {
              e.currentTarget.src = getCryptoLogoUrl(symbol, base);
            }}
          />
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-white truncate">
                {base}
              </span>
              <span className="text-xs text-gray-500">/USDT</span>
            </div>
            <span className="text-xs text-gray-400 truncate">{name}</span>
          </div>
        </div>
        
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(symbol);
          }}
          className="ml-2 p-1 hover:bg-gray-700 rounded transition-colors flex-shrink-0"
        >
          <Star
            size={14}
            className={isFavorite ? 'fill-yellow-500 text-yellow-500' : 'text-gray-500'}
          />
        </button>
      </div>
    );
  };

  const SectionHeader = ({ 
    title, 
    count, 
    sectionId 
  }: { 
    title: string; 
    count: number; 
    sectionId: string;
  }) => {
    const isExpanded = expandedSections.has(sectionId);
    
    return (
      <div
        className="px-3 py-2 bg-gray-800 cursor-pointer hover:bg-gray-750 transition-colors"
        onClick={() => toggleSection(sectionId)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${
                isExpanded ? 'rotate-90' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
            <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
              {title}
            </span>
          </div>
          <span className="text-xs text-gray-500">{count}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Market Leaders Section */}
      <SectionHeader 
        title="🏆 Market Leaders" 
        count={filteredMarketLeaders.length} 
        sectionId="MARKET_LEADERS"
      />
      {expandedSections.has('MARKET_LEADERS') && (
        <div className="border-b border-gray-800">
          {filteredMarketLeaders.map(pair => (
            <PairItem
              key={pair.symbol}
              symbol={pair.symbol}
              name={pair.name}
              base={pair.base}
            />
          ))}
        </div>
      )}

      {/* High Liquidity Section */}
      <SectionHeader 
        title="🚀 High Liquidity + Strong Volatility" 
        count={filteredHighLiquidity.length} 
        sectionId="HIGH_LIQUIDITY"
      />
      {expandedSections.has('HIGH_LIQUIDITY') && (
        <div className="flex-1 overflow-y-auto">
          {filteredHighLiquidity.map(pair => (
            <PairItem
              key={pair.symbol}
              symbol={pair.symbol}
              name={pair.name}
              base={pair.base}
            />
          ))}
        </div>
      )}

      {/* Search Results Info */}
      {searchQuery && (filteredMarketLeaders.length + filteredHighLiquidity.length) === 0 && (
        <div className="p-4 text-center text-gray-500 text-sm">
          No pairs found for &quot;{searchQuery}&quot;
        </div>
      )}

      {/* Total Count */}
      <div className="px-3 py-2 bg-gray-900 border-t border-gray-800">
        <div className="text-xs text-gray-500">
          Total: {filteredMarketLeaders.length + filteredHighLiquidity.length} pairs
        </div>
      </div>
    </div>
  );
}
