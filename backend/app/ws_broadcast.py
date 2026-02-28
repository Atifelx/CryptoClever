"""
WebSocket connection manager for live candle updates.
Clients can subscribe to multiple (symbol, interval) per connection:
  - Send { "symbol": "X", "interval": "Y" } to add one subscription.
  - Send { "subscriptions": [ { "symbol": "BTCUSDT", "interval": "1m" }, ... ] } to replace with a list.
When a new candle is written (from Binance stream), we push to all clients subscribed to that symbol/interval.
"""
import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

from app.utils import normalize_interval, normalize_symbol

logger = logging.getLogger(__name__)

# (symbol, interval) -> set of WebSocket
_subscribers: dict[tuple[str, str], set[WebSocket]] = {}
# WebSocket -> set of (symbol, interval) for unsubscribe_all
_connection_subs: dict[WebSocket, set[tuple[str, str]]] = {}
_lock = asyncio.Lock()

# Proposal API: clients that receive type "live_candle" with time in ms and is_closed
_proposal_subscribers: dict[tuple[str, str], set[WebSocket]] = {}
_proposal_connection_subs: dict[WebSocket, set[tuple[str, str]]] = {}


def _norm_key(symbol: str, interval: str) -> tuple[str, str]:
    return (normalize_symbol(symbol), normalize_interval(interval))


async def subscribe(websocket: WebSocket, symbol: str, interval: str) -> None:
    """Add one (symbol, interval) to this connection's subscriptions."""
    key = _norm_key(symbol, interval)
    async with _lock:
        _subscribers.setdefault(key, set()).add(websocket)
        _connection_subs.setdefault(websocket, set()).add(key)
    logger.debug("Client subscribed to %s %s", key[0], key[1])


async def unsubscribe(websocket: WebSocket, symbol: str, interval: str) -> None:
    """Remove one (symbol, interval) from this connection's subscriptions."""
    key = _norm_key(symbol, interval)
    async with _lock:
        s = _subscribers.get(key)
        if s:
            s.discard(websocket)
            if not s:
                del _subscribers[key]
        conn_subs = _connection_subs.get(websocket)
        if conn_subs:
            conn_subs.discard(key)
            if not conn_subs:
                del _connection_subs[websocket]


async def set_subscriptions(websocket: WebSocket, subscriptions: list[tuple[str, str]]) -> None:
    """Replace this connection's subscriptions with the given list (e.g. all 10 symbols x 1 interval)."""
    async with _lock:
        old = _connection_subs.get(websocket)
        if old:
            for key in old:
                s = _subscribers.get(key)
                if s:
                    s.discard(websocket)
                    if not s:
                        del _subscribers[key]
            del _connection_subs[websocket]
        keys = [_norm_key(sym, iv) for sym, iv in subscriptions]
        _connection_subs[websocket] = set(keys)
        for key in keys:
            _subscribers.setdefault(key, set()).add(websocket)
    logger.debug("Client set %d subscriptions", len(keys))


async def unsubscribe_all(websocket: WebSocket) -> None:
    """Remove this client from all subscriptions."""
    async with _lock:
        keys = list(_connection_subs.pop(websocket, set()))
        for key in keys:
            s = _subscribers.get(key)
            if s:
                s.discard(websocket)
                if not s:
                    del _subscribers[key]


async def subscribe_proposal(websocket: WebSocket, symbol: str, interval: str) -> None:
    """Add this connection to proposal feed (receives type 'live_candle' with time in ms, is_closed)."""
    key = _norm_key(symbol, interval)
    async with _lock:
        _proposal_subscribers.setdefault(key, set()).add(websocket)
        _proposal_connection_subs.setdefault(websocket, set()).add(key)
    logger.debug("Proposal client subscribed to %s %s", key[0], key[1])


async def unsubscribe_proposal_all(websocket: WebSocket) -> None:
    """Remove this client from all proposal subscriptions."""
    async with _lock:
        keys = list(_proposal_connection_subs.pop(websocket, set()))
        for key in keys:
            s = _proposal_subscribers.get(key)
            if s:
                s.discard(websocket)
                if not s:
                    del _proposal_subscribers[key]


async def broadcast_candle_proposal(symbol: str, interval: str, candle: dict[str, Any]) -> None:
    """Push a live_candle message (time in ms, is_closed) to all proposal subscribers for this symbol/interval."""
    key = _norm_key(symbol, interval)
    async with _lock:
        sockets = set(_proposal_subscribers.get(key, ()))
    if not sockets:
        return
    t = candle.get("time")
    time_ms = int(t) * 1000 if t is not None else 0
    payload = json.dumps({
        "type": "live_candle",
        "symbol": key[0],
        "time": time_ms,
        "open": candle.get("open"),
        "high": candle.get("high"),
        "low": candle.get("low"),
        "close": candle.get("close"),
        "volume": candle.get("volume"),
        "is_closed": candle.get("is_closed", True),
    })
    dead = set()
    for ws in sockets:
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    if dead:
        async with _lock:
            s = _proposal_subscribers.get(key)
            if s:
                for w in dead:
                    s.discard(w)
                if not s:
                    del _proposal_subscribers[key]


async def broadcast_candle(symbol: str, interval: str, candle: dict[str, Any]) -> None:
    """Push a candle to all clients subscribed to this symbol/interval."""
    key = _norm_key(symbol, interval)
    async with _lock:
        sockets = set(_subscribers.get(key, ()))
    logger.info("[BROADCAST] Key=%s | Subscribers=%d | Close=%s", key, len(sockets), candle.get("close"))
    if not sockets:
        return
    payload = json.dumps({"type": "candle", "symbol": key[0], "interval": key[1], "candle": candle})
    dead = set()
    for ws in sockets:
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    if dead:
        async with _lock:
            s = _subscribers.get(key)
            if s:
                for w in dead:
                    s.discard(w)
                if not s:
                    del _subscribers[key]
