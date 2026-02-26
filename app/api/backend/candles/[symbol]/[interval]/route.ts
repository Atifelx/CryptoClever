import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy to FastAPI backend: GET /candles/{symbol}/{interval}
 * When BACKEND_URL is set, chart data comes from backend (Redis); otherwise frontend falls back to Binance.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string; interval: string }> }
) {
  function getBackendUrl(): string | null {
    const u = process.env.BACKEND_URL;
    if (u) return u.replace(/\/$/, '');
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development')
      return 'http://127.0.0.1:8000';
    return null;
  }

  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    return NextResponse.json(
      { error: 'Backend not configured' },
      { status: 503, headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' } }
    );
  }

  const { symbol, interval } = await params;
  const limit = request.nextUrl.searchParams.get('limit') || '500';
  const url = `${backendUrl}/candles/${encodeURIComponent(symbol)}/${encodeURIComponent(interval)}?limit=${limit}`;
  const jsonHeaders = {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  } as const;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 0 },
    });
    const contentType = (res.headers.get('Content-Type') || '').toLowerCase();
    let data: unknown = { symbol, interval, candles: [] };
    if (contentType.includes('application/json')) {
      try {
        const parsed = await res.json();
        if (res.ok && parsed && typeof parsed === 'object' && Array.isArray((parsed as { candles?: unknown }).candles)) {
          data = parsed;
        }
      } catch {
        data = { symbol, interval, candles: [] };
      }
    }
    const body = data as { symbol: string; interval: string; candles: unknown[] };
    return NextResponse.json(body, { headers: jsonHeaders });
  } catch (err) {
    console.error('Backend candles proxy error:', err);
    return NextResponse.json(
      { symbol, interval, candles: [] },
      { headers: jsonHeaders }
    );
  }
}
