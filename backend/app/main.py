import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse

from app.binance_ws import bootstrap_all, get_stream_status, run_binance_ws
from app.config import INTERVALS, SYMBOLS
from app.redis_store import get_candles, get_signals, set_signals, close_redis, get_last_append_time, append_candle, get_store_keys_info
from app.utils import build_candle_key, normalize_interval, normalize_symbol
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


@app.get("/test/binance")
async def test_binance():
    """Test endpoint to verify Binance API connectivity from Render."""
    import httpx
    url = "https://api.binance.com/api/v3/klines"
    params = {"symbol": "BTCUSDT", "interval": "1m", "limit": 5}
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
            return {
                "status": "success",
                "binance_reachable": True,
                "candles_received": len(data),
                "sample_candle": {
                    "time": data[0][0] if data else None,
                    "open": data[0][1] if data else None,
                    "close": data[0][4] if data else None,
                } if data else None,
                "message": "✅ Binance API is accessible from Render"
            }
    except httpx.TimeoutException:
        return {
            "status": "error",
            "binance_reachable": False,
            "error": "Timeout - Binance API not responding within 10 seconds",
            "message": "❌ Binance API may be blocked or unreachable"
        }
    except httpx.HTTPStatusError as e:
        return {
            "status": "error",
            "binance_reachable": False,
            "error": f"HTTP {e.response.status_code}: {e.response.text[:200]}",
            "message": "❌ Binance API returned an error"
        }
    except Exception as e:
        return {
            "status": "error",
            "binance_reachable": False,
            "error": str(e),
            "message": "❌ Failed to connect to Binance API"
        }


@app.get("/debug/store-keys")
async def debug_store_keys():
    """Debug: list candle store keys with count, first_time, last_time. Verify 5 keys (one per symbol) with uppercase symbols."""
    return await get_store_keys_info()


@app.get("/debug/verify-unique-data")
async def debug_verify_unique_data():
    """Check if each symbol has unique data (bug = all same last_close)."""
    results = {}
    for symbol in SYMBOLS:
        candles = await get_candles(symbol, "1m", 5)
        results[symbol] = {
            "count": len(candles),
            "last_close": candles[-1].get("close") if candles else None,
            "last_time": candles[-1].get("time") if candles else None,
        }
    close_prices = [v["last_close"] for v in results.values() if v["last_close"] is not None]
    all_same = len(close_prices) > 1 and len(set(close_prices)) == 1
    return {
        "symbols": results,
        "bug_detected": all_same,
        "message": "BUG: All symbols have same close price!" if all_same else "OK: Symbols have different data",
    }


@app.get("/debug/candle-details/{symbol}/{interval}")
async def debug_candle_details(symbol: str, interval: str, limit: int = 5):
    """Show last N candles for a symbol to verify they're different per symbol."""
    symbol = normalize_symbol(symbol)
    interval = normalize_interval(interval)
    candles = await get_candles(symbol, interval, limit=limit)
    return {
        "symbol": symbol,
        "interval": interval,
        "key": build_candle_key(symbol, interval),
        "count": len(candles),
        "candles": candles,
        "close_prices": [c.get("close") for c in candles],
    }


@app.get("/debug/binance-pipeline")
async def debug_binance_pipeline():
    """Debug: store candles (REST bootstrap + stream appends) and Binance WebSocket stream status with recent candles. Use to verify backend/Binance pipeline before frontend."""
    keys_info = await get_store_keys_info()
    store_candles = []
    for symbol in SYMBOLS:
        for interval in INTERVALS:
            key = build_candle_key(symbol, interval)
            info = keys_info.get(key, {})
            count = info.get("count", 0)
            first_time = info.get("first_time")
            last_time = info.get("last_time")
            last_candle = None
            if count > 0:
                candles = await get_candles(symbol, interval, limit=1)
                if candles:
                    last_candle = candles[-1]
            store_candles.append({
                "symbol": symbol,
                "interval": interval,
                "count": count,
                "first_time": first_time,
                "last_time": last_time,
                "last_candle": last_candle,
            })
    stream = get_stream_status()
    return {
        "store_candles": store_candles,
        "stream": stream,
    }


@app.get("/debug/binance-pipeline/page", response_class=HTMLResponse)
async def debug_binance_pipeline_page():
    """Browser page: view store candles and Binance stream status with auto-refresh. Use to verify backend/Binance pipeline."""
    return BINANCE_PIPELINE_PAGE_HTML


@app.get("/symbols")
async def symbols():
    """Return list of symbols the backend streams (for frontend to show only these)."""
    return {"symbols": list(SYMBOLS)}


@app.get("/api/symbols")
async def api_symbols():
    """Proposal API: symbols list with count."""
    return {"symbols": list(SYMBOLS), "count": len(SYMBOLS)}


_CHART_DEMO_PATH = Path(__file__).resolve().parent.parent / "static" / "chart_demo.html"


@app.get("/chart_demo", response_class=HTMLResponse)
async def chart_demo():
    """Proposal API demo: TradingView Lightweight Charts with WS /ws/{symbol} (historical + live_candle)."""
    if _CHART_DEMO_PATH.is_file():
        return FileResponse(_CHART_DEMO_PATH, media_type="text/html")
    return HTMLResponse("<p>chart_demo.html not found</p>", status_code=404)


# --- Test page: history + live URLs (1m only) ---
TEST_CANDLES_HTML = """<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Test History + Live (1m)</title>
  <style>
    body { font-family: system-ui; background: #0f0f0f; color: #e0e0e0; padding: 20px; max-width: 900px; }
    h1 { font-size: 1.25rem; }
    section { margin: 1.5rem 0; padding: 1rem; background: #1a1a1a; border-radius: 8px; }
    code { background: #2a2a2a; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    .url { word-break: break-all; margin: 0.25rem 0; }
    button { padding: 8px 14px; margin: 4px 8px 4px 0; background: #26a69a; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    #log { font-family: monospace; font-size: 12px; max-height: 300px; overflow-y: auto; background: #111; padding: 10px; border-radius: 6px; white-space: pre-wrap; }
    .ok { color: #4ade80; }
    .err { color: #f87171; }
    select { padding: 6px 10px; margin-right: 8px; background: #2a2a2a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Test History + Live (1m) – URLs this app uses</h1>

  <section>
    <h2>Existing URLs (our app)</h2>
    <p><strong>History (REST, 1m, 12h = 720 candles):</strong></p>
    <p class="url"><code id="url-history">/api/historical/BTCUSDT?interval=1m&hours=12</code></p>
    <p><strong>Live (WebSocket, 1m):</strong></p>
    <p class="url"><code id="url-ws">/ws/BTCUSDT</code></p>
    <p><strong>Binance URL (backend subscribes to, BTC 1m only):</strong></p>
    <p class="url"><code>wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1m</code></p>
  </section>

  <section>
    <h2>Test in browser</h2>
    <p>
      Symbol: <select id="symbol"><option value="BTCUSDT">BTCUSDT (1m only)</option></select>
      <button id="btn-history">Test history (REST)</button>
      <button id="btn-live">Test live (WebSocket)</button>
      <button id="btn-stop">Stop WebSocket</button>
    </p>
    <p><strong>Log:</strong></p>
    <div id="log"></div>
  </section>

  <script>
    const base = window.location.origin;
    const logEl = document.getElementById('log');
    const symbolEl = document.getElementById('symbol');
    function log(msg, isErr) {
      const line = document.createElement('div');
      line.className = isErr ? 'err' : 'ok';
      line.textContent = new Date().toISOString().slice(11, 23) + ' ' + msg;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }
    function setUrlHistory() {
      const s = symbolEl.value;
      document.getElementById('url-history').textContent = base + '/api/historical/' + s + '?interval=1m&hours=12';
    }
    function setUrlWs() {
      document.getElementById('url-ws').textContent = (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host + '/ws/' + symbolEl.value;
    }
    symbolEl.addEventListener('change', function() { setUrlHistory(); setUrlWs(); });
    setUrlHistory();
    setUrlWs();

    document.getElementById('btn-history').onclick = async function() {
      const symbol = symbolEl.value;
      const url = base + '/api/historical/' + encodeURIComponent(symbol) + '?interval=1m&hours=12';
      log('Fetching: ' + url);
      try {
        const r = await fetch(url);
        const data = await r.json();
        log('History OK: ' + (data.count || 0) + ' candles, last close=' + (data.data && data.data.length ? data.data[data.data.length - 1].close : 'n/a'));
      } catch (e) {
        log('History FAIL: ' + e.message, true);
      }
    };

    let ws = null;
    document.getElementById('btn-live').onclick = function() {
      if (ws && ws.readyState === WebSocket.OPEN) { log('WebSocket already open'); return; }
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = proto + '//' + window.location.host + '/ws/' + symbolEl.value;
      log('Connecting: ' + url);
      ws = new WebSocket(url);
      ws.onopen = () => log('WebSocket connected');
      ws.onmessage = function(e) {
        const d = JSON.parse(e.data);
        if (d.type === 'historical') log('Live: historical ' + (d.data ? d.data.length : 0) + ' candles');
        else if (d.type === 'live_candle') log('Live: candle t=' + d.time + ' c=' + d.close);
        else log('Live: ' + (d.type || 'message'));
      };
      ws.onerror = () => log('WebSocket error', true);
      ws.onclose = (e) => { log('WebSocket closed ' + e.code); ws = null; }
    };
    document.getElementById('btn-stop').onclick = function() {
      if (ws) { ws.close(); ws = null; log('WebSocket closed by user'); }
    };
  </script>
</body>
</html>
"""


@app.get("/test/candles/urls")
async def test_candles_urls(request: Request):
    """Return JSON of the history and live URLs the app uses (1m). For scripts or browser."""
    base = str(request.base_url).rstrip("/")
    base_ws = base.replace("http://", "ws://").replace("https://", "wss://")
    return {
        "history_rest": {
            "description": "History (1m, 12h = 720 candles) – same as app",
            "url_template": base + "/api/historical/{symbol}?interval=1m&hours=12",
            "example": base + "/api/historical/BTCUSDT?interval=1m&hours=12",
        },
        "live_websocket": {
            "description": "Live (1m) – same as app",
            "url_template": base_ws + "/ws/{symbol}",
            "example": base_ws + "/ws/BTCUSDT",
        },
        "binance_ws_backend_subscribes": {
            "description": "Binance URL backend uses (BTC 1m only)",
            "url": "wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1m",
        },
        "symbols": list(SYMBOLS),
    }


@app.get("/test/candles", response_class=HTMLResponse)
async def test_candles_page():
    """Single endpoint to test history + live in browser. Uses same URLs as the app (1m)."""
    return TEST_CANDLES_HTML


# Interval to seconds for historical limit calculation
_HISTORICAL_INTERVAL_SECONDS = {"1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "2h": 7200, "4h": 14400, "6h": 21600, "8h": 28800, "12h": 43200, "1d": 86400, "3d": 259200, "1w": 604800}


@app.get("/api/historical/{symbol}")
async def api_historical(symbol: str, interval: str = "1m", hours: int = 12):
    """Proposal API: historical candles (time in ms, is_closed true). BTC 1m only."""
    symbol = normalize_symbol(symbol)
    interval = normalize_interval(interval)
    
    # VALIDATION: Only BTCUSDT 1m supported
    if symbol != "BTCUSDT":
        raise HTTPException(status_code=400, detail=f"Only BTCUSDT is supported. Requested: {symbol}")
    if interval != "1m":
        raise HTTPException(status_code=400, detail=f"Only 1m interval is supported. Requested: {interval}")
    
    interval_sec = _HISTORICAL_INTERVAL_SECONDS.get(interval, 60)
    limit = min(1000, max(1, int(hours * 3600 / interval_sec)))
    candles = await get_candles(symbol, interval, limit=limit)
    data = [
        {
            "time": c["time"] * 1000,
            "open": c["open"],
            "high": c["high"],
            "low": c["low"],
            "close": c["close"],
            "volume": c.get("volume", 0),
            "is_closed": True,
        }
        for c in candles
    ]
    return {"symbol": symbol, "interval": interval, "hours": hours, "count": len(data), "data": data}


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


BINANCE_PIPELINE_PAGE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Debug: Binance pipeline (REST + stream)</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e0e0e0; margin: 0; padding: 16px; }
    h1 { margin: 0 0 8px 0; font-size: 1.25rem; }
    h2 { font-size: 1rem; color: #26a69a; margin: 20px 0 8px 0; }
    .sub { color: #888; font-size: 0.875rem; margin-bottom: 12px; }
    .status-box { padding: 10px 14px; margin-bottom: 12px; border-radius: 8px; font-size: 0.9rem; }
    .status-box.ok { background: #1b2e1b; color: #4caf50; border: 1px solid #2e5c2e; }
    .status-box.err { background: #2e1b1b; color: #f44336; border: 1px solid #5c2e2e; }
    table { border-collapse: collapse; width: 100%; max-width: 960px; font-size: 0.85rem; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #333; }
    th { color: #26a69a; position: sticky; top: 0; background: #0f0f0f; }
    .count { font-variant-numeric: tabular-nums; }
    .time { font-variant-numeric: tabular-nums; color: #aaa; }
    #storeTable tbody tr:hover { background: #1a1a1a; }
    #streamTable tbody tr:hover { background: #1a1a1a; }
  </style>
</head>
<body>
  <h1>Debug: Binance pipeline</h1>
  <p class="sub">Store candles (REST bootstrap + stream appends) and Binance WebSocket stream status. Auto-refreshes every 3s. Use to verify backend/Binance before frontend.</p>
  <p class="sub">Last fetch: <span id="lastFetch">—</span></p>
  <div id="statusBox" class="status-box err">Loading…</div>
  <h2>Store candles (source of GET /candles)</h2>
  <table id="storeTable">
    <thead>
      <tr><th>Symbol</th><th>Interval</th><th>Count</th><th>First time</th><th>Last time</th><th>Last open</th><th>Last high</th><th>Last low</th><th>Last close</th><th>Last vol</th></tr>
    </thead>
    <tbody id="storeBody"></tbody>
  </table>
  <h2>Binance stream</h2>
  <p class="sub">Connected: <span id="streamConnected">—</span> · Last received at: <span id="lastReceived">—</span></p>
  <table id="streamTable">
    <thead>
      <tr><th>Received at</th><th>Symbol</th><th>Interval</th><th>Time</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Vol</th></tr>
    </thead>
    <tbody id="streamBody"></tbody>
  </table>
  <script>
    const apiBase = (document.location.pathname || '').indexOf('/api/backend') !== -1 ? '/api/backend' : '';
    const pipelineUrl = apiBase + '/debug/binance-pipeline';
    function formatTime(ts) {
      if (ts == null) return '—';
      if (ts < 1e10) ts *= 1000;
      return new Date(ts).toLocaleString();
    }
    async function refresh() {
      try {
        const r = await fetch(pipelineUrl);
        const data = await r.json();
        document.getElementById('lastFetch').textContent = new Date().toLocaleTimeString();
        if (!r.ok) {
          document.getElementById('statusBox').className = 'status-box err';
          document.getElementById('statusBox').textContent = 'HTTP ' + r.status + (data.detail ? ': ' + JSON.stringify(data.detail) : '');
          return;
        }
        document.getElementById('statusBox').className = 'status-box ok';
        document.getElementById('statusBox').textContent = 'Pipeline data loaded.';
        const store = data.store_candles || [];
        const storeRows = store.map(function(row) {
          const c = row.last_candle || {};
          return '<tr><td>' + row.symbol + '</td><td>' + row.interval + '</td><td class="count">' + row.count + '</td><td class="time">' + formatTime(row.first_time) + '</td><td class="time">' + formatTime(row.last_time) + '</td><td class="count">' + (c.open != null ? c.open : '—') + '</td><td class="count">' + (c.high != null ? c.high : '—') + '</td><td class="count">' + (c.low != null ? c.low : '—') + '</td><td class="count">' + (c.close != null ? c.close : '—') + '</td><td class="count">' + (c.volume != null ? Number(c.volume).toFixed(0) : '—') + '</td></tr>';
        });
        document.getElementById('storeBody').innerHTML = storeRows.length ? storeRows.join('') : '<tr><td colspan="10">No store data</td></tr>';
        const stream = data.stream || {};
        document.getElementById('streamConnected').textContent = stream.connected ? 'Yes' : 'No';
        document.getElementById('streamConnected').style.color = stream.connected ? '#4caf50' : '#f44336';
        document.getElementById('lastReceived').textContent = stream.last_received_at ? formatTime(stream.last_received_at) : '—';
        const recent = stream.recent_candles || [];
        const streamRows = recent.map(function(entry) {
          const c = entry.candle || {};
          return '<tr><td class="time">' + formatTime(entry.received_at) + '</td><td>' + (entry.symbol || '—') + '</td><td>' + (entry.interval || '—') + '</td><td class="time">' + formatTime(entry.time) + '</td><td class="count">' + (c.open != null ? c.open : '—') + '</td><td class="count">' + (c.high != null ? c.high : '—') + '</td><td class="count">' + (c.low != null ? c.low : '—') + '</td><td class="count">' + (c.close != null ? c.close : '—') + '</td><td class="count">' + (c.volume != null ? Number(c.volume).toFixed(0) : '—') + '</td></tr>';
        });
        document.getElementById('streamBody').innerHTML = streamRows.length ? streamRows.join('') : '<tr><td colspan="9">No recent stream candles yet (wait for Binance to send)</td></tr>';
      } catch (e) {
        document.getElementById('statusBox').className = 'status-box err';
        document.getElementById('statusBox').textContent = 'Failed: ' + (e.message || String(e));
      }
    }
    refresh();
    setInterval(refresh, 3000);
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


@app.websocket("/ws/{symbol}")
async def websocket_proposal(websocket: WebSocket, symbol: str):
    """
    Proposal API: on connect send historical (type 'historical') then stream live_candle.
    BTC 1m only.
    """
    symbol = normalize_symbol(symbol)
    await websocket.accept()
    
    # VALIDATION: Only BTCUSDT supported
    if symbol != "BTCUSDT":
        await websocket.send_json({"type": "error", "message": f"Only BTCUSDT is supported. Requested: {symbol}"})
        await websocket.close(code=4000)
        return
    
    try:
        candles = await get_candles(symbol, "1m", limit=720)
        data = [
            {
                "time": c["time"] * 1000,
                "open": c["open"],
                "high": c["high"],
                "low": c["low"],
                "close": c["close"],
                "volume": c.get("volume", 0),
                "is_closed": True,
            }
            for c in candles
        ]
        await websocket.send_json({"type": "historical", "symbol": symbol, "data": data})
        await ws_broadcast.subscribe_proposal(websocket, symbol, "1m")
        logger.info("Proposal WS client connected to /ws/%s, sent %d historical candles", symbol, len(data))
        while True:
            await websocket.receive_text()
    except Exception:
        pass
    finally:
        await ws_broadcast.unsubscribe_proposal_all(websocket)
        logger.info("Proposal WS client disconnected from /ws/%s", symbol)


@app.websocket("/ws/candles/{symbol}")
async def websocket_endpoint(websocket: WebSocket, symbol: str):
    """
    Single feed: subscribe this client to (symbol, 1m) via ws_broadcast. No per-symbol Binance connection.
    Live data comes from run_binance_ws and is broadcast to all subscribers. Kept for backward compatibility.
    Prefer /ws/candles with subscription payload for new clients.
    """
    symbol = normalize_symbol(symbol)
    await websocket.accept()
    await ws_broadcast.subscribe(websocket, symbol, "1m")
    logger.info("Client connected to /ws/candles/%s (shared feed)", symbol)
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        pass
    finally:
        await ws_broadcast.unsubscribe_all(websocket)
        logger.info("Client disconnected from /ws/candles/%s", symbol)


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
    import sys
    print(f"\n{'='*80}", file=sys.stderr)
    print(f"[FRONTEND_REQUEST] Raw symbol from URL path: '{symbol}'", file=sys.stderr)
    print(f"[FRONTEND_REQUEST] Raw interval from URL path: '{interval}'", file=sys.stderr)
    print(f"[FRONTEND_REQUEST] Limit: {limit}", file=sys.stderr)
    
    # VALIDATION: Only BTCUSDT 1m supported
    if limit < 1 or limit > 1000:
        limit = 500
    symbol_normalized = normalize_symbol(symbol)
    interval_normalized = normalize_interval(interval)
    
    # Enforce BTC 1m only
    if symbol_normalized != "BTCUSDT":
        print(f"[REJECTED] Symbol '{symbol_normalized}' not supported. Only BTCUSDT allowed.", file=sys.stderr)
        raise HTTPException(status_code=400, detail=f"Only BTCUSDT is supported. Requested: {symbol_normalized}")
    
    if interval_normalized != "1m":
        print(f"[REJECTED] Interval '{interval_normalized}' not supported. Only 1m allowed.", file=sys.stderr)
        raise HTTPException(status_code=400, detail=f"Only 1m interval is supported. Requested: {interval_normalized}")
    
    print(f"[NORMALIZED] Symbol: '{symbol_normalized}' | Interval: '{interval_normalized}'", file=sys.stderr)
    key = build_candle_key(symbol_normalized, interval_normalized)
    print(f"[KEY] Store key: '{key}'", file=sys.stderr)
    data = await get_candles(symbol_normalized, interval_normalized, limit=limit)
    print(f"[RESULT] Retrieved {len(data)} candles", file=sys.stderr)
    if data:
        print(f"[RESULT] Last 3 closes: {[c.get('close') for c in data[-3:]]}", file=sys.stderr)
    else:
        print(f"[RESULT] No candles", file=sys.stderr)
    print(f"{'='*80}\n", file=sys.stderr)
    return {"symbol": symbol_normalized, "interval": interval_normalized, "candles": data if data else []}


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
