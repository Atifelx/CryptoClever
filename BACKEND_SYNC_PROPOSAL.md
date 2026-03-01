# Backend sync before broadcast – proposal (no gap)

## 1. Goal

- **No gap on the chart:** The 1000 candles from REST and the live candles from WebSocket must form one continuous series (no missing minutes).
- **Fix on the backend:** Before broadcasting any live candle to clients, ensure it is **in sync** with the stored 1000 candles and **fill any gap** so clients never see a discontinuity.

---

## 2. Current flow (why the gap exists)

### Two separate backend data paths

| Path | Fills store? | Serves REST? | Serves chart WS? |
|------|----------------|-------------|-------------------|
| **run_binance_ws** (binance_ws.py) | Yes → Redis | Yes (GET /candles reads Redis) | No (chart does not use this WS) |
| **ConnectionManager** (main.py)   | No           | No               | Yes (/ws/candles/{symbol})   |

- **REST** `GET /candles/{symbol}/1m?limit=1000` → reads **Redis** (filled by `run_binance_ws` bootstrap + stream).
- **Chart WebSocket** `/ws/candles/{symbol}` → **ConnectionManager** has its own Binance worker per symbol; it **does not read or write Redis**. It only receives from Binance and calls `broadcast_to_clients(symbol, candle)`.

So:

- When the user clicks a symbol: frontend does REST (gets 1000 candles from Redis, last candle time = T) and connects WS to ConnectionManager.
- ConnectionManager’s worker may have just started or may already be running; it sends whatever candle it receives from Binance next (e.g. T+k).
- Candles T+1 … T+k−1 were either never sent (worker just started) or were sent before this client connected. So the client has [..., T] and then receives T+k → **gap**.

So the gap is **not** because REST is wrong; it’s because:

1. REST and chart WS use **different pipelines** (Redis vs ConnectionManager).
2. There is **no check** that the next live candle is continuous with the stored 1000 candles before broadcasting.

---

## 3. Validation (REST 1000 + WebSocket)

- **REST:** At startup, `bootstrap_all()` fills Redis with 1000 candles per symbol/interval (1m). `GET /candles/{symbol}/1m?limit=1000` returns that list. So REST **does** give 1000 candles from backend memory.
- **WebSocket:** When the first client connects to `/ws/candles/{symbol}`, ConnectionManager starts a Binance WebSocket for that symbol and broadcasts every incoming candle. So the live connection **is** started and live candles **are** broadcast.
- The missing piece is: **no sync** between “last candle in store (Redis)” and “next candle from Binance” before that next candle is broadcast. So the first (or any) broadcast can be T+k while the client’s REST had [... T], causing a gap.

---

## 4. Proposed fix: sync-before-broadcast on the backend

**Idea:** Before the backend sends any live candle to clients, it must ensure that candle is **continuous** with the stored 1000 candles. If there is a gap, **fill it in the store first**, then broadcast. So every broadcast is “in sync” with the store; clients that already have the 1000 from REST will never see a jump.

**Where:** In **ConnectionManager**’s `_binance_websocket_worker` (main.py), **before** `await self.broadcast_to_clients(symbol, candle)`:

1. **Read store:** Call `get_candles(symbol, "1m", limit=1000)` (Redis/memory). This is the same store REST uses.
2. **Ensure store exists for this symbol:** If the list is empty (e.g. this symbol wasn’t bootstrapped yet), call a one-off bootstrap for this symbol/1m (Binance REST klines, limit=1000) and `set_candles(symbol, "1m", candles)` so REST and WS both have 1000 candles.
3. **Detect gap:** Last candle time in store = `last_ts` (seconds). New candle time = `kline["t"] // 1000` (Binance sends ms). Interval = 60 seconds for 1m. If `new_ts > last_ts + 60`, there is a **forward gap** (one or more minutes missing).
4. **Fill gap:** If gap:
   - Fetch missing candles from Binance REST (`/klines`, symbol, interval=1m, optional `startTime` / `endTime` or enough limit to cover last_ts+60 … new_ts).
   - Append each missing candle to the store with `append_candle(symbol, "1m", candle)` in order.
   - Then append (or update) the **current** candle with `append_candle(symbol, "1m", candle)`.
5. **Broadcast:** Call `await self.broadcast_to_clients(symbol, candle)` as today.

**Result:**

- The **store (Redis/memory)** always has a continuous series up to and including the latest live candle.
- **REST** already reads from the store → clients get 1000 continuous candles.
- **WS** only broadcasts after the store is updated and continuous → clients never receive a candle that “jumps” over missing minutes. So **no gap** on the chart.

**Important:** The chart still does REST then WS; we do **not** change the frontend flow. We only ensure that every WS message is consistent with the store. Optional: when a client connects, ConnectionManager could send the **last N candles** from the store (e.g. last 5 minutes) so that even the first WS message is clearly continuous with REST; that can be a later enhancement.

---

## 5. Optional: same sync in run_binance_ws

For the **other** WebSocket path (`/ws/candles` with subscriptions), `run_binance_ws` already does `append_candle` then `broadcast_candle`. We can add the **same** sync logic there: before `append_candle`, call `get_candles`, detect gap (new candle time vs last in store), fill gap from Binance REST, then append and broadcast. Then both WS paths and REST stay gap-free.

---

## 6. Summary

| Step | Action |
|------|--------|
| 1 | Validate: REST returns 1000 candles from backend memory; WebSocket live connection is started and used. Both are working; the gap is due to no sync between store and live candle before broadcast. |
| 2 | Add a **sync-before-broadcast** layer: before sending any live candle to clients, read store (get_candles), ensure symbol is bootstrapped if empty, detect gap (new candle time > last_ts + 60s), fill gap via Binance REST + append_candle, then append the current candle, then broadcast. |
| 3 | Implement this in ConnectionManager’s `_binance_websocket_worker` (and optionally in `run_binance_ws`). Use existing `get_candles`, `append_candle`, `set_candles`; add a small helper that fetches Binance REST for a time range and returns list of candles in our format. |
| 4 | No change to frontend contract: REST still 1000 candles, WS still one candle per message. Only the backend guarantees continuity before every broadcast. |

This gives a single source of truth (the store), with a middleware-style “sync then broadcast” so there is **no gap** on the chart.
