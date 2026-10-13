/**
 * Snake refine, a Cleanup operation (SegWorks parity branch 6, F6; #200–201 —
 * docs/segworks-parity.md §10): the active segment's boundary moves onto the image edges
 * nearby; other segments keep their pixels unless "Replace shared boundary" is chosen, and
 * then lose only pixels along the shared boundary — never a locked segment's.
 *
 * ct-axial-anatomy: bone core +1000 HU (sphere r 14 mm) in +40 HU tissue, 1 mm pixels; the
 * slice on screen is 1.5 mm off centre, so the bone disc there has r ≈ 13.9 mm (≈ 607 px).
 * Masks are drawn with Contour Fill (freehand) and the operation is driven through the
 * Operations row, its preview and ⏎ — the labelmap voxel counts are the ground truth.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { openOperation } from '../../helpers/operations';

type Win = {
  __XNAT_E2E__: {
    clearAllContainers: () => void;
    activeSegmentVoxelCount: () => number;
    memberVoxelCount: (segmentIndex: number) => number;
    getPanelFocalPoint: (panelId: string) => [number, number, number] | null;
    worldToPanelPagePoint: (panelId: string, world: [number, number, number]) => { x: number; y: number } | null;
  };
};

const BONE_R = Math.sqrt(14 * 14 - 1.5 * 1.5);
const DISC = Math.PI * BONE_R * BONE_R;

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.activeSegmentVoxelCount());
const member = (page: Page, i: number) => page.evaluate((idx) => (window as unknown as Win).__XNAT_E2E__.memberVoxelCount(idx), i);

async function at(page: Page, dx: number, dy: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([dx, dy]) => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    const f = h.getPanelFocalPoint('panel_0')!;
    return h.worldToPanelPagePoint('panel_0', [f[0] + dx, f[1] + dy, f[2]])!;
  }, [dx, dy] as const);
}

async function segmentation(page: Page, fixture = 'ct-axial-anatomy') {
  await loadFixture(page, fixture, 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox.getByRole('button', { name: 'Contour Fill', exact: true })).toBeVisible({ timeout: 10_000 });
  await clickTool(toolbox, 'Contour Fill');
  return { panel, toolbox };
}

/** Fill a disc of radius r (mm) centred (cx, cy) mm from the slice centre, drawn freehand. */
async function fillDisc(page: Page, r: number, cx = 0, cy = 0) {
  const before = await voxels(page);
  const pts = [];
  for (let k = 0; k <= 48; k++) pts.push(await at(page, cx + r * Math.cos((2 * Math.PI * k) / 48), cy + r * Math.sin((2 * Math.PI * k) / 48)));
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.up();
  await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(before + Math.PI * r * r * 0.7);
}

async function snake(panel: Locator, settings: { variant?: string; iterations?: number; neighbours?: string; balloon?: number } = {}) {
  const sheet = await openOperation(panel, 'Cleanup', 'Snake refine');
  if (settings.variant) await sheet.getByLabel('Variant', { exact: true }).selectOption({ label: settings.variant });
  if (settings.iterations) await sheet.getByLabel('Iterations', { exact: true }).fill(String(settings.iterations));
  if (settings.neighbours) await sheet.getByLabel('Neighbours', { exact: true }).selectOption({ label: settings.neighbours });
  if (settings.balloon !== undefined) {
    await sheet.getByRole('button', { name: /Advanced/ }).click();
    await sheet.getByLabel('Balloon force', { exact: true }).fill(String(settings.balloon));
  }
  return sheet;
}

const offBy = (n: number) => Math.abs(n - DISC);

test('Snake refine (Edge): a mask 2 mm loose round the bone is pulled onto its edge — previewed, ⏎, one undo step', async ({ page }) => {
  const { panel } = await segmentation(page);
  await fillDisc(page, BONE_R + 2);
  const loose = await voxels(page);
  const sheet = await snake(panel);
  await sheet.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Snake refine');
  expect(await voxels(page)).toBe(loose); // previewed, not written
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  const refined = await voxels(page);
  expect(offBy(refined), `refined ${refined}, loose ${loose}, disc ${Math.round(DISC)}`).toBeLessThan(offBy(loose) / 2);
  await page.keyboard.press('Control+z');
  await expect.poll(() => voxels(page)).toBe(loose);
});

test('Gradient vector flow reaches the edge from 6 mm out, where the plain Edge snake has nothing to follow', async ({ page }) => {
  const { panel } = await segmentation(page);
  await fillDisc(page, BONE_R + 6);
  const loose = await voxels(page);
  const sheet = await snake(panel, { variant: 'Edge (Kass)' });
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await page.waitForTimeout(800); // Edge may legitimately change nothing from this far out
  const edge = await voxels(page);
  if (edge !== loose) {
    await page.keyboard.press('Control+z');
    await expect.poll(() => voxels(page)).toBe(loose);
  }
  await sheet.getByLabel('Variant', { exact: true }).selectOption({ label: 'Gradient vector flow' });
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => voxels(page)).not.toBe(loose);
  const gvf = await voxels(page);
  expect(offBy(gvf), `gvf ${gvf}, edge ${edge}, disc ${Math.round(DISC)}`).toBeLessThan(offBy(edge) / 2);
});

/**
 * Segment 1: a seed (r 6 mm) in the middle of the bone. Segment 2: a disc (r 5 mm) at +11 mm,
 * touching it — pixel centres fall on the half millimetre, so the seed's last column is at
 * x = 5.5 and the neighbour's first at 6.5. A Balloon snake inflates Segment 1 toward the bone
 * edge, through where Segment 2 sits.
 */
async function seedAndNeighbour(page: Page, panel: Locator, toolbox: Locator) {
  await fillDisc(page, 6);
  await panel.getByRole('button', { name: 'Add member' }).first().click();
  await page.keyboard.press('Escape');
  await clickTool(toolbox, 'Contour Fill');
  await fillDisc(page, 5, 11, 0);
  await panel.locator('[data-testid^="member-row-"]', { hasText: 'Segment 1' }).first().click();
  const seed = await member(page, 1), neighbour = await member(page, 2);
  expect(seed, 'Segment 1 painted').toBeGreaterThan(80);
  expect(neighbour, 'Segment 2 painted').toBeGreaterThan(50);
  return { seed, neighbour };
}

test('by default a neighbour keeps every pixel: Segment 1 grows round it', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page);
  const { seed, neighbour } = await seedAndNeighbour(page, panel, toolbox);
  const sheet = await snake(panel, { variant: 'Balloon', iterations: 60, balloon: 0.5 });
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => member(page, 1)).toBeGreaterThan(seed * 1.5);
  expect(await member(page, 2)).toBe(neighbour);
});

test('Replace shared boundary: the neighbour loses only some pixels along the shared boundary; a locked one loses none', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page);
  const { seed, neighbour } = await seedAndNeighbour(page, panel, toolbox);
  const sheet = await snake(panel, { variant: 'Balloon', iterations: 60, balloon: 0.5, neighbours: 'Replace shared boundary' });
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => member(page, 1)).toBeGreaterThan(seed * 1.5);
  const after = await member(page, 2);
  expect(after, 'some pixels changed hands').toBeLessThan(neighbour);
  expect(after, 'only the shared boundary, not the whole neighbour').toBeGreaterThan(neighbour * 0.5);

  // Undo, lock Segment 2, run again: it keeps every pixel.
  await page.keyboard.press('Control+z');
  await expect.poll(() => member(page, 2)).toBe(neighbour);
  await panel.locator('[data-testid^="member-row-"]', { hasText: 'Segment 2' }).first().getByRole('button', { name: 'Toggle lock' }).click();
  await panel.locator('[data-testid^="member-row-"]', { hasText: 'Segment 1' }).first().click();
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => member(page, 1)).toBeGreaterThan(seed * 1.5);
  expect(await member(page, 2)).toBe(neighbour);
});

test('Snake refine on an oblique acquisition pulls a loose mask onto the sphere (index space)', async ({ page }) => {
  // ct-oblique: a sphere (r 24 mm, 300 HU in −1000) on a ~30° tilted plane; r ≈ 23.95 mm here.
  const { panel } = await segmentation(page, 'ct-oblique');
  const R = Math.sqrt(24 * 24 - 1.5 * 1.5);
  await fillDisc(page, R + 2);
  const loose = await voxels(page);
  const sheet = await snake(panel);
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => voxels(page)).not.toBe(loose);
  const target = Math.PI * R * R;
  expect(Math.abs((await voxels(page)) - target)).toBeLessThan(Math.abs(loose - target) / 2);
});
