#!/usr/bin/env python3
"""
Verify proposal API: REST (GET /api/historical, GET /api/symbols) and WebSocket /ws/{symbol}.
Expects backend running at base_url (default http://localhost:8000).
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


async def verify_rest(base_url: str) -> bool:
    ok = True
    async with httpx.AsyncClient() as client:
        # GET /api/symbols
        r = await client.get(f"{base_url}/api/symbols")
        if r.status_code != 200:
            print(f"FAIL GET /api/symbols status={r.status_code}")
            ok = False
        else:
            data = r.json()
            if "symbols" not in data or "count" not in data:
                print("FAIL GET /api/symbols missing symbols or count")
                ok = False
            else:
                print(f"OK GET /api/symbols symbols={data['count']}")

        # GET /api/historical/BTCUSDT
        r = await client.get(f"{base_url}/api/historical/BTCUSDT", params={"interval": "1m", "hours": 12})
        if r.status_code != 200:
            print(f"FAIL GET /api/historical/BTCUSDT status={r.status_code}")
            ok = False
        else:
            data = r.json()
            for key in ("symbol", "interval", "hours", "count", "data"):
                if key not in data:
                    print(f"FAIL GET /api/historical missing key: {key}")
                    ok = False
                    break
            if "data" in data and isinstance(data["data"], list) and len(data["data"]) > 0:
                c = data["data"][0]
                if "time" not in c or c["time"] < 1e12:
                    print("FAIL GET /api/historical candle time not in ms?", c.get("time"))
                    ok = False
                if "is_closed" not in c:
                    print("FAIL GET /api/historical candle missing is_closed")
                    ok = False
            if ok:
                print(f"OK GET /api/historical/BTCUSDT count={len(data.get('data', []))}")
    return ok


async def verify_ws(base_url: str) -> bool:
    ws_url = base_url.replace("http://", "ws://").replace("https://", "wss://")
    url = f"{ws_url}/ws/BTCUSDT"
    historical_received = False
    live_received = False
    try:
        async with websockets.connect(url) as ws:
            first = await asyncio.wait_for(ws.recv(), timeout=15.0)
            msg = json.loads(first)
            if msg.get("type") == "historical":
                historical_received = True
                data = msg.get("data") or []
                if len(data) > 0:
                    c = data[0]
                    if "time" in c and "open" in c and "close" in c:
                        pass
                    else:
                        print("FAIL WS historical candle shape")
                        return False
                print(f"OK WS first message type=historical len={len(data)}")
            elif msg.get("type") == "error":
                print("FAIL WS server error:", msg.get("message"))
                return False
            else:
                print("FAIL WS first message type expected historical got", msg.get("type"))
                return False

            # wait for at least one live_candle (may take up to 1 minute for 1m close)
            loop = asyncio.get_running_loop()
            deadline = loop.time() + 65
            while loop.time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=10.0)
                    m = json.loads(raw)
                    if m.get("type") == "live_candle":
                        live_received = True
                        t = m.get("time")
                        if t is None or t < 1e12:
                            print("FAIL WS live_candle time not in ms?", t)
                            return False
                        if "is_closed" not in m:
                            print("FAIL WS live_candle missing is_closed")
                            return False
                        print("OK WS live_candle received (time ms, is_closed present)")
                        break
                except asyncio.TimeoutError:
                    continue
            if not live_received:
                print("WARN WS no live_candle in 65s (1m candle may not have closed)")
    except Exception as e:
        print("FAIL WS", e)
        return False
    return historical_received and True


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://localhost:8000", help="Backend base URL")
    args = parser.parse_args()
    check_deps()
    base = args.base.rstrip("/")
    print("REST checks...")
    rest_ok = await verify_rest(base)
    print("WebSocket checks...")
    ws_ok = await verify_ws(base)
    if rest_ok and ws_ok:
        print("All checks passed.")
        sys.exit(0)
    sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
