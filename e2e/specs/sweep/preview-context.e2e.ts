/**
 * A preview belongs to what it was made for (the bug review, X2): switching operation, active
 * segment or viewport discards it — before, the next Commit / ⏎ wrote it against the new
 * target (another operation's Commit wrote the old one's edit).
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { openOperation } from '../../helpers/operations';

const PANEL = 'panel_0';
const member = (page: Page, i: number) => page.evaluate((idx) => (window as unknown as { __XNAT_E2E__: { memberVoxelCount: (i: number) => number } }).__XNAT_E2E__.memberVoxelCount(idx), i);
async function pt(page: Page, dx: number, dy: number) {
  return (await page.evaluate(([x, y]) => (window as unknown as { __XNAT_E2E__: { inPlanePagePoint: (p: string, a: number, b: number) => { x: number; y: number } } }).__XNAT_E2E__.inPlanePagePoint('panel_0', x, y), [dx, dy] as const))!;
}

/** Two segments; segment 1 painted (a square and a speck the Cleanup ops act on); segment 1 active. */
async function setup(page: Page): Promise<Locator> {
  await loadFixture(page, 'ct-body-512', PANEL);
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox.getByRole('button', { name: 'Brush', exact: true })).toBeVisible({ timeout: 10_000 });
  await clickTool(toolbox, 'Rectangle');
  for (const [a, b] of [[[-10, -10], [10, 10]], [[18, -1], [19, 0]]] as const) {
    const p = await pt(page, a[0], a[1]), q = await pt(page, b[0], b[1]);
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 6 }); await page.mouse.up();
  }
  await panel.getByRole('button', { name: 'Add member' }).first().click();
  await page.keyboard.press('Escape');
  await panel.locator('[data-testid^="member-row-"]').first().click();
  await expect.poll(() => member(page, 1)).toBeGreaterThan(0);
  return panel;
}

async function previewKeepLargest(page: Page, panel: Locator) {
  const sheet = await openOperation(panel, 'Cleanup', 'Keep largest');
  await sheet.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByTestId('mask-preview-bar')).toBeVisible();
}

test('switching operation discards the pending preview — the next Commit does not write it', async ({ page }) => {
  const panel = await setup(page);
  const before = await member(page, 1);
  await previewKeepLargest(page, panel);
  await openOperation(panel, 'Interpolate');
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await member(page, 1), 'the speck Keep largest would remove is still there').toBe(before);
});

test('activating another segment discards the pending preview — ⏎ does not write it', async ({ page }) => {
  const panel = await setup(page);
  const before = await member(page, 1);
  await previewKeepLargest(page, panel);
  await panel.locator('[data-testid^="member-row-"]').nth(1).click();
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await member(page, 1)).toBe(before);
  expect(await member(page, 2)).toBe(0);
});
