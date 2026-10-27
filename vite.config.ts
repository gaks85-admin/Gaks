import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const suppressHmrPlugin = () => ({
  name: 'suppress-hmr-plugin',
  transformIndexHtml: {
    order: 'pre' as const,
    handler() {
      return [
        {
          tag: 'script',
          children: `
            (function() {
              var NativeWebSocket = window.WebSocket;
              window.WebSocket = function(url, protocols) {
                var urlStr = String(url || '');
                var protoStr = String(protocols || '');
                if (urlStr.includes('vite') || protoStr.includes('vite') || urlStr.includes('token=')) {
                  var fake = new EventTarget();
                  fake.readyState = 1;
                  fake.OPEN = 1;
                  fake.CLOSED = 3;
                  fake.CONNECTING = 0;
                  fake.CLOSING = 2;
                  fake.url = urlStr;
                  fake.send = function() {};
                  fake.close = function() {};
                  setTimeout(function() {
                    fake.dispatchEvent(new Event('open'));
                  }, 0);
                  return fake;
                }
                return new NativeWebSocket(url, protocols);
              };
              if (NativeWebSocket) {
                window.WebSocket.prototype = NativeWebSocket.prototype;
                window.WebSocket.CONNECTING = 0;
                window.WebSocket.OPEN = 1;
                window.WebSocket.CLOSING = 2;
                window.WebSocket.CLOSED = 3;
              }

              var originalError = console.error;
              var originalWarn = console.warn;
              var isViteWS = function(msg) {
                if (!msg) return false;
                var str = typeof msg === 'string' ? msg : (msg.message || msg.stack || String(msg));
                return str.includes('[vite]') || str.includes('WebSocket') || str.includes('HMR') || str.includes('ws://') || str.includes('wss://');
              };

              console.error = function() {
                for (var i = 0; i < arguments.length; i++) {
                  if (isViteWS(arguments[i])) return;
                }
                originalError.apply(console, arguments);
              };

              console.warn = function() {
                for (var i = 0; i < arguments.length; i++) {
                  if (isViteWS(arguments[i])) return;
                }
                originalWarn.apply(console, arguments);
              };

              window.addEventListener('error', function(e) {
                if (isViteWS(e.message) || isViteWS(e.filename) || isViteWS(e.error)) {
                  e.stopImmediatePropagation();
                  e.preventDefault();
                }
              }, true);

              window.addEventListener('unhandledrejection', function(e) {
                if (isViteWS(e.reason)) {
                  e.stopImmediatePropagation();
                  e.preventDefault();
                }
              }, true);
            })();
          `,
          injectTo: 'head-prepend' as const
        }
      ];
    }
  }
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

  return {
    plugins: [
      suppressHmrPlugin(),
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png', 'gaks-logo-white.png', 'gaks-logo-dark.png'],
        manifest: {
          id: '/',
          name: 'Gaks AI',
          short_name: 'Gaks AI',
          description: 'A sleek Forex market trading assistant with AI signals and real-time watchlists.',
          theme_color: '#000000',
          background_color: '#000000',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      hmr: false
    }
  };
});
