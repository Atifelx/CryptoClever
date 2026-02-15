# Vercel Configuration for Binance API

## Problem
Binance API returns 451 (restricted location) error when called from Vercel serverless functions in certain regions.

## Solution
Configure Vercel to use regions where Binance API is accessible.

## Configuration Steps

### 1. Vercel Dashboard Configuration

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Functions**
3. Under **Function Region**, select one of these regions:
   - **Washington, D.C., USA (iad1)** - Recommended
   - **San Francisco, USA (sfo1)**
   - **Frankfurt, Germany (fra1)** - If US regions don't work

4. Save the settings

### 2. Automatic Configuration (via vercel.json)

The `vercel.json` file is already configured to use:
- Primary region: `iad1` (Washington, D.C.)
- Fallback regions: `sfo1` (San Francisco)

This should automatically deploy functions to these regions.

### 3. Verify Configuration

After deployment:
1. Check Vercel deployment logs
2. Verify API routes are working
3. Test Binance API calls from the deployed app

### 4. If Still Blocked

If you still get 451 errors:
1. Try different regions in Vercel dashboard
2. Contact Binance support about IP whitelisting
3. Consider using Vercel Edge Functions (requires code changes)

## Current Configuration

- **Runtime**: Node.js 20.x
- **Primary Region**: iad1 (Washington, D.C.)
- **Fallback Regions**: sfo1 (San Francisco)
- **No Proxy**: Direct Binance API calls only
