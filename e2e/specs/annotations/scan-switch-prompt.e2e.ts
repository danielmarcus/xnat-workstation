/**
 * Switching the scan in a 1x1 viewport prompts before the previous scan's annotation
 * leaves the screen — and once it has gone, it does not render over the new scan.
 *
 * Reported: "in 1x1 when switching from a scan with an annotation to another scan, the
 * annotation from the first scan still appears... this is exactly a behavior that we just
 * did work to prevent."
 *
 * Two sibling series of ONE exam, so they share a Frame of Reference. That sharing is the
 * whole difficulty: Cornerstone keeps a contour attached across the switch because it is
 * spatially renderable on the new series, so an orphan rule phrased as "is it still
 * attached to a viewport" answers no-change and never prompts. The annotation is then left
 * drawn over a scan it does not belong to.
 *
 * Belonging is about the container's NATIVE series, not about what it can be projected on.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { enterLocalViewer, fixtureSeriesFiles, loadLocalDicom } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: { resetUnifiedSegmentations: () => void; setActiveUnifiedTool: (t: string) => void } };

async function openPanel(page: Page) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });
  return panel;
}

async function drawStroke(page: Page) {
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const cx = box.x + box.width * 0.35;
  const cy = box.y + box.height * 0.4;
  const r = Math.min(box.width, box.height) * 0.12;
  await page.mouse.move(cx - r, cy - r);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(cx - r + (2 * r * i) / 16, cy - r + (2 * r * i) / 16, { steps: 2 });
  }
  await page.mouse.up();
  await page.waitForTimeout(800);
}

/** Annotation shapes currently drawn on the viewport's SVG layer. */
const drawnShapeCount = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelectorAll(
        '[data-testid="unified-viewport-element:panel_0"] svg polyline, [data-testid="unified-viewport-element:panel_0"] svg path, [data-testid="unified-viewport-element:panel_0"] svg polygon',
      ).length,
  );

test('switching scans in one viewport prompts, and the annotation leaves with its scan', async ({ page }) => {
  await enterLocalViewer(page);
  const seriesA = fixtureSeriesFiles('mr-t1-t2-sameexam', 't1-slice');
  const seriesB = fixtureSeriesFiles('mr-t1-t2-sameexam', 't2-slice');

  await loadLocalDicom(page, seriesA, 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await drawStroke(page);
  expect(await drawnShapeCount(page), 'the contour must be drawn on its own scan').toBeGreaterThan(0);

  // Switch the SAME viewport to the sibling series. Unsaved work is about to leave.
  await page.locator('[data-testid="local-import-input"]').setInputFiles([]);
  await page.locator('[data-testid="local-import-input"]').setInputFiles(seriesB);

  await expect(
    page.locator('[data-testid="leave-unsaved-dialog"]'),
    'leaving a scan with unsaved work must prompt before the switch',
  ).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200);

  // Gone from the image and gone from the list — it belongs to a scan that is no longer
  // open, whatever frame of reference the new one happens to share.
  expect(
    await drawnShapeCount(page),
    'the discarded annotation must not stay drawn over the new scan',
  ).toBe(0);
  await expect(
    panel.locator('[data-testid^="container-row-"]'),
    'the discarded annotation must not stay listed',
  ).toHaveCount(0);
});

test('cancelling the prompt keeps the scan and the annotation', async ({ page }) => {
  await enterLocalViewer(page);
  const seriesA = fixtureSeriesFiles('mr-t1-t2-sameexam', 't1-slice');
  const seriesB = fixtureSeriesFiles('mr-t1-t2-sameexam', 't2-slice');

  await loadLocalDicom(page, seriesA, 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await drawStroke(page);

  await page.locator('[data-testid="local-import-input"]').setInputFiles([]);
  await page.locator('[data-testid="local-import-input"]').setInputFiles(seriesB);
  await expect(page.locator('[data-testid="leave-unsaved-dialog"]')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(1000);

  await expect(panel.locator('[data-testid^="container-row-"]'), 'Cancel must drop nothing').toHaveCount(1);
  expect(await drawnShapeCount(page), 'Cancel must leave the contour on screen').toBeGreaterThan(0);
});
