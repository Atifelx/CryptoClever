import { NextRequest, NextResponse } from 'next/server';

function getBackendUrl(): string | null {
  const url = process.env.BACKEND_URL;
  if (url) return url.replace(/\/$/, '');
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development')
    return 'http://127.0.0.1:8000';
  return null;
}

/** Proxy to FastAPI backend: GET /health. Used by inspect page to show if backend is reachable. */
export async function GET(_request: NextRequest) {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    return NextResponse.json(
      { status: 'not_configured', error: 'BACKEND_URL not set' },
      { status: 503 }
    );
  }
  try {
    const res = await fetch(`${backendUrl}/health`, { next: { revalidate: 0 } });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(res.ok ? data : { status: 'error', ...data }, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { status: 'unreachable', error: 'Cannot connect to backend' },
      { status: 502 }
    );
  }
}
