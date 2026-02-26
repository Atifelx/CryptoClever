import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Dict, List, Optional

import websockets
from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from app.binance_ws import bootstrap_all, run_binance_ws
from app.config import INTERVALS, SYMBOLS
from app.redis_store import get_candles, get_signals, set_signals, close_redis, get_last_append_time
from app.indicators import compute_signals
from app import database as db
from app import ws_broadcast as ws_broadcast

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_ws_task: Optional[asyncio.Task] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _ws_task
    try:
        await db.init_db()
        logger.info("Database tables ready")
    except Exception as e:
        logger.warning("Database init skipped or failed: %s", e)
    logger.info("Bootstrapping candles from Binance REST...")
    await bootstrap_all()
    _ws_task = asyncio.create_task(run_binance_ws())
    logger.info("Binance WebSocket task started")
    yield
    if _ws_task:
        _ws_task.cancel()
        try:
            await _ws_task
        except asyncio.CancelledError:
            pass
    await close_redis()
    logger.info("Backend shutdown complete")


app = FastAPI(title="SmartTrade Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/symbols")
async def symbols():
    """Return list of symbols the backend streams (for frontend to show only these)."""
    return {"symbols": list(SYMBOLS)}


@app.get("/streaming/status")
async def streaming_status():
    """Verification: for each configured symbol and interval, return candle count (max 1000), last_candle_time, and last candle OHLC from Redis."""
    per_symbol = []
    for symbol in SYMBOLS:
        for interval in INTERVALS:
            data = await get_candles(symbol, interval, limit=1000)
            count = len(data)
            last = data[-1] if data else None
            last_candle_time = last.get("time") if last else None
            item = {
                "symbol": symbol,
                "interval": interval,
                "count": count,
                "last_candle_time": last_candle_time,
            }
            if last:
                item["last_close"] = last.get("close")
                item["last_open"] = last.get("open")
                item["last_high"] = last.get("high")
                item["last_low"] = last.get("low")
            else:
                item["last_close"] = item["last_open"] = item["last_high"] = item["last_low"] = None
            per_symbol.append(item)
    return {
        "symbols": list(SYMBOLS),
        "per_symbol": per_symbol,
        "last_store_update_ts": get_last_append_time(),
    }


@app.get("/validate/candles")
async def validate_candles(interval: str = "1m"):
    """Programmatic validation: compare last close across symbols. Returns PASS if data differs per symbol, FAIL if same for all."""
    interval = interval.lower() if interval.upper() != "1D" else "1d"
    last_closes: dict[str, float] = {}
    for symbol in SYMBOLS:
        data = await get_candles(symbol, interval, limit=10)
        if data:
            last = data[-1]
            close = last.get("close")
            if close is not None:
                last_closes[symbol] = float(close)
    if len(last_closes) < 2:
        return {
            "result": "FAIL",
            "reason": "Insufficient symbol data (need at least 2 symbols with candles).",
            "last_closes": last_closes,
        }
    values = list(last_closes.values())
    if len(set(values)) == 1:
        return {
            "result": "FAIL",
            "reason": "Same last close for all symbols; backend may be returning identical data.",
            "last_closes": last_closes,
        }
    return {
        "result": "PASS",
        "reason": "Data differs per symbol (last close values are not identical).",
        "last_closes": last_closes,
    }


@app.get("/verify/status")
async def verify_status():
    """JSON check: server up and Binance bootstrap has candle data. Use for curl or /api/backend/verify/status."""
    data = await get_candles("BTCUSDT", "1m", limit=1)
    if data and len(data) > 0:
        return {"ok": True, "message": "Backend and Binance bootstrap OK"}
    return {"ok": False, "message": "Bootstrap not ready or no candle data"}


INSPECT_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Backend candles – inspect</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e0e0e0; margin: 0; padding: 16px; }
    h1 { margin: 0 0 8px 0; font-size: 1.25rem; }
    .sub { color: #888; font-size: 0.875rem; margin-bottom: 16px; }
    .status-box { padding: 12px 16px; margin-bottom: 16px; border-radius: 8px; font-size: 0.9rem; }
    .status-box.ok { background: #1b2e1b; color: #4caf50; border: 1px solid #2e5c2e; }
    .status-box.err { background: #2e1b1b; color: #f44336; border: 1px solid #5c2e2e; }
    .status-box code { display: block; margin-top: 8px; padding: 8px; background: #000; border-radius: 4px; font-size: 0.8rem; overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; max-width: 720px; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #333; }
    th { color: #26a69a; }
    .count { font-variant-numeric: tabular-nums; }
    .ok { color: #4caf50; }
    .warn { color: #ff9800; }
    .err { color: #f44336; }
    .pulse { animation: pulse 1s ease-in-out; }
    @keyframes pulse { 50% { background: #1a2a2a; } }
    #serverStatus { margin-bottom: 12px; }
  </style>
</head>
<body>
  <h1>Candles inspect</h1>
  <p class="sub">Every symbol × interval: candle count (target 1000), last candle time, and last close/open so you can verify data differs per symbol. Auto-refreshes every 2s.</p>
  <div id="serverStatus" class="status-box err">Checking backend…</div>
  <p class="sub">Last fetch: <span id="lastFetch">—</span> · Store last updated: <span id="storeUpdate">—</span></p>
  <table>
    <thead>
      <tr><th>Symbol</th><th>Interval</th><th>Count</th><th>Last candle time</th><th>Last close</th><th>Last open</th><th>Status</th></tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
  <script>
    const tbody = document.getElementById('tbody');
    const lastFetchEl = document.getElementById('lastFetch');
    const storeUpdateEl = document.getElementById('storeUpdate');
    const serverStatusEl = document.getElementById('serverStatus');
    const isNext = (document.location.pathname || '').indexOf('/api/backend') !== -1;
    const apiBase = isNext ? '/api/backend' : '';
    const startCmd = 'cd backend && USE_MEMORY_STORE=1 python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000';

    function setServerStatus(ok, msg) {
      serverStatusEl.className = 'status-box ' + (ok ? 'ok' : 'err');
      serverStatusEl.innerHTML = msg;
    }

    async function checkHealth() {
      try {
        const r = await fetch(apiBase + '/health');
        const d = await r.json().catch(() => ({}));
        if (r.ok && (d.status === 'ok' || d.status === undefined)) {
          setServerStatus(true, 'Backend reachable. Candle data should load below.');
          return true;
        }
        setServerStatus(false, 'Backend returned an error. Check terminal where backend is running.<br><code>' + (d.error || r.status) + '</code>');
        return false;
      } catch (e) {
        setServerStatus(false, 'Backend not reachable. Start the backend in a terminal:<br><code>' + startCmd + '</code>');
        return false;
      }
    }

    let prev = {};
    function formatTime(ts) {
      if (ts == null) return '—';
      const d = new Date(ts * 1000);
      return d.toLocaleString();
    }
    function status(count) {
      if (count >= 1000) return { text: 'OK', cls: 'ok' };
      if (count > 0) return { text: 'Partial', cls: 'warn' };
      return { text: 'Empty', cls: 'err' };
    }
    async function refresh() {
      const statusUrl = apiBase + '/streaming/status';
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (attempt > 1) lastFetchEl.textContent = 'Retrying (' + attempt + '/3)…';
          const r = await fetch(statusUrl);
          const data = await r.json();
          if (!r.ok) {
            lastErr = data.error || 'HTTP ' + r.status;
            if (attempt < 3) { await new Promise(function(ok) { setTimeout(ok, 2000); }); continue; }
          }
          lastFetchEl.textContent = new Date().toLocaleTimeString();
          const ts = data.last_store_update_ts;
          if (ts && ts > 0) {
            const ago = Math.round(Date.now() / 1000 - ts);
            if (ago < 60) storeUpdateEl.innerHTML = '<span class="ok">' + ago + 's ago</span>';
            else if (ago < 120) storeUpdateEl.innerHTML = '<span class="warn">' + ago + 's ago</span>';
            else storeUpdateEl.innerHTML = '<span class="err">' + ago + 's ago (Binance stream may have stopped)</span>';
          } else {
            storeUpdateEl.textContent = '—';
          }
          const list = data.per_symbol || [];
          if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="err">No symbol/interval data. Backend may still be bootstrapping (wait 1–2 min) or check backend logs.</td></tr>';
            return;
          }
          const rows = list.map(({ symbol, interval, count, last_candle_time, last_close, last_open }) => {
            const key = symbol + ':' + interval;
            const s = status(count);
            const changed = prev[key] !== last_candle_time;
            if (changed) prev[key] = last_candle_time;
            const closeStr = last_close != null ? Number(last_close).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—';
            const openStr = last_open != null ? Number(last_open).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—';
            return '<tr class="' + (changed ? 'pulse' : '') + '"><td>' + symbol + '</td><td>' + interval + '</td><td class="count">' + count + '</td><td>' + formatTime(last_candle_time) + '</td><td class="count">' + closeStr + '</td><td class="count">' + openStr + '</td><td class="' + s.cls + '">' + s.text + '</td></tr>';
          });
          tbody.innerHTML = rows.join('');
          return;
        } catch (e) {
          lastErr = e.message || String(e);
          if (attempt < 3) await new Promise(function(ok) { setTimeout(ok, 2000); });
        }
      }
      lastFetchEl.textContent = 'Error: ' + (lastErr || 'Failed to fetch');
      tbody.innerHTML = '<tr><td colspan="7" class="err">Cannot load status. Ensure backend is running: <code>' + startCmd + '</code> Then reload this page.</td></tr>';
    }
    (async function init() {
      await checkHealth();
      refresh();
      setInterval(refresh, 2000);
    })();
  </script>
</body>
</html>
"""


VERIFY_CANDLES_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Verify: Binance 1000 candles</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e0e0e0; margin: 0; padding: 16px; }
    h1 { margin: 0 0 8px 0; font-size: 1.25rem; }
    .sub { color: #888; font-size: 0.875rem; margin-bottom: 16px; }
    .summary { font-size: 1rem; color: #e0e0e0; margin-bottom: 12px; }
    .summary.ok { color: #4caf50; }
    .summary.no { color: #ff9800; }
    .status-box { padding: 12px 16px; margin-bottom: 16px; border-radius: 8px; font-size: 0.9rem; }
    .status-box.ok { background: #1b2e1b; color: #4caf50; border: 1px solid #2e5c2e; }
    .status-box.err { background: #2e1b1b; color: #f44336; border: 1px solid #5c2e2e; }
    table { border-collapse: collapse; width: 100%; max-width: 720px; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #333; }
    th { color: #26a69a; }
    .count { font-variant-numeric: tabular-nums; }
    .ok { color: #4caf50; }
    .warn { color: #ff9800; }
    .err { color: #f44336; }
  </style>
</head>
<body>
  <h1>Verify: Binance 1000 candles</h1>
  <p class="sub">Table of candle counts per symbol × interval (target 1000). Auto-refreshes every 4s.</p>
  <p id="summary" class="summary">All symbols (1m) have 1000 candles: —</p>
  <div id="serverStatus" class="status-box err">Checking backend…</div>
  <p class="sub">Last fetch: <span id="lastFetch">—</span></p>
  <table>
    <thead>
      <tr><th>Symbol</th><th>Interval</th><th>Count</th><th>Last close</th><th>Status</th></tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
  <script>
    const tbody = document.getElementById('tbody');
    const lastFetchEl = document.getElementById('lastFetch');
    const summaryEl = document.getElementById('summary');
    const serverStatusEl = document.getElementById('serverStatus');
    const apiBase = (document.location.pathname || '').indexOf('/api/backend') !== -1 ? '/api/backend' : '';
    const statusUrl = apiBase + '/streaming/status';

    function status(count) {
      if (count >= 1000) return { text: 'OK', cls: 'ok' };
      if (count > 0) return { text: 'Partial', cls: 'warn' };
      return { text: 'Empty', cls: 'err' };
    }
    async function refresh() {
      try {
        const r = await fetch(statusUrl);
        let data;
        try {
          data = await r.json();
        } catch (parseErr) {
          serverStatusEl.className = 'status-box err';
          serverStatusEl.textContent = 'Backend returned invalid JSON. Is the backend running on port 8000?';
          summaryEl.textContent = 'All symbols (1m) have 1000 candles: No – see table below';
          summaryEl.className = 'summary no';
          tbody.innerHTML = '<tr><td colspan="5" class="err">Invalid response (not JSON). Open <a href="' + (apiBase || '') + '/verify/candles" style="color:#26a69a;">backend directly</a> (port 8000) or ensure BACKEND_URL is set and backend is running.</td></tr>';
          return;
        }
        if (!r.ok) {
          summaryEl.textContent = 'All symbols (1m) have 1000 candles: No – see table below';
          summaryEl.className = 'summary no';
          serverStatusEl.className = 'status-box err';
          serverStatusEl.textContent = 'Backend returned ' + r.status + (data && data.error ? ': ' + data.error : '');
          tbody.innerHTML = '<tr><td colspan="5" class="err">HTTP ' + r.status + '. Start backend: <code>cd backend &amp;&amp; USE_MEMORY_STORE=1 python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000</code> Wait 1–2 min for bootstrap, then reload.</td></tr>';
          return;
        }
        lastFetchEl.textContent = new Date().toLocaleTimeString();
        const list = data.per_symbol || [];
        if (list.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="err">No candle data yet. Wait 1–2 minutes after starting the backend for Binance bootstrap to complete. Use memory store: <code>USE_MEMORY_STORE=1</code> (no Redis needed), or ensure Redis is running. Then reload this page.</td></tr>';
          summaryEl.textContent = 'All symbols (1m) have 1000 candles: No – see table below';
          summaryEl.className = 'summary no';
          serverStatusEl.className = 'status-box warn';
          serverStatusEl.textContent = 'Backend reachable but no candle data. Bootstrap may still be running (1–2 min).';
          return;
        }
        const rows1m = list.filter(function(x) { return x.interval === '1m'; });
        const all1000 = rows1m.length > 0 && rows1m.every(function(x) { return x.count >= 1000; });
        summaryEl.textContent = 'All symbols (1m) have 1000 candles: ' + (all1000 ? 'Yes' : 'No – see table below');
        summaryEl.className = 'summary ' + (all1000 ? 'ok' : 'no');
        serverStatusEl.className = 'status-box ok';
        serverStatusEl.textContent = 'Backend reachable. Candle counts below.';
        const rows = list.map(function(x) {
          const s = status(x.count);
          const closeStr = x.last_close != null ? Number(x.last_close).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—';
          return '<tr><td>' + x.symbol + '</td><td>' + x.interval + '</td><td class="count">' + x.count + '</td><td class="count">' + closeStr + '</td><td class="' + s.cls + '">' + s.text + '</td></tr>';
        });
        tbody.innerHTML = rows.join('');
      } catch (e) {
        summaryEl.textContent = 'All symbols (1m) have 1000 candles: No – see table below';
        summaryEl.className = 'summary no';
        serverStatusEl.className = 'status-box err';
        serverStatusEl.textContent = 'Cannot reach backend. Is it running on port 8000? If using Next.js, open <a href="/api/backend/verify/candles" style="color:#26a69a;">/api/backend/verify/candles</a>.';
        tbody.innerHTML = '<tr><td colspan="5" class="err">Failed to fetch: ' + (e.message || String(e)) + '. Start backend: <code>cd backend &amp;&amp; USE_MEMORY_STORE=1 python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000</code></td></tr>';
      }
    }
    refresh();
    setInterval(refresh, 4000);
  </script>
</body>
</html>
"""


@app.get("/inspect", response_class=HTMLResponse)
async def inspect_candles():
    """Browser page: see every symbol × interval candle count (target 1000) and last candle time; auto-refreshes so you can see new candles updating."""
    return INSPECT_HTML


@app.get("/verify/candles", response_class=HTMLResponse)
async def verify_candles():
    """Browser page: verify Binance has loaded 1000 candles per symbol/interval. Shows summary and table; auto-refreshes every 4s."""
    return VERIFY_CANDLES_HTML


INSPECT_WS_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Live WebSocket candles – inspect</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e0e0e0; margin: 0; padding: 16px; }
    h1 { margin: 0 0 8px 0; font-size: 1.25rem; }
    .sub { color: #888; font-size: 0.875rem; margin-bottom: 12px; }
    .status-box { padding: 10px 14px; margin-bottom: 12px; border-radius: 8px; font-size: 0.9rem; }
    .status-box.connected { background: #1b2e1b; color: #4caf50; border: 1px solid #2e5c2e; }
    .status-box.disconnected { background: #2e1b1b; color: #f44336; border: 1px solid #5c2e2e; }
    .status-box span { font-variant-numeric: tabular-nums; }
    table { border-collapse: collapse; width: 100%; max-width: 900px; font-size: 0.85rem; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #333; }
    th { color: #26a69a; position: sticky; top: 0; background: #0f0f0f; }
    .count { font-variant-numeric: tabular-nums; }
    .time { font-variant-numeric: tabular-nums; color: #aaa; }
    a { color: #26a69a; }
  </style>
</head>
<body>
  <h1>Live WebSocket candles</h1>
  <p class="sub">Subscribes to BTCUSDT 1m; shows the last 30 candle updates from the backend WebSocket. If no new rows appear, the Binance stream or backend may have stopped.</p>
  <div id="connStatus" class="status-box disconnected">Connecting…</div>
  <p class="sub">Received: <span id="count">0</span> messages</p>
  <div style="max-height: 70vh; overflow: auto;">
    <table>
      <thead>
        <tr><th>Time (received)</th><th>Symbol</th><th>Interval</th><th>Candle time</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Vol</th></tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
  <script>
    const tbody = document.getElementById('tbody');
    const connStatus = document.getElementById('connStatus');
    const countEl = document.getElementById('count');
    const isNext = (document.location.pathname || '').indexOf('/api/backend') !== -1;
    const wsUrl = (document.location.port === '3000' || isNext) ? 'ws://127.0.0.1:8000/ws/candles' : ((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/candles');
    let total = 0;
    const maxRows = 30;
    const rows = [];

    function addRow(msg) {
      const c = msg.candle || {};
      const t = c.time != null ? new Date(c.time * 1000).toLocaleString() : '—';
      const now = new Date().toLocaleTimeString();
      const r = [now, msg.symbol || '—', msg.interval || '—', t, c.open, c.high, c.low, c.close, (c.volume != null ? Number(c.volume).toFixed(0) : '—')];
      rows.unshift(r);
      if (rows.length > maxRows) rows.pop();
      total++;
      countEl.textContent = total;
      tbody.innerHTML = rows.map(function(row) {
        return '<tr><td class="time">' + row[0] + '</td><td>' + row[1] + '</td><td>' + row[2] + '</td><td class="time">' + row[3] + '</td><td class="count">' + row[4] + '</td><td class="count">' + row[5] + '</td><td class="count">' + row[6] + '</td><td class="count">' + row[7] + '</td><td class="count">' + row[8] + '</td></tr>';
      }).join('');
    }

    function connect() {
      connStatus.className = 'status-box disconnected';
      connStatus.textContent = 'Connecting to ' + wsUrl + '…';
      const ws = new WebSocket(wsUrl);
      ws.onopen = function() {
        connStatus.className = 'status-box connected';
        connStatus.innerHTML = 'Connected. Subscribed to BTCUSDT 1m. Waiting for live candle updates…';
        ws.send(JSON.stringify({ symbol: 'BTCUSDT', interval: '1m' }));
      };
      ws.onmessage = function(ev) {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'candle') addRow(msg);
        } catch (e) {}
      };
      ws.onclose = function() {
        connStatus.className = 'status-box disconnected';
        connStatus.textContent = 'Disconnected. Reconnecting in 3s…';
        setTimeout(connect, 3000);
      };
      ws.onerror = function() {
        connStatus.className = 'status-box disconnected';
        connStatus.textContent = 'WebSocket error. Is the backend running on port 8000?';
      };
    }
    connect();
  </script>
</body>
</html>
"""


@app.get("/inspect-ws", response_class=HTMLResponse)
async def inspect_ws():
    """Browser page: connect to WebSocket and show live candle updates (BTCUSDT 1m). Verifies Binance stream is pushing data."""
    return INSPECT_WS_HTML


VERIFY_LIVE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Verify: Live candle appends (Binance to backend store)</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e0e0e0; margin: 0; padding: 16px; }
    h1 { margin: 0 0 8px 0; font-size: 1.25rem; }
    .sub { color: #888; font-size: 0.875rem; margin-bottom: 12px; }
    .status-box { padding: 10px 14px; margin-bottom: 12px; border-radius: 8px; font-size: 0.9rem; }
    .status-box.connected { background: #1b2e1b; color: #4caf50; border: 1px solid #2e5c2e; }
    .status-box.disconnected { background: #2e1b1b; color: #f44336; border: 1px solid #5c2e2e; }
    .status-box span { font-variant-numeric: tabular-nums; }
    table { border-collapse: collapse; width: 100%; max-width: 900px; font-size: 0.85rem; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #333; }
    th { color: #26a69a; position: sticky; top: 0; background: #0f0f0f; }
    .count { font-variant-numeric: tabular-nums; }
    .time { font-variant-numeric: tabular-nums; color: #aaa; }
  </style>
</head>
<body>
  <h1>Verify: Live candle appends (Binance to backend store)</h1>
  <p class="sub">Subscribes to all symbols (1m). New rows appear as Binance sends kline updates and the backend appends to memory/Redis and broadcasts over WebSocket.</p>
  <div id="connStatus" class="status-box disconnected">Connecting…</div>
  <p class="sub">Received: <span id="count">0</span> messages</p>
  <div style="max-height: 70vh; overflow: auto;">
    <table>
      <thead>
        <tr><th>Time (received)</th><th>Symbol</th><th>Interval</th><th>Candle time</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Vol</th></tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
  <script>
    const tbody = document.getElementById('tbody');
    const connStatus = document.getElementById('connStatus');
    const countEl = document.getElementById('count');
    const SYMBOLS = __SYMBOLS_JSON__;
    const wsUrl = (document.location.port === '3000' || (document.location.pathname || '').indexOf('/api/backend') !== -1) ? 'ws://127.0.0.1:8000/ws/candles' : ((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws/candles');
    let total = 0;
    const maxRows = 80;
    const rows = [];

    function addRow(msg) {
      const c = msg.candle || {};
      const t = c.time != null ? new Date(c.time * 1000).toLocaleString() : '—';
      const now = new Date().toLocaleTimeString();
      const r = [now, msg.symbol || '—', msg.interval || '—', t, c.open, c.high, c.low, c.close, (c.volume != null ? Number(c.volume).toFixed(0) : '—')];
      rows.unshift(r);
      if (rows.length > maxRows) rows.pop();
      total++;
      countEl.textContent = total;
      tbody.innerHTML = rows.map(function(row) {
        return '<tr><td class="time">' + row[0] + '</td><td>' + row[1] + '</td><td>' + row[2] + '</td><td class="time">' + row[3] + '</td><td class="count">' + row[4] + '</td><td class="count">' + row[5] + '</td><td class="count">' + row[6] + '</td><td class="count">' + row[7] + '</td><td class="count">' + row[8] + '</td></tr>';
      }).join('');
    }

    function connect() {
      connStatus.className = 'status-box disconnected';
      connStatus.textContent = 'Connecting to ' + wsUrl + '…';
      const ws = new WebSocket(wsUrl);
      ws.onopen = function() {
        connStatus.className = 'status-box connected';
        connStatus.textContent = 'Connected. Subscribed to ' + SYMBOLS.length + ' symbols (1m). Waiting for live candle updates…';
        ws.send(JSON.stringify({ subscriptions: SYMBOLS.map(function(s) { return { symbol: s, interval: '1m' }; }) }));
      };
      ws.onmessage = function(ev) {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'candle') addRow(msg);
        } catch (e) {}
      };
      ws.onclose = function() {
        connStatus.className = 'status-box disconnected';
        connStatus.textContent = 'Disconnected. Reconnecting in 3s…';
        setTimeout(connect, 3000);
      };
      ws.onerror = function() {
        connStatus.className = 'status-box disconnected';
        connStatus.textContent = 'WebSocket error. Is the backend running on port 8000?';
      };
    }
    connect();
  </script>
</body>
</html>
"""


@app.get("/verify/live", response_class=HTMLResponse)
async def verify_live():
    """Browser page: live-updating table of candle appends from Binance via WebSocket. Subscribes to all symbols (1m) to verify backend is storing and broadcasting."""
    html = VERIFY_LIVE_HTML.replace("__SYMBOLS_JSON__", json.dumps(list(SYMBOLS)))
    return HTMLResponse(html)


class ConnectionManager:
    def __init__(self):
        # Track Next.js client connections
        # Format: {"BTCUSDT": [websocket1, websocket2], "ETHUSDT": [websocket3]}
        self.active_connections: Dict[str, List[WebSocket]] = {}

        # Track Binance WebSocket connections (tasks)
        # Format: {"BTCUSDT": task1, "ETHUSDT": task2}
        self.binance_connections: Dict[str, asyncio.Task] = {}

        # Store the latest candle for each symbol
        # Format: {"BTCUSDT": {candle_data}, "ETHUSDT": {candle_data}}
        self.latest_candles: Dict[str, dict] = {}

    async def connect_client(self, websocket: WebSocket, symbol: str):
        """Called when a Next.js client connects"""
        # Accept the WebSocket connection
        await websocket.accept()

        # Add this symbol to the dictionary if it doesn't exist
        if symbol not in self.active_connections:
            self.active_connections[symbol] = []

        # Add this client's WebSocket to the list for this symbol
        self.active_connections[symbol].append(websocket)

        # Print how many clients are watching this symbol
        client_count = len(self.active_connections[symbol])
        logger.info("✅ Client connected to %s. Total clients watching %s: %s", symbol, symbol, client_count)

        # If this is the first client for this symbol, start Binance connection
        if client_count == 1:
            await self.start_binance_stream(symbol)

        # Send the latest candle to this new client (if we have one cached)
        if symbol in self.latest_candles:
            await websocket.send_json(self.latest_candles[symbol])

    async def disconnect_client(self, websocket: WebSocket, symbol: str):
        """Called when a Next.js client disconnects"""
        # Remove this client from the list
        if symbol in self.active_connections:
            try:
                self.active_connections[symbol].remove(websocket)
            except ValueError:
                # Already removed / never added (race or double-cleanup)
                return

            # Print how many clients are still watching
            remaining = len(self.active_connections[symbol])
            logger.info("❌ Client disconnected from %s. Remaining clients: %s", symbol, remaining)

            # If no more clients are watching this symbol, stop Binance connection
            if remaining == 0:
                await self.stop_binance_stream(symbol)
                self.active_connections.pop(symbol, None)

    async def broadcast_to_clients(self, symbol: str, candle_data: dict):
        """Send candle data to all Next.js clients watching this symbol"""
        # Save the latest candle
        self.latest_candles[symbol] = candle_data

        # Get all clients watching this symbol
        if symbol in self.active_connections:
            clients = self.active_connections[symbol]
            logger.info("📢 Broadcasting to %s clients watching %s", len(clients), symbol)

            # Send to each client
            disconnected_clients = []
            for client_websocket in clients:
                try:
                    await client_websocket.send_json(candle_data)
                except Exception:
                    # If sending fails, mark this client for removal
                    disconnected_clients.append(client_websocket)

            # Remove any disconnected clients
            for client in disconnected_clients:
                await self.disconnect_client(client, symbol)

    async def start_binance_stream(self, symbol: str):
        """
        Start a WebSocket connection to Binance for this symbol.
        This is called when the FIRST client connects to a symbol.
        """
        logger.info("🚀 Starting Binance WebSocket for %s", symbol)

        # Create a background task that runs the Binance connection
        task = asyncio.create_task(self._binance_websocket_worker(symbol))

        # Store the task so we can cancel it later
        self.binance_connections[symbol] = task

    async def stop_binance_stream(self, symbol: str):
        """
        Stop the Binance WebSocket connection for this symbol.
        This is called when the LAST client disconnects from a symbol.
        """
        if symbol in self.binance_connections:
            logger.info("🛑 Stopping Binance WebSocket for %s", symbol)

            # Cancel the background task
            self.binance_connections[symbol].cancel()

            # Remove from dictionary
            del self.binance_connections[symbol]

    async def _binance_websocket_worker(self, symbol: str):
        """
        This runs in the background and maintains connection to Binance.
        It receives candle data and broadcasts to all Next.js clients.
        """
        # Binance WebSocket URL for this symbol
        # Example: wss://stream.binance.com:9443/ws/btcusdt@kline_1m
        url = f"wss://stream.binance.com:9443/ws/{symbol.lower()}@kline_1m"

        logger.info("📡 Connecting to Binance: %s", url)

        # Keep trying to connect (reconnect if connection drops)
        while True:
            try:
                # Connect to Binance
                async with websockets.connect(url) as binance_ws:
                    logger.info("✅ Connected to Binance for %s", symbol)

                    # Listen for messages from Binance
                    async for message in binance_ws:
                        # Parse the JSON message from Binance
                        data = json.loads(message)

                        # Extract candle information from Binance format
                        # Binance sends data in 'k' key
                        kline = data["k"]

                        # Format candle data for our clients
                        candle = {
                            "symbol": symbol,
                            "timestamp": kline["t"],  # Start time
                            "open": float(kline["o"]),
                            "high": float(kline["h"]),
                            "low": float(kline["l"]),
                            "close": float(kline["c"]),
                            "volume": float(kline["v"]),
                            "is_closed": kline["x"],  # Is this candle closed?
                        }

                        # Broadcast this candle to all Next.js clients watching this symbol
                        await self.broadcast_to_clients(symbol, candle)

            except asyncio.CancelledError:
                # This task was cancelled (we stopped it on purpose)
                logger.info("Binance stream cancelled for %s", symbol)
                break

            except Exception as e:
                # Connection error - wait and try again
                logger.warning("⚠️ Binance connection error for %s: %s", symbol, e)
                logger.info("Reconnecting in 5 seconds...")
                await asyncio.sleep(5)


# Create a single global instance of the manager
manager = ConnectionManager()


@app.websocket("/ws/candles/{symbol}")
async def websocket_endpoint(websocket: WebSocket, symbol: str):
    """
    This is where Next.js clients connect.
    Each client gets their own WebSocket connection to this endpoint.
    """
    # Convert symbol to uppercase for consistency
    symbol = symbol.upper()

    # Use the manager to handle this connection
    await manager.connect_client(websocket, symbol)

    try:
        while True:
            # Keep the connection alive by reading from the client.
            # Client may never send application messages; close frames still arrive here.
            await websocket.receive_text()
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        await manager.disconnect_client(websocket, symbol)


@app.websocket("/ws/candles")
async def websocket_candles(websocket: WebSocket):
    """Client sends { symbol, interval } to add one subscription, or { subscriptions: [ { symbol, interval }, ... ] } to set all. Receives { type: \"candle\", symbol, interval, candle: {...} } on updates."""
    await websocket.accept()
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
                if not isinstance(data, dict):
                    continue
                if "subscriptions" in data and isinstance(data["subscriptions"], list):
                    subs = []
                    for item in data["subscriptions"]:
                        if isinstance(item, dict) and item.get("symbol") and item.get("interval"):
                            subs.append((str(item["symbol"]).strip(), str(item["interval"]).strip()))
                    if subs:
                        await ws_broadcast.set_subscriptions(websocket, subs)
                elif data.get("symbol") and data.get("interval"):
                    symbol = str(data["symbol"]).upper()
                    interval = str(data["interval"])
                    if interval.upper() == "1D":
                        interval = "1d"
                    else:
                        interval = interval.lower()
                    await ws_broadcast.subscribe(websocket, symbol, interval)
            except (json.JSONDecodeError, TypeError):
                pass
    except Exception:
        pass
    finally:
        await ws_broadcast.unsubscribe_all(websocket)


@app.get("/candles/{symbol}/{interval}")
async def candles(symbol: str, interval: str, limit: int = 500):
    """Return last `limit` candles for symbol/interval from Redis. Single source of truth; Binance WS keeps this updated."""
    if limit < 1 or limit > 1000:
        limit = 500
    interval = interval.lower() if interval.upper() != "1D" else "1d"
    symbol = symbol.upper()
    data = await get_candles(symbol, interval, limit=limit)
    last_close = data[-1].get("close") if data else None
    logger.info("GET /candles symbol=%s interval=%s count=%d last_close=%s", symbol, interval, len(data), last_close)
    return {"symbol": symbol, "interval": interval, "candles": data if data else []}


@app.get("/signals/{symbol}/{interval}")
async def signals(symbol: str, interval: str):
    """Return computed indicators/signals for symbol/interval (from Redis cache or compute on-demand)."""
    interval = interval.lower() if interval.upper() != "1D" else "1d"
    symbol = symbol.upper()
    cached = await get_signals(symbol, interval)
    if cached:
        return cached
    candles_data = await get_candles(symbol, interval, limit=500)
    if not candles_data or len(candles_data) < 20:
        raise HTTPException(status_code=404, detail="Insufficient candles for signals.")
    result = compute_signals(candles_data)
    await set_signals(symbol, interval, result)
    return result


@app.get("/users/me/settings")
async def get_user_settings(user_id: Optional[str] = Header(default=None, alias="X-User-Id")):
    uid = user_id or "default"
    try:
        return await db.get_settings(uid)
    except Exception as e:
        logger.warning("get_settings error: %s", e)
        return {}


@app.patch("/users/me/settings")
async def patch_user_settings(body: dict, user_id: Optional[str] = Header(default=None, alias="X-User-Id")):
    uid = user_id or "default"
    try:
        for key, value in body.items():
            await db.set_setting(uid, key, str(value) if value is not None else "")
        return await db.get_settings(uid)
    except Exception as e:
        logger.warning("set_setting error: %s", e)
        return {}


@app.get("/trades")
async def list_trades(user_id: Optional[str] = Header(default=None, alias="X-User-Id"), limit: int = 100):
    uid = user_id or "default"
    try:
        return await db.get_trades(uid, limit=limit)
    except Exception as e:
        logger.warning("get_trades error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to load trades")


@app.post("/trades")
async def create_trade(body: dict, user_id: Optional[str] = Header(default=None, alias="X-User-Id")):
    uid = user_id or "default"
    try:
        symbol = body.get("symbol")
        side = body.get("side")
        amount = float(body.get("amount", 0))
        price = float(body.get("price", 0))
        time_iso = body.get("time")
        if not symbol or not side:
            raise HTTPException(status_code=400, detail="symbol and side required")
        return await db.add_trade(uid, symbol, side, amount, price, time_iso)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("add_trade error: %s", e)
        raise HTTPException(status_code=500, detail="Failed to save trade")
