"""Tests for backend: 10 symbols config and /streaming/status verification."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

# Expected exactly 10 symbols (Segment 1 + 2) in Binance format
EXPECTED_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
    "LTCUSDT", "ADAUSDT", "ALGOUSDT", "ATOMUSDT", "MATICUSDT",
]

EXPECTED_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"]


class TestConfig(unittest.TestCase):
    """Verify config has exactly 10 symbols and expected intervals."""

    def test_symbols_count(self):
        from app.config import SYMBOLS
        self.assertEqual(len(SYMBOLS), 10, "SYMBOLS must have exactly 10 symbols")

    def test_symbols_match_expected(self):
        from app.config import SYMBOLS
        self.assertEqual(list(SYMBOLS), EXPECTED_SYMBOLS, "SYMBOLS must match expected list")

    def test_intervals_unchanged(self):
        from app.config import INTERVALS
        self.assertEqual(INTERVALS, EXPECTED_INTERVALS)

    def test_buffer_size(self):
        from app.config import BUFFER_SIZE
        self.assertEqual(BUFFER_SIZE, 1000)


class TestStreamingStatus(unittest.TestCase):
    """Verify GET /streaming/status returns correct structure and uses all 10 symbols."""

    def test_streaming_status_structure(self):
        # Patch so we don't need Redis or Binance
        async def fake_get_candles(*args, **kwargs):
            return [{"time": 1700000000, "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 100}]

        with patch("app.main.bootstrap_all", new_callable=AsyncMock, return_value=None), \
             patch("app.main.run_binance_ws", lambda: asyncio.sleep(999)), \
             patch("app.main.close_redis", new_callable=AsyncMock, return_value=None), \
             patch("app.main.get_candles", side_effect=fake_get_candles):
            from app.main import app
            client = TestClient(app)
            resp = client.get("/streaming/status")
        self.assertEqual(resp.status_code, 200, resp.text)
        data = resp.json()
        self.assertIn("symbols", data)
        self.assertIn("per_symbol", data)
        self.assertEqual(data["symbols"], EXPECTED_SYMBOLS)
        self.assertEqual(len(data["per_symbol"]), 10 * len(EXPECTED_INTERVALS),
                         "per_symbol must have 10 symbols x 6 intervals = 60 entries")
        for entry in data["per_symbol"]:
            self.assertIn(entry["symbol"], EXPECTED_SYMBOLS)
            self.assertIn(entry["interval"], EXPECTED_INTERVALS)
            self.assertIsInstance(entry["count"], int)
            self.assertLessEqual(entry["count"], 1000)
            if entry["count"] > 0:
                self.assertIsNotNone(entry["last_candle_time"])

    def test_health(self):
        with patch("app.main.bootstrap_all", new_callable=AsyncMock, return_value=None), \
             patch("app.main.run_binance_ws", lambda: asyncio.sleep(999)), \
             patch("app.main.close_redis", new_callable=AsyncMock, return_value=None):
            from app.main import app
            client = TestClient(app)
            resp = client.get("/health")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"status": "ok"})


if __name__ == "__main__":
    unittest.main()
