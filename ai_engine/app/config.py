import os

from dotenv import load_dotenv

load_dotenv()

BACKEND_MARKET_DATA_URL = os.getenv("BACKEND_MARKET_DATA_URL", "http://backend:8000").rstrip("/")

AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT", "").rstrip("/")
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY", "")
AZURE_OPENAI_MODEL = os.getenv("AZURE_OPENAI_MODEL", "gpt-5.3-codex")
AZURE_OPENAI_API_VERSION = os.getenv("AZURE_OPENAI_API_VERSION", "2025-04-01-preview")

AI_ENGINE_REQUEST_TIMEOUT_SECONDS = float(os.getenv("AI_ENGINE_REQUEST_TIMEOUT_SECONDS", "20"))
AI_ENGINE_CANDLE_LIMIT = max(120, int(os.getenv("AI_ENGINE_CANDLE_LIMIT", "300")))
AI_ENGINE_NEWS_RESULTS_LIMIT = max(2, int(os.getenv("AI_ENGINE_NEWS_RESULTS_LIMIT", "5")))
AI_ENGINE_SEARCH_RESULTS_LIMIT = max(2, int(os.getenv("AI_ENGINE_SEARCH_RESULTS_LIMIT", "4")))
AI_ENGINE_NEWS_LOOKBACK_DAYS = max(1, int(os.getenv("AI_ENGINE_NEWS_LOOKBACK_DAYS", "2")))

NEWSAPI_KEY = os.getenv("NEWSAPI_KEY", "")


def azure_openai_configured() -> bool:
    return bool(AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY)
