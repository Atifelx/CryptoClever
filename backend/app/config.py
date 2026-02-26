import os

from dotenv import load_dotenv

# Load .env from backend directory so DATABASE_URL etc. can override defaults
load_dotenv()

# Curated symbols (Segment 1 + 2; Binance format)
SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
    "LTCUSDT", "ADAUSDT", "ALGOUSDT", "ATOMUSDT", "MATICUSDT",
]

# Intervals (Binance format; frontend uses 1D -> backend uses 1d)
INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"]

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
# Set to "1" or "true" to use in-memory store instead of Redis (no Redis needed for local testing)
USE_MEMORY_STORE = os.getenv("USE_MEMORY_STORE", "").lower() in ("1", "true", "yes")
BUFFER_SIZE = 1000  # Max candles per symbol/interval in Redis

# Binance WebSocket base URL
BINANCE_WS_BASE = "wss://stream.binance.com:9443"
# Binance REST for bootstrap
BINANCE_REST_BASE = "https://api.binance.com/api/v3"

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://neondb_owner:npg_UP2wNXdc0eVa@ep-icy-lab-a1lqbhz7-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
)
