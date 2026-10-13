/**
 * Contour refine (SegWorks parity branch 6 — docs/segworks-parity.md §10).
 *
 * F2 — Live Wire with SegWorks' settings, on the Structure Livewire tool: the Advanced
 * cost's weights decide the path, the close tolerance decides when a click closes the
 * contour, commit smoothing densifies the committed contour, and the Structure toolbox
 * keeps one height whatever tool is active.
 *
 * ct-axial-anatomy: bone core +1000 HU (sphere r 14 mm) in +40 HU tissue, 1 mm pixels; the
 * slice on screen is 1.5 mm off centre, so the bone edge there is at r ≈ 13.9 mm. Every
 * gesture is a real click on the canvas.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';

type Win = {
  __XNAT_E2E__: {
    clearAllContainers: () => void;
    resetContourToolSettings: () => void;
    getContourShapes: () => Array<{ toolName: string; polyline: string; closed: boolean }>;
    getPanelFocalPoint: (panelId: string) => [number, number, number] | null;
    worldToPanelPagePoint: (panelId: string, world: [number, number, number]) => { x: number; y: number } | null;
  };
};

const BONE_R = Math.sqrt(14 * 14 - 1.5 * 1.5);
/**
 * Anchors every 45°: each step between anchors is short, so the cheapest path is the near
 * arc. (With anchors 120° apart, Live Wire may take the far way round and the closing
 * segments then retrace it — a zero-area contour the contour union rightly discards.)
 */
const RING = [0, 45, 90, 135, 180, 225, 270, 315];
/** Four anchors: with nothing to follow, the path cuts the 90° chords (sagitta 4 mm). */
const SQUARE = [0, 90, 180, 270];
const STRUCTURE_TOOLS = ['Freehand', 'Spline', 'Livewire', 'Sculptor', 'Select'];

test.beforeEach(({ page }) => page.evaluate(() => {
  const h = (window as unknown as Win).__XNAT_E2E__;
  h.clearAllContainers();
  h.resetContourToolSettings();
}));

/** Page point of (dx, dy) mm from the centre of the slice on screen. */
async function at(page: Page, dx: number, dy: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([dx, dy]) => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    const f = h.getPanelFocalPoint('panel_0')!;
    return h.worldToPanelPagePoint('panel_0', [f[0] + dx, f[1] + dy, f[2]])!;
  }, [dx, dy] as const);
}

async function structure(page: Page) {
  await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox.getByRole('button', { name: 'Livewire', exact: true })).toBeVisible({ timeout: 10_000 });
  await clickTool(toolbox, 'Livewire');
  return { panel, toolbox };
}

/** Anchors on the bone edge at the given angles (degrees). */
async function anchorsOnBone(page: Page, degrees: number[]) {
  for (const d of degrees) {
    const p = await at(page, BONE_R * Math.cos((d * Math.PI) / 180), BONE_R * Math.sin((d * Math.PI) / 180));
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
  }
}

/** Close by clicking `offsetPx` screen pixels (outward, along x) from the first anchor at 0°. */
async function clickNearFirst(page: Page, offsetPx: number) {
  const p = await at(page, BONE_R, 0);
  await page.mouse.click(p.x + offsetPx, p.y);
  await page.waitForTimeout(250);
}

async function shapes(page: Page) {
  const f = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelFocalPoint('panel_0')!);
  const all = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getContourShapes());
  return all.map((s) => {
    const pts = JSON.parse(s.polyline) as number[][];
    const radii = pts.map((p) => Math.hypot(p[0] - f[0], p[1] - f[1]));
    return { ...s, points: pts.length, meanEdgeError: radii.reduce((a, r) => a + Math.abs(r - BONE_R), 0) / Math.max(1, radii.length) };
  });
}

/**
 * The committed contour. A closed contour-segmentation stroke goes through Cornerstone's
 * contour union, which recreates it as a PlanarFreehandContourSegmentationTool
 * annotation (see tools/sculptor-closed-spline) — its appearance is the proof the drawing
 * closed and was committed.
 */
async function committed(page: Page) {
  await expect.poll(async () => (await shapes(page)).filter((s) => s.toolName === 'PlanarFreehandContourSegmentationTool').length, { timeout: 5_000 }).toBeGreaterThan(0);
  return (await shapes(page)).filter((s) => s.toolName === 'PlanarFreehandContourSegmentationTool')[0];
}

/** Still drawing: the Live Wire annotation is open and nothing has been committed. */
async function stillDrawing(page: Page) {
  await page.waitForTimeout(500);
  const all = await shapes(page);
  return all.some((s) => s.toolName === 'LivewireContourSegmentationTool' && !s.closed)
    && !all.some((s) => s.toolName === 'PlanarFreehandContourSegmentationTool');
}

test('Advanced Live Wire: its weights decide the path — full edge weight hugs the bone edge, no weights cut across', async ({ page }) => {
  const { toolbox } = await structure(page);
  await toolbox.getByRole('group', { name: 'Edge cost' }).getByRole('button', { name: 'Advanced' }).click();
  await toolbox.getByLabel('Edge weight').fill('1');
  await anchorsOnBone(page, SQUARE);
  await clickNearFirst(page, 2);
  const edge = await committed(page);
  expect(edge.meanEdgeError, 'edge-weighted path follows the bone edge').toBeLessThan(1);

  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
  await structure(page);
  await toolbox.getByRole('group', { name: 'Edge cost' }).getByRole('button', { name: 'Advanced' }).click();
  await toolbox.getByLabel('Edge weight').fill('0');
  await toolbox.getByRole('button', { name: /Weights/ }).click();
  await toolbox.getByLabel('Direction').fill('0');
  await toolbox.getByLabel('Laplacian').fill('0');
  await anchorsOnBone(page, SQUARE);
  await clickNearFirst(page, 2);
  const blind = await committed(page);
  expect(blind.meanEdgeError, 'with nothing to follow, the path cuts across').toBeGreaterThan(2);
});

test('close tolerance: a wider tolerance closes from further away; a narrower one keeps drawing where Cornerstone would close', async ({ page }) => {
  const { toolbox } = await structure(page);
  // Default (10 px): a click 20 px from the first anchor is another anchor, not a close.
  await anchorsOnBone(page, RING);
  await clickNearFirst(page, 20);
  expect(await stillDrawing(page)).toBe(true);
  await clickNearFirst(page, 0); // finish it, so no drawing is left in progress
  await committed(page);

  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
  await structure(page);
  await toolbox.getByLabel('Close within').fill('30');
  await anchorsOnBone(page, RING);
  await clickNearFirst(page, 20);
  await committed(page);

  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
  await structure(page);
  await toolbox.getByLabel('Close within').fill('3');
  await anchorsOnBone(page, RING);
  await clickNearFirst(page, 6); // inside Cornerstone's own 10 px
  expect(await stillDrawing(page)).toBe(true);
  // The tolerance is read at each click: widen it and close, so no drawing is left open.
  await toolbox.getByLabel('Close within').fill('30');
  await clickNearFirst(page, 12);
  await committed(page);
});

test('commit smoothing: the closed contour is committed denser and rounder', async ({ page }) => {
  await structure(page);
  await anchorsOnBone(page, RING);
  await clickNearFirst(page, 2);
  const plain = await committed(page);

  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
  const { toolbox } = await structure(page);
  await toolbox.getByRole('group', { name: 'Smooth commit' }).getByRole('button', { name: '2' }).click();
  await anchorsOnBone(page, RING);
  await clickNearFirst(page, 2);
  const smooth = await committed(page);
  expect(smooth.points).toBeGreaterThan(plain.points * 2);
});

test('the Structure toolbox keeps one height whatever tool is active, and no tool\'s controls scroll', async ({ page }) => {
  const { toolbox } = await structure(page);
  const heights: Record<string, number> = {};
  const overflow: Record<string, number | null> = {};
  const measure = async (key: string) => {
    await page.waitForTimeout(80);
    heights[key] = Math.round((await toolbox.boundingBox())!.height);
    overflow[key] = await toolbox.evaluate((el) => {
      const c = el.querySelector('[data-testid="toolbox-controls"]');
      return c ? c.scrollHeight - c.clientHeight : null;
    });
  };
  for (const label of STRUCTURE_TOOLS) {
    await clickTool(toolbox, label);
    await measure(label);
  }
  await clickTool(toolbox, 'Livewire');
  await toolbox.getByRole('group', { name: 'Edge cost' }).getByRole('button', { name: 'Advanced' }).click();
  await measure('Livewire (Advanced)');
  expect(new Set(Object.values(heights)).size, JSON.stringify(heights)).toBe(1);
  for (const k of Object.keys(overflow)) expect(overflow[k], `${k} controls overflow`).toBe(0);
});
