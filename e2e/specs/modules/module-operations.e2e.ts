/**
 * Modules as operations (SegWorks parity branch 9, M4 — docs/segworks-parity.md §12): an enabled
 * module is an operation in the Operations picker's Modules group, built like the built-in ones
 * (one registry): parameters from its manifest, scope, estimate, Run → preview → ⏎, Cancel, its
 * log. The example module (modules/examples/threshold, packed from the repo) and fixture modules
 * run in the real sandbox.
 *
 * ct-axial-anatomy (world = phantom coordinates): bone core +1000 HU (sphere r 14 mm) in +40 HU
 * tissue, 1 mm pixels, 3 mm slices — the slice on screen holds a bone disc of ≈ 607 voxels.
 */
import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../../fixtures/electron-app';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { setSlider } from '../../helpers/operations';
import { buildPackage, FIXTURE_DIR, installDirect, manifest, packDirectory, REPO_MODULES, resetModules } from '../../helpers/modules';

type Win = { __XNAT_E2E__: {
  clearAllContainers: () => void;
  activeSegmentVoxelCount: () => number;
  memberVoxelCount: (i: number) => number;
  memberSphereDice: (i: number, c: [number, number, number], r: number) => number;
  getPanelFocalPoint: (panelId: string) => [number, number, number] | null;
  worldToPanelPagePoint: (panelId: string, world: [number, number, number]) => { x: number; y: number } | null;
} };

const THRESHOLD = 'Intensity threshold';
const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.activeSegmentVoxelCount());
const member = (page: Page, i: number) => page.evaluate((idx) => (window as unknown as Win).__XNAT_E2E__.memberVoxelCount(idx), i);
const DISC = Math.PI * (14 * 14 - 1.5 * 1.5);

async function setup(electronApp: ElectronApplication, page: Page, packages: string[], fixture = 'ct-axial-anatomy') {
  await resetModules(electronApp);
  for (const p of packages) expect((await installDirect(electronApp, p)).ok).toBe(true);
  await page.reload(); // the Operations picker reads the installed modules
  await loadFixture(page, fixture, 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  return panel;
}

async function openModule(panel: Locator, name: string): Promise<Locator> {
  await panel.getByLabel('Operation', { exact: true }).selectOption({ label: name });
  const sheet = panel.getByTestId('module-sheet');
  await expect(sheet).toBeVisible();
  return sheet;
}

const threshold = () => packDirectory(path.join(REPO_MODULES, 'examples', 'threshold'), 'threshold');

test('an installed module is an operation in the picker\'s Modules group, its parameters from its manifest', async ({ electronApp, page }) => {
  const panel = await setup(electronApp, page, [threshold()]);
  const picker = panel.getByLabel('Operation', { exact: true });
  await expect(picker.locator('optgroup[label="Modules"] option')).toHaveText([THRESHOLD]);
  await expect(picker.locator(':scope > option')).toContainText(['Cleanup', 'Propagate', 'Interpolate']); // the built-ins, first
  const sheet = await openModule(panel, THRESHOLD);
  await expect(sheet.getByTestId('module-tier')).toHaveText('Community');
  await expect(sheet.getByLabel('From', { exact: true })).toHaveValue('200');
  await expect(sheet.getByLabel('To', { exact: true })).toHaveValue('3000');
  await expect(sheet.getByRole('group', { name: 'Scope' }).getByRole('button')).toHaveText(['Slice', 'Range', 'Volume', 'ROI limit']);
  await sheet.getByRole('button', { name: /^. More/ }).click();
  await expect(sheet.getByLabel('Keep the largest island on each slice')).not.toBeChecked();
  await expect(sheet.getByTestId('module-estimate')).toContainText(/voxels · est\./);
});

test('Run previews the module\'s mask; ⏎ commits it as one undo step', async ({ electronApp, page }) => {
  const panel = await setup(electronApp, page, [threshold()]);
  const sheet = await openModule(panel, THRESHOLD);
  await setSlider(sheet.getByLabel('From', { exact: true }), 500);
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText(THRESHOLD);
  expect(await voxels(page), 'previewed, not written').toBe(0);
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(DISC * 0.9);
  expect(await voxels(page)).toBeLessThan(DISC * 1.1); // the slice on screen: the bone disc only
  await page.keyboard.press('Control+z');
  await expect.poll(() => voxels(page)).toBe(0);
});

test('a locked segment previews read-only and is not written', async ({ electronApp, page }) => {
  const panel = await setup(electronApp, page, [threshold()]);
  await panel.locator('[data-testid^="member-row-"]').first().getByRole('button', { name: 'Toggle lock' }).click();
  const sheet = await openModule(panel, THRESHOLD);
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText(THRESHOLD);
  await expect(sheet.getByTestId('sheet-message')).toContainText(/locked/);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await voxels(page)).toBe(0);
});

test('Cancel run stops the module and leaves nothing', async ({ electronApp, page }) => {
  const slow = buildPackage('slow', manifest('org.e2e.slow', { name: 'Slow module' }), `
    export async function run(input, api) {
      for (let i = 0; i < 40 && !api.cancelled(); i++) { await new Promise((r) => setTimeout(r, 50)); api.progress(i / 40); }
      return { mask: new Uint8Array(input.image.length).fill(1) };
    }`);
  const panel = await setup(electronApp, page, [slow]);
  const sheet = await openModule(panel, 'Slow module');
  await sheet.getByRole('button', { name: 'Run' }).click();
  await sheet.getByRole('button', { name: 'Cancel run' }).click();
  await expect(sheet.getByRole('button', { name: 'Cancel run' })).toHaveCount(0, { timeout: 1_000 });
  await page.waitForTimeout(3_000); // past when it would have finished (≈ 2 s) had it not been stopped
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  expect(await voxels(page)).toBe(0);
});

test('the log shows what the module said; Copy and Download carry it', async ({ electronApp, page }) => {
  const panel = await setup(electronApp, page, [threshold()]);
  const sheet = await openModule(panel, THRESHOLD);
  await setSlider(sheet.getByLabel('From', { exact: true }), 500);
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText(THRESHOLD);
  await sheet.getByRole('button', { name: /Log \(/ }).click();
  await expect(sheet.getByTestId('module-log')).toContainText('Window 500 to 3000');
  await electronApp.evaluate(({ clipboard }) => clipboard.writeText(''));
  await sheet.getByRole('button', { name: 'Copy' }).click();
  await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain('Window 500 to 3000');
  const out = path.join(FIXTURE_DIR, 'saved.log.txt');
  await electronApp.evaluate(({ dialog }, p) => {
    (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, out);
  await sheet.getByRole('button', { name: 'Download' }).click();
  await expect.poll(() => (fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '')).toContain('Window 500 to 3000');
});

test('a module that writes a new segment creates it, with its name and colour; Discard takes it away again', async ({ electronApp, page }) => {
  const edema = buildPackage('edema', manifest('org.e2e.edema', {
    name: 'Edema finder', writes: { target: 'new', mode: 'add', newMembers: [{ name: 'Edema', color: [255, 200, 0] }] },
  }), `export function run(input) { const m = new Uint8Array(input.image.length); for (let i = 0; i < m.length; i++) if (input.image[i] > 500) m[i] = 1; return { mask: m }; }`);
  const panel = await setup(electronApp, page, [edema]);
  const rows = panel.locator('[data-testid^="member-row-"]');
  await expect(rows).toHaveCount(1);
  const sheet = await openModule(panel, 'Edema finder');
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Edema finder');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Edema');
  await expect(rows.nth(1).locator('[data-testid^="color-swatch-"]')).toHaveCSS('background-color', 'rgb(255, 200, 0)');
  await sheet.getByRole('button', { name: 'Discard' }).click();
  await expect(rows).toHaveCount(1);
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Edema finder');
  await page.keyboard.press('Enter');
  await expect(rows.nth(1)).toContainText('Edema');
  await expect.poll(() => voxels(page), 'the new segment (active) holds the mask').toBeGreaterThan(DISC * 0.9);
  expect(await member(page, 1), 'the segment that was active is untouched').toBe(0);
});

test('undoing a module\'s commit takes away the segments it created; redo brings them back with their voxels (#103)', async ({ electronApp, page }) => {
  const edema = buildPackage('edema-undo', manifest('org.e2e.edema-undo', {
    name: 'Edema finder', writes: { target: 'new', mode: 'add', newMembers: [{ name: 'Edema', color: [255, 200, 0] }] },
  }), `export function run(input) { const m = new Uint8Array(input.image.length); for (let i = 0; i < m.length; i++) if (input.image[i] > 500) m[i] = 1; return { mask: m }; }`);
  const panel = await setup(electronApp, page, [edema]);
  const rows = panel.locator('[data-testid^="member-row-"]');
  await expect(rows).toHaveCount(1);
  const sheet = await openModule(panel, 'Edema finder');
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Edema finder');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  await expect(rows).toHaveCount(2);
  await expect.poll(() => voxels(page)).toBeGreaterThan(DISC * 0.9);
  const written = await voxels(page);

  await page.keyboard.press('Control+z');
  await expect(rows, 'the created segment is gone with its voxels').toHaveCount(1);
  await expect(rows.first()).not.toContainText('Edema');
  expect(await member(page, 1), 'the segment that was active is untouched').toBe(0);

  await page.keyboard.press('Control+Shift+z');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('Edema');
  await expect(rows.nth(1).locator('[data-testid^="color-swatch-"]')).toHaveCSS('background-color', 'rgb(255, 200, 0)');
  await expect.poll(() => voxels(page), 'redone: the segment (active) holds the mask again').toBe(written);

  await page.keyboard.press('Control+z');
  await expect(rows, 'and undone again').toHaveCount(1);
});

test('a mask holding a label the module did not declare is refused, with the reason', async ({ electronApp, page }) => {
  const bad = buildPackage('labels', manifest('org.e2e.labels', {
    name: 'Label overflow', writes: { target: 'new', mode: 'add', newMembers: [{ name: 'A', color: [255, 0, 0] }, { name: 'B', color: [0, 0, 255] }] },
  }), `export function run(input) { const m = new Uint8Array(input.image.length); m[0] = 1; m[1] = 2; m[2] = 3; return { mask: m }; }`);
  const panel = await setup(electronApp, page, [bad]);
  const sheet = await openModule(panel, 'Label overflow');
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(sheet.getByTestId('sheet-message')).toContainText('holds the value 3 — expected 0–2');
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  await expect(panel.locator('[data-testid^="member-row-"]')).toHaveCount(1);
});

test('a module disabled in Settings leaves the picker', async ({ electronApp, page }) => {
  const panel = await setup(electronApp, page, [threshold()]);
  await expect(panel.getByLabel('Operation', { exact: true }).locator('optgroup[label="Modules"] option')).toHaveText([THRESHOLD]);
  await page.getByTitle('Open settings').click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Modules', exact: true }).click();
  await dialog.getByLabel(`Enable ${THRESHOLD}`).uncheck();
  await dialog.getByTitle('Close', { exact: true }).click();
  await expect(panel.getByLabel('Operation', { exact: true }).locator('optgroup[label="Modules"]')).toHaveCount(0);
});

test('on an oblique acquisition the module segments the sphere through the volume (index space)', async ({ electronApp, page }) => {
  // ct-oblique: a sphere (r 24 mm, 300 HU in −1000) on a ~30° tilted plane, centred at the origin.
  const panel = await setup(electronApp, page, [threshold()], 'ct-oblique');
  const sheet = await openModule(panel, THRESHOLD);
  await setSlider(sheet.getByLabel('From', { exact: true }), 100);
  await setSlider(sheet.getByLabel('To', { exact: true }), 500);
  await sheet.getByRole('group', { name: 'Scope' }).getByRole('button', { name: 'Volume' }).click();
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText(THRESHOLD);
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.memberSphereDice(1, [0, 0, 0], 24))).toBeGreaterThan(0.95);
});
