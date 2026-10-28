/**
 * Validation modules (SegWorks parity branch 9, M5 — docs/segworks-parity.md §12): API 1.0 can
 * express (a) a SegWorks add-on, re-authored outside the host's source — the post-op edema
 * segmentation, signed, on a phantom built for it — and (b) a real Workstation operation —
 * Fast GrowCut packaged as a module from the built-in's own solver, whose result equals the
 * built-in's voxel for voxel on the same seeds and box.
 *
 * mr-flair-postop (world = phantom coordinates, 1 mm pixels, 3 mm slices, MR): brain 300 ± 30
 * noise; edema 650 in a sphere r 16 mm at (20, −5, 0) round a dark cavity 60 (r 6 mm, same
 * centre); a dark ventricle (r 8 mm at x −22) outside it.
 * ct-axial-anatomy: +40 HU tissue (r 50 mm) round a +1000 HU bone core (r 14 mm) and a +70 HU
 * lesion (r 8 mm at x +25), in air.
 */
import * as path from 'path';
import { test, expect } from '../../fixtures/electron-app';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { openOperation, pickOperation } from '../../helpers/operations';
import { DIST_MODULES, installDirect, packDirectory, REPO_MODULES, resetModules, trustPublisherDirect } from '../../helpers/modules';

type Win = { __XNAT_E2E__: {
  clearAllContainers: () => void;
  clearSeeds: () => void;
  setSolverMemoryLimits: (limits: { warn: number; block: number } | null) => void;
  activeSegmentVoxelCount: () => number;
  memberSphereDice: (i: number, c: [number, number, number], r: number, inner?: number) => number;
  memberVoxelIndices: (i: number) => number[] | null;
  getPanelFocalPoint: (panelId: string) => [number, number, number] | null;
  worldToPanelPagePoint: (panelId: string, world: [number, number, number]) => { x: number; y: number } | null;
} };

test.beforeEach(({ page }) => page.evaluate(() => {
  const h = (window as unknown as Win).__XNAT_E2E__;
  h.clearSeeds();
  h.setSolverMemoryLimits(null);
}));

const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.activeSegmentVoxelCount());
const dice = (page: Page, member: number, c: [number, number, number], r: number, inner?: number) =>
  page.evaluate(([m, cc, rr, ii]) => (window as unknown as Win).__XNAT_E2E__.memberSphereDice(m, cc, rr, ii), [member, c, r, inner] as const);
const indices = (page: Page, member: number) => page.evaluate((m) => (window as unknown as Win).__XNAT_E2E__.memberVoxelIndices(m), member);

async function at(page: Page, dx: number, dy: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([dx, dy]) => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    const f = h.getPanelFocalPoint('panel_0')!;
    return h.worldToPanelPagePoint('panel_0', [f[0] + dx, f[1] + dy, f[2]])!;
  }, [dx, dy] as const);
}

async function drag(page: Page, pts: Array<[number, number]>, shift = false) {
  const p = [];
  for (const [dx, dy] of pts) p.push(await at(page, dx, dy));
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(p[0].x, p[0].y);
  await page.mouse.down();
  for (const q of p.slice(1)) await page.mouse.move(q.x, q.y, { steps: 6 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

async function setup(electronApp: ElectronApplication, page: Page, packages: string[], fixture: string) {
  await resetModules(electronApp);
  await trustPublisherDirect(electronApp);
  for (const p of packages) expect((await installDirect(electronApp, p)).ok).toBe(true);
  await page.reload();
  await loadFixture(page, fixture, 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox.getByRole('button', { name: 'Brush', exact: true })).toBeVisible({ timeout: 10_000 });
  return { panel, toolbox };
}

async function openModule(panel: Locator, name: string): Promise<Locator> {
  await pickOperation(panel, name);
  const sheet = panel.getByTestId('module-sheet');
  await expect(sheet).toBeVisible();
  return sheet;
}

const EDEMA: [number, number, number] = [20, -5, 0];

test('(a) the post-op edema module, signed and installed from its package, segments the edema and its cavity', async ({ electronApp, page }) => {
  const pkg = packDirectory(path.join(REPO_MODULES, 'examples', 'postop-edema'), 'postop-edema', { sign: true });
  const { panel, toolbox } = await setup(electronApp, page, [pkg], 'mr-flair-postop');
  const rows = panel.locator('[data-testid^="member-row-"]');
  // The ROI limit, drawn tightly round the post-op region (the zone SegWorks had you draw).
  await clickTool(toolbox, 'ROI limit');
  await drag(page, [[EDEMA[0] - 18, EDEMA[1] - 18], [EDEMA[0] + 18, EDEMA[1] + 18]]);
  const sheet = await openModule(panel, 'Post-op edema');
  await expect(sheet.getByTestId('module-tier')).toHaveText('Verified');
  await sheet.getByRole('group', { name: 'Scope' }).getByRole('button', { name: 'Volume' }).click();
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Post-op edema', { timeout: 15_000 });
  await expect(rows).toHaveCount(3); // Segment 1, and the two it created
  await expect(rows.nth(1)).toContainText('Edema');
  await expect(rows.nth(2)).toContainText('Cavity');
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(0);
  await sheet.getByRole('button', { name: /Log \(/ }).click();
  await expect(sheet.getByTestId('module-log')).toContainText(/Anchor slice \d+: edema \d+ px, cavity \d+ px/);
  // Stated bounds: the edema shell (r 6–16 mm) and the cavity (r 6 mm), against the phantom.
  expect(await dice(page, 2, EDEMA, 16, 6), 'edema').toBeGreaterThan(0.9);
  expect(await dice(page, 3, EDEMA, 6), 'cavity').toBeGreaterThan(0.8);
  expect(await dice(page, 1, EDEMA, 16), 'the segment that was active is untouched').toBe(0);
});

test('(b) Fast GrowCut as a module equals the built-in Fast GrowCut, voxel for voxel', async ({ electronApp, page }) => {
  const pkg = packDirectory(path.join(DIST_MODULES, 'fast-growcut'), 'fast-growcut');
  const { panel } = await setup(electronApp, page, [pkg], 'ct-axial-anatomy');

  // The built-in, on the volume. Seeds where the result depends on them: the segment and the
  // Background both in the homogeneous tissue, on different slices — the boundary between them
  // is where the two grow to meet, so a seed moved, widened or put on another slice moves it
  // (seeds in a sharp-edged lesion would give the same mask whatever they were).
  const seeded = await openOperation(panel, 'Seeded segmentation');
  await seeded.getByLabel('Seed brush', { exact: true }).fill('3');
  await seeded.getByRole('group', { name: 'Domain' }).getByRole('button', { name: 'Volume' }).click();
  await seeded.getByRole('button', { name: 'Paint seeds' }).click();
  await drag(page, [[-30, -30], [-15, -32]]);
  const before = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelFocalPoint('panel_0')![2]);
  await page.locator('[data-testid="unified-viewport-element:panel_0"]').hover();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelFocalPoint('panel_0')![2])).not.toBe(before);
  await drag(page, [[-28, 22], [-12, 26]], true);
  await seeded.getByRole('button', { name: 'Paint seeds' }).click();
  await seeded.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Fast GrowCut');
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(0);
  const builtin = (await indices(page, 1))!;
  expect(builtin.length, 'a share of the volume, not all or nothing').toBeGreaterThan(1000);
  await page.keyboard.press('Control+z');
  await expect.poll(() => voxels(page)).toBe(0);

  // The module, on the same seeds and box (the volume).
  const sheet = await openModule(panel, 'Fast GrowCut (module)');
  await sheet.getByRole('group', { name: 'Scope' }).getByRole('button', { name: 'Volume' }).click();
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Fast GrowCut (module)', { timeout: 15_000 });
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(0);
  const module = (await indices(page, 1))!;
  expect(module.length).toBe(builtin.length);
  expect(module).toEqual(builtin);
});
