import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,js}'],
    testTimeout: 30000
  },
  resolve: {
    alias: {
      '@server': new URL('./src/server', import.meta.url).pathname,
      '@shared': new URL('./src/shared', import.meta.url).pathname
    }
  }
});
