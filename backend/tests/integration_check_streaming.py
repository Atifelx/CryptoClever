#!/usr/bin/env python3
"""
Integration check: run against a live backend (with Redis + Binance).
Usage: from backend dir, after starting uvicorn and waiting for bootstrap:
  python3 tests/integration_check_streaming.py [--base-url http://localhost:8000]
Exits 0 if all 10 symbols have at least one candle in Redis (any interval); else 1.
"""
import argparse
import sys

try:
    import httpx
except ImportError:
    print("Install httpx: pip install httpx", file=sys.stderr)
    sys.exit(2)

EXPECTED_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
    "LTCUSDT", "ADAUSDT", "ALGOUSDT", "ATOMUSDT", "MATICUSDT",
]


def main():
    p = argparse.ArgumentParser(description="Verify backend streaming status")
    p.add_argument("--base-url", default="http://localhost:8000", help="Backend base URL")
    p.add_argument("--timeout", type=float, default=10.0, help="Request timeout seconds")
    args = p.parse_args()
    base = args.base_url.rstrip("/")

    try:
        r = httpx.get(f"{base}/streaming/status", timeout=args.timeout)
        r.raise_for_status()
    except Exception as e:
        print(f"Failed to reach {base}/streaming/status: {e}", file=sys.stderr)
        return 1

    data = r.json()
    if data.get("symbols") != EXPECTED_SYMBOLS:
        print(f"Unexpected symbols: {data.get('symbols')}", file=sys.stderr)
        return 1

    # For each symbol, at least one interval should have count > 0 (bootstrap + WS ran)
    per_symbol = {e["symbol"]: [] for e in data["per_symbol"]}
    for e in data["per_symbol"]:
        per_symbol[e["symbol"]].append((e["interval"], e["count"], e.get("last_candle_time")))

    missing = []
    for sym in EXPECTED_SYMBOLS:
        entries = per_symbol.get(sym, [])
        total = sum(c for _, c, _ in entries)
        if total == 0:
            missing.append(sym)

    if missing:
        print(f"Symbols with no candle data yet: {missing}", file=sys.stderr)
        print("Start backend with Redis and wait for bootstrap + a few minutes of streaming.", file=sys.stderr)
        return 1

    print("OK: All 10 symbols have candle data in backend.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
