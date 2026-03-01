# Test Run Verification Report

**Date:** Run completed via automated backend + browser checks.

---

## 1. Backend

### 1.1 Store and API
- **Store keys:** 5 keys present (`candles:BTCUSDT:1m`, `ETHUSDT`, `SOLUSDT`, `BNBUSDT`, `XRPUSDT`).
- **Unique data:** `bug_detected: false`; last_close per symbol: BTC ~63577, ETH ~1850, SOL ~78, BNB ~590, XRP ~1.27.
- **REST per symbol (curl):**
  - `GET /candles/BTCUSDT/1m?limit=2` → closes [63668.32, 63682.96]
  - `GET /candles/ETHUSDT/1m?limit=2` → closes [1854.6, 1856.32]
  - `GET /candles/SOLUSDT/1m?limit=2` → closes [78.4, 78.49]

So the backend **stores and returns different data per symbol**.

### 1.2 Request logging
Backend stderr showed:
- `[FRONTEND_REQUEST] Raw symbol from URL path: 'BTCUSDT'` (chart 1m).
- Same for `ETHUSDT`, `SOLUSDT`, `BNBUSDT`, `XRPUSDT` for 5m (from `useBackendCandlesLoader`).
- `[RESULT] Last 3 closes:` matching the symbol (e.g. 63k for BTC, 1854 for ETH).

So the backend **receives the symbol from the URL and returns the correct series**.

### 1.3 Bug fixed during test
- **Issue:** `ws_broadcast.py` used `normalize_symbol` and `normalize_interval` in `_norm_key()` but did not import them → `NameError` in Binance WS broadcast path.
- **Change:** Added `from app.utils import normalize_interval, normalize_symbol` in `ws_broadcast.py`.
- **Result:** Broadcast path no longer raises; store and REST were already correct.

---

## 2. Frontend (browser)

### 2.1 Initial load (BTCUSDT)
- Console: `🔵 [useCandles] useEffect triggered for symbol: BTCUSDT`.
- Console: `🟢 [useCandles] Fetching URL: http://localhost:8000/candles/BTCUSDT/1m?limit=1000 for symbol: BTCUSDT`.
- Console: `🟡 [useCandles] Received data for symbol: BTCUSDT candles: 1000 last 3 closes: 63629.61,63668.32,63670.74`.
- Console: `📊 [TradingChart] Chart data update` (multiple times as data/WS updates).

So the frontend **requests BTCUSDT**, **gets BTC-range closes (~63k)**, and **passes them to the chart**.

### 2.2 Symbol change (automation limit)
- Clicking sidebar symbol buttons (e.g. second for ETH) failed in the browser automation (“Script failed to execute” / “Element not found”), so **symbol change was not verified by click in this run**.
- Code path is in place: `SymbolList` → `handleSymbolClick(symbol)` → `setSelectedSymbol(symbol)`; page uses `safeSymbol` from store and `key=chart-${safeSymbol}-${safeTimeframe}` so the chart remounts when symbol changes; `useCandles(newSymbol)` then runs and fetches the new symbol.

---

## 3. Summary

| Check | Result |
|-------|--------|
| Backend stores 5 separate keys with different data | ✅ Verified |
| Backend REST returns correct closes per symbol | ✅ Verified (curl) |
| Backend logs show correct symbol in [FRONTEND_REQUEST] | ✅ Verified |
| Frontend requests correct URL for initial symbol (BTCUSDT) | ✅ Verified (console) |
| Frontend receives and logs correct data (BTC closes ~63k) | ✅ Verified (console) |
| Chart receives data and runs “Chart data update” | ✅ Verified (console) |
| ws_broadcast NameError | ✅ Fixed (import added) |
| Symbol change by clicking in UI | ⚠️ Not verified (automation click failed) |

---

## 4. Conclusion

- **Backend:** Behaving as intended: per-symbol keys, per-symbol REST responses, and request logging show the right symbol and data.
- **Frontend (initial load):** Behaving as intended: one symbol (BTCUSDT) is requested, correct URL is used, response has BTC-range closes, and the chart is updated.
- **Fix applied:** `ws_broadcast.py` now imports `normalize_symbol` and `normalize_interval` from `app.utils`, so the broadcast path no longer throws.

When you **manually** click another symbol (e.g. Ethereum) in the sidebar:
- The store should set `selectedSymbol` to e.g. `ETHUSDT`.
- The chart container key will change and the chart will remount.
- `useCandles('ETHUSDT')` will run and fetch `http://localhost:8000/candles/ETHUSDT/1m?limit=1000`.
- The backend will log `[FRONTEND_REQUEST] Raw symbol: 'ETHUSDT'` and return ETH closes (~1.8k).
- The chart should then show ETH data. If it does not, the next place to check is that the sidebar click actually updates the store (e.g. with `🔴 SYMBOL CHANGE TRIGGERED` in the console).

**Verification status:** Backend and frontend data path are **confirmed** for the initial symbol; symbol-change flow is **implemented and expected to work** once the sidebar click is confirmed in your environment.
