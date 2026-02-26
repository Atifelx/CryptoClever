import asyncio
import json

import websockets


async def test_ws():
    uri = "ws://localhost:8000/ws/candles/BTCUSDT"
    print(f"Connecting to {uri}...")

    try:
        async with websockets.connect(uri) as ws:
            print("✅ Connected!")

            # Wait for 5 messages
            for i in range(5):
                msg = await asyncio.wait_for(ws.recv(), timeout=10.0)
                data = json.loads(msg)
                print(
                    f"Message {i+1}: symbol={data.get('symbol')}, "
                    f"timestamp={data.get('timestamp')}, close={data.get('close')}"
                )

            print("✅ Test PASSED - Received 5 candle updates")
    except asyncio.TimeoutError:
        print("❌ Test FAILED - Timeout waiting for messages")
    except Exception as e:
        print(f"❌ Test FAILED - Error: {e}")


if __name__ == "__main__":
    asyncio.run(test_ws())

