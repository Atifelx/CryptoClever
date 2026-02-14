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
                
                // Intercept script/link tag errors - but don't reload (causes infinite loop)
                // Just log the error for debugging
                var handleError = function(e) {
                  var target = e.target;
                  var src = target.src || target.href || '';
                  if (src && src.includes('/_next/static/')) {
                    // Don't reload - just log
                    console.warn('Static asset failed to load:', src);
                  }
                };
                
                // Only listen for errors, don't reload
                if (document.addEventListener) {
                  document.addEventListener('error', handleError, true);
                }
                
                // Watch for new script/link tags (only if DOM is ready)
                if (document.head && document.body) {
                  try {
                    var observer = new MutationObserver(function(mutations) {
                      mutations.forEach(function(mutation) {
                        mutation.addedNodes.forEach(function(node) {
                          if (node && node.nodeType === 1) {
                            if (node.tagName === 'SCRIPT' || node.tagName === 'LINK') {
                              node.addEventListener('error', handleError);
                            }
                          }
                        });
                      });
                    });
                    
                    observer.observe(document.head, { childList: true, subtree: true });
                    observer.observe(document.body, { childList: true, subtree: true });
                  } catch(e) {
                    // Silently fail if observer can't be created
                  }
                }
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
