import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Entry point and process wiring are covered by the end-to-end run, not unit tests.
      exclude: ['src/index.ts'],
      reporter: ['text-summary', 'text'],
    },
  },
});
