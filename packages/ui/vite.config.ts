import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Inline (empty) PostCSS config: stops Vite from picking up a postcss.config.js in a parent folder.
  css: { postcss: {} },
  test: { environment: 'jsdom', setupFiles: './src/test-setup.ts' },
});
