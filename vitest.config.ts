import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    exclude: ['**/node_modules/**', 'dist/**', 'functions/lib/**', 'tests/e2e/**', 'tests/e2e-production/**', 'tests/rules/**']
  }
});
