'use client';

import { useEffect, useState } from 'react';

export interface TradeRow {
  id: string;
  symbol: string;
  side: string;
  amount: number;
  price: number;
  time: string | null;
}

export default function TradeHistoryPanel({ onClose }: { onClose: () => void }) {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrades = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/backend/trades?limit=100', {
        headers: { Accept: 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Failed to load trades');
        setTrades([]);
        return;
      }
      setTrades(Array.isArray(data) ? data : []);
    } catch (e) {
      setError('Backend unavailable');
      setTrades([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrades();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Trade History</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchTrades}
              disabled={loading}
              className="px-3 py-1.5 text-sm rounded bg-gray-700 text-white hover:bg-gray-600 disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading && trades.length === 0 ? (
            <div className="text-gray-400 text-center py-8">Loading...</div>
          ) : error ? (
            <div className="text-amber-500 text-center py-8">{error}</div>
          ) : trades.length === 0 ? (
            <div className="text-gray-500 text-center py-8">No trades yet.</div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2 pr-4">Symbol</th>
                  <th className="py-2 pr-4">Side</th>
                  <th className="py-2 pr-4">Amount</th>
                  <th className="py-2 pr-4">Price</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className="border-b border-gray-800 text-white">
                    <td className="py-2 pr-4 text-gray-400">
                      {t.time ? new Date(t.time).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 pr-4">{t.symbol}</td>
                    <td className="py-2 pr-4">{t.side}</td>
                    <td className="py-2 pr-4">{t.amount}</td>
                    <td className="py-2 pr-4">{t.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
