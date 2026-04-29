import os

from dotenv import load_dotenv

# Load .env from backend directory so DATABASE_URL etc. can override defaults
load_dotenv()

# Unified symbols (Crypto + Forex)
SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "C:XAUUSD",
]

# Separate Forex symbols for provider routing
FOREX_SYMBOLS = ["C:XAUUSD"]
CRYPTO_SYMBOLS = ["BTCUSDT", "ETHUSDT"]

# Support 1m and 5m intervals. 1m is base for live streaming, 5m for analysis.
INTERVALS = ["1m", "5m"]

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
# Set to "1" or "true" to use in-memory store instead of Redis (no Redis needed for local testing)
USE_MEMORY_STORE = os.getenv("USE_MEMORY_STORE", "true").lower() in ("1", "true", "yes")
BUFFER_SIZE = 1000  # Max candles per symbol/interval in Redis (as per user request)

# Binance WebSocket base URL
BINANCE_WS_BASE = "wss://stream.binance.com:9443"
# Binance REST for bootstrap
BINANCE_REST_BASE = "https://api.binance.com/api/v3"

# Massive (Polygon-style) for Forex/Gold
MASSIVE_API_KEY = os.getenv("MASSIVE_API_KEY", "5twdPmXQm1VQhTIFnok2RCx4dZmS7c3u")
MASSIVE_WS_BASE = "wss://socket.massive.com/forex" # User's clusters for Forex/Currencies
MASSIVE_REST_BASE = "https://api.massive.com"

# Twelve Data for Forex/Gold replacement
TWELVEDATA_API_KEY = os.getenv("TWELVEDATA_API_KEY", "")
TWELVEDATA_REST_BASE = "https://api.twelvedata.com"

# Proxy configuration (optional - set HTTP_PROXY env var if Binance is blocked)
# Example: HTTP_PROXY=http://proxy.example.com:8080
HTTP_PROXY = os.getenv("HTTP_PROXY", None)
HTTPS_PROXY = os.getenv("HTTPS_PROXY", None)
WS_PROXY = os.getenv("WS_PROXY", None)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://neondb_owner:npg_UP2wNXdc0eVa@ep-icy-lab-a1lqbhz7-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
)

AI_ENGINE_URL = os.getenv("AI_ENGINE_URL", "")
AI_ENGINE_TIMEOUT_SECONDS = float(os.getenv("AI_ENGINE_TIMEOUT_SECONDS", "60"))
CORE_ENGINE_USE_AI = os.getenv("CORE_ENGINE_USE_AI", "true").lower() in ("1", "true", "yes")
