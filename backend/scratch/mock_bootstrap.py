import asyncio
import httpx
from datetime import datetime, timedelta

MASSIVE_API_KEY = "5twdPmXQm1VQhTIFnok2RCx4dZmS7c3u"
MASSIVE_REST_BASE = "https://api.polygon.io"

async def mock_bootstrap():
    symbol = "C:XAUUSD"
    end_date = datetime.now()
    start_date = end_date - timedelta(days=30)
    
    from_str = start_date.strftime("%Y-%m-%d")
    to_str = end_date.strftime("%Y-%m-%d")
    
    url = f"{MASSIVE_REST_BASE}/v2/aggs/ticker/{symbol}/range/15/minute/{from_str}/{to_str}"
    params = {"apiKey": MASSIVE_API_KEY, "limit": 1000, "adjusted": "true", "sort": "asc"}
    
    print(f"Fetching from: {url}")
    all_results = []
    
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, params=params, timeout=20.0)
            print(f"Status Code: {r.status_code}")
            if r.status_code != 200:
                print(r.text)
                return
            data = r.json()
            results = data.get("results", [])
            print(f"Page 1 fetched {len(results)} candles")
            all_results.extend(results)
            print("Next URL:", data.get("next_url"))
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    asyncio.run(mock_bootstrap())
