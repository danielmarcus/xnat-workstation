/**
 * The panel's multi-viewport indicators actually render.
 *
 * `ContainerRow.crossPanelCount` (the "↗ N" pill) and `MemberRow.eligibility` (the
 * frame-of-reference dimming) were declared down to the row components in R3.4/R3.5 and
 * forwarded by ContainerList — but `useAnnotationsPanel` never supplied either resolver,
 * so neither had ever rendered in any build. That is why a multi-viewport grid showed no
 * dimming and gave no clue which scan a container belonged to.
 *
 * Uses the SAME scan in both viewports, which is what "on more than one panel" means now:
 * an annotation belongs to the scan it was drawn on, and every viewport showing that scan
 * displays it — a second viewport on the same series, or the planes of an MPR.
 *
 * It previously used two different series of one exam, back when a mask also rendered on a
 * sibling series (requirements A2b). That rule was removed as incorrect, so the container
 * attached to one viewport only and this spec silently SKIPPED rather than failing — which
 * is how a deleted behaviour can take a test with it without anyone noticing.
 */
import { test, expect } from '../../fixtures/electron-app';
import { loadSameSeriesTwice } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: {
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string }>;
  getSegmentationViewportIds: (segmentationId: string) => string[];
}; };

test('a container attached to more than one viewport shows the cross-panel pill', async ({ page }) => {
  await loadSameSeriesTwice(page, 'ct-axial-300', 'slice');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();

  const { segmentationId } = await page.evaluate(
    () => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation('Cross SEG'),
  );
  const viewports = await page.evaluate(
    (id) => (window as unknown as Win).__XNAT_E2E__.getSegmentationViewportIds(id),
    segmentationId,
  );
  expect(
    viewports.length,
    'the same scan is open in two viewports, so the container must render on both',
  ).toBeGreaterThan(1);

  // The pill must be rendered — before the resolvers were wired it never was, at any width.
  await expect(
    panel.locator('[data-testid="container-list"]').getByTitle(/Rendering on \d+ other panel/).first(),
    'the cross-panel pill should render when a container is on more than one viewport',
  ).toBeVisible({ timeout: 10_000 });
});
