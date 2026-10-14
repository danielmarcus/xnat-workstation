/**
 * The spline slice workflow (SegWorks parity branch 6, F5 — docs/segworks-parity.md §10):
 * Undo & edit (#85), Copy nearby (#86) and Propagate ◀ ▶ with its three tracks (#87–89), on
 * Contour Fill's Spline boundary (Segmentation) and the Structure Spline tool.
 *
 * Each action puts a spline IN HAND — a closed, editable spline on the slice, nothing written
 * yet; ⏎ commits it as one undo step.
 *
 * ct-axial-anatomy: bone core +1000 HU (sphere r 14 mm) in +40 HU tissue, 1 mm pixels; the
 * slice on screen is 1.5 mm off centre (bone disc r ≈ 13.9 mm, ≈ 607 voxels) and its
 * neighbours hold discs of nearly the same size. Every gesture is a real click or key.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';

type Shape = { toolName: string; closed: boolean; handles: number; handlePoints: number[][] };
type Win = {
  __XNAT_E2E__: {
    clearAllContainers: () => void;
    resetContourToolSettings: () => void;
    globalUndoDepth: () => number;
    activeSegmentVoxelCount: () => number;
    getContourShapes: () => Shape[];
    getActiveContourSnapshot: (panelId?: string) => { currentSliceIndex: number | null };
    getPanelFocalPoint: (panelId: string) => [number, number, number] | null;
    worldToPanelPagePoint: (panelId: string, world: [number, number, number]) => { x: number; y: number } | null;
  };
};

const BONE_R = Math.sqrt(14 * 14 - 1.5 * 1.5);
const DISC = Math.PI * BONE_R * BONE_R;
const RING = [0, 45, 90, 135, 180, 225, 270, 315];
const FILL_SPLINE = 'ContourFillSpline';
const STRUCTURE_SPLINE = 'SplineContourSegmentationTool';
const COMMITTED_CONTOUR = 'PlanarFreehandContourSegmentationTool';

test.beforeEach(({ page }) => page.evaluate(() => {
  const h = (window as unknown as Win).__XNAT_E2E__;
  h.clearAllContainers();
  h.resetContourToolSettings();
}));

const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.activeSegmentVoxelCount());
const shapes = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getContourShapes());
const sliceIndex = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveContourSnapshot('panel_0').currentSliceIndex);
const inHand = async (page: Page, toolName: string) => (await shapes(page)).filter((s) => s.toolName === toolName && s.closed);
const toast = (page: Page) => page.locator('[data-testid="viewport-toast"]');

async function at(page: Page, dx: number, dy: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([dx, dy]) => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    const f = h.getPanelFocalPoint('panel_0')!;
    return h.worldToPanelPagePoint('panel_0', [f[0] + dx, f[1] + dy, f[2]])!;
  }, [dx, dy] as const);
}

async function open(page: Page, kind: 'SEG' | 'RTSTRUCT', fixture = 'ct-axial-anatomy'): Promise<Locator> {
  await loadFixture(page, fixture, 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: kind === 'SEG' ? 'New Segmentation (SEG)' : 'New Structure (RTSTRUCT)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  if (kind === 'SEG') {
    await expect(toolbox.getByRole('button', { name: 'Contour Fill', exact: true })).toBeVisible({ timeout: 10_000 });
    await clickTool(toolbox, 'Contour Fill');
    await toolbox.getByRole('group', { name: 'Boundary' }).getByRole('button', { name: 'Spline' }).click();
  } else {
    await expect(toolbox.getByRole('button', { name: 'Spline', exact: true })).toBeVisible({ timeout: 10_000 });
    await clickTool(toolbox, 'Spline');
  }
  return toolbox;
}

/** Click anchors round a circle of radius r (mm), then the first again to close. */
async function clickRing(page: Page, r: number) {
  for (const d of RING) {
    const p = await at(page, r * Math.cos((d * Math.PI) / 180), r * Math.sin((d * Math.PI) / 180));
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
  }
  const first = await at(page, r, 0);
  await page.mouse.click(first.x, first.y);
}

async function fillDisc(page: Page) {
  await clickRing(page, BONE_R);
  await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(DISC * 0.85);
  expect(await voxels(page)).toBeLessThan(DISC * 1.2);
  await expect.poll(async () => (await inHand(page, FILL_SPLINE)).length).toBe(0);
  return voxels(page);
}

async function structureRing(page: Page) {
  await clickRing(page, BONE_R);
  await expect.poll(async () => (await shapes(page)).filter((s) => s.toolName === COMMITTED_CONTOUR).length, { timeout: 5_000 }).toBe(1);
}

/** Step one slice with the keyboard and wait until it is drawn. */
async function stepSlice(page: Page, key: 'ArrowUp' | 'ArrowDown') {
  const from = (await sliceIndex(page)) ?? 0;
  await page.keyboard.press(key);
  await expect.poll(() => sliceIndex(page)).toBe(from + (key === 'ArrowDown' ? 1 : -1));
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

const button = (toolbox: Locator, name: string) => toolbox.getByRole('button', { name, exact: true });

async function chooseTrack(toolbox: Locator, label: string) {
  await toolbox.getByRole('button', { name: /Options/ }).click();
  await toolbox.getByLabel('Propagation track').selectOption({ label });
}

// ─── Undo & edit (#85) ───────────────────────────────────────────────────────

test('Segmentation — Undo & edit takes the fill back and holds the same control points; ⏎ fills again', async ({ page }) => {
  const toolbox = await open(page, 'SEG');
  await clickRing(page, BONE_R);
  // Read the control points while the spline is still closing (it is removed once filled).
  await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(DISC * 0.85);
  const filled = await voxels(page);
  await button(toolbox, 'Undo & edit').click();
  await expect.poll(() => voxels(page)).toBe(0);
  const held = await inHand(page, FILL_SPLINE);
  expect(held).toHaveLength(1);
  expect(held[0].handles).toBe(RING.length);
  // The same points the ring was clicked at.
  const f = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelFocalPoint('panel_0')!);
  for (const [i, d] of RING.entries()) {
    const p = held[0].handlePoints[i];
    expect(Math.hypot(p[0] - (f[0] + BONE_R * Math.cos((d * Math.PI) / 180)), p[1] - (f[1] + BONE_R * Math.sin((d * Math.PI) / 180)))).toBeLessThan(1);
  }
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBe(filled);
  await expect.poll(async () => (await inHand(page, FILL_SPLINE)).length).toBe(0);
});

test('Structure — Undo & edit takes the contour back as the spline it was drawn as; ⏎ commits it again', async ({ page }) => {
  const toolbox = await open(page, 'RTSTRUCT');
  await structureRing(page);
  await button(toolbox, 'Undo & edit').click();
  await expect.poll(async () => (await shapes(page)).filter((s) => s.toolName === COMMITTED_CONTOUR).length).toBe(0);
  const held = await inHand(page, STRUCTURE_SPLINE);
  expect(held).toHaveLength(1);
  expect(held[0].handles).toBe(RING.length);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await shapes(page)).filter((s) => s.toolName === COMMITTED_CONTOUR).length, { timeout: 5_000 }).toBe(1);
  await expect.poll(async () => (await inHand(page, STRUCTURE_SPLINE)).length).toBe(0);
});

test('Structure — moving a point of the held spline is part of its one undo step, not a step of its own', async ({ page }) => {
  const toolbox = await open(page, 'RTSTRUCT');
  await structureRing(page);
  await button(toolbox, 'Undo & edit').click();
  await expect.poll(async () => (await inHand(page, STRUCTURE_SPLINE)).length).toBe(1);
  const depth = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.globalUndoDepth());
  // Drag the point at 0° outward by 4 mm.
  const from = await at(page, BONE_R, 0);
  const to = await at(page, BONE_R + 4, 0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const f = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelFocalPoint('panel_0')!);
  const moved = (await inHand(page, STRUCTURE_SPLINE))[0].handlePoints[0];
  expect(Math.hypot(moved[0] - f[0], moved[1] - f[1])).toBeGreaterThan(BONE_R + 2);
  // Cornerstone's own history (the undo used with no container active) holds nothing for it either.
  expect(await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.globalUndoDepth())).toBe(depth);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await shapes(page)).filter((s) => s.toolName === COMMITTED_CONTOUR).length, { timeout: 5_000 }).toBe(1);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await shapes(page)).length).toBe(0);
  // Nothing else to undo: the drag recorded no step of its own.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  expect(await shapes(page)).toEqual([]);
});

test('Undo & edit is refused once another edit came after the spline — nothing is undone', async ({ page }) => {
  const toolbox = await open(page, 'SEG');
  const first = await fillDisc(page);
  // Another edit on top: a second fill elsewhere, drawn freehand (not a spline commit).
  await toolbox.getByRole('group', { name: 'Boundary' }).getByRole('button', { name: 'Freehand' }).click();
  const pts = [];
  for (let k = 0; k <= 24; k++) pts.push(await at(page, 40 + 5 * Math.cos((2 * Math.PI * k) / 24), 40 + 5 * Math.sin((2 * Math.PI * k) / 24)));
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.up();
  await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(first);
  const both = await voxels(page);
  await toolbox.getByRole('group', { name: 'Boundary' }).getByRole('button', { name: 'Spline' }).click();
  await button(toolbox, 'Undo & edit').click();
  await expect(toast(page)).toContainText(/no longer the newest edit/i);
  await page.waitForTimeout(300);
  expect(await voxels(page)).toBe(both);
  expect(await inHand(page, FILL_SPLINE)).toHaveLength(0);
});

// ─── Copy nearby (#86) ───────────────────────────────────────────────────────

test('Copy nearby holds the spline from the next slice with its own control points — nothing written until ⏎', async ({ page }) => {
  const toolbox = await open(page, 'SEG');
  await clickRing(page, BONE_R);
  await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(DISC * 0.85);
  const one = await voxels(page);
  const f = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelFocalPoint('panel_0')!);
  const ring = RING.map((d) => [f[0] + BONE_R * Math.cos((d * Math.PI) / 180), f[1] + BONE_R * Math.sin((d * Math.PI) / 180)]);
  await stepSlice(page, 'ArrowDown');
  await button(toolbox, 'Copy nearby').click();
  const held = await inHand(page, FILL_SPLINE);
  expect(held).toHaveLength(1);
  expect(held[0].handles).toBe(RING.length);
  held[0].handlePoints.forEach((p, i) => expect(Math.hypot(p[0] - ring[i][0], p[1] - ring[i][1])).toBeLessThan(1));
  expect(await voxels(page)).toBe(one); // a copy writes nothing
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(one + DISC * 0.8);
  expect(await voxels(page)).toBeLessThan(one + DISC * 1.25);
});

test('Copy nearby from a slice filled freehand: its outline becomes an editable spline (6–24 points)', async ({ page }) => {
  const toolbox = await open(page, 'SEG');
  await toolbox.getByRole('group', { name: 'Boundary' }).getByRole('button', { name: 'Freehand' }).click();
  const pts = [];
  for (let k = 0; k <= 48; k++) pts.push(await at(page, BONE_R * Math.cos((2 * Math.PI * k) / 48), BONE_R * Math.sin((2 * Math.PI * k) / 48)));
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.up();
  await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(DISC * 0.85);
  const one = await voxels(page);
  await toolbox.getByRole('group', { name: 'Boundary' }).getByRole('button', { name: 'Spline' }).click();
  await stepSlice(page, 'ArrowUp');
  await button(toolbox, 'Copy nearby').click();
  const held = await inHand(page, FILL_SPLINE);
  expect(held).toHaveLength(1);
  expect(held[0].handles).toBeGreaterThanOrEqual(6);
  expect(held[0].handles).toBeLessThanOrEqual(24);
  expect(await voxels(page)).toBe(one);
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(one + DISC * 0.8);
});

test('Copy nearby with nothing within reach says so and holds nothing', async ({ page }) => {
  const toolbox = await open(page, 'SEG');
  await button(toolbox, 'Copy nearby').click();
  await expect(toast(page)).toContainText(/Nothing to copy/i);
  expect(await inHand(page, FILL_SPLINE)).toHaveLength(0);
});

// ─── Propagate ◀ ▶ (#87–89) ──────────────────────────────────────────────────

/**
 * The tracks, told apart by where the ring starts. On the bone edge (r ≈ 13.9 mm) every track
 * carries the disc to the next slice. From a ring of r 8 mm INSIDE the bone, Deform walks the
 * control points out onto the edge, while Mask would take the whole bone region — three times
 * the area — which propagation's leak guard (area change > 60 %) refuses.
 */
for (const [track, r] of [['Deform spline', 8], ['Mask', BONE_R], ['Mask + snake', BONE_R]] as const) {
  test(`Propagate ▶ (${track}, ring r ${Math.round(r)}): the next slice's spline is on the bone edge, held until ⏎ fills it as one undo step`, async ({ page }) => {
    const toolbox = await open(page, 'SEG');
    await chooseTrack(toolbox, track);
    await clickRing(page, r);
    await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(Math.PI * r * r * 0.8);
    await expect.poll(async () => (await inHand(page, FILL_SPLINE)).length).toBe(0);
    const one = await voxels(page);
    const from = await sliceIndex(page);
    await toolbox.getByRole('button', { name: 'Propagate to the next slice' }).click();
    await expect.poll(() => sliceIndex(page)).not.toBe(from);
    await expect.poll(async () => (await inHand(page, FILL_SPLINE)).length).toBe(1);
    expect(await voxels(page)).toBe(one); // previewed, not written
    await page.keyboard.press('Enter');
    await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(one + DISC * 0.8);
    expect(await voxels(page)).toBeLessThan(one + DISC * 1.25);
    await page.keyboard.press('Control+z');
    await expect.poll(() => voxels(page)).toBe(one);
  });
}

test('Propagate ▶ (Mask) from a ring inside the bone: the leak guard stops it — nothing held, nothing written', async ({ page }) => {
  const toolbox = await open(page, 'SEG');
  await chooseTrack(toolbox, 'Mask');
  await clickRing(page, 8);
  await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(Math.PI * 64 * 0.8);
  const one = await voxels(page);
  await toolbox.getByRole('button', { name: 'Propagate to the next slice' }).click();
  await expect(toast(page)).toContainText(/Propagation stopped/i);
  expect(await inHand(page, FILL_SPLINE)).toHaveLength(0);
  expect(await voxels(page)).toBe(one);
});

test('Propagate on a Structure: the next slice gets its own contour once ⏎ commits the spline in hand', async ({ page }) => {
  const toolbox = await open(page, 'RTSTRUCT');
  await structureRing(page);
  const from = await sliceIndex(page);
  await toolbox.getByRole('button', { name: 'Propagate to the previous slice' }).click();
  await expect.poll(() => sliceIndex(page)).not.toBe(from);
  await expect.poll(async () => (await inHand(page, STRUCTURE_SPLINE)).length).toBe(1);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await shapes(page)).filter((s) => s.toolName === COMMITTED_CONTOUR).length, { timeout: 5_000 }).toBe(2);
});

test('⎋ drops the spline in hand and writes nothing', async ({ page }) => {
  const toolbox = await open(page, 'SEG');
  const one = await fillDisc(page);
  await toolbox.getByRole('button', { name: 'Propagate to the next slice' }).click();
  await expect.poll(async () => (await inHand(page, FILL_SPLINE)).length).toBe(1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await inHand(page, FILL_SPLINE)).length).toBe(0);
  await page.waitForTimeout(300);
  expect(await voxels(page)).toBe(one);
});

test('Propagate on an oblique acquisition: the spline follows the sphere onto the next slice (index space)', async ({ page }) => {
  // ct-oblique: a sphere (r 24 mm, 300 HU in −1000) on a ~30° tilted acquisition plane; the
  // slices either side of the one shown are both 1.5 mm from its centre (r ≈ 23.95 mm).
  const toolbox = await open(page, 'SEG', 'ct-oblique');
  await clickRing(page, Math.sqrt(24 * 24 - 1.5 * 1.5));
  await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(1000);
  const one = await voxels(page);
  await toolbox.getByRole('button', { name: 'Propagate to the next slice' }).click();
  await expect.poll(async () => (await inHand(page, FILL_SPLINE)).length).toBe(1);
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(one + one * 0.85);
  expect(await voxels(page)).toBeLessThan(one + one * 1.15);
});

test('the Slice row and Commit appear only for a spline: Live Wire boundary has neither', async ({ page }) => {
  const toolbox = await open(page, 'SEG');
  await expect(button(toolbox, 'Copy nearby')).toBeVisible();
  await toolbox.getByRole('group', { name: 'Boundary' }).getByRole('button', { name: 'Live Wire' }).click();
  await expect(button(toolbox, 'Copy nearby')).toHaveCount(0);
  await expect(button(toolbox, 'Undo & edit')).toHaveCount(0);
});

test('Copy nearby on a locked segment is refused with the lock warning — nothing held, nothing written', async ({ page }) => {
  // The spline actions are buttons and keys: the draw guard (a pointer-down check) never saw
  // them, and they wrote into locked — approved — segments.
  const toolbox = await open(page, 'SEG');
  await clickRing(page, BONE_R);
  await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(DISC * 0.85);
  const one = await voxels(page);
  await stepSlice(page, 'ArrowDown');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await panel.locator('[data-testid^="member-row-"]').first().getByRole('button', { name: 'Toggle lock' }).click();
  await button(toolbox, 'Copy nearby').click();
  await expect(toast(page)).toContainText('locked');
  expect(await inHand(page, FILL_SPLINE)).toHaveLength(0);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await voxels(page)).toBe(one);
});
