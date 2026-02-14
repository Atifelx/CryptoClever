'use client';

import { FMCBRLevels, SemaforPoint } from '../../lib/indicators/types';

interface IndicatorPanelProps {
  fmcbrLevels: FMCBRLevels | null;
  semaforPoints: SemaforPoint[];
  currentPrice: number;
  showSemafor: boolean;
  showFMCBR: boolean;
  showFib: boolean;
  showCamarilla: boolean;
  showBollinger: boolean;
  showMurrayMath: boolean;
  onToggleSemafor: (value: boolean) => void;
  onToggleFMCBR: (value: boolean) => void;
  onToggleFib: (value: boolean) => void;
  onToggleCamarilla: (value: boolean) => void;
  onToggleBollinger: (value: boolean) => void;
  onToggleMurrayMath: (value: boolean) => void;
}

export default function IndicatorPanel({ 
  fmcbrLevels, 
  semaforPoints,
  currentPrice,
  showSemafor,
  showFMCBR,
  showFib,
  showCamarilla,
  showBollinger,
  showMurrayMath,
  onToggleSemafor,
  onToggleFMCBR,
  onToggleFib,
  onToggleCamarilla,
  onToggleBollinger,
  onToggleMurrayMath,
}: IndicatorPanelProps) {
  if (!fmcbrLevels) {
    return (
      <div className="bg-[#1a1a1a] border-t border-gray-800 p-4">
        <div className="text-sm text-gray-500">Calculating indicators...</div>
      </div>
    );
  }

  // Get nearest support and resistance levels
  const resistanceLevels = fmcbrLevels.keyLevels
    .filter(l => l.type === 'resistance' && l.price > currentPrice)
    .sort((a, b) => a.price - b.price)
    .slice(0, 3);

  const supportLevels = fmcbrLevels.keyLevels
    .filter(l => l.type === 'support' && l.price < currentPrice)
    .sort((a, b) => b.price - a.price)
    .slice(0, 3);

  return (
    <div className="bg-[#1a1a1a] border-t border-gray-800 p-4">
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <h3 className="text-white font-bold text-sm">Indicators</h3>
        
        {/* Toggle buttons */}
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
          <input 
            type="checkbox" 
            checked={showSemafor}
            onChange={e => onToggleSemafor(e.target.checked)}
            className="rounded border-gray-600 bg-[#2a2a2a] text-[#26a69a] focus:ring-[#26a69a]"
          />
          <span>Semafor</span>
          {showSemafor && (
            <span className="text-xs text-gray-500">({semaforPoints.length})</span>
          )}
        </label>
        
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
          <input 
            type="checkbox" 
            checked={showFMCBR}
            onChange={e => onToggleFMCBR(e.target.checked)}
            className="rounded border-gray-600 bg-[#2a2a2a] text-[#26a69a] focus:ring-[#26a69a]"
          />
          <span>FMCBR</span>
        </label>
        
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
          <input 
            type="checkbox" 
            checked={showFib}
            onChange={e => onToggleFib(e.target.checked)}
            className="rounded border-gray-600 bg-[#2a2a2a] text-[#26a69a] focus:ring-[#26a69a]"
          />
          <span>Fibonacci</span>
        </label>
        
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
          <input 
            type="checkbox" 
            checked={showCamarilla}
            onChange={e => onToggleCamarilla(e.target.checked)}
            className="rounded border-gray-600 bg-[#2a2a2a] text-[#26a69a] focus:ring-[#26a69a]"
          />
          <span>Camarilla</span>
        </label>
        
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
          <input 
            type="checkbox" 
            checked={showBollinger}
            onChange={e => onToggleBollinger(e.target.checked)}
            className="rounded border-gray-600 bg-[#2a2a2a] text-[#26a69a] focus:ring-[#26a69a]"
          />
          <span>Bollinger</span>
        </label>
        
        <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer hover:text-gray-300 transition-colors">
          <input 
            type="checkbox" 
            checked={showMurrayMath}
            onChange={e => onToggleMurrayMath(e.target.checked)}
            className="rounded border-gray-600 bg-[#2a2a2a] text-[#26a69a] focus:ring-[#26a69a]"
          />
          <span>Murray Math</span>
        </label>
      </div>

      {/* Display key levels */}
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-red-500 font-semibold mb-2">Resistance</div>
          {resistanceLevels.length > 0 ? (
            resistanceLevels.map((level, i) => (
              <div key={i} className="text-gray-400 mb-1">
                <span className="text-white">${level.price.toFixed(2)}</span>
                <span className="text-gray-600 ml-2 text-xs">({level.source})</span>
              </div>
            ))
          ) : (
            <div className="text-gray-600 text-xs">No resistance above</div>
          )}
        </div>
        
        <div>
          <div className="text-yellow-500 font-semibold mb-2">Current</div>
          <div className="text-white text-lg font-bold">${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="text-xs text-gray-500 mt-1">
            {semaforPoints.filter(p => p.strength >= 2).length} strong pivots
          </div>
        </div>
        
        <div>
          <div className="text-green-500 font-semibold mb-2">Support</div>
          {supportLevels.length > 0 ? (
            supportLevels.map((level, i) => (
              <div key={i} className="text-gray-400 mb-1">
                <span className="text-white">${level.price.toFixed(2)}</span>
                <span className="text-gray-600 ml-2 text-xs">({level.source})</span>
              </div>
            ))
          ) : (
            <div className="text-gray-600 text-xs">No support below</div>
          )}
        </div>
      </div>
    </div>
  );
}
