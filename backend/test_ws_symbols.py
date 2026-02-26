import asyncio
import websockets
import json


async def monitor_symbol(symbol: str, duration: int = 10):
    """Connect to WebSocket and monitor candle data for a symbol"""

    uri = f"ws://localhost:8000/ws/candles/{symbol}"
    candles_received = []

    print(f"\n[{symbol}] Connecting to {uri}")

    try:
        async with websockets.connect(uri) as ws:
            print(f"[{symbol}] ✅ Connected")

            # Receive messages for specified duration
            loop = asyncio.get_running_loop()
            start_time = loop.time()

            while (loop.time() - start_time) < duration:
                try:
                    message = await asyncio.wait_for(ws.recv(), timeout=2.0)
                    data = json.loads(message)

                    candles_received.append({
                        'timestamp': data.get('timestamp'),
                        'close': data.get('close'),
                        'volume': data.get('volume'),
                        'symbol': data.get('symbol')
                    })

                    # Print every 3rd candle to avoid spam
                    if len(candles_received) % 3 == 0:
                        print(f"[{symbol}] Candles: {len(candles_received)}, Latest close: {data.get('close')}")

                except asyncio.TimeoutError:
                    continue

            print(f"[{symbol}] ✅ Monitoring complete. Received {len(candles_received)} updates")
            return symbol, candles_received

    except Exception as e:
        print(f"[{symbol}] ❌ ERROR: {e}")
        return symbol, []


async def test_multiple_symbols():
    """Test multiple symbols simultaneously"""

    print("=" * 100)
    print("TEST 1B: WebSocket - Different Symbols Receive Different Data")
    print("=" * 100)
    print("\nMonitoring 3 symbols for 10 seconds each (simultaneously)...\n")

    symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]

    # Monitor all symbols simultaneously
    results = await asyncio.gather(
        monitor_symbol("BTCUSDT", 10),
        monitor_symbol("ETHUSDT", 10),
        monitor_symbol("SOLUSDT", 10)
    )

    # Analyze results
    print("\n" + "=" * 100)
    print("ANALYSIS: Comparing data received for different symbols")
    print("=" * 100)

    symbol_data = {symbol: candles for symbol, candles in results}

    # Check if all symbols received data
    for symbol, candles in symbol_data.items():
        if not candles:
            print(f"❌ {symbol}: No data received!")
        else:
            print(f"✅ {symbol}: Received {len(candles)} candle updates")

    # CRITICAL CHECK: Compare if candles are actually different
    if all(len(candles) > 0 for candles in symbol_data.values()):
        print("\n" + "=" * 100)
        print("CRITICAL CHECK: Are the candle values actually different?")
        print("=" * 100)

        symbols_list = list(symbol_data.keys())

        # Get latest candle from each symbol
        for symbol in symbols_list:
            latest = symbol_data[symbol][-1]
            print(f"\n{symbol} (latest candle):")
            print(f"  Timestamp: {latest['timestamp']}")
            print(f"  Close:     {latest['close']}")
            print(f"  Volume:    {latest['volume']}")
            print(f"  Symbol in data: {latest['symbol']}")

        # Compare close prices
        print("\n" + "-" * 100)
        btc_close = symbol_data["BTCUSDT"][-1]['close']
        eth_close = symbol_data["ETHUSDT"][-1]['close']
        sol_close = symbol_data["SOLUSDT"][-1]['close']

        if btc_close == eth_close == sol_close:
            print("🚨 CRITICAL BUG FOUND: All symbols have IDENTICAL close prices!")
            print(f"   BTC={btc_close}, ETH={eth_close}, SOL={sol_close}")
            print("   Backend is sending SAME data for all symbols!")
        else:
            print("✅ Close prices are different (as expected):")
            print(f"   BTC={btc_close}, ETH={eth_close}, SOL={sol_close}")

        # Check if symbol field in data is correct
        print("\n" + "-" * 100)
        print("Checking 'symbol' field in received data:")

        for symbol in symbols_list:
            symbol_in_data = symbol_data[symbol][-1]['symbol']
            if symbol_in_data == symbol:
                print(f"✅ {symbol}: 'symbol' field is correct ({symbol_in_data})")
            else:
                print(f"🚨 {symbol}: 'symbol' field is WRONG! Expected '{symbol}', got '{symbol_in_data}'")

        # Check candle patterns over time
        print("\n" + "-" * 100)
        print("Checking if candle PATTERNS are identical (last 5 updates):")

        if len(symbol_data["BTCUSDT"]) >= 5 and len(symbol_data["ETHUSDT"]) >= 5:
            btc_pattern = [c['close'] for c in symbol_data["BTCUSDT"][-5:]]
            eth_pattern = [c['close'] for c in symbol_data["ETHUSDT"][-5:]]

            print(f"\nBTC last 5 closes: {btc_pattern}")
            print(f"ETH last 5 closes: {eth_pattern}")

            if btc_pattern == eth_pattern:
                print("🚨 CRITICAL: Candle patterns are IDENTICAL! Backend bug confirmed.")
            else:
                print("✅ Candle patterns are different (as expected)")

    print("\n" + "=" * 100)
    print("TEST 1B COMPLETE")
    print("=" * 100)


if __name__ == "__main__":
    print("Starting WebSocket Symbol Test...")
    print("Make sure backend is running on http://localhost:8000\n")
    asyncio.run(test_multiple_symbols())
