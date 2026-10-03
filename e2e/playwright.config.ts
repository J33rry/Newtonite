import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against their own isolated stack, so they never touch the dev database or
 * collide with dev servers on 3000/4000:
 *
 *   Postgres (docker, :5433) database `ops_e2e` ← reset + migrated + small seed on every run
 *   API     :4100  (Fastify)
 *   worker         (notifications, overdue sweep)
 *   web     :3100  (production `next build` in .next-e2e, proxying /api → :4100)
 *
 * Only Postgres must already be running (`pnpm db:up`). Locally, servers that are already up are
 * reused (fast re-runs; the database is then NOT reset). On CI everything starts fresh.
 */
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgres://ops:ops@localhost:5433/ops_e2e';
const API_PORT = 4100;
const WEB_PORT = 3100;
const reuse = !process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true, // every test creates its own work items, so tests are independent
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  // Started in order; each must be ready before the next starts.
  webServer: [
    {
      name: 'api',
      command: 'pnpm --filter server e2e:db && pnpm --filter server start',
      cwd: '..',
      url: `http://localhost:${API_PORT}/api/health`,
      env: { DATABASE_URL, PORT: String(API_PORT), SEED_ITEMS: '500', LOG_LEVEL: 'warn' },
      reuseExistingServer: reuse,
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      name: 'worker',
      command: 'pnpm --filter server worker',
      cwd: '..',
      wait: { stdout: /worker-\w+ started/ },
      env: { DATABASE_URL },
      reuseExistingServer: reuse,
      timeout: 60_000,
    },
    {
      name: 'web',
      command: `pnpm --filter web exec next build && pnpm --filter web exec next start -p ${WEB_PORT}`,
      cwd: '..',
      url: `http://localhost:${WEB_PORT}/login`,
      env: { API_URL: `http://localhost:${API_PORT}`, NEXT_DIST_DIR: '.next-e2e', NEXT_TELEMETRY_DISABLED: '1' },
      reuseExistingServer: reuse,
      timeout: 240_000,
    },
  ],
});
