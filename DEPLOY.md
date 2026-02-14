# Deployment Guide

## 🚀 Deploy to GitHub

### Step 1: Create GitHub Repository

1. Go to [GitHub](https://github.com) and sign in
2. Click the "+" icon in the top right → "New repository"
3. Repository name: `cryptoclever` (or your preferred name)
4. Description: "Real-time crypto trading platform with Semafor indicator"
5. Choose **Public** or **Private**
6. **DO NOT** initialize with README, .gitignore, or license (we already have these)
7. Click "Create repository"

### Step 2: Push Code to GitHub

Run these commands in your terminal:

```bash
# Add GitHub remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/cryptoclever.git

# Rename main branch if needed
git branch -M main

# Push code to GitHub
git push -u origin main
```

If you get authentication errors, you may need to:
- Use a Personal Access Token instead of password
- Or use SSH: `git remote set-url origin git@github.com:YOUR_USERNAME/cryptoclever.git`

## 🌐 Deploy to Vercel (Recommended)

### Option 1: Deploy via Vercel Dashboard

1. Go to [Vercel](https://vercel.com) and sign in with GitHub
2. Click "Add New Project"
3. Import your `cryptoclever` repository
4. Vercel will auto-detect Next.js settings
5. Click "Deploy"
6. Your app will be live in ~2 minutes!

### Option 2: Deploy via Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Follow the prompts
# - Link to existing project or create new
# - Deploy to production
```

### Environment Variables (Optional - for Redis)

If you want to use Redis caching in production:

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add:
   - `REDIS_URL`: Your Redis connection string (e.g., `redis://user:pass@host:port`)
   - Or individual variables:
     - `REDIS_HOST`: Your Redis host
     - `REDIS_PORT`: Redis port (default: 6379)
     - `REDIS_PASSWORD`: Redis password (if required)

**Note**: The app works perfectly without Redis - it's optional for performance optimization.

## 🔧 Post-Deployment

1. **Verify Deployment**: Visit your Vercel URL (e.g., `https://cryptoclever.vercel.app`)
2. **Custom Domain** (Optional): Add your domain in Vercel Settings → Domains
3. **Monitor**: Check Vercel Dashboard for build logs and analytics

## 📊 Alternative Deployment Options

### Netlify

1. Connect GitHub repository to Netlify
2. Build command: `npm run build`
3. Publish directory: `.next`
4. Deploy!

### Railway

1. Connect GitHub repository
2. Railway auto-detects Next.js
3. Deploy!

### Self-Hosted

```bash
# Build production version
npm run build

# Start production server
npm start
```

## ✅ Deployment Checklist

- [ ] Code pushed to GitHub
- [ ] Repository is public/accessible
- [ ] Vercel deployment successful
- [ ] App loads without errors
- [ ] Real-time data streaming works
- [ ] Charts render correctly
- [ ] Semafor indicator displays
- [ ] (Optional) Redis configured if using

## 🐛 Troubleshooting

### Build Fails
- Check Node.js version (should be 18+)
- Verify all dependencies are in `package.json`
- Check build logs in Vercel dashboard

### Environment Variables
- Make sure Redis variables are set if using Redis
- App works without Redis, so these are optional

### CORS Issues
- All API calls go through Next.js API routes (no CORS issues)
- Binance WebSocket connects directly from client

## 📞 Support

If you encounter issues:
1. Check Vercel build logs
2. Check browser console for errors
3. Verify all dependencies are installed
4. Ensure Node.js version is 18+
