import urllib.request
import json

def test_rest_candles():
    """Test if REST API returns different candle data for different symbols"""

    symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
    base_url = "http://localhost:8000/candles"

    results = {}

    print("=" * 80)
    print("TEST 1A: REST API - Different Symbols Return Different Data")
    print("=" * 80)

    for symbol in symbols:
        url = f"{base_url}/{symbol}/1m?limit=5"
        print(f"\nFetching: {url}")

        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                data = json.loads(response.read().decode())

            if "candles" in data:
                candles = data["candles"]
                results[symbol] = candles

                print(f"✅ {symbol}: Received {len(candles)} candles")

                # Show first candle details
                if candles:
                    first = candles[0]
                    print(f"   First candle: time={first.get('time')}, close={first.get('close')}, volume={first.get('volume')}")
            else:
                print(f"❌ {symbol}: No 'candles' key in response")

        except Exception as e:
            print(f"❌ {symbol}: ERROR - {e}")

    # CRITICAL CHECK: Compare candle patterns
    print("\n" + "=" * 80)
    print("COMPARISON: Are candle patterns different?")
    print("=" * 80)

    if len(results) >= 2:
        symbols_list = list(results.keys())

        # Compare first symbol vs others
        base_symbol = symbols_list[0]
        base_candles = results[base_symbol]

        for compare_symbol in symbols_list[1:]:
            compare_candles = results[compare_symbol]

            # Check if close prices are different
            if base_candles and compare_candles:
                base_close = base_candles[0].get('close')
                compare_close = compare_candles[0].get('close')

                if base_close == compare_close:
                    print(f"⚠️  WARNING: {base_symbol} and {compare_symbol} have IDENTICAL close price: {base_close}")
                    print(f"   This suggests backend might be returning same data!")
                else:
                    price_diff = abs(base_close - compare_close)
                    print(f"✅ {base_symbol} close={base_close} vs {compare_symbol} close={compare_close} (diff: {price_diff})")

            # Check if timestamps are identical (they should be similar but volumes/prices different)
            if len(base_candles) >= 3 and len(compare_candles) >= 3:
                # Compare patterns by checking if close prices follow same pattern
                base_pattern = [c.get('close') for c in base_candles[:3]]
                compare_pattern = [c.get('close') for c in compare_candles[:3]]

                if base_pattern == compare_pattern:
                    print(f"🚨 CRITICAL BUG: {base_symbol} and {compare_symbol} have IDENTICAL candle patterns!")
                    print(f"   {base_symbol}: {base_pattern}")
                    print(f"   {compare_symbol}: {compare_pattern}")
                else:
                    print(f"✅ Candle patterns are different (as expected)")

    print("\n" + "=" * 80)
    print("TEST 1A COMPLETE")
    print("=" * 80)

if __name__ == "__main__":
    print("Starting REST API Symbol Test...")
    print("Make sure backend is running on http://localhost:8000\n")
    test_rest_candles()
