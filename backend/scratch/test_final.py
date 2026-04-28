import asyncio
import logging
from app.massive_ws import bootstrap_forex_symbol, run_massive_ws_for_symbol
from app.redis_store import get_candles

logging.basicConfig(level=logging.INFO)

async def test():
    # Test Bootstrap
    await bootstrap_forex_symbol("C:XAUUSD")
    
    # Check candles
    candles = await get_candles("C:XAUUSD", "15m", 15)
    print("Bootstrap complete. Count=", len(candles))
    if len(candles) > 0:
        print("Last historical candle:", candles[-1])
        
    # Test Poller (1 run)
    t = asyncio.create_task(run_massive_ws_for_symbol("C:XAUUSD"))
    await asyncio.sleep(5)
    t.cancel()
    
if __name__ == "__main__":
    asyncio.run(test())
