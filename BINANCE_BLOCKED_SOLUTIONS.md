# Solutions for Binance API Blocked (HTTP 451)

Binance API is blocked from Render due to geographic restrictions. Here are **practical solutions**:

---

## Solution 1: Deploy Backend to Railway (Recommended - Easiest)

**Railway** often has different IP ranges that Binance allows.

### Steps:
1. Go to [railway.app](https://railway.app) → Sign in with GitHub
2. **New Project** → **Deploy from GitHub repo**
3. Select your repo → Set **Root Directory** = `backend`
4. **Settings** → **Variables**:
   - `USE_MEMORY_STORE` = `1`
5. Railway auto-detects Python → Deploy
6. Copy Railway URL (e.g., `https://your-app.up.railway.app`)
7. Update frontend `NEXT_PUBLIC_BACKEND_URL` to Railway URL

**Why this works:** Railway uses different data centers/IP ranges that Binance may allow.

---

## Solution 2: Use HTTP Proxy (If you have proxy access)

If you have access to an HTTP proxy in an allowed region:

### Steps:
1. Get proxy URL (e.g., `http://proxy.example.com:8080`)
2. In Render → Backend Service → **Environment Variables**:
   - Add `HTTPS_PROXY` = `http://proxy.example.com:8080`
   - Or `HTTP_PROXY` = `http://proxy.example.com:8080`
3. Redeploy backend
4. Test: `https://your-backend.onrender.com/test/binance`

**Code already supports this** - proxy will be used automatically if env var is set.

---

## Solution 3: Use Free Proxy Services

### Option A: FreeProxyList
1. Get a free HTTP proxy from [free-proxy-list.net](https://free-proxy-list.net)
2. Choose a proxy from an allowed region (US, EU, etc.)
3. Add to Render env vars: `HTTPS_PROXY=http://IP:PORT`
4. **Note:** Free proxies are unreliable and may be slow

### Option B: ProxyScrape (Free API)
1. Sign up at [proxyscrape.com](https://proxyscrape.com)
2. Get rotating proxy endpoint
3. Use their API endpoint as proxy

---

## Solution 4: Deploy to Fly.io (Alternative Hosting)

**Fly.io** has global regions - deploy to a region Binance allows.

### Steps:
1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Create `fly.toml` in `backend/` directory:
   ```toml
   app = "your-app-name"
   primary_region = "iad"  # US East
   
   [build]
   
   [env]
     USE_MEMORY_STORE = "1"
     PORT = "8080"
   
   [[services]]
     internal_port = 8080
     protocol = "tcp"
   
     [[services.ports]]
       handlers = ["http"]
       port = 80
       force_https = true
   ```
3. Deploy: `fly deploy`
4. Update frontend `NEXT_PUBLIC_BACKEND_URL`

---

## Solution 5: Use Alternative Crypto Data API

Switch to a different data provider that doesn't block:

### Option A: CoinGecko API (Free)
- **Pros:** Free, no restrictions
- **Cons:** Rate limits, may not have real-time 1m candles
- **URL:** `https://api.coingecko.com/api/v3`

### Option B: CryptoCompare API
- **Pros:** Good coverage, free tier available
- **Cons:** Rate limits
- **URL:** `https://min-api.cryptocompare.com`

### Option C: Bybit API (Alternative Exchange)
- **Pros:** Similar to Binance, may allow your region
- **URL:** `https://api.bybit.com/v5`

**Note:** Switching APIs requires code changes to adapt to different response formats.

---

## Solution 6: Deploy Backend to VPS (Most Control)

Deploy backend to a VPS in a region Binance allows (US, EU, Singapore).

### Providers:
- **DigitalOcean** (Singapore, US regions)
- **Linode** (US, EU regions)
- **Vultr** (Global regions)

### Steps:
1. Create VPS in allowed region
2. Install Python, clone repo
3. Run backend: `USE_MEMORY_STORE=1 uvicorn app.main:app --host 0.0.0.0 --port 8000`
4. Use VPS IP/domain for frontend `NEXT_PUBLIC_BACKEND_URL`

---

## Recommended Quick Fix

**Try Railway first** (Solution 1) - it's the fastest and most likely to work:
1. Takes 5 minutes to deploy
2. No code changes needed
3. Free tier available
4. Different IP ranges than Render

---

## Testing After Fix

Once you've implemented a solution, test:

```
https://your-backend-url/test/binance
```

Should return:
```json
{
  "status": "success",
  "binance_reachable": true,
  "message": "✅ Binance API is accessible"
}
```

Then check:
```
https://your-backend-url/streaming/status
```

Should show `"count": 1000` after bootstrap completes.

---

## Current Code Status

✅ **Proxy support already added** - Just set `HTTPS_PROXY` or `HTTP_PROXY` env var in Render

The code will automatically use the proxy if the environment variable is set.
