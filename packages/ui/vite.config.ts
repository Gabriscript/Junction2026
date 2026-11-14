import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Inline (empty) PostCSS config: stops Vite from picking up a postcss.config.js in a parent folder.
  css: { postcss: {} },
  // /api → assistant server (buyer side), /v1 + JWKS → Valio Aimo gateway. Used with VITE_GATEWAY_URL=/ (npm run dev:live).
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8788',
      '/v1': 'http://127.0.0.1:8787',
      '/.well-known': 'http://127.0.0.1:8787',
    },
  },
  // Two pages: the dashboard (index.html) and the Aimo webshop front page with the AI Assistant button (shop.html).
  build: { rollupOptions: { input: { main: 'index.html', shop: 'shop.html' } } },
});
