#!/usr/bin/env python3
"""
Test script using the same history + live URLs the app uses (1m only).
- History: GET /api/historical/{symbol}?interval=1m&hours=12
- Live: WebSocket /ws/{symbol} (receives historical then live_candle)

Run with backend up: python scripts/test_candles_urls.py [--base http://localhost:8000] [--symbol BTCUSDT]
"""
import argparse
import asyncio
import json
import sys

try:
    import httpx
except ImportError:
    httpx = None
try:
    import websockets
except ImportError:
    websockets = None


def check_deps():
    if httpx is None:
        print("pip install httpx")
        sys.exit(1)
    if websockets is None:
        print("pip install websockets")
        sys.exit(1)


async def test_history(base_url: str, symbol: str) -> bool:
    """Test history REST (same URL as app: 1m, 12h)."""
    url = f"{base_url}/api/historical/{symbol}"
    params = {"interval": "1m", "hours": 12}
    async with httpx.AsyncClient() as client:
        r = await client.get(url, params=params, timeout=10.0)
    if r.status_code != 200:
        print(f"FAIL history {r.status_code} {url}")
        return False
    data = r.json()
    count = data.get("count", 0)
    arr = data.get("data") or []
    last = arr[-1] if arr else None
    print(f"OK history: {count} candles, last close={last.get('close') if last else 'n/a'}")
    return True


async def test_live(base_url: str, symbol: str, max_messages: int = 5) -> bool:
    """Test live WebSocket (same URL as app: /ws/{symbol}). Receives historical then live_candle."""
    ws_url = base_url.replace("http://", "ws://").replace("https://", "wss://")
    uri = f"{ws_url}/ws/{symbol}"
    print(f"Connecting to {uri} ...")
    try:
        async with websockets.connect(uri, ping_interval=20, ping_timeout=10) as ws:
            n = 0
            async for msg in ws:
                data = json.loads(msg)
                t = data.get("type", "")
                if t == "historical":
                    arr = data.get("data") or []
                    print(f"OK live: historical {len(arr)} candles")
                elif t == "live_candle":
                    print(f"OK live: live_candle time={data.get('time')} close={data.get('close')}")
                else:
                    print(f"  live: {t}")
                n += 1
                if n >= max_messages:
                    break
    except Exception as e:
        print(f"FAIL live: {e}")
        return False
    return True


async def main():
    check_deps()
    p = argparse.ArgumentParser(description="Test history + live URLs (1m) used by the app")
    p.add_argument("--base", default="http://localhost:8000", help="Backend base URL")
    p.add_argument("--symbol", default="BTCUSDT", help="Symbol to test")
    p.add_argument("--urls-only", action="store_true", help="Only print URLs (from /test/candles/urls)")
    p.add_argument("--no-ws", action="store_true", help="Skip WebSocket test")
    args = p.parse_args()
    base = args.base.rstrip("/")

    if args.urls_only:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{base}/test/candles/urls", timeout=5.0)
        if r.status_code != 200:
            print(f"FAIL /test/candles/urls {r.status_code}")
            sys.exit(1)
        print(json.dumps(r.json(), indent=2))
        return

    print("--- History (REST, 1m 12h) ---")
    ok_h = await test_history(base, args.symbol)
    if not ok_h:
        sys.exit(1)

    if not args.no_ws:
        print("--- Live (WebSocket, 1m) ---")
        ok_w = await test_live(base, args.symbol)
        if not ok_w:
            sys.exit(1)

    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
