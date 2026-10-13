/**
 * Seeded segmentation (SegWorks parity branch 5 — docs/segworks-parity.md §11): paint seeds of
 * the segment and of the Background in the operation's seed mode, Run, preview, ⏎.
 *
 * ct-axial-anatomy (world = phantom coordinates): a lesion of +70 HU (sphere r 8 mm at
 * x = +25) in +40 HU tissue, a bone core of +1000 HU (r 14 at the origin), 3 mm slices — the
 * one on screen is 1.5 mm off centre. Every gesture is a real drag or click; the ground truth
 * is the labelmap, scored against the known sphere (Dice).
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { openOperation } from '../../helpers/operations';

type Win = {
  __XNAT_E2E__: {
    clearAllContainers: () => void;
    clearSeeds: () => void;
    activeSegmentVoxelCount: () => number;
    memberSphereDice: (segmentIndex: number, center: [number, number, number], radius: number) => number;
    setSolverMemoryLimits: (limits: { warn: number; block: number } | null) => void;
    setComputeThrottle: (ms: number) => void;
    getPanelFocalPoint: (panelId: string) => [number, number, number] | null;
    worldToPanelPagePoint: (panelId: string, world: [number, number, number]) => { x: number; y: number } | null;
  };
};

const LESION: [number, number, number] = [25, 0, 0];

test.beforeEach(({ page }) => page.evaluate(() => {
  const h = (window as unknown as Win).__XNAT_E2E__;
  h.clearAllContainers();
  h.clearSeeds();
  h.setSolverMemoryLimits(null);
  h.setComputeThrottle(0);
}));

const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.activeSegmentVoxelCount());
const dice = (page: Page, center: [number, number, number], r: number, member = 1) =>
  page.evaluate(([m, c, rr]) => (window as unknown as Win).__XNAT_E2E__.memberSphereDice(m, c, rr), [member, center, r] as const);

async function at(page: Page, dx: number, dy: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([dx, dy]) => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    const f = h.getPanelFocalPoint('panel_0')!;
    return h.worldToPanelPagePoint('panel_0', [f[0] + dx, f[1] + dy, f[2]])!;
  }, [dx, dy] as const);
}

async function drag(page: Page, path: Array<[number, number]>, shift = false) {
  const pts = [];
  for (const [dx, dy] of path) pts.push(await at(page, dx, dy));
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

const ring = (cx: number, cy: number, r: number, n = 16): Array<[number, number]> =>
  Array.from({ length: n + 1 }, (_, k) => [cx + r * Math.cos((2 * Math.PI * k) / n), cy + r * Math.sin((2 * Math.PI * k) / n)]);

async function open(page: Page, fixture = 'ct-axial-anatomy') {
  await loadFixture(page, fixture, 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox.getByRole('button', { name: 'Brush', exact: true })).toBeVisible({ timeout: 10_000 });
  const sheet = await openOperation(panel, 'Seeded segmentation');
  return { panel, toolbox, sheet };
}

/** Step one slice with the keyboard and wait until the viewport is on it. */
async function stepSlice(page: Page, key: 'ArrowUp' | 'ArrowDown') {
  const before = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelFocalPoint('panel_0')![2]);
  await page.locator('[data-testid="unified-viewport-element:panel_0"]').hover();
  await page.keyboard.press(key);
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelFocalPoint('panel_0')![2])).not.toBe(before);
}

/**
 * The default brush (SegWorks' 8 px radius) is sized for 512-pixel scans; on the phantom's
 * 1 mm pixels it would paint a 17 mm wide stroke, wider than the lesion. A 2 px brush.
 */
async function fineBrush(sheet: Locator) {
  await sheet.getByLabel('Seed brush', { exact: true }).fill('2');
}

/** Lesion seeds on two slices: a stroke inside it, a ⇧ ring of Background round it. */
async function seedLesion(page: Page, sheet: Locator) {
  await fineBrush(sheet);
  await sheet.getByRole('button', { name: 'Paint seeds' }).click();
  for (const key of [null, 'ArrowDown'] as const) {
    if (key) await stepSlice(page, key);
    await drag(page, [[22, 0], [28, 0]]);
    await drag(page, ring(25, 0, 12), true);
  }
  await expect(sheet.getByTestId('seed-count-1')).toHaveText('2');
  await expect(sheet.getByTestId('seed-count-0')).toHaveText('2');
}

test('Fast GrowCut: seeds on two slices segment the 3D lesion — previewed, ⏎, one undo step', async ({ page }) => {
  const { sheet } = await open(page);
  await seedLesion(page, sheet);
  expect(await voxels(page), 'seeds paint nothing').toBe(0);
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Fast GrowCut');
  expect(await voxels(page), 'previewed, not written').toBe(0);
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(0);
  expect(await dice(page, LESION, 8)).toBeGreaterThan(0.85);
  await page.keyboard.press('Control+z');
  await expect.poll(() => voxels(page)).toBe(0);
});

test('Cancel run leaves nothing; Restore seeds brings back the seeds of the last run', async ({ page }) => {
  const { sheet } = await open(page);
  await seedLesion(page, sheet);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setComputeThrottle(60));
  await sheet.getByRole('button', { name: 'Run' }).click();
  await sheet.getByRole('button', { name: 'Cancel run' }).click();
  await expect(sheet.getByRole('button', { name: 'Run' })).toBeVisible();
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  expect(await voxels(page)).toBe(0);
  await sheet.getByRole('button', { name: 'Clear seeds' }).click();
  await expect(sheet.getByTestId('seed-count-1')).toHaveText('0');
  await sheet.getByRole('button', { name: '↺ Restore seeds' }).click();
  await expect(sheet.getByTestId('seed-count-1')).toHaveText('2');
  await expect(sheet.getByTestId('seed-count-0')).toHaveText('2');
});

test('the seed painter is a pointer mode: it clears the toolbox highlight, and picking a tool ends it', async ({ page }) => {
  const { sheet, toolbox } = await open(page);
  await clickTool(toolbox, 'Brush');
  await sheet.getByRole('button', { name: 'Paint seeds' }).click();
  await expect(sheet.getByRole('button', { name: 'Paint seeds' })).toHaveAttribute('aria-pressed', 'true');
  await expect(toolbox.getByRole('button', { name: 'Brush', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await drag(page, [[-30, -30], [-25, -30]]);
  expect(await voxels(page), 'a seed is not a brush stroke').toBe(0);
  await clickTool(toolbox, 'Brush');
  await expect(sheet.getByRole('button', { name: 'Paint seeds' })).toHaveAttribute('aria-pressed', 'false');
});

test('Erase removes the seed under the brush', async ({ page }) => {
  const { sheet } = await open(page);
  await sheet.getByRole('button', { name: 'Paint seeds' }).click();
  await drag(page, [[22, 0], [28, 0]]);
  await expect(sheet.getByTestId('seed-count-1')).toHaveText('1');
  await sheet.getByRole('group', { name: 'Seed class' }).getByRole('button', { name: 'Erase' }).click();
  await drag(page, [[20, 0], [30, 0]]);
  await expect(sheet.getByTestId('seed-count-1')).toHaveText('0');
});

test('memory guard: an estimate line, then amber, then Run disabled with the reason — never a dialog', async ({ page }) => {
  const { sheet } = await open(page);
  await seedLesion(page, sheet);
  const line = sheet.getByTestId('seeded-estimate');
  await expect(line).toHaveAttribute('data-level', 'ok');
  await expect(line).toContainText(/voxels · est\. \d+ MB/);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setSolverMemoryLimits({ warn: 1, block: 1e12 }));
  await sheet.getByRole('group', { name: 'Domain' }).getByRole('button', { name: 'Volume' }).click();
  await expect(line).toHaveAttribute('data-level', 'warn');
  await expect(sheet.getByRole('button', { name: 'Run' })).toBeEnabled();
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setSolverMemoryLimits({ warn: 1, block: 2 }));
  await sheet.getByRole('group', { name: 'Domain' }).getByRole('button', { name: 'Around seeds' }).click();
  await expect(line).toHaveAttribute('data-level', 'block');
  await expect(line).toContainText(/narrow the domain/);
  await expect(sheet.getByRole('button', { name: 'Run' })).toBeDisabled();
});

test('Fast GrowCut on an oblique acquisition segments the sphere (index space)', async ({ page }) => {
  // ct-oblique: a sphere (r 24 mm, 300 HU in −1000) on a ~30° tilted plane, centred at the origin.
  const { sheet } = await open(page, 'ct-oblique');
  await fineBrush(sheet);
  await sheet.getByRole('button', { name: 'Paint seeds' }).click();
  for (const key of [null, 'ArrowDown'] as const) {
    if (key) await stepSlice(page, key);
    await drag(page, [[-5, 0], [5, 0]]);
    await drag(page, ring(0, 0, 32), true);
  }
  // The sphere fills nearly the whole stack: solve the volume, not just the seeded slices ± 2.
  await sheet.getByRole('group', { name: 'Domain' }).getByRole('button', { name: 'Volume' }).click();
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Fast GrowCut');
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(0);
  expect(await dice(page, [0, 0, 0], 24)).toBeGreaterThan(0.85);
});
