'use client';

import { useTradingStore } from '../../store/tradingStore';

export default function AccountInfo() {
  const { tradingData } = useTradingStore();

  return (
    <div className="bg-[#1a1a1a] border-t border-gray-800 p-4">
      <div className="flex gap-8 text-sm">
        <div>
          <span className="text-gray-500">Account Balance:</span>
          <span className="text-white ml-2 font-bold">
            ${tradingData.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-xs text-gray-600 ml-2">(Demo)</span>
        </div>
        <div>
          <span className="text-gray-500">Open Positions:</span>
          <span className="text-white ml-2">{tradingData.openPositions.length}</span>
        </div>
        <div>
          <span className="text-gray-500">Data Source:</span>
          <span className="text-green-500 ml-2">Binance (Free)</span>
        </div>
      </div>
    </div>
  );
}
