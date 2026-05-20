import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/rules/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', 'dist/**', 'functions/lib/**']
  }
});
