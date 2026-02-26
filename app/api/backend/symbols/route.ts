import { NextRequest, NextResponse } from 'next/server';

function getBackendUrl(): string | null {
  const url = process.env.BACKEND_URL;
  if (url) return url.replace(/\/$/, '');
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development')
    return 'http://127.0.0.1:8000';
  return null;
}

const FALLBACK_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'LTCUSDT', 'ADAUSDT', 'ALGOUSDT', 'ATOMUSDT', 'MATICUSDT',
];

/**
 * Proxy to FastAPI backend: GET /symbols.
 * On 404/502 returns fallback list so the app loads without backend.
 */
export async function GET(_request: NextRequest) {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    return NextResponse.json(
      { error: 'Backend not configured' },
      { status: 503, headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' } }
    );
  }

  const url = `${backendUrl}/symbols`;
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
    if (res.ok && data && typeof data === 'object' && Array.isArray(data.symbols)) {
      return NextResponse.json(data, { headers: jsonHeaders });
    }
    return NextResponse.json({ symbols: FALLBACK_SYMBOLS }, { headers: jsonHeaders });
  } catch (err) {
    console.error('Backend symbols proxy error:', err);
    return NextResponse.json({ symbols: FALLBACK_SYMBOLS }, { headers: jsonHeaders });
  }
}
