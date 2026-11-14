import { defineConfig } from 'vitest/config';

/**
 * Root Vitest config: one `vitest run` executes every workspace package.
 * Each package has its own small vitest.config.ts (environment, name).
 */
export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
