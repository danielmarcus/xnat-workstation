import { defineConfig } from '@playwright/test';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';

/**
 * Playwright config for PENDING ACCEPTANCE SIGNALS (annotation rebuild).
 *
 * These specs (e2e/signals/) encode the §G acceptance signals as red-before-green
 * tests against the *rebuilt* surfaces. They are EXPECTED TO FAIL until their
 * phase implements the behavior, so they are deliberately kept OUT of the default
 * green suite (playwright.config.ts → e2e/specs). Run them explicitly to observe
 * red / track progress:
 *
 *   npx playwright test --config=playwright.signals.config.ts
 *
 * No maxFailures cap here — we want every signal to report its status.
 */
const envFile = fs.existsSync(path.resolve(__dirname, '.env.e2e'))
  ? '.env.e2e'
  : '.env.e2e.example';
dotenv.config({ path: path.resolve(__dirname, envFile), override: true });

export default defineConfig({
  testDir: './e2e/signals',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  timeout: 120_000,
  // Short expect timeout: red signals assert not-yet-existent elements, so we
  // want them to fail fast rather than wait the full default 30s each.
  expect: { timeout: 5_000 },
  retries: 0,
  reporter: [['list']],
  // Under the already-gitignored e2e/test-results/ tree.
  outputDir: 'e2e/test-results/signals',
  use: {
    screenshot: 'only-on-failure',
  },
});
