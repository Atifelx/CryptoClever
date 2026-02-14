'use client';

import { useEffect, useState } from 'react';
import { useTradingStore } from '../store/tradingStore';

export function StoreHydration({ children }: { children: React.ReactNode }) {
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Ensure we're on the client side
    if (typeof window === 'undefined') {
      setIsHydrated(true);
      return;
    }

    // Clear any corrupted localStorage data first
    try {
      const stored = localStorage.getItem('trading-storage');
      if (stored) {
        let parsed: any;
        try {
          parsed = JSON.parse(stored);
        } catch (parseError) {
          // Invalid JSON, clear it
          console.warn('Invalid JSON in storage, clearing...', parseError);
          localStorage.removeItem('trading-storage');
          parsed = null;
        }
        
        if (parsed) {
          // Validate structure and migrate old format
          if (parsed && typeof parsed === 'object' && parsed.state) {
            // Check if selectedSymbol is an object (old format)
            if (parsed.state.selectedSymbol && typeof parsed.state.selectedSymbol === 'object') {
              // Migrate old format
              const oldSymbol = parsed.state.selectedSymbol;
              parsed.state.selectedSymbol = oldSymbol.name || oldSymbol.symbol || 'BTCUSDT';
              try {
                localStorage.setItem('trading-storage', JSON.stringify(parsed));
                console.warn('Migrated old symbol format in localStorage');
              } catch (e) {
                console.warn('Error saving migrated data:', e);
              }
            }
            // Ensure selectedSymbol is a string
            if (parsed.state.selectedSymbol && typeof parsed.state.selectedSymbol !== 'string') {
              parsed.state.selectedSymbol = 'BTCUSDT';
              try {
                localStorage.setItem('trading-storage', JSON.stringify(parsed));
              } catch (e) {
                console.warn('Error saving fixed data:', e);
              }
            }
          } else {
            // Invalid structure, clear it
            console.warn('Invalid storage structure, clearing...');
            localStorage.removeItem('trading-storage');
          }
        }
      }
    } catch (error) {
      console.warn('Error checking storage, clearing...', error);
      try {
        localStorage.removeItem('trading-storage');
      } catch (e) {
        // Ignore
      }
    }

    // Hydrate store after mount
    try {
      useTradingStore.persist.rehydrate();
      setIsHydrated(true);
    } catch (error) {
      console.error('Error rehydrating store:', error);
      // Clear storage if rehydration fails
      try {
        localStorage.removeItem('trading-storage');
      } catch (e) {
        // Ignore
      }
      setIsHydrated(true); // Still allow render with default state
    }
  }, []);

  if (!isHydrated) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0a0a0a] text-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#26a69a] mx-auto mb-4"></div>
          <div>Loading...</div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
