/**
 * Contour Fill's boundary modes (SegWorks parity D3, branch 6 F4 — docs/segworks-parity.md
 * §10): the outline that fills the active segment is drawn freehand, as a spline or with
 * Live Wire, and O cycles the mode.
 *
 * ct-axial-anatomy: bone core +1000 HU (sphere r 14 mm) in +40 HU tissue, 1 mm pixels; the
 * slice on screen is 1.5 mm off centre, so the bone disc there has r ≈ 13.9 mm and an area
 * of ≈ 607 voxels. Every gesture is a real click, drag or key on the canvas; the assertion
 * is the labelmap voxel count of the active segment.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';

type Win = {
  __XNAT_E2E__: {
    clearAllContainers: () => void;
    resetContourToolSettings: () => void;
    activeSegmentVoxelCount: () => number;
    getContourShapes: () => Array<{ toolName: string }>;
    getPanelFocalPoint: (panelId: string) => [number, number, number] | null;
    worldToPanelPagePoint: (panelId: string, world: [number, number, number]) => { x: number; y: number } | null;
  };
};

const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';
const BONE_R = Math.sqrt(14 * 14 - 1.5 * 1.5);
const DISC = Math.PI * BONE_R * BONE_R;
const RING = [0, 45, 90, 135, 180, 225, 270, 315];

test.beforeEach(({ page }) => page.evaluate(() => {
  const h = (window as unknown as Win).__XNAT_E2E__;
  h.clearAllContainers();
  h.resetContourToolSettings();
}));

const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.activeSegmentVoxelCount());
const outlines = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getContourShapes().map((s) => s.toolName));

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

async function boundary(toolbox: ReturnType<Page['locator']>, mode: 'Freehand' | 'Spline' | 'Live Wire') {
  await toolbox.getByRole('group', { name: 'Boundary' }).getByRole('button', { name: mode }).click();
}

/** Click anchors round a circle of radius r (mm), then click the first again to close. */
async function clickRing(page: Page, r: number) {
  for (const d of RING) {
    const p = await at(page, r * Math.cos((d * Math.PI) / 180), r * Math.sin((d * Math.PI) / 180));
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
  }
  const first = await at(page, r, 0);
  await page.mouse.click(first.x, first.y);
}

/** Drag a closed freehand circle of radius r (mm). */
async function dragRing(page: Page, r: number) {
  const pts = [];
  for (let k = 0; k <= 48; k++) pts.push(await at(page, r * Math.cos((2 * Math.PI * k) / 48), r * Math.sin((2 * Math.PI * k) / 48)));
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.up();
}

async function expectDisc(page: Page) {
  await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(DISC * 0.85);
  expect(await voxels(page)).toBeLessThan(DISC * 1.2);
}

for (const [mode, draw] of [
  ['Spline', clickRing],
  ['Live Wire', clickRing],
  ['Freehand', dragRing],
] as const) {
  test(`${mode} boundary: the bone disc it encloses joins the segment, as one undo step`, async ({ page }) => {
    const { toolbox } = await segmentation(page);
    await boundary(toolbox, mode);
    await draw(page, BONE_R);
    await expectDisc(page);
    // The outline was only the way to draw the boundary.
    await expect.poll(() => outlines(page)).toEqual([]);
    await page.keyboard.press('Control+z');
    await expect.poll(() => voxels(page)).toBe(0);
  });
}

test('Contour Fill remembers its boundary: picked again after another tool, it still draws a spline', async ({ page }) => {
  const { toolbox } = await segmentation(page);
  await boundary(toolbox, 'Spline');
  await clickTool(toolbox, 'Brush');
  await clickTool(toolbox, 'Contour Fill');
  await expect(toolbox.getByRole('group', { name: 'Boundary' }).getByRole('button', { name: 'Spline' })).toHaveAttribute('aria-pressed', 'true');
  await clickRing(page, BONE_R); // clicks, not a drag: only a spline boundary fills from these
  await expectDisc(page);
});

test('Spline boundary on an oblique acquisition fills (index space, not world space)', async ({ page }) => {
  const { toolbox } = await segmentation(page, 'ct-oblique');
  await boundary(toolbox, 'Spline');
  await clickRing(page, 10);
  const area = Math.PI * 100;
  await expect.poll(() => voxels(page), { timeout: 8_000 }).toBeGreaterThan(area * 0.6);
  expect(await voxels(page)).toBeLessThan(area * 1.6);
});

test('a locked segment is refused with the lock warning, not filled, and the outline does not stay behind', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page);
  await panel.locator('[data-testid^="member-row-"]').first().getByRole('button', { name: 'Toggle lock' }).click();
  await boundary(toolbox, 'Spline');
  await clickRing(page, BONE_R);
  // Refused with the one lock warning every refused edit raises (a toast, not a modal).
  await expect(page.locator('[data-testid="viewport-toast"]')).toContainText(/locked/i);
  await page.waitForTimeout(500);
  expect(await voxels(page)).toBe(0);
  expect(await outlines(page)).toEqual([]);
});

test('O picks Contour Fill, then cycles its boundary Freehand → Spline → Live Wire', async ({ page }) => {
  const { toolbox } = await segmentation(page);
  await clickTool(toolbox, 'Brush');
  const pressed = (mode: string) => toolbox.getByRole('group', { name: 'Boundary' }).getByRole('button', { name: mode });
  await page.locator(VIEWPORT).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('o');
  await expect(toolbox.getByRole('button', { name: 'Contour Fill', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(pressed('Freehand')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('o');
  await expect(pressed('Spline')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('viewport-hud')).toHaveText('Contour Fill · Spline');
  await page.keyboard.press('o');
  await expect(pressed('Live Wire')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('o');
  await expect(pressed('Freehand')).toHaveAttribute('aria-pressed', 'true');
  await expect(toolbox.getByRole('button', { name: 'Contour Fill', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
