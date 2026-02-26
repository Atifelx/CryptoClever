'use client';

import { useEffect, useState } from 'react';
import { useTradingStore } from '../../store/tradingStore';
import { Star } from 'lucide-react';
import { getCryptoLogoUrl, getFallbackAvatarUrl } from '../../lib/cryptoLogos';
import { BACKEND_SYMBOLS_FALLBACK, SYMBOL_DISPLAY } from '../../store/tradingStore';
import type { TradingPair } from '../../store/tradingStore';

export default function SymbolList() {
  const {
    selectedSymbol,
    favorites,
    setSelectedSymbol,
    toggleFavorite,
    searchQuery,
    allPairs,
    setAllPairs,
    setLoadingPairs,
    isLoadingPairs,
  } = useTradingStore();

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['AVAILABLE'])
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingPairs(true);
    fetch('/api/backend/symbols', { headers: { Accept: 'application/json' } })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) return res.json();
        return null;
      })
      .then((data: { symbols?: string[] } | null) => {
        if (cancelled) return;
        if (data?.symbols && Array.isArray(data.symbols)) {
          const pairs: TradingPair[] = data.symbols
            .filter((s) => SYMBOL_DISPLAY[s])
            .map((s) => {
              const d = SYMBOL_DISPLAY[s];
              return {
                symbol: s,
                baseAsset: d.base,
                quoteAsset: 'USDT',
                name: `${d.base}/USDT`,
                displayName: d.name,
              };
            });
          if (pairs.length > 0) {
            setAllPairs(pairs, { USDT: pairs });
          }
        } else {
          setAllPairs(BACKEND_SYMBOLS_FALLBACK, { USDT: BACKEND_SYMBOLS_FALLBACK });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllPairs(BACKEND_SYMBOLS_FALLBACK, { USDT: BACKEND_SYMBOLS_FALLBACK });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPairs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setAllPairs, setLoadingPairs]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const handleSymbolClick = (symbol: string) => {
    setSelectedSymbol(symbol);
  };

  const filterPairs = (pairs: TradingPair[]) => {
    if (!searchQuery) return pairs;
    const q = searchQuery.toLowerCase();
    return pairs.filter(
      (p) =>
        p.symbol.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.baseAsset.toLowerCase().includes(q)
    );
  };

  const filteredPairs = filterPairs(allPairs);

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
              e.currentTarget.src = getFallbackAvatarUrl(symbol, base);
            }}
          />
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-white truncate">{base}</span>
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
    sectionId,
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
              className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
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
      <SectionHeader
        title="Available pairs (backend)"
        count={filteredPairs.length}
        sectionId="AVAILABLE"
      />
      {expandedSections.has('AVAILABLE') && (
        <div className="flex-1 overflow-y-auto border-b border-gray-800">
          {isLoadingPairs ? (
            <div className="p-4 text-center text-gray-500 text-sm">Loading symbols...</div>
          ) : (
            filteredPairs.map((pair) => (
              <PairItem
                key={pair.symbol}
                symbol={pair.symbol}
                name={pair.displayName || pair.name}
                base={pair.baseAsset}
              />
            ))
          )}
        </div>
      )}

      {searchQuery && filteredPairs.length === 0 && !isLoadingPairs && (
        <div className="p-4 text-center text-gray-500 text-sm">
          No pairs found for &quot;{searchQuery}&quot;
        </div>
      )}

      <div className="px-3 py-2 bg-gray-900 border-t border-gray-800">
        <div className="text-xs text-gray-500">Total: {filteredPairs.length} pairs</div>
      </div>
    </div>
  );
}
