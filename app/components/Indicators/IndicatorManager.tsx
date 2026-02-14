'use client';

import { useState, useMemo, useEffect } from 'react';
import { INDICATOR_REGISTRY, IndicatorConfig } from '../../lib/indicators/registry';

interface IndicatorManagerProps {
  enabledIndicators: Set<string>;
  onToggleIndicator: (id: string, enabled: boolean) => void;
  onClose: () => void;
}

type CategoryFilter = 'all' | 'trend' | 'oscillator' | 'overlay' | 'volume' | 'support-resistance';

export default function IndicatorManager({
  enabledIndicators,
  onToggleIndicator,
  onClose,
}: IndicatorManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('all');

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  // Get all categories from registry
  const categories: CategoryFilter[] = ['all', 'trend', 'oscillator', 'overlay', 'volume', 'support-resistance'];

  const categoryLabels: Record<CategoryFilter, string> = {
    all: 'All Indicators',
    trend: 'Trend',
    oscillator: 'Oscillators',
    overlay: 'Overlays',
    volume: 'Volume',
    'support-resistance': 'Support/Resistance',
  };

  // Filter indicators
  const filteredIndicators = useMemo(() => {
    let allIndicators = Object.values(INDICATOR_REGISTRY);

    // Filter by category
    if (selectedCategory !== 'all') {
      allIndicators = allIndicators.filter(ind => ind.category === selectedCategory);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      allIndicators = allIndicators.filter(
        ind =>
          ind.name.toLowerCase().includes(query) ||
          ind.description.toLowerCase().includes(query) ||
          ind.category.toLowerCase().includes(query)
      );
    }

    // Sort: enabled first, then alphabetically
    return allIndicators.sort((a, b) => {
      const aEnabled = enabledIndicators.has(a.id);
      const bEnabled = enabledIndicators.has(b.id);
      if (aEnabled !== bEnabled) {
        return aEnabled ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [searchQuery, selectedCategory, enabledIndicators]);

  const handleToggle = (id: string, enabled: boolean) => {
    onToggleIndicator(id, enabled);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        className="bg-[#1a1a1a] border border-gray-800 rounded-lg w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <div>
            <h2 className="text-2xl font-bold text-white">Indicators</h2>
            <p className="text-sm text-gray-400 mt-1">
              Add technical indicators to your chart
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-[#2a2a2a] rounded-lg"
            aria-label="Close"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search and Category Filter */}
        <div className="p-6 border-b border-gray-800 space-y-4">
          <div className="relative">
            <input
              type="text"
              placeholder="Search indicators..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-3 bg-[#2a2a2a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#26a69a] focus:border-transparent transition-all"
              autoFocus
            />
            <svg 
              className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                  selectedCategory === cat
                    ? 'bg-[#26a69a] text-white shadow-lg shadow-[#26a69a]/20'
                    : 'bg-[#2a2a2a] text-gray-400 hover:bg-[#3a3a3a] hover:text-gray-300'
                }`}
              >
                {categoryLabels[cat]}
              </button>
            ))}
          </div>
        </div>

        {/* Indicator List */}
        <div className="flex-1 overflow-y-auto p-6">
          {filteredIndicators.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-lg font-medium">No indicators found</p>
              <p className="text-sm mt-2">Try adjusting your search or category filter</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredIndicators.map((indicator) => {
                const isEnabled = enabledIndicators.has(indicator.id);
                return (
                  <div
                    key={indicator.id}
                    className={`flex items-center justify-between p-4 rounded-lg transition-all cursor-pointer ${
                      isEnabled
                        ? 'bg-[#26a69a]/10 border border-[#26a69a]/30 hover:bg-[#26a69a]/15'
                        : 'bg-[#2a2a2a] border border-transparent hover:bg-[#3a3a3a]'
                    }`}
                    onClick={() => handleToggle(indicator.id, !isEnabled)}
                  >
                    <div className="flex items-center gap-4 flex-1">
                      <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-2xl ${
                        isEnabled ? 'bg-[#26a69a]/20' : 'bg-[#3a3a3a]'
                      }`}>
                        {indicator.icon || '📊'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-white font-semibold">{indicator.name}</h3>
                          {isEnabled && (
                            <span className="px-2 py-0.5 bg-[#26a69a] text-white text-xs rounded-full font-medium">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-400 mt-1 line-clamp-2">
                          {indicator.description}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs px-2 py-0.5 bg-[#2a2a2a] text-gray-500 rounded">
                            {categoryLabels[indicator.category]}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <label 
                      className="relative inline-flex items-center cursor-pointer ml-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(e) => handleToggle(indicator.id, e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-12 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#26a69a] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#26a69a]"></div>
                    </label>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-800 flex items-center justify-between bg-[#1a1a1a]">
          <div className="text-sm text-gray-400">
            <span className="font-semibold text-white">{enabledIndicators.size}</span>{' '}
            indicator{enabledIndicators.size !== 1 ? 's' : ''} enabled
          </div>
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-[#26a69a] text-white rounded-lg hover:bg-[#208a7e] transition-colors font-medium shadow-lg shadow-[#26a69a]/20"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
