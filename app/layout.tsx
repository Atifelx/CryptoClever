import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import { StoreHydration } from "./components/StoreHydration";
import CacheBuster from "./components/CacheBuster";

export const metadata: Metadata = {
  title: "CryptoClever - Trading Platform",
  description: "Professional trading platform with real-time charts - Build by Atif Shaikh",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Set default timezone to Indian Standard Time (GMT+5:30) - MUST RUN FIRST */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // CRITICAL: Override default timezone to IST for ALL date formatting
              // This must run before any other scripts
              (function() {
                'use strict';
                
                // Store original methods
                const originalToLocaleString = Date.prototype.toLocaleString;
                const originalToLocaleTimeString = Date.prototype.toLocaleTimeString;
                const originalToLocaleDateString = Date.prototype.toLocaleDateString;
                const originalToString = Date.prototype.toString;
                const originalIntlDateTimeFormat = Intl.DateTimeFormat;
                
                // Helper to convert UTC to IST
                function toIST(date) {
                  const utcTime = date.getTime();
                  const istOffset = 5.5 * 60 * 60 * 1000; // GMT+5:30
                  return new Date(utcTime + istOffset);
                }
                
                // Override Intl.DateTimeFormat to force IST timezone
                // This is what lightweight-charts uses internally for time formatting
                const OriginalDateTimeFormat = Intl.DateTimeFormat;
                Intl.DateTimeFormat = function(locales, options) {
                  const opts = options ? { ...options } : {};
                  // Force IST timezone if not specified
                  if (!opts.timeZone) {
                    opts.timeZone = 'Asia/Kolkata';
                  }
                  return new OriginalDateTimeFormat(locales || 'en-IN', opts);
                };
                
                // Copy static methods and properties
                Object.setPrototypeOf(Intl.DateTimeFormat, OriginalDateTimeFormat);
                if (OriginalDateTimeFormat.supportedLocalesOf) {
                  Intl.DateTimeFormat.supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf;
                }
                
                // Override toLocaleString to use IST by default
                Date.prototype.toLocaleString = function(locales, options) {
                  const opts = { ...options };
                  if (!opts.timeZone) {
                    opts.timeZone = 'Asia/Kolkata';
                  }
                  // Convert to IST before formatting
                  const istDate = toIST(this);
                  return originalToLocaleString.call(istDate, locales || 'en-IN', opts);
                };
                
                // Override toLocaleTimeString to use IST by default
                Date.prototype.toLocaleTimeString = function(locales, options) {
                  const opts = { ...options };
                  if (!opts.timeZone) {
                    opts.timeZone = 'Asia/Kolkata';
                  }
                  const istDate = toIST(this);
                  return originalToLocaleTimeString.call(istDate, locales || 'en-IN', opts);
                };
                
                // Override toLocaleDateString to use IST by default
                Date.prototype.toLocaleDateString = function(locales, options) {
                  const opts = { ...options };
                  if (!opts.timeZone) {
                    opts.timeZone = 'Asia/Kolkata';
                  }
                  const istDate = toIST(this);
                  return originalToLocaleDateString.call(istDate, locales || 'en-IN', opts);
                };
                
                // Also override toString to show IST
                Date.prototype.toString = function() {
                  const istDate = toIST(this);
                  const hours = istDate.getUTCHours().toString().padStart(2, '0');
                  const minutes = istDate.getUTCMinutes().toString().padStart(2, '0');
                  const day = istDate.getUTCDate().toString().padStart(2, '0');
                  const month = (istDate.getUTCMonth() + 1).toString().padStart(2, '0');
                  const year = istDate.getUTCFullYear();
                  return \`\${day}/\${month}/\${year} \${hours}:\${minutes} IST\`;
                };
                
                console.log('✅ IST timezone override applied (GMT+5:30)');
              })();
            `,
          }}
        />
        {/* Prevent browser caching permanently */}
        <meta httpEquiv="Cache-Control" content="no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
        {/* Cache clearing for development */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                // Clear all caches on page load
                if ('caches' in window) {
                  caches.keys().then(function(names) {
                    return Promise.all(names.map(function(name) {
                      return caches.delete(name);
                    }));
                  }).catch(function() {});
                }
                
                // Unregister service workers
                if ('serviceWorker' in navigator) {
                  navigator.serviceWorker.getRegistrations().then(function(registrations) {
                    return Promise.all(registrations.map(function(reg) {
                      return reg.unregister();
                    }));
                  }).catch(function() {});
                }
                
                // Clear browser cache for static assets
                if ('serviceWorker' in navigator) {
                  navigator.serviceWorker.getRegistrations().then(function(registrations) {
                    return Promise.all(registrations.map(function(reg) {
                      return reg.unregister();
                    }));
                  }).catch(function() {});
                }
                
                // Clear all caches
                if ('caches' in window) {
                  caches.keys().then(function(names) {
                    return Promise.all(names.map(function(name) {
                      return caches.delete(name);
                    }));
                  }).catch(function() {});
                }
                
                // Remove cache-busting query params and reload if needed
                if (window.location.search.includes('v=') || window.location.search.includes('nocache')) {
                  var newUrl = window.location.pathname;
                  if (window.location.hash) {
                    newUrl += window.location.hash;
                  }
                  window.history.replaceState({}, '', newUrl);
                }
                
                // PERMANENT FIX: Intercept and retry failed chunk requests
                (function() {
                  var originalFetch = window.fetch;
                  window.fetch = function() {
                    var args = Array.prototype.slice.call(arguments);
                    var self = this;
                    return originalFetch.apply(self, args).catch(function(error) {
                      // If it's a chunk loading error, retry once after clearing cache
                      var url = args[0];
                      if (typeof url === 'string' && url.includes('/_next/static/')) {
                        console.warn('Chunk load failed, retrying after cache clear:', url);
                        // Clear cache and retry
                        if ('caches' in window) {
                          return caches.keys().then(function(names) {
                            return Promise.all(names.map(function(name) {
                              return caches.delete(name);
                            }));
                          }).then(function() {
                            return originalFetch.apply(self, args);
                          }).catch(function() {
                            // If retry fails, return original error
                            return Promise.reject(error);
                          });
                        }
                      }
                      return Promise.reject(error);
                    });
                  };
                })();
                
                // PERMANENT FIX: Handle script tag errors (chunk loading failures)
                var chunkErrorRetryCount = 0;
                var maxRetries = 2;
                window.addEventListener('error', function(event) {
                  if (event.target && event.target.tagName === 'SCRIPT') {
                    var src = event.target.src || event.target.getAttribute('src');
                    if (src && src.includes('/_next/static/')) {
                      console.warn('Script chunk error detected:', src);
                      chunkErrorRetryCount++;
                      
                      // Clear cache immediately
                      if ('caches' in window) {
                        caches.keys().then(function(names) {
                          return Promise.all(names.map(function(name) {
                            return caches.delete(name);
                          }));
                        });
                      }
                      
                      // Retry by reloading if we haven't exceeded max retries
                      if (chunkErrorRetryCount <= maxRetries) {
                        console.log('Retrying chunk load...');
                        setTimeout(function() {
                          window.location.reload();
                        }, 1000);
                      } else {
                        console.error('Max retries exceeded. Please manually refresh.');
                      }
                    }
                  }
                }, true);
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased">
        <CacheBuster />
        <StoreHydration>
          {children}
        </StoreHydration>
        <Toaster 
          position="top-right"
          toastOptions={{
            style: {
              background: '#1a1d2e',
              color: '#fff',
              border: '1px solid #2a2d3e',
            },
            success: {
              iconTheme: {
                primary: '#26a69a',
                secondary: '#fff',
              },
            },
            error: {
              iconTheme: {
                primary: '#ef5350',
                secondary: '#fff',
              },
            },
          }}
        />
      </body>
    </html>
  );
}
