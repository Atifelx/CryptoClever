# CryptoClever - Real-Time Crypto Trading Platform

A professional Next.js 14+ cryptocurrency trading platform with real-time charts, powered by Binance free API. Built with TypeScript, Tailwind CSS, and lightweight-charts.

**Built by [Atif Shaikh](https://www.linkedin.com/in/atif-shaikh)**

## 🚀 Features

- **Real-Time Charts**: Live candlestick charts with WebSocket data from Binance
- **Semafor Indicator**: Advanced pivot point detection with buy/sell signals
- **Top Trading Pairs**: Dynamic list of top 80 most traded pairs by volume
- **Multiple Timeframes**: 1m, 5m, 15m, 1h, 4h, 1D
- **Dark Theme**: Professional MetaTrader-like UI
- **100% Free**: Uses Binance free public API (no API keys required)
- **Redis Caching**: Optional Redis integration for faster performance

## 🛠️ Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Charts**: lightweight-charts
- **State Management**: Zustand
- **Real-Time Data**: Binance WebSocket API
- **Caching**: Redis (optional)

## 📦 Installation

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/cryptoclever.git
cd cryptoclever
```

2. Install dependencies:
```bash
npm install
```

3. (Optional) Set up Redis for caching:
```bash
# Install Redis locally or use a cloud service
# The app works without Redis, but caching improves performance
```

4. Run the development server:
```bash
npm run dev
```

To use port 3003 (e.g. if 3000 is in use): `npm run dev:3003` then open http://localhost:3003.

5. Open [http://localhost:3000](http://localhost:3000) in your browser. Use the port that the terminal shows (default 3000). If you run with a different port (e.g. `npm run dev -- -p 3003`), open that port (e.g. http://localhost:3003). Opening a port where the dev server is not running causes 404 errors.

## 🚀 Deployment

### Deploy to Vercel (Recommended)

1. Push your code to GitHub
2. Import your repository in [Vercel](https://vercel.com)
3. Vercel will automatically detect Next.js and deploy
4. (Optional) Add Redis environment variables if using Redis

### Environment Variables (Optional)

If using Redis, add these in Vercel:
- `REDIS_URL`: Your Redis connection string
- `REDIS_HOST`: Redis host (if not using URL)
- `REDIS_PORT`: Redis port (default: 6379)
- `REDIS_PASSWORD`: Redis password (if required)

## 📊 API Endpoints

- `/api/binance/klines` - Historical candle data
- `/api/binance/symbols` - Available trading pairs
- `/api/binance/ticker` - 24h ticker statistics
- `/api/binance/cache` - Cache WebSocket updates
- `/api/crypto/logo` - Crypto logo URLs

## 🎯 Features in Detail

### Semafor Indicator
- Identifies swing highs and lows (pivot points)
- Generates buy/sell signals based on price movement
- Strength levels: 1 (weak), 2 (medium), 3 (strong)
- Visual indicators: Bigger, darker circles = stronger signals

### Real-Time Data
- WebSocket connection to Binance stream
- Automatic reconnection on disconnect
- Historical data fetching on symbol/timeframe change
- Redis caching for improved performance

### Trading Pairs
- Top 80 most traded pairs by volume
- Dynamic filtering: Trending, Most Trades, Cheap, All Pairs
- Search functionality
- Favorites support

## 📝 License

This project is open source and available under the MIT License.

## 👤 Author

**Atif Shaikh**
- LinkedIn: [https://www.linkedin.com/in/atif-shaikh](https://www.linkedin.com/in/atif-shaikh)

## 🙏 Acknowledgments

- Binance for providing free public API
- TradingView for inspiration on UI/UX
- MetaTrader community for Semafor indicator algorithm
