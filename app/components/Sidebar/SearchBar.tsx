'use client';

import { Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTradingStore } from '../../store/tradingStore';

export default function SearchBar() {
  const { searchQuery, setSearchQuery } = useTradingStore(
    useShallow((state) => ({ searchQuery: state.searchQuery, setSearchQuery: state.setSearchQuery }))
  );

  return (
    <div className="p-4 border-b border-gray-800">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
        <input
          type="text"
          placeholder="Search symbols..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-[#0a0a0a] border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#26a69a]"
        />
      </div>
    </div>
  );
}
