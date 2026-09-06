import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Modern target so esbuild doesn't try (and fail) to down-level destructuring.
  esbuild: { target: 'es2022' },
  build: { target: 'es2022' },
  server: {
    port: 5173,
    // Proxy uploaded media + API to the server in dev so relative /uploads and /api work.
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
    },
  },
});
