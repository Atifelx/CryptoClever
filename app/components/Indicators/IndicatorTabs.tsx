'use client';

import { useState } from 'react';
import { SemaforPoint } from '../../lib/indicators/types';
import { INDICATOR_REGISTRY } from '../../lib/indicators/registry';

interface IndicatorTabsProps {
  semaforPoints: SemaforPoint[];
  currentPrice: number;
  enabledIndicators: Set<string>;
  onToggleIndicator: (id: string, enabled: boolean) => void;
}

type TabType = 'overview' | 'settings';

export default function IndicatorTabs({
  semaforPoints,
  currentPrice,
  enabledIndicators,
  onToggleIndicator,
}: IndicatorTabsProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const tabs = [
    { id: 'overview' as TabType, label: 'Overview' },
    { id: 'settings' as TabType, label: 'Settings' },
  ];

  const isEnabled = (id: string) => enabledIndicators.has(id);

  // Calculate support and resistance from Semafor points
  const resistanceLevels = semaforPoints
    .filter(p => p.type === 'high' && p.price > currentPrice)
    .sort((a, b) => a.price - b.price)
    .slice(0, 5);

  const supportLevels = semaforPoints
    .filter(p => p.type === 'low' && p.price < currentPrice)
    .sort((a, b) => b.price - a.price)
    .slice(0, 5);

  return (
    <div className="bg-[#1a1a1a] border-t border-gray-800">
      {/* Tab Headers */}
      <div className="flex border-b border-gray-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-3 text-sm font-medium transition-colors relative ${
              activeTab === tab.id
                ? 'text-[#26a69a] border-b-2 border-[#26a69a]'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="p-4">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Enabled Indicators Summary */}
            <div className="mb-4">
              <h3 className="text-white font-semibold mb-2">Active Indicators</h3>
              <div className="flex flex-wrap gap-2">
                {Array.from(enabledIndicators).map((id) => {
                  const indicator = INDICATOR_REGISTRY[id];
                  if (!indicator) return null;
                  return (
                    <div
                      key={id}
                      className="px-3 py-1 bg-[#2a2a2a] rounded-lg text-sm flex items-center gap-2"
                    >
                      <span>{indicator.icon}</span>
                      <span className="text-gray-300">{indicator.name}</span>
                      <button
                        onClick={() => onToggleIndicator(id, false)}
                        className="text-gray-500 hover:text-red-500 ml-1"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                {enabledIndicators.size === 0 && (
                  <div className="text-gray-500 text-sm">No indicators enabled</div>
                )}
              </div>
            </div>

            {/* Semafor Statistics */}
            {isEnabled('semafor') && (
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-[#2a2a2a] p-4 rounded-lg">
                  <div className="text-red-500 font-semibold mb-2 flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-500"></span>
                    Resistance Pivots
                  </div>
                  <div className="text-white text-2xl font-bold">
                    {semaforPoints.filter(p => p.type === 'high').length}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Strong: {semaforPoints.filter(p => p.type === 'high' && p.strength === 3).length} | 
                    Medium: {semaforPoints.filter(p => p.type === 'high' && p.strength === 2).length}
                  </div>
                </div>
                <div className="bg-[#2a2a2a] p-4 rounded-lg">
                  <div className="text-green-500 font-semibold mb-2 flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-green-500"></span>
                    Support Pivots
                  </div>
                  <div className="text-white text-2xl font-bold">
                    {semaforPoints.filter(p => p.type === 'low').length}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Strong: {semaforPoints.filter(p => p.type === 'low' && p.strength === 3).length} | 
                    Medium: {semaforPoints.filter(p => p.type === 'low' && p.strength === 2).length}
                  </div>
                </div>
              </div>
            )}

            {/* Key Levels from Semafor */}
            <div className="grid grid-cols-3 gap-4">
              {/* Resistance */}
              <div className="bg-[#2a2a2a] p-4 rounded-lg">
                <div className="text-red-500 font-semibold mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  Resistance
                </div>
                {resistanceLevels.length > 0 ? (
                  <div className="space-y-2">
                    {resistanceLevels.map((point, i) => (
                      <div key={i} className="text-sm">
                        <div className="text-white font-medium">${point.price.toFixed(2)}</div>
                        <div className="text-xs text-gray-500">Semafor {point.strength}</div>
                        <div className="text-xs text-gray-600">
                          Strength: {'★'.repeat(point.strength)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-gray-600 text-xs">No resistance above current price</div>
                )}
              </div>

              {/* Current Price */}
              <div className="bg-[#2a2a2a] p-4 rounded-lg text-center">
                <div className="text-yellow-500 font-semibold mb-2">Current Price</div>
                <div className="text-white text-2xl font-bold mb-2">
                  ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-gray-500">
                  {semaforPoints.filter(p => p.strength >= 2).length} strong pivots
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {semaforPoints.length} total pivots
                </div>
              </div>

              {/* Support */}
              <div className="bg-[#2a2a2a] p-4 rounded-lg">
                <div className="text-green-500 font-semibold mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  Support
                </div>
                {supportLevels.length > 0 ? (
                  <div className="space-y-2">
                    {supportLevels.map((point, i) => (
                      <div key={i} className="text-sm">
                        <div className="text-white font-medium">${point.price.toFixed(2)}</div>
                        <div className="text-xs text-gray-500">Semafor {point.strength}</div>
                        <div className="text-xs text-gray-600">
                          Strength: {'★'.repeat(point.strength)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-gray-600 text-xs">No support below current price</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            <div className="mb-4">
              <h3 className="text-white font-semibold mb-2">Indicator Settings</h3>
              <p className="text-xs text-gray-500">
                Click the &quot;Indicators&quot; button in the header to add/remove indicators
              </p>
            </div>

            {/* Quick Toggle List */}
            <div className="space-y-2">
              {Object.values(INDICATOR_REGISTRY).map((indicator) => {
                const enabled = isEnabled(indicator.id);
                return (
                  <div
                    key={indicator.id}
                    className="flex items-center justify-between p-3 bg-[#2a2a2a] rounded-lg hover:bg-[#3a3a3a] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{indicator.icon}</span>
                      <div>
                        <div className="text-white font-medium">{indicator.name}</div>
                        <div className="text-xs text-gray-500">{indicator.description}</div>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => onToggleIndicator(indicator.id, e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#26a69a] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#26a69a]"></div>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
