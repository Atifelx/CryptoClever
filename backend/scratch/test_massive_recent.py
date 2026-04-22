import httpx
import asyncio
from datetime import datetime, timedelta

async def test_massive_recent():
    API_KEY = "5twdPmXQm1VQhTIFnok2RCx4dZmS7c3u"
    symbol = "C:XAUUSD"
    end_date = datetime.now()
    start_date = end_date - timedelta(days=20)
    
    from_str = start_date.strftime("%Y-%m-%d")
    to_str = end_date.strftime("%Y-%m-%d")
    
    url = f"https://api.massive.com/v2/aggs/ticker/{symbol}/range/15/minute/{from_str}/{to_str}"
    params = {"apiKey": API_KEY, "limit": 1000, "adjusted": "true"}
    
    print(f"Testing URL: {url}")
    
    async with httpx.AsyncClient() as client:
        r = await client.get(url, params=params)
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            print(f"Status: {data.get('status')}")
            print(f"Results Count: {data.get('resultsCount')}")
            results = data.get("results", [])
            if results:
                print("First result:", results[0])
                print("Last result:", results[-1])
        else:
            print(f"Error Body: {r.text}")

if __name__ == "__main__":
    asyncio.run(test_massive_recent())
