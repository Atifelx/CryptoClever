import httpx
import asyncio

async def test_massive_rest():
    API_KEY = "5twdPmXQm1VQhTIFnok2RCx4dZmS7c3u"
    # Try to find EURUSD in tickers
    url = f"https://api.massive.com/v3/reference/tickers"
    params = {"apiKey": API_KEY, "market": "fx", "active": "true", "limit": 10}
    
    print(f"Testing URL: {url}")
    
    async with httpx.AsyncClient() as client:
        r = await client.get(url, params=params)
        print(f"Status: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            results = data.get("results", [])
            print(f"Found {len(results)} tickers.")
            for res in results:
                print(f"Ticker: {res['ticker']}, Name: {res['name']}")
        else:
            print(f"Error Body: {r.text}")

if __name__ == "__main__":
    asyncio.run(test_massive_rest())
