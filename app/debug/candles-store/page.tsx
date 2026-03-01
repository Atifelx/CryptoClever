'use client';

import { useEffect, useState } from 'react';
import { useCandlesStore } from '../../store/candlesStore';

/** BTC only */
const BACKEND_SYMBOLS = ['BTCUSDT'];

function BackendVerifyButton() {
  const [result, setResult] = useState<{
    symbols?: Record<string, { count: number; last_close: number | null; last_time: number | null }>;
    bug_detected?: boolean;
    message?: string;
    error?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchBackend = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/backend/debug/verify-unique-data', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      setResult(data);
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="bg-gray-800 rounded p-4">
      <h2 className="text-lg font-bold mb-2">Backend Verification</h2>
      <button
        onClick={fetchBackend}
        disabled={loading}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
      >
        {loading ? 'Checking...' : 'Verify Backend Data Uniqueness'}
      </button>
      {result && (
        <div className="mt-3 p-3 bg-gray-900 rounded">
          {result.error && <div className="text-red-400">{result.error}</div>}
          {result.message && <div className="text-white">{result.message}</div>}
          {result.bug_detected !== undefined && (
            <div className={result.bug_detected ? 'text-red-400' : 'text-green-400'}>
              {result.bug_detected ? '❌ Bug Detected!' : '✅ Data is Unique'}
            </div>
          )}
          {result.symbols && (
            <div className="mt-2">
              <div className="text-sm text-gray-400">Backend candles:</div>
              {Object.entries(result.symbols).map(([sym, info]) => (
                <div key={sym} className="text-xs text-gray-300 ml-2">
                  {sym}: {info.count} candles, last_close={info.last_close?.toFixed(2)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Debug page to visualize Zustand store state for candles.
 * Shows BTC 1m data only.
 */
export default function CandlesStorePage() {
  const btcCandles = useCandlesStore((s) => s.btcCandles);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="p-8 text-white">Loading...</div>;
  }

  return (
    <div className="p-8 bg-[#1a1a1a] text-white min-h-screen">
      <h1 className="text-2xl font-bold mb-4">🔍 Candles Store Debug (BTC Only)</h1>
      <BackendVerifyButton />
      <div className="mt-6 bg-gray-800 rounded p-4">
        <h2 className="text-lg font-bold mb-2">BTC/USDT 1m Store State</h2>
        <div className="text-sm text-gray-400 mb-2">
          Candles in store: {btcCandles.length}
        </div>
        {btcCandles.length > 0 ? (
          <div className="space-y-2">
            <div className="text-xs text-gray-300">
              <div>First: time={btcCandles[0].time}, close={btcCandles[0].close.toFixed(2)}</div>
              <div>
                Last: time={btcCandles[btcCandles.length - 1].time}, close=
                {btcCandles[btcCandles.length - 1].close.toFixed(2)}
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto bg-gray-900 rounded p-2">
              <pre className="text-xs text-gray-400">
                {JSON.stringify(btcCandles.slice(-20), null, 2)}
              </pre>
            </div>
          </div>
        ) : (
          <div className="text-gray-500 text-sm">No candles in store yet...</div>
        )}
      </div>
    </div>
  );
}
