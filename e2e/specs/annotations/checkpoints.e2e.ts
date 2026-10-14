/**
 * Segmentation checkpoints (SegWorks parity D8; branch 2 R5): saved from the container
 * menu, restored as ONE undo step with the exact voxels, a single baseline listed first,
 * the newest four named kept, a locked segment refused, and kept across a reload.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';

type Win = {
  __XNAT_E2E__: {
    clearAllContainers: () => void;
    memberVoxelCount: (i: number) => number;
    deleteActiveCheckpoints: () => Promise<number>;
  };
};
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';
const count = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.memberVoxelCount(1));

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

async function stroke(page: Page, fx: number) {
  const b = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * (fx + 0.06), b.y + b.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function segmentation(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  await clickTool(panel.locator('[data-testid="context-toolbox"]'), 'Brush');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.deleteActiveCheckpoints());
  return panel;
}

async function menu(panel: Locator) {
  await panel.getByRole('button', { name: 'Container menu' }).first().click();
}

async function saveCheckpoint(page: Page, panel: Locator, name: string, baseline = false) {
  await menu(panel);
  await panel.getByRole('menuitem', { name: 'Save checkpoint…' }).click();
  if (baseline) await page.getByLabel('Use as baseline').check();
  else await page.getByLabel('Checkpoint name').fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function listed(panel: Locator): Promise<string[]> {
  await menu(panel);
  await panel.getByRole('menuitem', { name: /Restore checkpoint/ }).click();
  const rows = panel.locator('[data-testid^="checkpoint-"]');
  await expect(rows.first()).toBeVisible();
  const names = (await rows.allInnerTexts()).map((t) => t.split('·')[0].trim());
  return names;
}

async function restore(panel: Locator, name: string) {
  await menu(panel);
  await panel.getByRole('menuitem', { name: /Restore checkpoint/ }).click();
  await panel.locator('[data-testid^="checkpoint-"]', { hasText: name }).getByRole('menuitem').click();
}

test('restoring a checkpoint brings back the exact voxels, as one undo step', async ({ page }) => {
  const panel = await segmentation(page);
  await stroke(page, 0.3);
  const atSave = await count(page);
  await saveCheckpoint(page, panel, 'before');
  await stroke(page, 0.5);
  const edited = await count(page);
  expect(edited).toBeGreaterThan(atSave);

  await restore(panel, 'before');
  await expect.poll(() => count(page)).toBe(atSave);
  await page.keyboard.press('Control+z');
  await expect.poll(() => count(page)).toBe(edited);
});

test('one baseline, listed first; the newest four named checkpoints are kept', async ({ page }) => {
  const panel = await segmentation(page);
  await stroke(page, 0.3);
  await saveCheckpoint(page, panel, '', true);
  for (const n of ['c1', 'c2', 'c3', 'c4', 'c5']) await saveCheckpoint(page, panel, n);
  await saveCheckpoint(page, panel, '', true); // replaces the first baseline
  const names = await listed(panel);
  expect(names[0]).toBe('Baseline');
  expect(names.filter((n) => n === 'Baseline')).toHaveLength(1);
  expect(names.slice(1)).toEqual(['c5', 'c4', 'c3', 'c2']);
});

test('a locked segment refuses a restore and keeps its voxels', async ({ page }) => {
  const panel = await segmentation(page);
  await stroke(page, 0.3);
  await saveCheckpoint(page, panel, 'snap');
  await stroke(page, 0.5);
  const edited = await count(page);
  await panel.locator('[data-testid^="member-row-"]').first().getByRole('button', { name: 'Toggle lock' }).click();
  await restore(panel, 'snap');
  await expect(page.getByText('A segment is locked — nothing was restored')).toBeVisible();
  expect(await count(page)).toBe(edited);
});

test('checkpoints survive a reload and restore into the same scan’s segmentation', async ({ page }) => {
  const panel = await segmentation(page);
  await stroke(page, 0.3);
  const atSave = await count(page);
  await saveCheckpoint(page, panel, 'kept');

  await page.reload();
  const panel2 = page.locator('[data-testid="annotations-side-panel"]');
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  if (!(await panel2.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await panel2.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  expect(await count(page)).toBe(0);
  await restore(panel2, 'kept');
  await expect.poll(() => count(page)).toBe(atSave);
});

test('renaming a segmentation keeps its checkpoints (#102: the label was in the key)', async ({ page }) => {
  const panel = await segmentation(page);
  await stroke(page, 0.3);
  const atSave = await count(page);
  await saveCheckpoint(page, panel, 'before-rename');

  await panel.locator('[data-testid^="container-activate-"] span[title]').first().dblclick();
  await panel.getByLabel('Rename container').fill('Renamed liver/tumour');
  await page.keyboard.press('Enter');
  await expect(panel.locator('[data-testid^="container-activate-"] span[title="Renamed liver/tumour"]')).toHaveCount(1);

  await stroke(page, 0.55);
  expect(await count(page)).toBeGreaterThan(atSave);
  await restore(panel, 'before-rename');
  await expect.poll(() => count(page)).toBe(atSave);
});
