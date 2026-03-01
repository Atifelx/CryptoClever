#!/usr/bin/env python3
"""
Backend unit/integration test: Redis data uniqueness + REST+live gap-fill + full functionality.

Asserts:
  1. All symbol data in Redis is unique (no shared last_close across symbols).
  2. REST + live data is gap-filled (1m: consecutive candle times differ by 60s).
  3. Backend is fully functional (health, historical and debug endpoints).

Run against a live backend (after bootstrap + some WS data):
  cd backend && python3 -m pytest tests/test_backend_redis_unique_gapfilled.py -v
  cd backend && python3 tests/test_backend_redis_unique_gapfilled.py --base-url http://localhost:8000
"""
import argparse
import sys

try:
    import httpx
except ImportError:
    httpx = None

# Expected config (1m only in store after recent backend change)
EXPECTED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]
INTERVAL_1M_SEC = 60
INTERVAL_1M_MS = 60_000


def check_gap_filled(candles: list, interval_ms: int = INTERVAL_1M_MS):
    """
    Check candle list has no gaps: consecutive times must differ by interval_ms (or less for forming candle).
    candles: list of dicts with "time" in milliseconds.
    Returns (all_ok, list of error messages).
    """
    errors = []
    if len(candles) < 2:
        return True, []
    sorted_c = sorted(candles, key=lambda c: c.get("time", 0))
    for i in range(len(sorted_c) - 1):
        t0 = sorted_c[i].get("time")
        t1 = sorted_c[i + 1].get("time")
        if t0 is None or t1 is None:
            errors.append("Missing time at index %s or %s" % (i, i + 1))
            continue
        diff = t1 - t0
        if diff > interval_ms:
            errors.append("Gap at index %s: time %s -> %s (diff=%s ms, expected <=%s)" % (i, t0, t1, diff, interval_ms))
        elif diff < 0:
            errors.append("Out-of-order at index %s: time %s -> %s" % (i, t0, t1))
    return len(errors) == 0, errors


def run_tests(base_url: str, timeout: float = 15.0):
    """Run all checks. Returns (success, list of error messages)."""
    base = base_url.rstrip("/")
    errors = []

    # 1) Health
    try:
        r = httpx.get(f"{base}/health", timeout=timeout)
        r.raise_for_status()
        if r.json().get("status") != "ok":
            errors.append("GET /health: status is not 'ok'")
    except Exception as e:
        errors.append("GET /health failed: %s" % e)
        return False, errors

    # 2) Uniqueness: all symbol data in Redis is unique
    try:
        r = httpx.get(f"{base}/debug/verify-unique-data", timeout=timeout)
        r.raise_for_status()
        data = r.json()
        if data.get("bug_detected") is True:
            errors.append("Uniqueness FAIL: all symbols have same last_close (bug_detected=true)")
        symbols_data = data.get("symbols") or {}
        for sym in EXPECTED_SYMBOLS:
            if sym not in symbols_data:
                errors.append("Uniqueness: symbol %s missing" % sym)
            else:
                info = symbols_data[sym]
                if (info.get("count") or 0) == 0:
                    errors.append("Uniqueness: symbol %s has no candles in Redis" % sym)
    except Exception as e:
        errors.append("GET /debug/verify-unique-data failed: %s" % e)

    # 3) Gap-filled: each symbol historical data has no gaps (1m = 60000 ms between candles)
    for symbol in EXPECTED_SYMBOLS:
        try:
            r = httpx.get(
                f"{base}/api/historical/{symbol}",
                params={"interval": "1m", "hours": 12},
                timeout=timeout,
            )
            r.raise_for_status()
            data = r.json()
            arr = data.get("data") or []
            if len(arr) < 2:
                continue
            ok, gap_errors = check_gap_filled(arr, INTERVAL_1M_MS)
            if not ok:
                for err in gap_errors:
                    errors.append("Gap-fill %s: %s" % (symbol, err))
        except Exception as e:
            errors.append("GET /api/historical/%s failed: %s" % (symbol, e))

    # 4) Streaming status indicates backend has data
    try:
        r = httpx.get(f"{base}/streaming/status", timeout=timeout)
        r.raise_for_status()
        data = r.json()
        if data.get("symbols") != EXPECTED_SYMBOLS:
            errors.append("streaming/status symbols mismatch: %s" % data.get("symbols"))
        per = data.get("per_symbol") or []
        counts_1m = [e["count"] for e in per if e.get("interval") == "1m"]
        if not counts_1m or max(counts_1m) == 0:
            errors.append("streaming/status: no 1m candle count > 0")
    except Exception as e:
        errors.append("GET /streaming/status failed: %s" % e)

    return len(errors) == 0, errors


def main():
    if httpx is None:
        print("Install httpx: pip install httpx", file=sys.stderr)
        return 2
    p = argparse.ArgumentParser(description="Test backend: Redis unique data + gap-filled + functional")
    p.add_argument("--base-url", default="http://localhost:8000", help="Backend base URL")
    p.add_argument("--timeout", type=float, default=15.0, help="Request timeout seconds")
    args = p.parse_args()

    ok, errors = run_tests(args.base_url, args.timeout)
    if ok:
        print("OK: All symbol data is unique, REST+live data is gap-filled, backend is fully functional.")
        return 0
    for e in errors:
        print("FAIL: %s" % e, file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())


# --- Pytest / unittest entrypoints ---
def test_health():
    """Requires running backend. Skip if unreachable."""
    if httpx is None:
        import pytest
        pytest.skip("httpx not installed")
    ok, errs = run_tests("http://localhost:8000", timeout=5.0)
    assert ok, "; ".join(errs)


def test_redis_unique_and_gapfilled():
    """Requires running backend. Asserts uniqueness + gap-filled + functional."""
    if httpx is None:
        import pytest
        pytest.skip("httpx not installed")
    ok, errs = run_tests("http://localhost:8000", timeout=15.0)
    assert ok, "; ".join(errs)
