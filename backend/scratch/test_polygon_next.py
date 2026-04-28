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
    params = {"apiKey": MASSIVE_API_KEY, "limit": 1000, "adjusted": "true"}
    
    async with httpx.AsyncClient() as client:
        r = await client.get(url, params=params)
        data = r.json()
        print("Keys in response:", data.keys())
        if "next_url" in data:
            print("Has next_url:", data["next_url"])

if __name__ == "__main__":
    asyncio.run(test_rest())
