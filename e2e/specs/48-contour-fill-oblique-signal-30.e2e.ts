/**
 * Phase 5 — signal 30, OBLIQUE regression. Contour Fill on an obliquely-acquired scan.
 *
 * The original Contour Fill fix (spec 42) was verified only on the axial sphere phantom,
 * whose acquisition plane is world-axis-aligned. A real scan acquired obliquely is shown
 * on an OBLIQUE acquisition plane, where Cornerstone's world-space rasterizer
 * (viewportContoursToLabelmap → isPointInsidePolyline3D → projectTo2D) throws "Cannot find
 * a shared dimension index for polyline, probably oblique plane" and nothing fills — a
 * live-CNDA bug the axial fixture structurally could not catch.
 *
 * The fix rasterizes in INDEX (IJK) space (contourEditPrereq.installObliqueSafeContourFill),
 * where an acquisition-plane contour is a constant-slice plane regardless of world
 * orientation, and consumes the contour before Cornerstone's world-space listener runs so
 * projectTo2D never throws. This spec loads the `ct-oblique` fixture (~30° tilt) and asserts
 * the fill rasterizes AND no shared-dimension error is logged.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (toolName: string) => void;
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string; segmentIndex: number }>;
  getPaintedVoxelCount: () => number;
  isUnifiedVolumeReady: () => boolean;
  resetUnifiedSegmentations: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const setTool = (page: Page, t: string) => page.evaluate((tn) => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool(tn), t);
const createLabelmap = (page: Page, l: string) => page.evaluate((label) => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation(label), l);
const paintedVoxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());
const volumeReady = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady());

async function drawClosedContour(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = Math.min(box.width, box.height) * 0.22;
  const verts = 8;
  const pt = (i: number) => ({ x: cx + r * Math.cos((i / verts) * Math.PI * 2), y: cy + r * Math.sin((i / verts) * Math.PI * 2) });
  const start = pt(0);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= verts; i++) {
    const p = pt(i % verts);
    await page.mouse.move(p.x, p.y, { steps: 6 });
  }
  await page.mouse.move(start.x, start.y, { steps: 6 });
  await page.mouse.up();
}

test('Contour Fill rasterizes on an OBLIQUE acquisition plane without throwing (signal 30)', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await enterLocalViewer(page);
  const files = ensureFixture('ct-oblique');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => volumeReady(page), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  await createLabelmap(page, 'Oblique ContourFill SEG');
  await setTool(page, 'LabelmapEditWithContour');
  expect(await paintedVoxels(page)).toBe(0);

  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  expect(box).not.toBeNull();
  await drawClosedContour(page, box);

  // The index-space rasterizer fills the enclosed region…
  await expect
    .poll(() => paintedVoxels(page), {
      timeout: 15_000,
      message: `oblique contour fill should rasterize. consoleErrors=${JSON.stringify(consoleErrors.slice(0, 6))}`,
    })
    .toBeGreaterThan(0);

  // …and Cornerstone's world-space projectTo2D never ran (we consumed the contour first).
  const obliqueThrow = consoleErrors.find((e) => e.includes('shared dimension index'));
  expect(obliqueThrow, 'the oblique-plane projectTo2D throw must not occur').toBeUndefined();
});
