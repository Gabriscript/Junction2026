import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Inline (empty) PostCSS config: stops Vite from picking up a postcss.config.js in a parent folder.
  css: { postcss: {} },
  server: { port: 5173 },
});
