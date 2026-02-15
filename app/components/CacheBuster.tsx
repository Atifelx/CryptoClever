'use client';

import { useEffect, useRef } from 'react';

/**
 * Client-side component to clear old caches and prevent caching issues
 * Also detects 404 errors and forces reload
 */
export default function CacheBuster() {
  const hasRun = useRef(false);
  const reloadAttempted = useRef(false);

  useEffect(() => {
    // Only run once
    if (hasRun.current) return;
    hasRun.current = true;

    // Ensure we're in browser
    if (typeof window === 'undefined') return;

    // Clear all caches on first load
    const clearAllCaches = async () => {
      try {
        // Clear service worker caches
        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(name => caches.delete(name)));
        }
        
        // Clear browser cache for static assets
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map(reg => reg.unregister()));
        }
        
        // Clear localStorage cache markers
        try {
          const keys = Object.keys(localStorage);
          keys.forEach(key => {
            if (key.startsWith('next-') || key.includes('cache')) {
              localStorage.removeItem(key);
            }
          });
        } catch (e) {
          // Ignore
        }
      } catch (e) {
        // Silently fail
      }
    };

    clearAllCaches();

    // Add cache-busting query param to force fresh load
    if (!window.location.search.includes('nocache')) {
      const url = new URL(window.location.href);
      url.searchParams.set('nocache', Date.now().toString());
      // Don't reload automatically, just update URL
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  return null;
}
