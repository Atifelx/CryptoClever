/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',
  reactStrictMode: true,
  generateEtags: false,
  poweredByHeader: false,
  // Disable static optimization to prevent CSS path issues
  experimental: {
    optimizeCss: false,
  },
  // Add rewrite to handle incorrect /next/static/ requests
  async rewrites() {
    return [
      {
        source: '/next/static/:path*',
        destination: '/_next/static/:path*',
      },
    ];
  },
  async redirects() {
    return [
      { source: '/verify/candles', destination: '/api/backend/verify/candles', permanent: false },
      { source: '/verify/live', destination: '/api/backend/verify/live', permanent: false },
    ];
  },
  async headers() {
    return [
      {
        // Apply CORS headers to API routes
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PATCH, OPTIONS, DELETE' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
      {
        // Prevent caching of static assets in development
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: process.env.NODE_ENV === 'development' 
              ? 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
              : 'public, max-age=31536000, immutable',
          },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
    ];
  },
  // Webpack configuration to handle module resolution
  webpack: (config, { isServer, dev }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    
    // PERMANENT FIX: Prevent _error.js 500 errors during HMR
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
        ignored: ['**/node_modules', '**/.next'],
      };
      
      // Better error handling for dev mode - prevent chunk errors
      config.optimization = {
        ...config.optimization,
        removeAvailableModules: false,
        removeEmptyChunks: false,
        // Simplified chunk splitting to reduce errors
        splitChunks: false, // Disable chunk splitting in dev to prevent errors
      };
      
      // Ignore errors for missing chunks during HMR
      config.ignoreWarnings = [
        /Failed to parse source map/,
        /Module not found/,
      ];
      
      // Better HMR configuration
      config.devServer = {
        ...config.devServer,
        hot: true,
        liveReload: false, // Disable live reload, use HMR only
      };
    }
    
    return config;
  },
  
  // PERMANENT FIX: Better dev server configuration
  onDemandEntries: {
    // Period (in ms) where the server will keep pages in the buffer
    maxInactiveAge: 25 * 1000,
    // Number of pages that should be kept simultaneously without being disposed
    pagesBufferLength: 2,
  },
}

module.exports = nextConfig
