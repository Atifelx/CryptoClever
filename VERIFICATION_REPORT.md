# Verification Test Report – Symbol Chart Bug

## TEST 1A: Store keys after bootstrap
**Result: PASS**

```json
{
  "candles:BTCUSDT:1m": {"count": 1000, "first_time": 1772208660, "last_time": 1772268600},
  "candles:ETHUSDT:1m": {"count": 1000, "first_time": 1772208600, "last_time": 1772268540},
  "candles:SOLUSDT:1m": {"count": 1000, "first_time": 1772208600, "last_time": 1772268540},
  "candles:BNBUSDT:1m": {"count": 1000, "first_time": 1772208600, "last_time": 1772268540},
  "candles:XRPUSDT:1m": {"count": 1000, "first_time": 1772208600, "last_time": 1772268540}
}
```
- All 5 keys exist with count=1000.

---

## TEST 1B: Verify unique data
**Result: NOT RUN**

- `GET /debug/verify-unique-data` returned **404 Not Found**.
- The route is not present in the current `main.py` (only `/debug/store-keys` exists).

---

## TEST 1C: Compare close_prices per symbol
**Result: NOT RUN**

- `GET /debug/candle-details/{symbol}/1m` returned **404 Not Found**.
- The route is not present in the current `main.py`.

**From startup logs we know bootstrap wrote different data per symbol:**
- `[SET_CANDLES]` showed different LastClose: BTCUSDT 63651.08, ETHUSDT 1857.51, SOLUSDT 78.14, BNBUSDT 592.25, XRPUSDT 1.2911 → bootstrap data is unique.

---

## TEST 2A: Store keys after ~3+ minutes
**Result: BUG – only one symbol updating**

- **BTCUSDT:** `last_time`: 1772268660, `first_time`: 1772208720 (updated).
- **ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT:** `last_time`: 1772268540 (unchanged since bootstrap).

So only **BTCUSDT** is getting live updates. The other four symbols are not updated after bootstrap.

---

## TEST 2B: Verify unique data after live updates
**Result: NOT RUN** (endpoint missing).

---

## TEST 3: BOOTSTRAP_VERIFY logs
**Result: All 5 verify steps failed (code bug)**

```
ERROR:app.binance_ws:[BOOTSTRAP_ERROR] Symbol=BTCUSDT | Interval=1m | Error=name 'get_candles' is not defined
ERROR:app.binance_ws:[BOOTSTRAP_ERROR] Symbol=ETHUSDT | Interval=1m | Error=name 'get_candles' is not defined
... (same for all 5 symbols)
```

- `bootstrap_all()` calls `get_candles(sym, iv, 5)` in the verify loop, but `get_candles` is **not imported** in `binance_ws.py` (only `append_candle` and `set_candles` are imported).
- So we have no successful `[BOOTSTRAP_VERIFY]` lines; bootstrap itself did write unique data (see SET_CANDLES in startup logs).

---

## TEST 4: BINANCE_PARSED logs
**Result: No lines found**

- `grep "\[BINANCE_PARSED\]" /tmp/smarttrade_backend.log` returned nothing.
- Logs show many `[BINANCE_RAW]` lines for all 5 streams (btcusdt, ethusdt, solusdt, bnbusdt, xrpusdt).
- So the combined WebSocket **is** subscribed to all 5 symbols and receiving messages, but the code path that logs `[BINANCE_PARSED]` and calls `append_candle` is either not reached or an exception is caught and only logged at DEBUG (`logger.debug("Parse error: %s", e)`).
- No `[APPEND_CANDLE]` lines appear in the log from `run_binance_ws`, which is consistent with an exception after `[BINANCE_RAW]` and before/at `append_candle`.

---

## TEST 5: REST endpoint returns different data
**Result: PASS**

- **BTCUSDT** last 3 closes: `[63649.83, 63574.45, 63601.68]`
- **ETHUSDT** last 3 closes: `[1858.22, 1857.88, 1857.51]`
- **SOLUSDT** last 3 closes: `[78.14, 78.13, 78.14]`

REST correctly returns different close prices per symbol. Backend store and REST layer are symbol-specific.

---

## DIAGNOSIS

### Scenario match: **B (WebSocket) + small code bug**

1. **Bootstrap (Scenario A):** Not the cause. Bootstrap creates 5 keys with different data (SET_CANDLES and REST both show unique data).
2. **WebSocket (Scenario B):** Matches. Only **BTCUSDT** receives live updates because:
   - The **ConnectionManager** starts a per-symbol Binance worker when a client connects to `/ws/candles/BTCUSDT`, and that worker updates only `candles:BTCUSDT:1m`.
   - The **combined stream** `run_binance_ws()` receives all 5 streams (`[BINANCE_RAW]` shows all symbols) but never successfully appends: no `[BINANCE_PARSED]` and no `[APPEND_CANDLE]` from it. An exception is likely after parsing and is swallowed with `logger.debug("Parse error")`.
3. **REST (Scenario C):** Not the cause. REST returns different data per symbol.
4. **Frontend (Scenario D):** Not ruled out for “same chart” UI, but backend store and REST are correct per symbol.

### Root causes to fix

1. **`run_binance_ws()`**  
   - Find why the combined stream never reaches `append_candle` / `[BINANCE_PARSED]` (e.g. log the caught exception at INFO or re-raise to see traceback).  
   - Fix the bug so all 5 symbols are appended and their store keys updated.

2. **`bootstrap_all()` verify**  
   - In `binance_ws.py`, add `get_candles` to the import from `app.redis_store` so `[BOOTSTRAP_VERIFY]` runs and future tests can confirm bootstrap.

3. **Missing debug routes (optional)**  
   - Add `GET /debug/verify-unique-data` and `GET /debug/candle-details/{symbol}/{interval}` in `main.py` so TEST 1B and 1C can be run as specified.

---

## Summary table

| Test        | Result   | Notes |
|------------|----------|--------|
| 1A store-keys | PASS  | 5 keys, count 1000 each |
| 1B verify-unique-data | SKIP | 404 – route missing |
| 1C candle-details | SKIP | 404 – route missing |
| 2A store-keys after 3 min | FAIL | Only BTCUSDT last_time advanced |
| 2B verify after live | SKIP | Route missing |
| 3 BOOTSTRAP_VERIFY | ERROR | get_candles not defined in binance_ws |
| 4 BINANCE_PARSED | NONE | No lines; exception likely in combined stream |
| 5 REST per symbol | PASS | Different close arrays per symbol |

**Conclusion:** Backend store and REST are symbol-correct. Live updates only reach BTCUSDT (ConnectionManager worker). The combined Binance WebSocket task does not update any symbol due to an unlogged exception in the parse/append path. Fix `run_binance_ws()` so all symbols are appended and fix the `get_candles` import for bootstrap verify.
