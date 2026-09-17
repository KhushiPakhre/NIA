import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// The project depended on @vitejs/plugin-react but shipped no config, so Vite fell
// back to its defaults and never ran the React JSX transform — `npm run dev` failed
// on the first tag in main.jsx. Adding the config is the whole fix.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Opt-in same-origin path. By default the client talks to the API directly at
    // :8787 and the API sends permissive CORS headers, which EventSource is happy
    // with. But EventSource cannot send custom headers and reconnects on its own,
    // so cross-origin setups behind a corporate proxy sometimes drop the stream;
    // running the dev server with VITE_API_URL=/api routes it through here instead.
    proxy: {
      '/api': {
        target: process.env.DESKLINE_API_TARGET || 'http://localhost:8787',
        changeOrigin: true,
        // SSE must not be buffered or the feed arrives in one lump at the end.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (String(proxyRes.headers['content-type'] || '').includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache, no-transform';
            }
          });
        },
      },
    },
  },
  build: {outDir: 'dist'},
});
