# Deploy SmartTrade: Frontend (Vercel) + Backend (separate service)

Your app has **two parts**:
- **Frontend**: Next.js (runs on **Vercel**)
- **Backend**: Python FastAPI (runs on **Railway** or **Render** — Vercel cannot run long-running Python servers)

Deploy the **backend first**, then the **frontend**, and connect them with env vars.

---

## Your repo structure (why we set Root Directory = backend)

Same repo contains both apps:
- Repo root: Next.js (`app/`, `package.json`, `next.config.js`)
- `backend/` folder: Python FastAPI (`app/main.py`, `requirements.txt`)

Render must run only the Python app. So we set **Root Directory** to **`backend`**. Then Render uses `backend` as the project root, finds `requirements.txt` and `app/main.py`, and runs uvicorn. If Root Directory is left empty, Render sees `package.json` at the top and tries to build Next.js.

---

## Part 1: Deploy the backend on Render (exact steps)

1. **[render.com](https://render.com)** → sign in with GitHub → **New +** → **Web Service**.
2. **Connect** your repo (e.g. Atifelx/CryptoClever).
3. **Branch**: select **main** (or your deploy branch).
4. **Root Directory**: set to **`backend`** (so only the Python app is built).
5. **Name**: e.g. `smarttrade-backend`. **Runtime**: Python 3.
6. **Build Command**: `pip install -r requirements.txt`
7. **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
8. **Environment**: add `USE_MEMORY_STORE` = `1` (optional: `REDIS_URL`, `DATABASE_URL`).
9. **Create Web Service**. Copy the service URL (no trailing slash) → use as BACKEND_URL in Vercel.
10. Check: open `https://YOUR-RENDER-URL/health` → `{"status":"ok"}`.

**If build failed with "Failed building wheel for asyncpg"**: Switch to Docker. See section "Fix: asyncpg build failure" at the end of this doc.

---

### Option A: Railway (alternative)

1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. Click **New Project** → **Deploy from GitHub repo**.
3. Select your repo (e.g. `Atifelx/CryptoClever`). If the repo has both `backend/` and Next.js at root:
   - Set **Root Directory** to `backend` (so Railway builds and runs the Python app).
4. In **Settings** (or **Variables**):
   - Add:
     - `USE_MEMORY_STORE` = `1` (no Redis needed for start; optional: add Redis later and remove this).
     - `REDIS_URL` = leave empty if using memory store, or your Redis URL if you add Redis.
     - `DATABASE_URL` = your Postgres URL if the backend uses DB; otherwise you can omit.
5. **Build / Start** (Railway often auto-detects):
   - Build: `pip install -r requirements.txt` (or leave default).
   - Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
6. Deploy. After deploy, open **Settings** → **Networking** → **Generate Domain**. Copy the URL (e.g. `https://your-app.up.railway.app`).  
   **This is your BACKEND_URL** — you will use it in Vercel.

### Option B: Render (alternative — same idea: Root Directory = backend)

---

## Part 2: Deploy the frontend on Vercel (GUI)

### Step 1: Import project

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub.
2. Click **Add New…** → **Project**.
3. **Import** your GitHub repository (e.g. `Atifelx/CryptoClever`).
4. Leave **Root Directory** as **empty** (repo root has `package.json` and Next.js).

### Step 2: Build settings (usually auto-detected)

- **Framework Preset**: Next.js
- **Build Command**: `npm run build` or leave default
- **Output Directory**: leave default (e.g. `.next`)

### Step 3: Environment variables (required)

Before clicking **Deploy**, open **Environment Variables** and add:

| Name | Value | Notes |
|------|--------|--------|
| `NEXT_PUBLIC_BACKEND_URL` | `https://YOUR-BACKEND-URL` | Replace with your Railway/Render backend URL (no trailing slash). Used by the **browser** for WebSocket and API calls. |
| `BACKEND_URL` | `https://YOUR-BACKEND-URL` | Same URL. Used by **Next.js API routes** (server-side) to proxy to the backend. |

Example (replace with your real backend URL):

- `NEXT_PUBLIC_BACKEND_URL` = `https://your-app.up.railway.app`
- `BACKEND_URL` = `https://your-app.up.railway.app`

Optional (only if you use them):

- `REDIS_URL` – if any Next.js API route uses Redis (e.g. pattern analysis).
- `NEXT_PUBLIC_DEBUG_CHART` = `1` – only if you want the chart debug overlay in production.

Apply to **Production** (and Preview if you want the same for branch previews).

### Step 4: Deploy

Click **Deploy**. Wait for the build to finish. Your frontend will be at `https://your-project.vercel.app`.

---

## Part 3: Two-service summary

```
[Browser]
    │
    ├── Next.js (Vercel)  ←  Frontend + API routes
    │       │
    │       └── BACKEND_URL  ──→  FastAPI (Railway/Render)  ←  Backend
    │
    └── NEXT_PUBLIC_BACKEND_URL  ──→  FastAPI (Railway/Render)  ←  WebSocket + REST from client
```

- **Frontend (Vercel)**: Serves the Next.js app and can proxy some requests using `BACKEND_URL`.
- **Backend (Railway/Render)**: Serves REST and WebSocket; must allow requests from your Vercel domain (and from `localhost` in dev). Your FastAPI app already uses CORS; if you restrict origins, add your Vercel URL (e.g. `https://your-project.vercel.app`).

---

## Checklist

- [ ] Backend deployed on Railway or Render; **Root Directory** = `backend`.
- [ ] Backend URL copied (e.g. `https://xxx.up.railway.app`).
- [ ] Vercel project created and repo connected; **Root Directory** = repo root (no change).
- [ ] In Vercel: `NEXT_PUBLIC_BACKEND_URL` and `BACKEND_URL` set to that backend URL.
- [ ] Deploy frontend; open the Vercel URL and test chart + live data.

---

## If the backend has a `Dockerfile`

- **Railway**: Often auto-detects Docker; ensure it runs `uvicorn` on `$PORT`.
- **Render**: In **New** → **Web Service**, choose **Docker** and point to the Dockerfile in `backend/` (or repo root if Dockerfile is there).

---

## Fix: asyncpg build failure on Render

If you see **"Failed building wheel for asyncpg"** or **gcc failed with exit code 1**, Render's native Python image doesn't have the build tools asyncpg needs. Use **Docker** instead.

1. The repo includes **`backend/Dockerfile`** (installs gcc + libpq-dev, then pip install, then uvicorn).
2. In Render: open your **Web Service** → **Settings**.
3. Change **Environment** from **Python 3** to **Docker**.
4. Keep **Root Directory** = **`backend`**. Render will use `backend/Dockerfile`.
5. Leave **Build Command** and **Start Command** blank (Dockerfile defines the run).
6. Keep env vars: `USE_MEMORY_STORE` = `1` (and optional `DATABASE_URL`, `REDIS_URL`).
7. **Save** → **Manual Deploy** (or push a commit). Build should succeed.

For a **new** service: connect repo, **Root Directory** = `backend`, **Environment** = **Docker**, add `USE_MEMORY_STORE` = `1`, then Create Web Service.

---

## Troubleshooting

- **Chart / WebSocket not working**: Ensure `NEXT_PUBLIC_BACKEND_URL` is set and has **no trailing slash**. Check browser Network tab for WS URL.
- **API routes 502 / timeout**: Ensure `BACKEND_URL` is correct and the backend is running and reachable (open `BACKEND_URL/health` in a browser).
- **CORS**: Backend already allows `*`; if you later restrict origins, add your Vercel domain.
