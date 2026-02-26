'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useTradingStore } from '../store/tradingStore';
import type { Timeframe } from '../store/tradingStore';

/**
 * Syncs tradingStore (favorites, selectedSymbol, selectedTimeframe) with backend.
 * On mount: GET /api/backend/users/me/settings and merge into store.
 * On store change: debounced PATCH to backend.
 * After a failed PATCH (4xx/5xx), no retry for 1 min to prevent looping errors.
 */
const PATCH_COOLDOWN_MS = 60_000;

export function useBackendSettingsSync() {
  const { favorites, selectedSymbol, selectedTimeframe, setSelectedSymbol, setSelectedTimeframe } = useTradingStore();
  const justLoadedFromBackend = useRef(false);
  const patchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownUntil = useRef<number>(0);

  // Load settings from backend once on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/backend/users/me/settings', {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok || !mounted) return;
        const data = (await res.json()) as Record<string, string>;
        if (typeof data !== 'object' || data === null) return;
        justLoadedFromBackend.current = true;
        setTimeout(() => {
          justLoadedFromBackend.current = false;
        }, 2500);
        if (data.selectedSymbol && typeof data.selectedSymbol === 'string') {
          setSelectedSymbol(data.selectedSymbol);
        }
        if (data.selectedTimeframe && typeof data.selectedTimeframe === 'string') {
          setSelectedTimeframe(data.selectedTimeframe as Timeframe);
        }
        if (data.favorites) {
          try {
            const arr = JSON.parse(data.favorites) as unknown;
            if (Array.isArray(arr) && arr.every((x): x is string => typeof x === 'string')) {
              useTradingStore.setState({ favorites: arr });
            }
          } catch {
            // ignore invalid JSON
          }
        }
      } catch {
        // Backend not available, keep localStorage state
      }
    })();
    return () => {
      mounted = false;
    };
  }, [setSelectedSymbol, setSelectedTimeframe]);

  // Debounced PATCH when favorites, selectedSymbol, or selectedTimeframe change.
  const patchSettings = useCallback(() => {
    if (patchTimeout.current) clearTimeout(patchTimeout.current);
    if (justLoadedFromBackend.current) return;
    if (Date.now() < cooldownUntil.current) return;
    patchTimeout.current = setTimeout(async () => {
      patchTimeout.current = null;
      if (Date.now() < cooldownUntil.current) return;
      try {
        const res = await fetch('/api/backend/users/me/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            selectedSymbol: useTradingStore.getState().selectedSymbol,
            selectedTimeframe: useTradingStore.getState().selectedTimeframe,
            favorites: JSON.stringify(useTradingStore.getState().favorites),
          }),
        });
        if (!res.ok) cooldownUntil.current = Date.now() + PATCH_COOLDOWN_MS;
      } catch {
        cooldownUntil.current = Date.now() + PATCH_COOLDOWN_MS;
      }
    }, 800);
  }, []);

  useEffect(() => {
    patchSettings();
    return () => {
      if (patchTimeout.current) clearTimeout(patchTimeout.current);
    };
  }, [favorites, selectedSymbol, selectedTimeframe, patchSettings]);
}
