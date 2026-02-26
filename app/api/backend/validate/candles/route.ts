import { NextRequest, NextResponse } from 'next/server';

function getBackendUrl(): string | null {
  const url = process.env.BACKEND_URL;
  if (url) return url.replace(/\/$/, '');
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development')
    return 'http://127.0.0.1:8000';
  return null;
}

/**
 * Proxy to FastAPI backend: GET /validate/candles?interval=1m
 * Returns PASS if last close differs per symbol, FAIL if same for all.
 */
export async function GET(request: NextRequest) {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    return NextResponse.json(
      { error: 'Backend not configured' },
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const interval = request.nextUrl.searchParams.get('interval') || '1m';
  try {
    const res = await fetch(`${backendUrl}/validate/candles?interval=${encodeURIComponent(interval)}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 0 },
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Backend validate/candles proxy error:', err);
    return NextResponse.json(
      { result: 'FAIL', error: 'Cannot reach backend' },
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
