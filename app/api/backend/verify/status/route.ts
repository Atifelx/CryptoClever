import { NextRequest, NextResponse } from 'next/server';

function getBackendUrl(): string | null {
  const url = process.env.BACKEND_URL;
  if (url) return url.replace(/\/$/, '');
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development')
    return 'http://127.0.0.1:8000';
  return null;
}

/**
 * Proxy to FastAPI backend: GET /verify/status (JSON check: server + Binance bootstrap).
 */
export async function GET(_request: NextRequest) {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    return NextResponse.json(
      { ok: false, message: 'Backend not configured' },
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const res = await fetch(`${backendUrl}/verify/status`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 0 },
    });
    const data = await res.json().catch(() => ({ ok: false, message: 'Invalid response' }));
    return NextResponse.json(data, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Backend verify/status proxy error:', err);
    return NextResponse.json(
      { ok: false, message: 'Cannot reach backend' },
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
