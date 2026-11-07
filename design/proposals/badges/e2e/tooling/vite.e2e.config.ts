// Vite config for the badges e2e run only: same as apps/web/vite.config.ts but proxies to the throwaway ports (world 3410, lobby 3411).
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = { target: 'http://localhost:3410', changeOrigin: false, ws: true };
export default defineConfig({
  root: '/Users/admin/Projects/tribewars/apps/web',
  plugins: [react()],
  server: {
    port: 5410, host: '127.0.0.1', strictPort: true,
    proxy: {
      '/api': api,
      '^/w/[A-Za-z0-9-]+/api(/|$|\\?)': api,
      '^/lobby/api(/|$|\\?)': { target: 'http://localhost:3411', changeOrigin: false },
    },
  },
});
