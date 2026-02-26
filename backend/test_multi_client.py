import asyncio
import json

import websockets


async def client(client_id: int):
    uri = "ws://localhost:8000/ws/candles/BTCUSDT"
    print(f"Client {client_id}: Connecting...")

    async with websockets.connect(uri) as ws:
        print(f"Client {client_id}: ✅ Connected")

        # Receive 3 messages
        for _ in range(3):
            msg = await ws.recv()
            data = json.loads(msg)
            print(f"Client {client_id}: Received candle close={data.get('close')}")

        print(f"Client {client_id}: Done")


async def test_multiple_clients():
    print("Starting 3 clients simultaneously...")
    await asyncio.gather(client(1), client(2), client(3))
    print("✅ All clients completed")


if __name__ == "__main__":
    asyncio.run(test_multiple_clients())

