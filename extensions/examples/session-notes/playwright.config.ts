/**
 * Session notes' own E2E — as an extension's own repository runs it: Playwright and the SDK's
 * testing helpers, against a built XNAT Workstation (here, this core checkout's dist/).
 * Run with `npm run test:e2e:extension-example` after `npm run build`.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  timeout: 90_000,
  reporter: 'list',
});
