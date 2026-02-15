#!/bin/bash
# Test script for Deep Analysis API

echo "🧪 Testing Deep Analysis API"
echo "================================"
echo ""

# Test 1: Valid request
echo "Test 1: Valid request (BTCUSDT, 1h)"
curl -X POST http://localhost:3000/api/deep-analysis \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","timeframe":"1h"}' \
  | jq '.' || echo "Response received"
echo ""
echo ""

# Test 2: Check Redis cache (should return cached)
echo "Test 2: Second request (should return cached)"
curl -X POST http://localhost:3000/api/deep-analysis \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","timeframe":"1h"}' \
  | jq '.cached' || echo "Response received"
echo ""
echo ""

# Test 3: Invalid symbol
echo "Test 3: Invalid symbol"
curl -X POST http://localhost:3000/api/deep-analysis \
  -H "Content-Type: application/json" \
  -d '{"symbol":"","timeframe":"1h"}' \
  | jq '.error' || echo "Response received"
echo ""
echo ""

# Test 4: Invalid timeframe
echo "Test 4: Invalid timeframe"
curl -X POST http://localhost:3000/api/deep-analysis \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","timeframe":"invalid"}' \
  | jq '.error' || echo "Response received"
echo ""
