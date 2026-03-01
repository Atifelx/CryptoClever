# Backend Design: Structure and Data Flow

## 1. HIGH-LEVEL OVERVIEW

The backend is a single FastAPI process that:
- Fetches candle data from Binance (REST for history, WebSocket for live).
- Keeps a per-symbol, per-interval buffer of up to 1000 candles in a store (Redis or in-memory).
- Serves REST endpoints for symbols list and candle history.
- Exposes WebSocket endpoints so frontend clients receive live candle updates.
- Broadcasts each new candle only to clients that are subscribed to that symbol (and interval).

```
                    Binance
                 (REST + WS)
                      |
                      v
              +---------------+     REST /candles/{symbol}/{interval}
              |   Backend     | <-------------------------------------  Frontend (initial load)
              |   FastAPI     |
              |              |     WS /ws/candles/{symbol}  or  /ws/candles
              |              | -------------------------------------->  Frontend (live updates)
              +-------^------+
                      |
                      v
              Store (Redis or in-memory)
              candles:SYMBOL:interval  ->  list of up to 1000 candles
```

---

## 2. BACKEND STRUCTURE (MODULES)

- **app/main.py**
  - FastAPI app, lifespan, CORS.
  - REST: /health, /symbols, /streaming/status, /candles/{symbol}/{interval}, /signals, /trades, etc.
  - WebSocket: /ws/candles/{symbol} (per-symbol client connections + per-symbol Binance worker), /ws/candles (multi-subscribe + broadcast from shared Binance stream).
  - ConnectionManager: tracks client WebSockets per symbol, starts/stops a Binance WebSocket worker per symbol, broadcasts to clients watching that symbol.

- **app/binance_ws.py**
  - Bootstrap: bootstrap_symbol_interval(symbol, interval) fetches last 1000 klines from Binance REST and writes via set_candles(); bootstrap_all() runs this for all SYMBOLS x INTERVALS.
  - fetch_klines_range(symbol, interval, start_sec, end_sec): fetches Binance REST klines for a time range (used for gap-fill).
  - run_binance_ws(): single long-lived task that connects to Binance combined kline stream (all symbols), parses messages, calls append_candle() then broadcast_candle() for each update.

- **app/redis_store.py**
  - Store abstraction: either in-memory dict or Redis.
  - Keys: candles:{SYMBOL}:{interval} (e.g. candles:BTCUSDT:1m). Value: list of candle dicts (time in seconds, open, high, low, close, volume). Max length BUFFER_SIZE (1000).
  - get_candles(symbol, interval, limit), append_candle(symbol, interval, candle), set_candles(symbol, interval, candles).
  - Also: get_signals/set_signals (indicators cache), get_last_append_time().

- **app/ws_broadcast.py**
  - In-process broadcast: _subscribers[(symbol, interval)] = set of WebSocket; _connection_subs[websocket] = set of (symbol, interval).
  - subscribe(ws, symbol, interval), unsubscribe(ws, symbol, interval), set_subscriptions(ws, list of (symbol, interval)), unsubscribe_all(ws).
  - broadcast_candle(symbol, interval, candle): builds JSON payload, sends to every WebSocket in _subscribers[(symbol, interval)].

- **app/config.py**
  - SYMBOLS (e.g. BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT), INTERVALS (e.g. ["1m"]), BUFFER_SIZE=1000, REDIS_URL, USE_MEMORY_STORE, BINANCE_REST_BASE, BINANCE_WS_BASE.

---

## 3. DATA FLOW — HIGH LEVEL

### 3.1 Startup (lifespan)

1. Database init (optional).
2. bootstrap_all(): for each (symbol, interval), fetch last 1000 klines from Binance REST; set_candles(symbol, interval, candles). Store is filled with initial history.
3. asyncio.create_task(run_binance_ws()): background task connects to Binance combined stream and runs forever (reconnect on error).
4. On shutdown: cancel run_binance_ws task, close_redis().

### 3.2 Two Ways Clients Get Live Data

**Path A — Per-symbol WebSocket: /ws/candles/{symbol}**

- Client connects to e.g. /ws/candles/BTCUSDT.
- ConnectionManager adds that WebSocket to active_connections["BTCUSDT"].
- If this is the first client for BTCUSDT, ConnectionManager starts a dedicated Binance WebSocket for BTCUSDT: wss://stream.binance.com:9443/ws/btcusdt@kline_1m.
- That worker loop: receive kline from Binance -> build candle -> sync store (gap-fill if needed, append_candle) -> broadcast_to_clients(BTCUSDT, candle).
- broadcast_to_clients sends the candle (JSON) to every WebSocket in active_connections["BTCUSDT"].
- When the last client for BTCUSDT disconnects, the manager stops the Binance worker for BTCUSDT.

**Path B — Multi-subscribe WebSocket: /ws/candles (no path param)**

- Client connects to /ws/candles and sends messages like { "symbol": "BTCUSDT", "interval": "1m" } or { "subscriptions": [ { "symbol", "interval" }, ... ] }.
- ws_broadcast maintains _subscribers[(symbol, interval)] and _connection_subs[websocket].
- run_binance_ws() (the single combined Binance stream) on each kline: append_candle(symbol, interval, candle) then broadcast_candle(symbol, interval, candle).
- broadcast_candle sends to all WebSockets in _subscribers[(symbol, interval)] (from ws_broadcast). So clients subscribed via /ws/candles receive updates from the combined stream, not from ConnectionManager.

So: two independent broadcast paths. Path A uses ConnectionManager and its per-symbol Binance workers; Path B uses run_binance_ws + ws_broadcast. Both paths write to the same store (append_candle). REST /candles reads from that store.

### 3.3 REST Candle Read

- GET /candles/{symbol}/{interval}?limit=N
- get_candles(symbol, interval, limit) from redis_store; returns last N candles for that key.
- Response: { "symbol", "interval", "candles": [ ... ] }.

---

## 4. DATA FLOW — LOW LEVEL

### 4.1 Store Keys and Shape

- Key: candles:{SYMBOL}:{interval} (e.g. candles:BTCUSDT:1m). Symbol uppercase, interval lowercase (1D -> 1d).
- Value: list of dicts. Each dict: time (int, seconds), open, high, low, close, volume (floats). Sorted by time. Max length BUFFER_SIZE (1000); oldest dropped when over.

### 4.2 append_candle(symbol, interval, candle)

- Resolve key = candles:SYMBOL:interval.
- Load current list (from Redis or _memory_store).
- If a candle with same "time" exists: replace it; else append, sort by time, trim to last BUFFER_SIZE.
- Write back. Update _last_append_time.

### 4.3 set_candles(symbol, interval, candles)

- Replaces entire buffer for that key (used by bootstrap). Trim to BUFFER_SIZE if needed.

### 4.4 get_candles(symbol, interval, limit)

- Read key; return last `limit` candles (copy). Return [] if key missing or empty.

### 4.5 ConnectionManager (main.py) — Per-Symbol Clients and Binance Worker

- active_connections: dict[symbol, list[WebSocket]]. Clients connected to /ws/candles/{symbol} for that symbol.
- binance_connections: dict[symbol, asyncio.Task]. One long-running task per symbol that has at least one client.
- connect_client(ws, symbol): add ws to active_connections[symbol]; if symbol had no clients before, start_binance_stream(symbol) -> _binance_websocket_worker(symbol).
- disconnect_client(ws, symbol): remove ws from active_connections[symbol]; if no clients left for symbol, stop_binance_stream(symbol) (cancel task, remove from dict).
- _binance_websocket_worker(symbol): loop: connect to wss://stream.binance.com:9443/ws/{symbol_lower}@kline_1m; for each message: parse kline -> build candle dict (timestamp ms, open, high, low, close, volume, is_closed); sync store (get_candles; if empty bootstrap; if gap, fetch_klines_range and append_candle each; then append_candle current); broadcast_to_clients(symbol, candle).
- broadcast_to_clients(symbol, candle_data): for each ws in active_connections[symbol], send_json(candle_data); remove any that fail.

### 4.6 ws_broadcast (ws_broadcast.py) — Multi-Subscribe

- _subscribers: dict[(symbol, interval), set[WebSocket]]. Which connections get updates for (symbol, interval).
- _connection_subs: dict[WebSocket, set[(symbol, interval)]]. For cleanup on disconnect.
- subscribe(ws, symbol, interval): add ws to _subscribers[(sym, iv)], add (sym, iv) to _connection_subs[ws].
- broadcast_candle(symbol, interval, candle): key = (symbol, interval); get copy of set(_subscribers[key]); send JSON {"type":"candle","symbol","interval","candle":...} to each; remove dead connections from _subscribers.

### 4.7 run_binance_ws() (binance_ws.py)

- Build combined stream URL: e.g. btcusdt@kline_1m/ethusdt@kline_1m/... (all SYMBOLS x INTERVALS).
- Connect to Binance; for each message: parse stream name -> symbol, interval; parse "k" -> _kline_to_candle(k) (time in seconds); append_candle(symbol, interval, candle); broadcast_candle(symbol, interval, candle).
- On disconnect/error: sleep 5, reconnect. On CancelledError: exit.

### 4.8 Candle Formats

- **Store (redis_store)**: time (seconds), open, high, low, close, volume.
- **ConnectionManager broadcast (to /ws/candles/{symbol} clients)**: symbol, timestamp (ms), open, high, low, close, volume, is_closed.
- **ws_broadcast payload**: { "type": "candle", "symbol", "interval", "candle": { time, open, high, low, close, volume } } (candle in store shape, time in seconds).

---

## 5. SUMMARY DIAGRAM (TEXT)

```
[Binance REST]
      |
      | bootstrap_all() at startup
      v
+------------------+     run_binance_ws() (combined stream)      +------------------+
|  Redis / Memory  | <-- append_candle() per kline -------------|  Binance WS      |
|  Store           |                                            |  (all symbols)   |
|  candles:SYMBOL  |                                            +--------+---------+
|  :interval       |                                                     |
+--------+---------+                                                     | broadcast_candle()
         |                                                               v
         | get_candles()                                          +------------------+
         |                                                       | ws_broadcast     |
         v                                                       | _subscribers     |
  GET /candles/{symbol}/{interval}                               +--------+---------+
         |                                                                 |
         v                                                                 | /ws/candles
  Frontend REST                                                             v
                                                                   Frontend (multi-subscribe)

[Binance WS per symbol] (started by ConnectionManager when first client connects to /ws/candles/BTCUSDT)
      |
      | _binance_websocket_worker(symbol)
      | append_candle() + broadcast_to_clients(symbol, candle)
      v
+------------------+
| ConnectionManager|
| active_connections[symbol]
+--------+---------+
         |
         | /ws/candles/{symbol}
         v
  Frontend (per-symbol WS)
```

---

## 6. CONFIGURATION

- SYMBOLS: 5 (BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT).
- INTERVALS: ["1m"].
- BUFFER_SIZE: 1000 candles per symbol/interval.
- Store: Redis (REDIS_URL) or in-memory (USE_MEMORY_STORE=1).
- Binance: BINANCE_REST_BASE (api.binance.com/api/v3), BINANCE_WS_BASE (stream.binance.com:9443).
