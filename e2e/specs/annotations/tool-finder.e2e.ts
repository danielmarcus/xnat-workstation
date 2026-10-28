/**
 * The ⌘K finder (annotation-panel-modes R4-A): any tool, mode or operation of the active
 * annotation type, found by name — including the names tools had before they were grouped
 * into families. Driven with the real keys; the keyboard returns to the viewport after.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: { clearAllContainers: () => void; getActiveUnifiedTool: () => string } };
const activeTool = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveUnifiedTool());

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

async function segmentation(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  return panel;
}

test('⌘K finds a mode by its old tool name; ⏎ picks it and the keyboard goes back to the viewport', async ({ page }) => {
  const panel = await segmentation(page);
  await page.keyboard.press('Meta+k');
  const finder = page.getByRole('dialog', { name: 'Find a tool or operation' });
  await expect(finder).toBeVisible();
  await page.keyboard.type('sph. thresh');
  await expect(finder.getByRole('option').first()).toContainText('Brush · 3D · Window');
  await page.keyboard.press('Enter');
  await expect(finder).toHaveCount(0);
  expect(await activeTool(page)).toBe('SphereThreshold');
  const toolbox = panel.getByTestId('context-toolbox');
  await expect(toolbox.getByTestId('toolbox-grid').getByRole('button', { name: 'Brush', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(toolbox.getByRole('group', { name: 'Kernel' }).getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true');
  // The keyboard is the viewport's again: a tool hotkey works at once.
  await page.keyboard.press('f');
  await expect.poll(() => activeTool(page)).toBe('PaintFill');
});

test('Ctrl+K opens an operation: "random walker" opens Seeded segmentation with that method; ⎋ closes without picking', async ({ page }) => {
  const panel = await segmentation(page);
  await page.keyboard.press('Control+k');
  const finder = page.getByRole('dialog', { name: 'Find a tool or operation' });
  await page.keyboard.type('random walker');
  await page.keyboard.press('Enter');
  const sheet = panel.getByTestId('seeded-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Method')).toHaveValue('randomWalker');

  await page.keyboard.press('Control+k');
  await expect(finder).toBeVisible();
  await page.keyboard.type('cleanup');
  await page.keyboard.press('Escape');
  await expect(finder).toHaveCount(0);
  await expect(sheet).toBeVisible(); // nothing was picked
});
