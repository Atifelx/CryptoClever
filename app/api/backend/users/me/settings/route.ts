import { NextRequest, NextResponse } from 'next/server';

/**
 * Proxy to FastAPI backend: GET /users/me/settings
 * Returns user settings from PostgreSQL. Forwards X-User-Id if present.
 */
function getBackendUrl(): string | null {
  const url = process.env.BACKEND_URL;
  if (url) return url.replace(/\/$/, '');
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development')
    return 'http://127.0.0.1:8000';
  return null;
}

export async function GET(request: NextRequest) {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    return NextResponse.json(
      { error: 'Backend not configured' },
      { status: 503, headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' } }
    );
  }

  const url = `${backendUrl}/users/me/settings`;
  const headers: HeadersInit = { Accept: 'application/json' };
  const xUserId = request.headers.get('X-User-Id');
  if (xUserId) headers['X-User-Id'] = xUserId;
  const jsonHeaders = {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  } as const;

  try {
    const res = await fetch(url, { headers, next: { revalidate: 0 } });
    const contentType = res.headers.get('Content-Type') || '';
    const data = contentType.includes('application/json') ? await res.json() : {};
    if (res.ok && data && typeof data === 'object') return NextResponse.json(data, { headers: jsonHeaders });
    return NextResponse.json({}, { headers: jsonHeaders });
  } catch (err) {
    console.error('Backend settings GET proxy error:', err);
    return NextResponse.json({}, { headers: jsonHeaders });
  }
}

/**
 * Proxy to FastAPI backend: PATCH /users/me/settings
 * Body: { key: value, ... }. Forwards X-User-Id if present.
 */
export async function PATCH(request: NextRequest) {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    return NextResponse.json(
      { error: 'Backend not configured' },
      { status: 503, headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' } }
    );
  }

  const url = `${backendUrl}/users/me/settings`;
  const headers: HeadersInit = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const xUserId = request.headers.get('X-User-Id');
  if (xUserId) headers['X-User-Id'] = xUserId;
  const jsonHeaders = {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  } as const;

  try {
    const body = await request.json();
    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
      next: { revalidate: 0 },
    });
    const contentType = res.headers.get('Content-Type') || '';
    const data = contentType.includes('application/json') ? await res.json() : {};
    if (res.ok && data && typeof data === 'object') return NextResponse.json(data, { headers: jsonHeaders });
    return NextResponse.json({}, { headers: jsonHeaders });
  } catch (err) {
    console.error('Backend settings PATCH proxy error:', err);
    return NextResponse.json({}, { headers: jsonHeaders });
  }
}
