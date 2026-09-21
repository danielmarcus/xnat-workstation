/**
 * Segment Bidirectional: measure the active segment's longest axis and its perpendicular.
 *
 * It shipped greyed out, recorded as crashing on multi-layer-group segmentations. The
 * crash is real but the recorded cause was not quite right: SegmentBidirectionalTool's
 * free-draw path builds an annotation whose metadata carries NO segmentationId and NO
 * segmentIndex, so its render calls getSegmentIndexColor(viewportId, undefined, undefined),
 * gets null, and dies on `colorArray.slice(0, 3)`. It would crash on a plain segmentation
 * too. Measured: "Cannot read properties of null (reading 'slice')" from renderAnnotation.
 *
 * The tool is only ever meant to be entered through its static `hydrate`, with the segment
 * named — i.e. it is an ACTION on a segment, not a drawing mode. Selecting it now measures
 * the active segment and leaves the active tool alone.
 *
 * Asserted on pixels and on the annotation, plus a no-crash guard: a page error would have
 * been the old behaviour, so the spec fails on one.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: {
  setActiveUnifiedTool: (t: string) => void;
  getActiveUnifiedTool: () => string | null;
  setUnifiedBrushSize: (n: number) => void;
  resetUnifiedSegmentations: () => void;
  isUnifiedVolumeReady: () => boolean;
  getMeasurementCount: () => number;
}; };

const bidirectionalShapes = (page: Page) =>
  page.evaluate(() =>
    document.querySelectorAll('[data-testid="unified-viewport-element:panel_0"] svg line').length,
  );

test('measuring a painted segment draws its bidirectional, without crashing', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady()), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  const mr = panel.getByLabel('Rename member');
  if (await mr.count()) await mr.press('Enter');

  // Paint a blob for it to measure.
  await page.evaluate(() => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    h.setUnifiedBrushSize(25);
    h.setActiveUnifiedTool('Brush');
  });
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(box.x + box.width * 0.42, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.58, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1200);

  const linesBefore = await bidirectionalShapes(page);
  pageErrors.length = 0;

  // The real toolbox button.
  await panel.getByRole('button', { name: 'Seg Bidir.', exact: true }).click();
  await page.waitForTimeout(2500);

  expect(pageErrors, `selecting it must not throw — it used to: ${pageErrors[0] ?? ''}`).toEqual([]);
  expect(
    await bidirectionalShapes(page),
    'the measurement must be drawn — two crossed axes over the segment',
  ).toBeGreaterThan(linesBefore);

  // It is an action, not a mode: the brush stays selected.
  expect(
    await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveUnifiedTool()),
    'measuring must not take over the primary tool',
  ).toBe('Brush');
});

test('measuring with nothing painted is a no-op, not a crash', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  const mr = panel.getByLabel('Rename member');
  if (await mr.count()) await mr.press('Enter');

  await panel.getByRole('button', { name: 'Seg Bidir.', exact: true }).click();
  await page.waitForTimeout(2000);
  expect(pageErrors, 'an empty segment must be handled, not thrown on').toEqual([]);
});
