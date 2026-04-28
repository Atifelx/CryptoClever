import asyncio
import httpx
from datetime import datetime, timedelta

MASSIVE_API_KEY = "5twdPmXQm1VQhTIFnok2RCx4dZmS7c3u"
# Using a 2nd API key if possible to bypass the overloaded live key? I don't have one.
# So I'll pause 12 seconds to try to squeak a request through.
async def mock_bootstrap():
    await asyncio.sleep(15) 
    symbol = "C:XAUUSD"
    end_date = datetime.now()
    start_date = end_date - timedelta(days=30)
    
    from_str = start_date.strftime("%Y-%m-%d")
    to_str = end_date.strftime("%Y-%m-%d")
    
    url = f"https://api.polygon.io/v2/aggs/ticker/{symbol}/range/15/minute/{from_str}/{to_str}"
    params = {"apiKey": MASSIVE_API_KEY, "limit": 50000, "adjusted": "true", "sort": "desc"}
    
    print(f"Fetching from: {url} with limit=50000")
    
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, params=params, timeout=20.0)
            print(f"Status Code: {r.status_code}")
            if r.status_code != 200:
                print(r.text)
                return
            data = r.json()
            results = data.get("results", [])
            print(f"Fetched {len(results)} candles in single request!")
            print("Next URL:", data.get("next_url"))
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    asyncio.run(mock_bootstrap())
