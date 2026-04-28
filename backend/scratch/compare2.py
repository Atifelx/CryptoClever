import asyncio
import httpx
from datetime import datetime, timedelta

async def fetch_massive():
    apiKey = "5twdPmXQm1VQhTIFnok2RCx4dZmS7c3u"
    end_date = datetime.now()
    start_date = end_date - timedelta(days=2)
    from_str = start_date.strftime("%Y-%m-%d")
    to_str = end_date.strftime("%Y-%m-%d")
    url = f"https://api.polygon.io/v2/aggs/ticker/C:XAUUSD/range/15/minute/{from_str}/{to_str}"
    params = {"apiKey": apiKey, "limit": 1, "sort": "desc"}
    async with httpx.AsyncClient() as client:
        r = await client.get(url, params=params)
        data = r.json()
        print("Massive Response:", data)

async def main():
    await fetch_massive()

if __name__ == "__main__":
    asyncio.run(main())
