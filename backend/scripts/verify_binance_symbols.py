#!/usr/bin/env python3
"""
Verify that SOL, BNB, XRP get candle data from Binance exactly like BTC.
Calls backend endpoints and prints per-symbol candle count + last close.

Usage:
  1. Start backend with current config (all 4 symbols in backend/app/config.py):
     cd backend && USE_MEMORY_STORE=1 uvicorn app.main:app --host 127.0.0.1 --port 8000
  2. Wait ~1–2 min for Binance bootstrap to finish.
  3. Run: python scripts/verify_binance_symbols.py
     Or against another port: BACKEND_URL=http://127.0.0.1:8001 python scripts/verify_binance_symbols.py

If you see only BTCUSDT, the backend was started with an old config – restart it so SYMBOLS includes all 4.
"""
import os
import sys

try:
    import httpx
except ImportError:
    print("Install httpx: pip install httpx", file=sys.stderr)
    sys.exit(1)

BASE = os.getenv("BACKEND_URL", "http://127.0.0.1:8000")
TIMEOUT = 15.0
EXPECTED_SYMBOLS = ["BTCUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]


def main():
    print("=" * 60)
    print("Binance symbols verification – backend:", BASE)
    print("=" * 60)

    # 1) GET /symbols – backend must list all 4
    try:
        r = httpx.get(f"{BASE}/symbols", timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
        symbols = data.get("symbols") or []
        print("\n1) GET /symbols")
        print("   Symbols:", symbols)
        if set(symbols) != set(EXPECTED_SYMBOLS):
            print("   FAIL: Expected", EXPECTED_SYMBOLS, "got", symbols, file=sys.stderr)
        else:
            print("   OK: All 4 symbols configured")
    except Exception as e:
        print("   FAIL:", e, file=sys.stderr)
        print("\n   Ensure backend is running: cd backend && USE_MEMORY_STORE=1 uvicorn app.main:app --host 127.0.0.1 --port 8000")
        sys.exit(1)

    # 2) GET /streaming/status – per-symbol count and last close
    print("\n2) GET /streaming/status (candle count + last close per symbol)")
    try:
        r = httpx.get(f"{BASE}/streaming/status", timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
        per_symbol = data.get("per_symbol") or []
        if not per_symbol:
            print("   FAIL: No per_symbol data (backend may still be bootstrapping – wait 1–2 min)", file=sys.stderr)
        else:
            for item in per_symbol:
                sym = item.get("symbol", "?")
                count = item.get("count", 0)
                last_close = item.get("last_close")
                last_time = item.get("last_candle_time")
                status = "OK" if count >= 100 else ("Partial" if count > 0 else "EMPTY")
                print(f"   {sym}: count={count}, last_close={last_close}, last_time={last_time} [{status}]")
            counts_1m = [x["count"] for x in per_symbol if x.get("interval") == "1m"]
            if len(counts_1m) != 4 or min(counts_1m) == 0:
                print("   FAIL: Not all 4 symbols have 1m data", file=sys.stderr)
            else:
                print("   OK: All 4 symbols have 1m candle data")
    except Exception as e:
        print("   FAIL:", e, file=sys.stderr)
        sys.exit(1)

    # 3) GET /debug/verify-unique-data – each symbol must have different last_close
    print("\n3) GET /debug/verify-unique-data (Binance data unique per symbol)")
    try:
        r = httpx.get(f"{BASE}/debug/verify-unique-data", timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
        results = data.get("symbols") or {}
        bug = data.get("bug_detected", True)
        for sym, v in results.items():
            print(f"   {sym}: count={v.get('count')}, last_close={v.get('last_close')}, last_time={v.get('last_time')}")
        if bug:
            print("   FAIL:", data.get("message", "All symbols have same close price (bug)"), file=sys.stderr)
            sys.exit(1)
        print("   OK:", data.get("message", "Symbols have different data"))
    except Exception as e:
        print("   FAIL:", e, file=sys.stderr)
        sys.exit(1)

    # 4) GET /candles/{symbol}/1m?limit=3 – REST returns data per symbol (same as frontend)
    print("\n4) GET /candles/{symbol}/1m?limit=3 (REST – same as frontend)")
    for sym in EXPECTED_SYMBOLS:
        try:
            r = httpx.get(f"{BASE}/candles/{sym}/1m", params={"limit": 3}, timeout=TIMEOUT)
            r.raise_for_status()
            data = r.json()
            candles = data.get("candles") or []
            if not candles:
                print(f"   {sym}: FAIL – no candles", file=sys.stderr)
            else:
                last = candles[-1]
                print(f"   {sym}: count={len(candles)}, last close={last.get('close')}, time={last.get('time')} OK")
        except Exception as e:
            print(f"   {sym}: FAIL –", e, file=sys.stderr)
            sys.exit(1)

    print("\n" + "=" * 60)
    print("All checks passed: BTC, SOL, BNB, XRP get Binance data like BTC.")
    print("=" * 60)


if __name__ == "__main__":
    main()
