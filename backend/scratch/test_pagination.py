import asyncio
import logging
from app.massive_ws import bootstrap_forex_symbol

# Configure basic logging to see INFO logs to stdout
logging.basicConfig(level=logging.INFO)

if __name__ == "__main__":
    asyncio.run(bootstrap_forex_symbol("C:XAUUSD"))
