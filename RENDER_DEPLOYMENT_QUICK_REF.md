# Render.com Deployment - Quick Reference

## Backend Service Configuration

**Service Type**: Web Service  
**Root Directory**: `backend`  
**Environment**: Python 3 (or Docker if asyncpg build fails)  
**Build Command**: `pip install -r requirements.txt` (only if Python 3)  
**Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

### Environment Variables:
- `USE_MEMORY_STORE` = `1` (required)

### Test Backend:
- Health endpoint: `https://YOUR-BACKEND-URL/health` → Should return `{"status":"ok"}`

---

## Frontend Service Configuration

**Service Type**: Static Site (or Web Service for SSR)  
**Root Directory**: (leave empty)  
**Environment**: Node  
**Build Command**: `npm install && npm run build`  
**Publish Directory**: `.next` (if Static Site)  
**Start Command**: `npm start` (if Web Service)

### Environment Variables:
- `NEXT_PUBLIC_BACKEND_URL` = `https://YOUR-BACKEND-URL` (no trailing slash!)
- `NODE_ENV` = `production`

---

## Critical Checklist

- [ ] Backend Root Directory = `backend`
- [ ] Backend Start Command uses `0.0.0.0` and `$PORT`
- [ ] Backend has `USE_MEMORY_STORE=1`
- [ ] Frontend Root Directory = empty
- [ ] Frontend `NEXT_PUBLIC_BACKEND_URL` = backend URL (no trailing slash)
- [ ] Both services deployed
- [ ] Backend `/health` returns `{"status":"ok"}`
- [ ] Frontend loads without "waiting data" message

---

## Common Issues

**"Waiting data from server"**:
- Check `NEXT_PUBLIC_BACKEND_URL` is set correctly (no trailing slash)
- Verify backend is running: test `/health` endpoint
- Check browser console for errors

**Backend build fails (asyncpg)**:
- Switch to Docker environment
- Keep Root Directory = `backend`
- Leave Build/Start commands blank

**CORS errors**:
- Backend already allows all origins
- Verify backend URL is correct
- Clear browser cache
