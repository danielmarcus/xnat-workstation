/**
 * The rotation / flip / invert overlay fields show their CURRENT state whenever the
 * field is enabled — including the default (untransformed) state, where they used to
 * render nothing and so looked unwired. Drives the real toolbar transform buttons and
 * reads the live overlay (no store shortcuts).
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../../helpers/local-fixture';

const field = (page: Page, key: string) =>
  page.locator(`[data-testid="overlay-field-${key}:panel_0"]`);

test('rotation / flip / invert overlay fields render their state, default included', async ({ page }: { page: Page }) => {
  await enterLocalViewer(page);
  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  // Default state: the fields are present and show their resting values (the bug was
  // that an untransformed image rendered them blank). Default prefs place all three
  // in the bottom-right corner.
  await expect(field(page, 'rotation')).toHaveText('Rot: 0°');
  await expect(field(page, 'flip')).toHaveText('Flip: None');
  await expect(field(page, 'invert')).toHaveText('Invert: Off');

  // Apply each transform via the real toolbar (open the Transform group if collapsed).
  const rotate = page.locator('button[title="Rotate 90°"]');
  if (!(await rotate.isVisible())) await page.locator('button[title="Transform"]').click();
  await page.locator('button[title="Rotate 90°"]').click();
  await page.locator('button[title="Flip horizontal"]').click();
  await page.locator('button[title="Invert grayscale (negative)"]').click();

  await expect(field(page, 'rotation')).toHaveText('Rot: 90°');
  await expect(field(page, 'flip')).toHaveText('Flip: H');
  await expect(field(page, 'invert')).toHaveText('Invert: On');
});
