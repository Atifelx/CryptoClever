'use client';

import { useEffect } from 'react';

/**
 * Registers a global error handler to suppress "Object is disposed" from
 * lightweight-charts/fancy-canvas when the chart is removed on symbol change.
 * Must mount early (e.g. in root layout) so the handler is active before any chart unmounts.
 */
export default function ChartErrorSuppress() {
  useEffect(() => {
    const msgMatches = (msg: string) =>
      msg.toLowerCase().includes('object is disposed') || msg.toLowerCase().includes('disposed');

    const onError = (event: ErrorEvent) => {
      const msg = (event.message || (event.error && (event.error as Error).message) || '').toString();
      if (msgMatches(msg)) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        return true;
      }
      return false;
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const msg = (event.reason?.message ?? String(event.reason ?? '')).toString();
      if (msgMatches(msg)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('error', onError, true);
    window.addEventListener('unhandledrejection', onUnhandledRejection, true);
    return () => {
      window.removeEventListener('error', onError, true);
      window.removeEventListener('unhandledrejection', onUnhandledRejection, true);
    };
  }, []);

  return null;
}
