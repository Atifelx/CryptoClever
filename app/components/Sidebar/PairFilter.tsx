'use client';

import { useTradingStore } from '../../store/tradingStore';
import { TrendingUp, List, DollarSign, Activity } from 'lucide-react';

export default function PairFilter() {
  const { filterMode, setFilterMode } = useTradingStore();

  const filters = [
    { 
      id: 'trending' as const, 
      label: 'Top Trending', 
      icon: TrendingUp,
      description: 'High volume & profit'
    },
    { 
      id: 'mostTrades' as const, 
      label: 'Most Trades', 
      icon: Activity,
      description: 'Maximum trades/day'
    },
    { 
      id: 'cheap' as const, 
      label: 'Cheap (Low→High)', 
      icon: DollarSign,
      description: 'Price low to high'
    },
    { 
      id: 'all' as const, 
      label: 'All Pairs', 
      icon: List,
      description: 'Show all pairs'
    },
  ];

  return (
    <div className="p-3 border-b border-gray-800 bg-[#0a0a0a]">
      <div className="text-xs text-gray-500 uppercase font-semibold tracking-wider mb-2 px-1">
        Filter Pairs
      </div>
      <div className="grid grid-cols-2 gap-2">
        {filters.map((filter) => {
          const Icon = filter.icon;
          const isActive = filterMode === filter.id;
          
          return (
            <button
              key={filter.id}
              onClick={() => setFilterMode(filter.id)}
              className={`
                flex flex-col items-center justify-center p-2.5 rounded-lg transition-all
                ${isActive 
                  ? 'bg-[#26a69a] text-white shadow-lg shadow-[#26a69a]/20' 
                  : 'bg-[#1a1a1a] text-gray-400 hover:bg-[#2a2a2a] hover:text-gray-300'
                }
              `}
              title={filter.description}
            >
              <Icon size={16} className="mb-1" />
              <span className="text-xs font-medium">{filter.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
