import { defineConfig } from '@playwright/test';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';

/**
 * Playwright config for the PERFORMANCE BASELINE harness (requirements D8).
 *
 * These specs MEASURE — they are not pass/fail acceptance tests, and they are slow
 * (they generate and load a 300-slice 512×512 series, ~150 MB), so they are kept out
 * of the default green suite:
 *
 *   npx playwright test --config=playwright.perf.config.ts
 *
 * Each spec prints its numbers and writes them to e2e/test-results/perf/latest.json.
 * The only assertions are loose sanity ceilings that catch a pathological regression
 * (e.g. a load that never completes); the numbers themselves are machine-specific and
 * must be read as a baseline for THIS host, not as a verdict on the D8 budget for
 * clinical hardware.
 */
const envFile = fs.existsSync(path.resolve(__dirname, '.env.e2e'))
  ? '.env.e2e'
  : '.env.e2e.example';
dotenv.config({ path: path.resolve(__dirname, envFile), override: true });

export default defineConfig({
  testDir: './e2e/perf',
  testMatch: '**/*.perf.ts',
  workers: 1,
  // A 300-slice load plus layout churn needs generous headroom on a cold cache.
  timeout: 600_000,
  expect: { timeout: 120_000 },
  retries: 0,
  reporter: [['list']],
  outputDir: 'e2e/test-results/perf',
  use: {
    screenshot: 'only-on-failure',
  },
});
