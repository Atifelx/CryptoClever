'use client';

import { useTradingStore } from '../../store/tradingStore';

export default function Navbar() {
  const { selectedSymbol, allPairs } = useTradingStore();
  const selectedPair = allPairs.find((p) => p.symbol === selectedSymbol);

  return (
    <div className="bg-[#1a1a1a] border-b border-gray-800 py-2 px-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl text-white font-bold">
            {selectedPair?.baseAsset || selectedSymbol?.replace('USDT', '') || 'Bitcoin'}
          </h2>
          <p className="text-sm text-gray-500">{selectedSymbol || 'BTCUSDT'}</p>
        </div>
      </div>
    </div>
  );
}
