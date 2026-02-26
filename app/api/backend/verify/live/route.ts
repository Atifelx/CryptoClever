import { NextRequest, NextResponse } from 'next/server';

function getBackendUrl(): string | null {
  const url = process.env.BACKEND_URL;
  if (url) return url.replace(/\/$/, '');
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development')
    return 'http://127.0.0.1:8000';
  return null;
}

/**
 * Proxy to FastAPI backend: GET /verify/live (HTML page for live candle appends).
 */
export async function GET(_request: NextRequest) {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    return new NextResponse(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Backend not configured</title></head><body style="font-family:system-ui;background:#0f0f0f;color:#e0e0e0;padding:20px;"><h1>Backend not configured</h1><p>Set <code>BACKEND_URL</code> in .env, or run the backend:</p><pre style="background:#000;padding:12px;border-radius:8px;">cd backend && USE_MEMORY_STORE=1 python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000</pre><p>Then open <a href="/api/backend/verify/live" style="color:#26a69a;">/api/backend/verify/live</a> again.</p></body></html>`,
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  try {
    const res = await fetch(`${backendUrl}/verify/live`, {
      headers: { Accept: 'text/html' },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404) {
        return new NextResponse(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Verify routes not found</title></head><body style="font-family:system-ui;background:#0f0f0f;color:#e0e0e0;padding:20px;max-width:640px;"><h1>Verify routes not found on the backend</h1><p>The backend may be running old code. Restart it from this project so it loads the latest routes:</p><pre style="background:#000;padding:12px;border-radius:8px;overflow-x:auto;">cd backend &amp;&amp; USE_MEMORY_STORE=1 python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000</pre><p>Wait for &quot;Binance WebSocket task started&quot;, then reload this page. If you use <code>BACKEND_URL</code> in .env, point it at this backend (e.g. <code>http://127.0.0.1:8000</code>).</p><p><strong>Try opening the backend directly:</strong> <a href="http://localhost:8000/verify/live" style="color:#26a69a;">http://localhost:8000/verify/live</a></p><p><a href="/api/backend/verify/live" style="color:#26a69a;">Reload /api/backend/verify/live</a></p></body></html>`,
          { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
      return new NextResponse(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Backend error</title></head><body style="font-family:system-ui;background:#0f0f0f;color:#e0e0e0;padding:20px;"><h1>Backend returned ${res.status}</h1><pre>${text.slice(0, 500)}</pre></body></html>`,
        { status: res.status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
    const html = await res.text();
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Backend verify/live proxy error:', err);
    return new NextResponse(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Backend not reachable</title></head><body style="font-family:system-ui;background:#0f0f0f;color:#e0e0e0;padding:20px;"><h1>Backend not reachable</h1><p>Start the backend (from project root):</p><pre style="background:#000;padding:12px;border-radius:8px;">cd backend && USE_MEMORY_STORE=1 python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000</pre><p>Wait for "Binance WebSocket task started", then <a href="/api/backend/verify/live" style="color:#26a69a;">reload</a>.</p></body></html>`,
      { status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}
