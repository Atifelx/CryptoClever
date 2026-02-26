import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy to FastAPI backend: GET /signals/{symbol}/{interval}
 * Returns computed indicators/signals from backend (Redis or on-demand).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string; interval: string }> }
) {
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    return NextResponse.json(
      { error: 'Backend not configured' },
      { status: 503 }
    );
  }

  const { symbol, interval } = await params;
  const url = `${backendUrl.replace(/\/$/, '')}/signals/${encodeURIComponent(symbol)}/${encodeURIComponent(interval)}`;
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
    const contentType = res.headers.get('Content-Type') || '';
    const data = contentType.includes('application/json') ? await res.json() : {};
    if (!res.ok) return NextResponse.json(data, { status: res.status, headers: jsonHeaders });
    return NextResponse.json(data, { headers: jsonHeaders });
  } catch (err) {
    console.error('Backend signals proxy error:', err);
    return NextResponse.json(
      { error: 'Backend unavailable' },
      { status: 502, headers: jsonHeaders }
    );
  }
}
