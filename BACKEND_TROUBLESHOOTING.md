# Backend Troubleshooting - No Candle Data

## Issue: Backend returns empty data (`count: 0, data: []`)

This means the backend is **running** but hasn't **bootstrapped** candle data from Binance yet.

---

## Step 1: Test the Correct Endpoint

The frontend uses `/candles/BTCUSDT/1m`, not `/api/historical/BTCUSDT`.

**Test this URL in your browser:**
```
https://cryptoclever.onrender.com/candles/BTCUSDT/1m?limit=100
```

**Expected response:**
```json
{
  "symbol": "BTCUSDT",
  "interval": "1m",
  "candles": [
    {
      "time": 1234567890,
      "open": 50000.0,
      "high": 50100.0,
      "low": 49900.0,
      "close": 50050.0,
      "volume": 123.45
    },
    ...
  ]
}
```

If you get `"candles": []`, continue to Step 2.

---

## Step 2: Check Backend Health

**Test health endpoint:**
```
https://cryptoclever.onrender.com/health
```

**Expected:** `{"status":"ok"}`

If this works, backend is running. If not, backend isn't started.

---

## Step 3: Check Streaming Status

**Test streaming status:**
```
https://cryptoclever.onrender.com/streaming/status
```

**Expected response:**
```json
{
  "symbols": ["BTCUSDT"],
  "per_symbol": [
    {
      "symbol": "BTCUSDT",
      "interval": "1m",
      "count": 1000,  // Should be 1000 after bootstrap
      "last_candle_time": 1234567890,
      "last_close": 50000.0
    }
  ]
}
```

**If `count` is `0`:** Backend hasn't bootstrapped yet (see Step 4).

---

## Step 4: Check Backend Logs

1. Go to Render Dashboard → Your Backend Service
2. Click **Logs** tab
3. Look for these messages:

**✅ Bootstrap Started:**
```
Bootstrapping candles from Binance REST...
```

**✅ Bootstrap Completed:**
```
Binance WebSocket task started
```

**❌ Bootstrap Failed:**
```
Error bootstrapping candles...
```

**If bootstrap is still running:** Wait 1-2 minutes, then check `/streaming/status` again.

---

## Step 5: Verify Environment Variables

In Render Dashboard → Backend Service → **Environment**:

**Required:**
- `USE_MEMORY_STORE` = `1`

**Check:**
- Backend service is **running** (not stopped)
- No errors in logs
- `USE_MEMORY_STORE=1` is set

---

## Step 6: Manual Bootstrap Check

If bootstrap seems stuck, check backend logs for:

1. **Binance API connection errors:**
   - `Failed to fetch from Binance`
   - `Connection timeout`
   - `SSL errors`

2. **Memory store errors:**
   - `Failed to store candles`
   - `Memory allocation error`

---

## Common Issues & Solutions

### Issue: Bootstrap takes too long (>5 minutes)

**Solution:**
- Check Render logs for errors
- Verify `USE_MEMORY_STORE=1` is set
- Restart backend service

### Issue: Backend keeps restarting

**Solution:**
- Check logs for crash errors
- Verify `PORT` is NOT set manually (Render sets it)
- Check Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

### Issue: Binance API errors

**Solution:**
- Binance API should work on Render (no special config needed)
- Check if Binance API is down: https://www.binance.com/en/support/announcement
- Check backend logs for specific error messages

---

## Quick Test Checklist

- [ ] Backend `/health` returns `{"status":"ok"}`
- [ ] Backend `/streaming/status` shows `count > 0` (should be 1000)
- [ ] Backend `/candles/BTCUSDT/1m?limit=10` returns candles array
- [ ] Backend logs show "Binance WebSocket task started"
- [ ] `USE_MEMORY_STORE=1` is set in environment variables

---

## Expected Timeline

- **0-30 seconds:** Backend starts, begins bootstrap
- **30-60 seconds:** Bootstrap completes, 1000 candles loaded
- **60+ seconds:** Backend ready, serving candle data

If it's been >5 minutes and still no data, check logs for errors.
