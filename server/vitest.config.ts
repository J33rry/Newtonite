import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one database; run files sequentially to keep fixtures isolated.
    fileParallelism: false,
    testTimeout: 20_000,
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://ops:ops@localhost:5433/ops_test' },
  },
});
