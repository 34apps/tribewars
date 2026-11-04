import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = 'http://localhost:3000';
// Keep the browser's Host header (changeOrigin: false): the server refuses POSTs whose Origin host differs from Host.
// ws: true forwards the live-update WebSocket (/api/live) too.
const apiProxy = { target: API, changeOrigin: false, ws: true };

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Listen on the LAN so phones can open the dev server.
    host: true,
    proxy: { '/api': apiProxy },
  },
  preview: {
    port: 4173,
    host: true,
    proxy: { '/api': apiProxy },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
