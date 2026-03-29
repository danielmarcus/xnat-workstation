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
