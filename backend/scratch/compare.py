import asyncio
import httpx
from datetime import datetime, timedelta

async def fetch_binance():
    url = "https://api.binance.com/api/v3/klines"
    params = {"symbol": "BTCUSDT", "interval": "15m", "limit": 1}
    async with httpx.AsyncClient() as client:
        r = await client.get(url, params=params)
        data = r.json()
        print("Binance Raw:")
        print(data)
        if data:
            k = data[0]
            candle = {
                "time": k[0] // 1000,
                "open": float(k[1]),
                "high": float(k[2]),
                "low": float(k[3]),
                "close": float(k[4]),
                "volume": float(k[5]),
                "is_closed": True
            }
            print("Binance Transformed:")
            print(candle)

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
        print("Massive Raw:")
        print(data.get("results"))
        res = data.get("results", [])
        if res:
            r0 = res[0]
            candle = {
                "time": int(r0["t"]) // 1000,
                "open": float(r0["o"]),
                "high": float(r0["h"]),
                "low": float(r0["l"]),
                "close": float(r0["c"]),
                "volume": float(r0["v"]),
                "is_closed": True
            }
            print("Massive Transformed:")
            print(candle)

async def main():
    await fetch_binance()
    print("-" * 40)
    await fetch_massive()

if __name__ == "__main__":
    asyncio.run(main())
