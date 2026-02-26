# SmartTrade Backend (FastAPI)

- Connects to Binance WebSocket for curated symbols/intervals.
- Stores live candles in Redis (max 1000 per symbol/interval, FIFO).
- REST: `GET /candles/{symbol}/{interval}?limit=500`.
- REST: `GET /symbols` — returns `{"symbols": ["BTCUSDT", ...]}` (used by frontend to show only these pairs).
- WebSocket: `WS /ws/candles` — send `{ "symbol": "X", "interval": "Y" }` to add one subscription, or `{ "subscriptions": [ { "symbol": "BTCUSDT", "interval": "1m" }, ... ] }` to subscribe to many; receive `{ "type": "candle", "symbol", "interval", "candle": {...} }` on each update.

## Data flow

The backend is the single source of truth for candle data. **Backend store** is filled by a single Binance WebSocket client (bootstrap via REST, then live stream). The **frontend never talks to Binance**: it loads data via backend REST and stays live via a **private WebSocket to the backend**. One frontend connection can subscribe to all 10 symbols (e.g. for the current interval); the backend pushes every candle it receives from Binance to subscribed clients, so all charts update in real time.

## Run locally

**Option A – No Redis (easiest for testing)**

Uses in-memory store so you don’t need Redis installed:

```bash
cd backend
pip install -r requirements.txt   # if not done yet
USE_MEMORY_STORE=1 python3 -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Option B – With Redis**

```bash
# Terminal 1: start Redis (if installed, e.g. brew install redis)
redis-server

# Terminal 2: backend
cd backend
source venv/bin/activate   # or: python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export REDIS_URL=redis://localhost:6379
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Then start the Next.js frontend** (from repo root):

```bash
export BACKEND_URL=http://127.0.0.1:8000
export NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000
npm run dev
```

Open http://localhost:3000 (or the port shown). The sidebar will load the 10 symbols from the backend; clicking a symbol loads the chart from the backend (and live WebSocket if `NEXT_PUBLIC_BACKEND_URL` is set).

**Verify backend has candle data:** Open http://127.0.0.1:8000/inspect or http://localhost:3000/api/backend/inspect — you should see a table with Count 1000 per symbol/interval. If you see "Backend not reachable", start the backend with the command shown; bootstrap takes 30–60s.

**Verify live WebSocket:** Open http://127.0.0.1:8000/inspect-ws or http://localhost:3000/api/backend/inspect-ws — the page connects to the backend WebSocket and shows live candle updates for BTCUSDT 1m. New rows should appear every few seconds (forming candle) and each minute (new candle).

**If the app stays on “Loading…” or you see 404/chunk errors:** clear the Next.js cache and use a free port: `rm -rf .next` then `npm run dev -- -p 3003`. **Open http://localhost:3003** in the browser (same port as the server). If you open a different port than the one the dev server is running on, you will get 404 errors.

## Env

- `REDIS_URL`: Redis connection string (default `redis://localhost:6379`).
- `USE_MEMORY_STORE`: Set to `1` or `true` to use in-memory store instead of Redis (no Redis needed).
- Frontend: set `BACKEND_URL` and `NEXT_PUBLIC_BACKEND_URL` (e.g. `http://127.0.0.1:8000`) so the app can reach the backend for symbols, candles, and live WebSocket.

## Tests

Run unit tests (no Redis/Binance required): `python3 -m unittest tests.test_streaming_verify -v` from the backend directory. Optional integration check against a running backend: `python3 tests/integration_check_streaming.py`.
