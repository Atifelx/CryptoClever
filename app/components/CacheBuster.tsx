'use client';

import { useEffect, useRef } from 'react';

/**
 * Client-side component to clear old caches and prevent caching issues
 */
export default function CacheBuster() {
  const hasRun = useRef(false);

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
      } catch (e) {
        // Silently fail
      }
    };

    clearAllCaches();
  }, []);

  return null;
}
