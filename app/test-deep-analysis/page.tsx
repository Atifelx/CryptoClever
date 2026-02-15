'use client';

import { useState } from 'react';

interface AnalysisResult {
  structure: string;
  regime: string;
  impulseScore: number;
  confidence: number;
  pivots: Array<{
    type: string;
    price: number;
    index: number;
    time: number;
  }>;
  cached?: boolean;
  symbol?: string;
  timeframe?: string;
  candlesCount?: number;
}

export default function TestDeepAnalysis() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testCount, setTestCount] = useState(0);
  const [cacheStatus, setCacheStatus] = useState<string>('');

  const testAnalysis = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setCacheStatus('');

    try {
      const response = await fetch('/api/deep-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: 'BTCUSDT',
          timeframe: '1h',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data: AnalysisResult = await response.json();
      setResult(data);
      setTestCount(prev => prev + 1);
      
      // Check cache status
      if (data.cached) {
        setCacheStatus('✅ CACHED (from Redis)');
      } else {
        setCacheStatus('🔄 FRESH (fetched from Binance)');
      }
    } catch (err: any) {
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Deep Analysis API Test</h1>
        
        <div className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-6 mb-6">
          <button
            onClick={testAnalysis}
            disabled={loading}
            className="bg-[#26a69a] hover:bg-[#208a7e] disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            {loading ? '🔄 Testing...' : '🚀 Test Deep Analysis'}
          </button>
          
          {testCount > 0 && (
            <div className="mt-4 text-sm text-gray-400">
              Tests run: {testCount}
            </div>
          )}
        </div>

        {cacheStatus && (
          <div className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-4 mb-6">
            <div className="text-lg font-semibold">{cacheStatus}</div>
            <div className="text-sm text-gray-400 mt-2">
              {result?.cached 
                ? 'This result was served from Redis cache (TTL: 900 seconds)'
                : 'This result was computed fresh and stored in Redis'}
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-500 rounded-lg p-4 mb-6">
            <div className="text-red-400 font-semibold">❌ Error</div>
            <div className="text-red-300 mt-2">{error}</div>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-bold mb-4">Analysis Results</h2>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="text-sm text-gray-400">Structure</div>
                  <div className="text-lg font-semibold">{result.structure}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Regime</div>
                  <div className="text-lg font-semibold">{result.regime}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Impulse Score</div>
                  <div className="text-lg font-semibold">{result.impulseScore.toFixed(2)}/100</div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Confidence</div>
                  <div className="text-lg font-semibold">{result.confidence.toFixed(2)}/100</div>
                </div>
              </div>

              {result.symbol && (
                <div className="mt-4 pt-4 border-t border-gray-800">
                  <div className="text-sm text-gray-400">Symbol: {result.symbol}</div>
                  <div className="text-sm text-gray-400">Timeframe: {result.timeframe}</div>
                  <div className="text-sm text-gray-400">Candles: {result.candlesCount}</div>
                  <div className="text-sm text-gray-400">Pivots Detected: {result.pivots.length}</div>
                </div>
              )}
            </div>

            {result.pivots.length > 0 && (
              <div className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-6">
                <h3 className="text-lg font-bold mb-4">Pivots (Last 10)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left p-2">Type</th>
                        <th className="text-left p-2">Price</th>
                        <th className="text-left p-2">Index</th>
                        <th className="text-left p-2">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.pivots.slice(-10).map((pivot, idx) => (
                        <tr key={idx} className="border-b border-gray-800/50">
                          <td className="p-2">
                            <span className={pivot.type === 'HIGH' ? 'text-red-400' : 'text-green-400'}>
                              {pivot.type}
                            </span>
                          </td>
                          <td className="p-2">${pivot.price.toFixed(2)}</td>
                          <td className="p-2">{pivot.index}</td>
                          <td className="p-2 text-gray-400">
                            {new Date(pivot.time).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-bold mb-2">Raw JSON</h3>
              <pre className="text-xs bg-[#0a0a0a] p-4 rounded overflow-auto max-h-96">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          </div>
        )}

        <div className="mt-8 bg-blue-900/20 border border-blue-500 rounded-lg p-4">
          <div className="text-blue-400 font-semibold mb-2">📋 Test Instructions</div>
          <ol className="list-decimal list-inside text-sm text-gray-300 space-y-1">
            <li>Click &quot;Test Deep Analysis&quot; button</li>
            <li>First request should show &quot;FRESH&quot; (fetched from Binance)</li>
            <li>Click again immediately - should show &quot;CACHED&quot; (from Redis)</li>
            <li>Wait 15+ minutes and click again - should show &quot;FRESH&quot; (TTL expired)</li>
            <li>Verify all fields are populated correctly</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
