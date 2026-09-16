/**
 * The panel's multi-viewport indicators actually render.
 *
 * `ContainerRow.crossPanelCount` (the "↗ N" pill) and `MemberRow.eligibility` (the
 * frame-of-reference dimming) were declared down to the row components in R3.4/R3.5 and
 * forwarded by ContainerList — but `useAnnotationsPanel` never supplied either resolver,
 * so neither had ever rendered in any build. That is why a multi-viewport grid showed no
 * dimming and gave no clue which scan a container belonged to.
 *
 * Uses two series that share a frame of reference, so a container created on panel_0
 * also attaches to panel_1 — the case the cross-panel pill exists for. (With different
 * frames of reference the container correctly attaches to one viewport only, so there is
 * no second panel to report.)
 */
import { test, expect } from '../../fixtures/electron-app';
import { loadTwoSeries } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: {
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string }>;
  getSegmentationViewportIds: (segmentationId: string) => string[];
}; };

test('a container attached to more than one viewport shows the cross-panel pill', async ({ page }) => {
  await loadTwoSeries(page, 'mr-t1-t2-sameexam', 't1-slice', 't2-slice');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  await panel.getByLabel('Rename member').press('Enter');

  const { segmentationId } = await page.evaluate(
    () => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation('Cross SEG'),
  );
  const viewports = await page.evaluate(
    (id) => (window as unknown as Win).__XNAT_E2E__.getSegmentationViewportIds(id),
    segmentationId,
  );
  test.skip(viewports.length < 2, `container is on ${viewports.length} viewport(s); the pill only applies to >1`);

  // The pill must be rendered — before the resolvers were wired it never was, at any width.
  await expect(
    panel.locator('[data-testid="container-list"]').getByTitle(/Rendering on \d+ other panel/),
    'the cross-panel pill should render when a container is on more than one viewport',
  ).toBeVisible({ timeout: 10_000 });
});
