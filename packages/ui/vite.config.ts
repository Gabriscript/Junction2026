import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Inline (empty) PostCSS config: stops Vite from picking up a postcss.config.js in a parent folder.
  css: { postcss: {} },
  server: { port: 5173 },
  // Two pages: the dashboard (index.html) and the Aimo webshop front page with the AI Assistant button (shop.html).
  build: { rollupOptions: { input: { main: 'index.html', shop: 'shop.html' } } },
});
