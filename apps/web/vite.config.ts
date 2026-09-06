import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Read VITE_* vars from the monorepo-root .env (single source of truth).
  envDir: '../../',
  // Modern target so esbuild doesn't try (and fail) to down-level destructuring.
  esbuild: { target: 'es2022' },
  build: { target: 'es2022' },
  server: {
    port: 5173,
    // Proxy API, uploads, and the Socket.IO WebSocket to the server in dev, so the
    // app works same-origin even if VITE_API_URL is unset.
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
