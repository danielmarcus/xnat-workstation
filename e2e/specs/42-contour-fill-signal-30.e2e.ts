/**
 * Phase 5 — signal 30: Contour Fill (`LabelMapEditWithContourTool`).
 *
 * The spec (requirements §30, design §Phase-5): select the Contour Fill tool,
 * draw a closed freehand boundary on a slice, and the ENCLOSED REGION rasterizes
 * into the active segment (boundary-then-fill — not voxel-by-voxel). Per the docs
 * this tool is "currently broken"; this spec is its acceptance gate.
 *
 * REPRO-FIRST (CLAUDE.md §8, red-before-green): we create a volume labelmap on a
 * single CT, select the real `LabelmapEditWithContour` tool via the unified tool
 * service (no setter shortcut into the labelmap), and trace a closed loop on the
 * canvas with REAL mouse events. The contract is: painted voxels go from 0 to >0.
 * Against the broken tool this stays 0 (red) — and we surface any thrown
 * page/console error so the failure MODE is visible, not just the symptom.
 *
 * Root cause (fixed): `ContourSegmentationBaseTool.createAnnotation` throws "A
 * contour segmentation must be active" unless the active labelmap already carries a
 * Contour representation on the drawing viewport. The tool's own reactive setup
 * (`checkContourSegmentation`) never fires when the tool is selected with the
 * viewport + labelmap already present, so the gesture was a swallowed no-op. The fix
 * (`unifiedSegService.ensureContourEditPrereq`, invoked from `setActiveTool`) adds
 * that representation at tool-activation time.
 *
 * Undo (signal 30's second clause — "undo reverts the fill as ONE entry"):
 * Cornerstone's `viewportContoursToLabelmap` writes the voxels then only fires
 * SEGMENTATION_DATA_MODIFIED; it never finalizes a history memo, so the fill would be
 * absent from the undo ring. `installContourFillUndo` bridges that at the app boundary
 * (before/after labelmap snapshot → one custom memo). This spec asserts BOTH: the fill
 * rasterizes, and a single undo reverts the entire fill.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (toolName: string) => void;
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string; segmentIndex: number }>;
  getActiveUnifiedTool: () => string | null;
  getUnifiedToolsWithPrimary: () => string[];
  getPaintedVoxelCount: () => number;
  isUnifiedVolumeReady: () => boolean;
  resetUnifiedSegmentations: () => void;
  canUnifiedUndo: () => boolean;
  triggerUnifiedUndo: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const setTool = (page: Page, t: string) =>
  page.evaluate((tn) => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool(tn), t);
const activeTool = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveUnifiedTool());
const primaryTools = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getUnifiedToolsWithPrimary());
const createLabelmap = (page: Page, label: string) =>
  page.evaluate((l) => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation(l), label);
const paintedVoxels = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());
const volumeReady = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady());

/**
 * Trace a CLOSED loop (octagon) centred on the canvas via real mouse events:
 * down at the first vertex, drag through the ring back to the start, then up.
 * `LabelmapEditWithContour` draws a freehand contour and fills its interior on
 * release — so the path must return near where it began.
 */
async function drawClosedContour(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = Math.min(box.width, box.height) * 0.22;
  const verts = 8;
  const pt = (i: number) => {
    const a = (i / verts) * Math.PI * 2;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  const start = pt(0);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= verts; i++) {
    const p = pt(i % verts);
    await page.mouse.move(p.x, p.y, { steps: 6 });
  }
  // Return to the start so the freehand contour closes cleanly.
  await page.mouse.move(start.x, start.y, { steps: 6 });
  await page.mouse.up();
}

test('Contour Fill rasterizes the enclosed region into the active segment (signal 30)', async ({ page }) => {
  // Surface the failure MODE: collect page errors + console errors during the run.
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  await enterLocalViewer(page);

  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas'))
    .toBeVisible({ timeout: 30_000 });

  // Wait for the source volume so the derived labelmap is geometrically aligned.
  await expect.poll(() => volumeReady(page), { timeout: 30_000 }).toBe(true);

  // Isolate from any segmentation a prior spec left in the worker-scoped app.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  // Create + attach a labelmap segmentation; select the real Contour Fill tool.
  await createLabelmap(page, 'ContourFill SEG');
  await setTool(page, 'LabelmapEditWithContour');

  // Sanity: the tool actually took the Primary (left-click) slot.
  expect(await activeTool(page)).toBe('LabelmapEditWithContour');

  // Nothing painted yet.
  expect(await paintedVoxels(page)).toBe(0);

  // Draw a closed boundary on the axial panel via a real gesture.
  const box = await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox();
  expect(box).not.toBeNull();
  await drawClosedContour(page, box!);

  // CONTRACT: the enclosed region rasterized into the active segment.
  await expect
    .poll(() => paintedVoxels(page), {
      timeout: 15_000,
      message:
        'Contour Fill should rasterize the enclosed region into the labelmap. '
        + `pageErrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors.slice(0, 8))}`,
    })
    .toBeGreaterThan(0);

  // CONTRACT (signal 30): a single undo reverts the ENTIRE fill.
  expect(await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.canUnifiedUndo())).toBe(true);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.triggerUnifiedUndo());
  await expect
    .poll(() => paintedVoxels(page), { timeout: 10_000, message: 'one undo should revert the whole contour fill' })
    .toBe(0);
});
