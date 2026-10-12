/**
 * Checkpoint files (SegWorks parity D8, #266–267; branch 2 R5b): Settings › File Backup
 * exports a checkpoint of the active Segmentation to a file and imports one back — only
 * from the same series and grid. The native save/open dialogs are stubbed in the main
 * process; everything else (IPC, file on disk, validation, restore) is the real path.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect } from '../../fixtures/electron-app';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';

type Win = {
  __XNAT_E2E__: { clearAllContainers: () => void; memberVoxelCount: (i: number) => number; deleteActiveCheckpoints: () => Promise<number> };
};
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';
const count = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.memberVoxelCount(1));

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

async function stubSave(app: ElectronApplication, filePath: string) {
  await app.evaluate(({ dialog }, p) => {
    (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, filePath);
}
async function stubOpen(app: ElectronApplication, filePath: string) {
  await app.evaluate(({ dialog }, p) => {
    (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

async function segmentationWithCheckpoint(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  await clickTool(panel.locator('[data-testid="context-toolbox"]'), 'Brush');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.deleteActiveCheckpoints());
  const b = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.38, b.y + b.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  await panel.getByRole('button', { name: 'Container menu' }).first().click();
  await panel.getByRole('menuitem', { name: 'Save checkpoint…' }).click();
  await page.getByLabel('Checkpoint name').fill('exp');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  return panel;
}

async function openFileBackup(page: Page): Promise<Locator> {
  await page.getByTitle('Open settings').click();
  await page.getByRole('button', { name: 'File Backup' }).click();
  return page.getByTestId('checkpoint-files');
}

async function closeSettings(page: Page) {
  // The modal's backdrop is the 'Close settings' button; its centre is under the dialog.
  await page.getByRole('button', { name: 'Close settings' }).last().click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('checkpoint-files')).toHaveCount(0);
}

test('export a checkpoint to a file, then import it back and restore it', async ({ page, electronApp }) => {
  const panel = await segmentationWithCheckpoint(page);
  const atSave = await count(page);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt-')), 'exp.wscheckpoint');

  const section = await openFileBackup(page);
  await stubSave(electronApp, file);
  await section.locator('[data-testid^="checkpoint-file-"]', { hasText: 'exp' }).getByRole('button', { name: 'Export…' }).click();
  await expect(section.getByTestId('checkpoint-files-status')).toContainText('Saved to');
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).name).toBe('exp');

  // Gone from the app, then imported back from the file.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.deleteActiveCheckpoints());
  await stubOpen(electronApp, file);
  await section.getByRole('button', { name: 'Import checkpoint file…' }).click();
  await expect(section.getByTestId('checkpoint-files-status')).toContainText('Imported “exp”');
  await closeSettings(page);

  // Change the mask, then restore the imported checkpoint.
  const b = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.62, b.y + b.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => count(page)).toBeGreaterThan(atSave);
  await panel.getByRole('button', { name: 'Container menu' }).first().click();
  await panel.getByRole('menuitem', { name: /Restore checkpoint/ }).click();
  await panel.locator('[data-testid^="checkpoint-"]', { hasText: 'exp' }).getByRole('menuitem').click();
  await expect.poll(() => count(page)).toBe(atSave);
});

test('a checkpoint file from a different series is refused', async ({ page, electronApp }) => {
  await segmentationWithCheckpoint(page);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt-'));
  const good = path.join(dir, 'good.wscheckpoint');
  const section = await openFileBackup(page);
  await stubSave(electronApp, good);
  await section.getByRole('button', { name: 'Export…' }).first().click();
  await expect(section.getByTestId('checkpoint-files-status')).toContainText('Saved to');
  const other = path.join(dir, 'other.wscheckpoint');
  fs.writeFileSync(other, JSON.stringify({ ...JSON.parse(fs.readFileSync(good, 'utf8')), seriesInstanceUID: '1.2.3.999' }));

  await stubOpen(electronApp, other);
  await section.getByRole('button', { name: 'Import checkpoint file…' }).click();
  await expect(section.getByTestId('checkpoint-files-status')).toHaveText('That checkpoint was made from a different series — not imported');
  await closeSettings(page);
});

test('a file that is not a checkpoint is rejected', async ({ page, electronApp }) => {
  await segmentationWithCheckpoint(page);
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt-')), 'bad.wscheckpoint');
  fs.writeFileSync(bad, JSON.stringify({ hello: 'world' }));
  const section = await openFileBackup(page);
  await stubOpen(electronApp, bad);
  await section.getByRole('button', { name: 'Import checkpoint file…' }).click();
  await expect(section.getByTestId('checkpoint-files-status')).toContainText('Not a Workstation checkpoint file');
  await closeSettings(page);
});
