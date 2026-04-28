import asyncio
import httpx
from datetime import datetime, timedelta

async def test():
    apiKey = "5twdPmXQm1VQhTIFnok2RCx4dZmS7c3u"
    url = f"https://api.polygon.io/v2/aggs/ticker/C:XAUUSD/range/15/minute/2026-04-20/2026-04-22"
    params = {"apiKey": apiKey, "limit": 1}
    async with httpx.AsyncClient() as client:
        # hammer the API
        for i in range(10):
            r = await client.get(url, params=params)
            print(f"Request {i}: Code={r.status_code}")
            data = r.json()
            if "error" in data:
                print("Error:", data["error"])

if __name__ == "__main__":
    asyncio.run(test())
