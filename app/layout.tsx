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
