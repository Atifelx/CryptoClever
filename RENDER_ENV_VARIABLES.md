# Render.com Environment Variables - Exact Setup Guide

## Backend Service Environment Variables

Go to your **Backend Service** → **Environment** → **Add Environment Variable**

### Required Variables:

| Variable Name | Value | Notes |
|--------------|-------|-------|
| `USE_MEMORY_STORE` | `1` | **REQUIRED** - Uses in-memory store (no Redis needed) |

### Optional Variables (only if you use them):

| Variable Name | Value | Notes |
|--------------|-------|-------|
| `REDIS_URL` | (leave empty) | Only if you want to use Redis instead of memory store |
| `DATABASE_URL` | (your Postgres URL) | Only if backend uses database features |

### ⚠️ Important:
- **DO NOT** set `PORT` - Render automatically sets this
- If you set `USE_MEMORY_STORE=1`, you don't need `REDIS_URL`

---

## Frontend Service Environment Variables

Go to your **Frontend Service** → **Environment** → **Add Environment Variable**

### Required Variables:

| Variable Name | Value | Example |
|--------------|-------|---------|
| `NEXT_PUBLIC_BACKEND_URL` | Your backend URL (no trailing slash!) | `https://smarttrade-backend.onrender.com` |

**⚠️ CRITICAL**: 
- Replace `https://smarttrade-backend.onrender.com` with **YOUR actual backend URL**
- **NO trailing slash** (e.g., `https://smarttrade-backend.onrender.com` ✅ NOT `https://smarttrade-backend.onrender.com/` ❌)
- Get your backend URL from Render dashboard → Backend Service → URL

### Optional Variables:

| Variable Name | Value | Notes |
|--------------|-------|-------|
| `NODE_ENV` | `production` | Recommended for production builds |
| `BACKEND_URL` | Same as `NEXT_PUBLIC_BACKEND_URL` | Only if Next.js API routes need server-side backend access |
| `REDIS_URL` | (your Redis URL) | Only if Next.js API routes use Redis |
| `NEXT_PUBLIC_DEBUG_CHART` | `1` | Only if you want debug overlay in production |

---

## Step-by-Step Instructions

### For Backend:

1. Go to Render Dashboard → Your Backend Service
2. Click **Environment** tab (or **Settings** → **Environment Variables**)
3. Click **Add Environment Variable**
4. Add:
   - **Key**: `USE_MEMORY_STORE`
   - **Value**: `1`
5. Click **Save Changes**
6. Service will automatically redeploy

### For Frontend:

1. Go to Render Dashboard → Your Frontend Service
2. Click **Environment** tab (or **Settings** → **Environment Variables**)
3. Click **Add Environment Variable**
4. Add:
   - **Key**: `NEXT_PUBLIC_BACKEND_URL`
   - **Value**: `https://YOUR-BACKEND-URL.onrender.com` (replace with your actual backend URL)
5. (Optional) Add:
   - **Key**: `NODE_ENV`
   - **Value**: `production`
6. Click **Save Changes**
7. Service will automatically redeploy

---

## How to Find Your Backend URL

1. Go to Render Dashboard
2. Click on your **Backend Service**
3. Look at the top of the page - you'll see a URL like:
   - `https://smarttrade-backend-xxxx.onrender.com`
4. Copy this URL (without trailing slash)
5. Use it as the value for `NEXT_PUBLIC_BACKEND_URL` in frontend

---

## Quick Checklist

### Backend ✅
- [ ] `USE_MEMORY_STORE` = `1` is set
- [ ] `PORT` is NOT set (Render handles this automatically)

### Frontend ✅
- [ ] `NEXT_PUBLIC_BACKEND_URL` = your backend URL (no trailing slash)
- [ ] Backend URL is correct (test by opening `https://YOUR-BACKEND-URL/health`)

---

## Example Configuration

### Backend Service:
```
USE_MEMORY_STORE=1
```

### Frontend Service:
```
NEXT_PUBLIC_BACKEND_URL=https://smarttrade-backend-abc123.onrender.com
NODE_ENV=production
```

---

## Troubleshooting

**Frontend shows "waiting data from server":**
- Check `NEXT_PUBLIC_BACKEND_URL` is set correctly
- Verify no trailing slash in the URL
- Test backend directly: `https://YOUR-BACKEND-URL/health` should return `{"status":"ok"}`
- Redeploy frontend after changing env vars

**Backend not starting:**
- Check `USE_MEMORY_STORE=1` is set
- Check backend logs in Render dashboard
- Wait 1-2 minutes for bootstrap to complete
