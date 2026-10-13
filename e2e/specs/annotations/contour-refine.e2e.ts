/**
 * Contour refine (SegWorks parity branch 6 — docs/segworks-parity.md §10).
 *
 * F2 — Live Wire with SegWorks' settings, on the Structure Livewire tool: the Advanced
 * cost's weights decide the path, the close tolerance decides when a click closes the
 * contour, commit smoothing densifies the committed contour, and the Structure toolbox
 * keeps one height whatever tool is active.
 *
 * F3 — Spline families and editing, on the Structure Spline tool: the family decides the
 * curve through the same points, Undo point / Clear act on the spline being drawn, the
 * no-crossing guard refuses a crossing point, Local ROI editing keeps points inside the ROI
 * limit, Fit ROI zooms to it, and the ROI active spline pulls the curve onto the edge.
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
    getContourShapes: () => Array<{ toolName: string; polyline: string; closed: boolean; handles: number }>;
    getPanelParallelScale: (panelId: string) => number | null;
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

async function structure(page: Page, tool = 'Livewire') {
  await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox.getByRole('button', { name: tool, exact: true })).toBeVisible({ timeout: 10_000 });
  await clickTool(toolbox, tool);
  return { panel, toolbox };
}

/** Anchors on a circle of radius `r` (default: the bone edge) at the given angles (degrees). */
async function anchorsOnBone(page: Page, degrees: number[], r = BONE_R) {
  for (const d of degrees) {
    const p = await at(page, r * Math.cos((d * Math.PI) / 180), r * Math.sin((d * Math.PI) / 180));
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
  }
}

/** Close by clicking `offsetPx` screen pixels (outward, along x) from the first anchor at 0°. */
async function clickNearFirst(page: Page, offsetPx: number, r = BONE_R) {
  const p = await at(page, r, 0);
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

// ─── F3 — Spline ─────────────────────────────────────────────────────────────

const meanRadius = (polyline: string, f: number[]) => {
  const pts = JSON.parse(polyline) as number[][];
  return pts.reduce((a, p) => a + Math.hypot(p[0] - f[0], p[1] - f[1]), 0) / pts.length;
};
const focal = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelFocalPoint('panel_0')!);
const splineHandles = async (page: Page) =>
  (await shapes(page)).filter((s) => s.toolName === 'SplineContourSegmentationTool').map((s) => s.handles);
/**
 * Control points once the clicks have landed. Cornerstone holds a canvas mousedown back for
 * a moment to see whether a double-click follows, so a reading right after a click lags by
 * one; a test that a click was REFUSED must wait for that, then read the final state (a poll
 * could pass on the in-between count).
 */
const settledHandles = async (page: Page) => {
  await page.waitForTimeout(800);
  return splineHandles(page);
};

async function drawClosedSpline(page: Page, algorithm: string, r = BONE_R) {
  const { toolbox } = await structure(page, 'Spline');
  await toolbox.getByLabel('Spline algorithm').selectOption(algorithm);
  await anchorsOnBone(page, RING, r);
  await clickNearFirst(page, 0, r);
  return committed(page);
}

test('spline families: a cubic B-spline through the same points commits inside the Catmull-Rom curve', async ({ page }) => {
  const f = await (async () => { await structure(page, 'Spline'); return focal(page); })();
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
  const cr = meanRadius((await drawClosedSpline(page, 'centripetalCR')).polyline, f);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
  const bs = meanRadius((await drawClosedSpline(page, 'cubicBSpline')).polyline, f);
  // B-spline approximates: it stays inside the polygon of its points; Catmull-Rom passes through them.
  expect(bs).toBeLessThan(cr - 0.3);
});

test('Undo point removes the last point of the spline being drawn; Clear discards it', async ({ page }) => {
  const { toolbox } = await structure(page, 'Spline');
  await anchorsOnBone(page, [0, 45, 90]);
  await expect.poll(() => splineHandles(page)).toEqual([3]);
  await toolbox.getByRole('button', { name: 'Undo point' }).click();
  await expect.poll(() => splineHandles(page)).toEqual([2]);
  await toolbox.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect.poll(() => splineHandles(page)).toEqual([]);
});

test('the no-crossing guard refuses a point that makes the curve cross itself', async ({ page }) => {
  const bowTie: Array<[number, number]> = [[-10, -10], [10, 10], [10, -10], [-10, 10]];
  const place = async () => {
    for (const [x, y] of bowTie) {
      const p = await at(page, x, y);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(120);
    }
  };
  const { toolbox } = await structure(page, 'Spline');
  await place();
  expect(await settledHandles(page)).toEqual([4]); // off: accepted
  await toolbox.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect.poll(() => splineHandles(page)).toEqual([]);

  await toolbox.getByRole('button', { name: /Options/ }).click();
  await toolbox.getByLabel('Prevent self-intersection').check();
  await place();
  expect(await settledHandles(page)).toEqual([3]); // on: the crossing point is refused
  await toolbox.getByRole('button', { name: 'Clear', exact: true }).click();
});

/** An ROI limit drawn with the Segmentation toolbox's ROI limit tool, then a Structure. */
async function structureWithRoi(page: Page, roi: [[number, number], [number, number]]) {
  await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await clickTool(toolbox, 'ROI limit');
  const a = await at(page, roi[0][0], roi[0][1]), b = await at(page, roi[1][0], roi[1][1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect(toolbox.getByTestId('roi-limit-controls')).toContainText('Drawn');
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await page.keyboard.press('Escape');
  await clickTool(toolbox, 'Spline');
  return { panel, toolbox };
}

test('Local ROI editing: points go down only inside the ROI limit', async ({ page }) => {
  const { toolbox } = await structureWithRoi(page, [[-20, -20], [20, 20]]);
  await toolbox.getByRole('group', { name: 'Edit' }).getByRole('button', { name: 'Local ROI' }).click();
  const click = async (x: number, y: number) => { const p = await at(page, x, y); await page.mouse.click(p.x, p.y); await page.waitForTimeout(150); };
  await click(30, 30); // outside: no spline starts
  expect(await settledHandles(page)).toEqual([]);
  await click(10, 0); // inside: the first point
  await click(35, 0); // outside: refused
  await click(0, 10); // inside
  expect(await settledHandles(page)).toEqual([2]);
  await toolbox.getByRole('button', { name: 'Clear', exact: true }).click();
});

test('Fit ROI zooms the viewport to the ROI limit and centres it', async ({ page }) => {
  const { toolbox } = await structureWithRoi(page, [[10, 10], [30, 30]]);
  const before = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelParallelScale('panel_0'));
  const f0 = await focal(page);
  await toolbox.getByRole('group', { name: 'Edit' }).getByRole('button', { name: 'Local ROI' }).click();
  await toolbox.getByRole('button', { name: 'Fit ROI' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelParallelScale('panel_0'))).toBeLessThan(before! / 2);
  const f1 = await focal(page);
  expect(Math.hypot(f1[0] - (f0[0] + 20), f1[1] - (f0[1] + 20))).toBeLessThan(1);
});

test('ROI active spline: points inside the edge commit closer to it than the same points with plain Local Catmull-Rom+', async ({ page }) => {
  await structureWithRoi(page, [[-25, -25], [25, 25]]);
  const f = await focal(page);
  const radiusFor = async (algorithm: string) => {
    const toolbox = page.locator('[data-testid="annotations-side-panel"] [data-testid="context-toolbox"]');
    await toolbox.getByLabel('Spline algorithm').selectOption(algorithm);
    await anchorsOnBone(page, RING, BONE_R - 2);
    await clickNearFirst(page, 0, BONE_R - 2);
    const c = await committed(page);
    return meanRadius(c.polyline, f);
  };
  const plain = await radiusFor('localCR');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
  await structureWithRoi(page, [[-25, -25], [25, 25]]);
  const active = await radiusFor('roiActiveSpline');
  expect(Math.abs(active - BONE_R)).toBeLessThan(Math.abs(plain - BONE_R) - 0.5);
});
