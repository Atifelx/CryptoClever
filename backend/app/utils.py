"""
Shared normalization for symbol and interval so store keys are consistent.
Binance WebSocket streams use lowercase (btcusdt@kline_1m) but we store with uppercase symbol (candles:BTCUSDT:1m).
"""


def normalize_symbol(symbol: str) -> str:
    """
    Normalize symbol to uppercase for consistent store keys.
    Binance streams use lowercase, but we store in uppercase.
    """
    return (symbol or "").strip().upper()


def normalize_interval(interval: str) -> str:
    """
    Normalize interval to lowercase (1m, 5m, 1h, 1d).
    """
    if not interval:
        return "1m"
    iv = (interval or "").strip()
    return "1d" if iv.upper() == "1D" else iv.lower()


def build_candle_key(symbol: str, interval: str) -> str:
    """
    Build consistent store key: candles:BTCUSDT:1m
    """
    return f"candles:{normalize_symbol(symbol)}:{normalize_interval(interval)}"
