import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy to FastAPI backend: GET /trades and POST /trades
 * Forwards X-User-Id if present.
 */
const getBackendUrl = () => {
  const url = process.env.BACKEND_URL;
  if (!url) return null;
  return url.replace(/\/$/, '');
};

function buildHeaders(request: NextRequest, extra: HeadersInit = {}): HeadersInit {
  const headers: HeadersInit = { Accept: 'application/json', ...extra };
  const xUserId = request.headers.get('X-User-Id');
  if (xUserId) (headers as Record<string, string>)['X-User-Id'] = xUserId;
  return headers;
}

export async function GET(request: NextRequest) {
  const base = getBackendUrl();
  if (!base) {
    return NextResponse.json(
      { error: 'Backend not configured' },
      { status: 503 }
    );
  }

  const limit = request.nextUrl.searchParams.get('limit') || '100';
  const url = `${base}/trades?limit=${limit}`;
  const jsonHeaders = {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  } as const;

  try {
    const res = await fetch(url, {
      headers: buildHeaders(request),
      next: { revalidate: 0 },
    });
    const contentType = res.headers.get('Content-Type') || '';
    const data = contentType.includes('application/json') ? await res.json() : { error: 'Invalid response' };
    if (!res.ok) return NextResponse.json(data, { status: res.status, headers: jsonHeaders });
    return NextResponse.json(data, { headers: jsonHeaders });
  } catch (err) {
    console.error('Backend trades GET proxy error:', err);
    return NextResponse.json(
      { error: 'Backend unavailable' },
      { status: 502, headers: jsonHeaders }
    );
  }
}

export async function POST(request: NextRequest) {
  const base = getBackendUrl();
  if (!base) {
    return NextResponse.json(
      { error: 'Backend not configured' },
      { status: 503 }
    );
  }

  const url = `${base}/trades`;
  const jsonHeaders = { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' } as const;

  try {
    const body = await request.json();
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(request, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      next: { revalidate: 0 },
    });
    const contentType = res.headers.get('Content-Type') || '';
    const data = contentType.includes('application/json') ? await res.json() : {};
    if (!res.ok) return NextResponse.json(data, { status: res.status, headers: jsonHeaders });
    return NextResponse.json(data, { headers: jsonHeaders });
  } catch (err) {
    console.error('Backend trades POST proxy error:', err);
    return NextResponse.json(
      { error: 'Backend unavailable' },
      { status: 502, headers: jsonHeaders }
    );
  }
}
