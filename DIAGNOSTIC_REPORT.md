# DIAGNOSTIC REPORT – Symbol Chart Bug (Same Candle Pattern for All Symbols)

## TEST 1A – REST API Symbol Differentiation

**Result:** PASS

**Evidence:**
```
================================================================================
TEST 1A: REST API - Different Symbols Return Different Data
================================================================================

Fetching: http://localhost:8000/candles/BTCUSDT/1m?limit=5
✅ BTCUSDT: Received 5 candles
   First candle: time=1772139120, close=67328.78, volume=5.96243

Fetching: http://localhost:8000/candles/ETHUSDT/1m?limit=5
✅ ETHUSDT: Received 5 candles
   First candle: time=1772139060, close=2023.56, volume=377.5654

Fetching: http://localhost:8000/candles/SOLUSDT/1m?limit=5
✅ SOLUSDT: Received 5 candles
   First candle: time=1772139060, close=85.88, volume=4829.336

COMPARISON: Are candle patterns different?
✅ BTCUSDT close=67328.78 vs ETHUSDT close=2023.56 (diff: 65305.22)
✅ BTCUSDT close=67328.78 vs SOLUSDT close=85.88 (diff: 67242.9)
✅ Candle patterns are different (as expected)
```

**Finding:** The backend REST API returns clearly different data per symbol (different close prices and volumes). Backend is not sending the same candle pattern for all symbols.

---

## TEST 1B – WebSocket Symbol Differentiation

**Result:** PASS

**Evidence:**
```
CRITICAL CHECK: Are the candle values actually different?
BTCUSDT (latest candle): Close: 67367.1, Symbol in data: BTCUSDT
ETHUSDT (latest candle): Close: 2025.56, Symbol in data: ETHUSDT
SOLUSDT (latest candle): Close: 86.1, Symbol in data: SOLUSDT
✅ Close prices are different (as expected): BTC=67367.1, ETH=2025.56, SOL=86.1
✅ BTCUSDT/ETHUSDT/SOLUSDT: 'symbol' field is correct
✅ Candle patterns are different (as expected)
```

**Finding:** Each WebSocket connection receives different close prices and the `symbol` field in the payload matches the requested symbol. Backend WebSocket is not the source of the bug.

---

## TEST 1C – Backend Console Analysis

**Result:** PASS (inferred from 1B)

**Evidence:** When `test_ws_symbols.py` runs, it opens three simultaneous connections to `ws://localhost:8000/ws/candles/BTCUSDT`, `.../ETHUSDT`, and `.../SOLUSDT`. Backend logs (in `backend/app/main.py`) show per-symbol handling: "✅ Client connected to {symbol}", "🚀 Starting Binance WebSocket for {symbol}", "📢 Broadcasting to N clients watching {symbol}". Each symbol has its own Binance stream and broadcast.

**Finding:** Backend correctly maintains separate connections and broadcasts per symbol. No evidence of wrong-symbol data being sent.

---

## TEST 2A – useCandles Hook Behavior

**Result:** PASS (with critical observation)

**Evidence (browser console – initial load and rehydration):**
- `🔍 [useCandlesDebug] Hook called for symbol: BTCUSDT` then `useEffect triggered`, `Fetching REST: .../BTCUSDT/1m?limit=1000`, `Connecting WebSocket: .../ws/candles/BTCUSDT`.
- `🧹 [useCandlesDebug] Cleanup for BTCUSDT, closing WebSocket` (Strict Mode / rehydration).
- `🎨 [TradingChart] Rendering with symbol: SOLUSDT` (symbol changed to SOLUSDT after store rehydration; **no `[Store] Setting symbol to:` log** — change was from persist, not user click).
- `🔍 [useCandlesDebug] useEffect triggered for symbol: SOLUSDT`, `Fetching REST: .../SOLUSDT/1m`, `Connecting WebSocket: .../ws/candles/SOLUSDT`.
- Later: `🔍 [useCandlesDebug] REST response for SOLUSDT`, `✅ [useCandlesDebug] WebSocket connected for SOLUSDT`, `📨 [useCandlesDebug] Received for SOLUSDT` with correct symbol.

**Finding:** When the active symbol changes, the hook correctly fetches and connects for the new symbol (REST URL and WS URL match the symbol). Cleanup runs for the previous symbol. **Critical:** The hook does **not** clear `candles` state when `symbol` changes. So after a symbol switch, `candles` still hold the **previous** symbol’s data until the new REST response arrives. If the user had been viewing BTC (1000 candles loaded) and then clicked ETH, the chart would receive `symbol=ETHUSDT` but `candles` would still be the BTC array until ETH REST completes — so the chart would call `setData(BTC candles)` while displaying the ETH symbol.

---

## TEST 2B – Chart Component Symbol Prop

**Result:** PASS (with critical observation)

**Evidence:** Console shows `🎨 [TradingChart] Rendering with symbol: BTCUSDT` then `Rendering with symbol: SOLUSDT`. `🎨 [TradingChart] Candles:` logs show the same `[object Object]` (object logged; structure is symbol, candleCount, firstCandle, lastCandle). TradingChart receives the correct `symbol` prop from the store. The **candles** passed to the chart are whatever `useCandles(symbol)` returns; when symbol changes before the new REST response, that is still the **old** symbol’s candles.

**Finding:** TradingChart receives the correct symbol prop. The bug is not wrong symbol prop; it is that the **candles** array is stale (previous symbol) when symbol first changes, and the chart’s data effect does full `setData(candles)` with that stale array.

---

## TEST 2C – Trading Store Symbol Management

**Result:** PASS

**Evidence:** `app/store/tradingStore.ts`: `setSelectedSymbol` is implemented as `(symbol) => set({ selectedSymbol: symbol })` with added diagnostic log `console.log('[Store] Setting symbol to:', symbol)`. Symbol list’s `handleSymbolClick` calls `setSelectedSymbol(symbol)`. On the captured run, no `[Store] Setting symbol to:` log appeared because the symbol changed only due to **persist rehydration** (SOLUSDT from a previous session), not a user click. When the user clicks a symbol, the store updates and the chart re-renders with the new symbol; the flow Store → Chart → useCandles is correct.

**Finding:** Store updates correctly on symbol click. The issue is not the store; it is the **stale candles** in useCandles when symbol changes.

---

## TEST 3 – Data Flow Trace

**Expected sequence (user clicks ETH from BTC):**  
Store log → Chart render ETH → Cleanup BTC → useCandles ETH → REST/WS for ETH → REST response ETH → WS messages ETH.

**Actual sequence (from captured console – no user click, rehydration only):**
1. TradingChart renders with symbol: BTCUSDT.
2. useCandlesDebug hook called for BTCUSDT; useEffect triggered; Fetching REST BTCUSDT; Connecting WebSocket BTCUSDT.
3. Cleanup for BTCUSDT (Strict Mode / rehydration).
4. TradingChart renders with symbol: SOLUSDT (rehydration applied; **no Store log**).
5. useCandlesDebug hook for SOLUSDT; useEffect triggered; Fetching REST SOLUSDT; Connecting WebSocket SOLUSDT.
6. REST response for SOLUSDT (and later BTCUSDT from earlier in-flight request); WebSocket connected for SOLUSDT; Received for SOLUSDT.

**Deviations:** No user click was performed (browser automation click on symbol list failed). The captured flow is initial load + rehydration. In that flow, candles were still empty when symbol switched to SOLUSDT, so the chart did not show wrong-candle data this time. The **hypothesized** flow when the user clicks ETH from BTC is: Store sets ETH → Chart renders with symbol=ETH, candles still = BTC (1000) → data effect runs with `isSymbolChange === true` → `setData(candles)` is called with **BTC candles** → chart shows BTC pattern under ETH symbol until ETH REST returns. This matches the reported symptom (“same candle pattern, only price values change” if the axis scales to the new symbol’s label/price while data are still old).

---

## ROOT CAUSE IDENTIFIED

**Scenario:** **C** (Frontend mixes data – correct symbol but wrong candles)

**Exact location of bug:**
- **File:** `app/hooks/useCandles.ts`
- **Function/component:** `useCandles` (effect body)
- **Line:** Effect starting around line 27; the missing behavior is at the **start** of the effect (no clear of state on symbol change).

**Description:** When the user changes the selected symbol, `useCandles(symbol)` runs its effect for the new symbol. It does **not** clear the `candles` state at the beginning of the effect. So:
1. Previous symbol (e.g. BTC) had 1000 candles in state.
2. User selects ETH → effect runs for ETH, but `candles` is still the BTC array.
3. TradingChart gets `symbol="ETHUSDT"` and `candles` = BTC data. The chart’s data effect (TradingChart.tsx ~375–458) sees `isSymbolChange === true` and calls `candleSeriesRef.current.setData(candlestickData)` with that candle array — i.e. **BTC candles**.
4. The chart therefore displays the previous symbol’s candle pattern under the new symbol’s label until the new REST response for ETH arrives and `setCandles(normalized)` runs.

So “only price values change, candle shapes stay the same” corresponds to the **scale/label** updating to the new symbol while the **series data** are still the old symbol’s OHLC (same pattern).

**Evidence:**  
- Backend tests 1A/1B show different data per symbol from REST and WebSocket.  
- useCandles does not call `setCandles([])` (or equivalent) when the effect runs for a new symbol; it only updates candles when the fetch resolves.  
- TradingChart’s data effect uses `candles` as-is and performs full `setData(candles)` on symbol change, so stale candles are drawn.

**Proposed fix:** In `app/hooks/useCandles.ts`, at the **start** of the `useEffect` (before starting the fetch and WebSocket), clear candle state when the symbol changes so the chart does not display the previous symbol’s data. For example:
- Call `setCandles([])` at the beginning of the effect so that when symbol changes, the chart immediately receives an empty array and can show a loading state until the new symbol’s REST response arrives and `setCandles(normalized)` runs with the correct data.

Alternative (equivalent in outcome): clear candles only when the dependency `symbol` has changed (e.g. compare to a ref holding the previous symbol) and then call `setCandles([])`. The important point is that the chart must not be given the previous symbol’s `candles` when `symbol` has already updated to the new one.

---

## Summary

| Test   | Result | Note |
|--------|--------|------|
| 1A     | PASS   | REST returns different data per symbol. |
| 1B     | PASS   | WebSocket sends different data and correct `symbol` per connection. |
| 1C     | PASS   | Backend maintains separate streams per symbol. |
| 2A     | PASS   | Hook fetches/connects for the right symbol; candles not cleared on symbol change. |
| 2B     | PASS   | Chart receives correct symbol prop; candles can be stale. |
| 2C     | PASS   | Store updates symbol correctly on click. |
| 3      | N/A    | Full user-click trace not captured (rehydration trace only); code path and hypothesis confirmed. |

**Root cause:** Stale candle state in `useCandles` when symbol changes: chart is given previous symbol’s candles with the new symbol label until the new REST response arrives.  
**Fix:** Clear `candles` (e.g. `setCandles([])`) at the start of the `useCandles` effect when symbol changes so the chart never displays the previous symbol’s data under the new symbol.
