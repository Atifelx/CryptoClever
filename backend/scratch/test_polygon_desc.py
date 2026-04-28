import asyncio
import httpx
import json
from app.config import MASSIVE_REST_BASE, MASSIVE_API_KEY
from datetime import datetime, timedelta

async def test_rest(symbol="C:XAUUSD"):
    end_date = datetime.now()
    start_date = end_date - timedelta(days=20)
    
    from_str = start_date.strftime("%Y-%m-%d")
    to_str = end_date.strftime("%Y-%m-%d")
    
    url = f"{MASSIVE_REST_BASE}/v2/aggs/ticker/{symbol}/range/15/minute/{from_str}/{to_str}"
    params = {"apiKey": MASSIVE_API_KEY, "limit": 1000, "adjusted": "true", "sort": "desc"}
    print(f"Testing REST: {url} with params: {params}")
    
    async with httpx.AsyncClient() as client:
        try:
            r = await client.get(url, params=params)
            print(f"REST Status: {r.status_code}")
            if r.status_code == 200:
                data = r.json()
                res = data.get("results", [])
                print(f"REST Got {len(res)} candles. First: {res[0] if res else None}")
                if res:
                    print(f"REST Last: {res[-1]}")
            else:
                print(f"REST Error: {r.text}")
        except Exception as e:
            print(f"REST Exception: {e}")

if __name__ == "__main__":
    asyncio.run(test_rest())
