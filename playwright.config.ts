import { defineConfig } from '@playwright/test';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';

// Load E2E environment variables from .env.e2e (preferred) or .env.e2e.example (fallback)
const envFile = fs.existsSync(path.resolve(__dirname, '.env.e2e'))
  ? '.env.e2e'
  : '.env.e2e.example';
dotenv.config({ path: path.resolve(__dirname, envFile), override: true });

export default defineConfig({
  testDir: './e2e/specs',
  testMatch: '**/*.e2e.ts',

  /* Single worker — Electron is a stateful singleton */
  workers: 1,

  /*
   * Run order is DECLARED here, not inferred from a filename sort.
   *
   * Specs used to carry `NN-` prefixes because with `workers: 1` Playwright runs files
   * alphabetically — a documented Playwright pattern, but one that made the run order an
   * emergent property of names, and the names an append-only log (two files ended up
   * numbered 61). The suite does not actually depend on order: the autouse `resetState`
   * fixture in e2e/fixtures/electron-app.ts reloads the renderer before EVERY test, so
   * each one starts from a reconstructed app.
   *
   * What the numbers really bought was "smoke first, fail fast". `dependencies` buys that
   * outright and more strictly: if `smoke` fails, the dependent projects never run.
   *
   *   smoke — launch + WebGL2. Everything else depends on it.
   *   app   — the whole offline suite. No credentials needed.
   *   auth  — live-XNAT specs. Separated so expired CNDA credentials fail only these
   *           instead of aborting the run (they previously sorted FIRST, so a 401 stopped
   *           everything under maxFailures: 1).
   *
   * Run offline only: npm run test:e2e:offline   (or --project=app)
   */
  projects: [
    { name: 'smoke', testDir: './e2e/specs/smoke' },
    {
      name: 'app',
      testDir: './e2e/specs',
      testIgnore: ['**/smoke/**', '**/auth/**'],
      dependencies: ['smoke'],
    },
    { name: 'auth', testDir: './e2e/specs/auth', dependencies: ['smoke'] },
  ],

  /* Generous timeouts for network-dependent DICOM loading */
  timeout: 120_000,
  expect: { timeout: 30_000 },

  /* No retries against a live server — flaky retries mask real issues */
  retries: 0,

  /* Stop the entire suite on first failure */
  maxFailures: 1,

  /* Reporters */
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e/playwright-report', open: 'never' }],
  ],

  /* Artifacts */
  outputDir: 'e2e/test-results',

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
