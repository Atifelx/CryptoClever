'use client';

import { useTradingStore } from '../../store/tradingStore';
import LiveAnalysisToggle from './LiveAnalysisToggle';
import { Menu } from 'lucide-react';

interface NavbarProps {
  onMenuClick?: () => void;
  sidebarOpen?: boolean;
}

export default function Navbar({ onMenuClick, sidebarOpen }: NavbarProps) {
  const { selectedSymbol, allPairs } = useTradingStore();
  const selectedPair = allPairs.find((p) => p.symbol === selectedSymbol);

  return (
    <div className="bg-[#1a1a1a] border-b border-gray-800 py-2 px-4 flex-shrink-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile: menu button to toggle sidebar */}
          <button
            type="button"
            aria-label="Toggle symbol list"
            className="md:hidden p-2 -ml-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors flex-shrink-0"
            onClick={onMenuClick}
          >
            <Menu size={22} />
          </button>
          <div className="min-w-0">
            <h2 className="text-lg md:text-xl text-white font-bold truncate">
              {selectedPair?.baseAsset || selectedSymbol?.replace('USDT', '') || 'Bitcoin'}
            </h2>
            <p className="text-xs text-gray-500 truncate">{selectedSymbol || 'BTCUSDT'}</p>
          </div>
        </div>
        {/* Core Engine + Keep Live Analysis in top bar (parallel to symbol) */}
        <div className="flex items-center flex-shrink-0">
          <LiveAnalysisToggle />
        </div>
      </div>
    </div>
  );
}
