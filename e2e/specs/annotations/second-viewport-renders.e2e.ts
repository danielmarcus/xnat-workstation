/**
 * An annotation RENDERS in a second viewport opened on the same scan.
 *
 * `same-scan-viewport-parity` asserts the container is LISTED there, which is a panel-row
 * assertion — and it passes while the viewport draws nothing. That is precisely the trap
 * CLAUDE.md §1 names: "X appears" is a contract about pixels, not about a component or a
 * store field. These specs read the canvas instead.
 *
 * A CT is grayscale, so any saturated pixel is an overlay; see helpers/canvas-pixels.
 */
import { test, expect } from '../../fixtures/electron-app';
import { enterLocalViewer, ensureFixture, loadSameSeriesTwice } from '../../helpers/local-fixture';
import { captureViewport, changedRegion } from '../../helpers/canvas-pixels';

type Win = { __XNAT_E2E__: {
  setActiveUnifiedTool: (t: string) => void;
  setUnifiedBrushSize: (n: number) => void;
  getPaintedVoxelCount: () => number;
  resetUnifiedSegmentations: () => void;
}; };

const focus = (page: import('@playwright/test').Page, vp: string) =>
  page.locator(`[data-testid="unified-viewport:${vp}"]`).click({ position: { x: 20, y: 20 } });

async function strokeAcross(page: import('@playwright/test').Page, viewportId: string) {
  const box = (await page.locator(`[data-testid="unified-viewport-element:${viewportId}"] canvas`).boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.4, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(900);
}

async function openPanel(page: import('@playwright/test').Page) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });
  return panel;
}

async function createAndPaint(page: import('@playwright/test').Page, viewportId: string) {
  const panel = await openPanel(page);
  await focus(page, viewportId);
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  await panel.getByLabel('Rename member').press('Enter');
  await page.evaluate(() => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    h.setUnifiedBrushSize(40);
    h.setActiveUnifiedTool('Brush');
  });
  await strokeAcross(page, viewportId);
  expect(await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount())).toBeGreaterThan(0);
}

test('the annotation is drawn in both viewports when the scan is already in both', async ({ page }) => {
  await loadSameSeriesTwice(page, 'ct-axial-300', 'slice');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  await openPanel(page);
  await page.waitForTimeout(600);

  const base0 = await captureViewport(page, 'panel_0');
  const base1 = await captureViewport(page, 'panel_1');

  await createAndPaint(page, 'panel_0');

  const drawnOn = await changedRegion(page, base0, await captureViewport(page, 'panel_0'));
  expect(drawnOn.fraction, 'the viewport drawn in must show the overlay').toBeGreaterThan(0.001);

  const other = await changedRegion(page, base1, await captureViewport(page, 'panel_1'));
  expect(
    other.fraction,
    'the second viewport shows the same scan, so it must render the same overlay — not merely list it',
  ).toBeGreaterThan(0.001);
});

test('opening the scan in a second viewport AFTER annotating renders the annotation there', async ({ page }) => {
  await enterLocalViewer(page);
  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles([]);
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  await createAndPaint(page, 'panel_0');

  // Only now open the second viewport on the same scan.
  await page.locator('[title^="Viewport layout"]').click();
  await page.getByRole('button', { name: '1 x 2' }).click();
  await page.locator('[data-testid="unified-viewport:panel_1"]').waitFor({ state: 'attached', timeout: 20_000 });
  await focus(page, 'panel_1');
  await page.locator('[data-testid="local-import-input"]').setInputFiles([]);
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_1"] canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  // What is ON the canvas here is isolated by toggling the member's own visibility
  // control — a real affordance, and the only way to get a baseline of "this viewport
  // without the annotation" once the viewport already has it.
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  const eye = panel.locator('[aria-label^="Cycle visibility"]').first();
  const shown = await captureViewport(page, 'panel_1');
  await eye.click();
  await page.waitForTimeout(700);
  const hidden = await captureViewport(page, 'panel_1');

  const overlay = await changedRegion(page, hidden, shown);
  expect(
    overlay.fraction,
    'a viewport opened on an already-annotated scan must render its annotations — hiding the member must visibly change it',
  ).toBeGreaterThan(0.001);
});
