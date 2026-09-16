/**
 * The panel lists the FOCUSED viewport's annotations (proposal §4.1).
 *
 * Replaces the session-scoped model recorded at CLAUDE.md:213 — "the container list shows
 * every container; rows not on the active viewport are dimmed with a cross-panel pill".
 * The dimming and the pill were never wired (fixed in 5beb794 / d257377), so what a
 * multi-viewport grid actually showed was one undifferentiated list covering every scan
 * on screen, with nothing saying which row belonged where. Focus is now the filter.
 *
 * Uses two series with DIFFERENT frames of reference, so a container created on panel_0
 * genuinely cannot render on panel_1 — which is the case scoping exists for. (With the
 * same frame of reference a container attaches to both viewports and correctly appears in
 * both lists; panel-multiviewport-indicators covers that half.)
 */
import { test, expect } from '../../fixtures/electron-app';
import { loadTwoSeries } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: {
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string }>;
  getSegmentationViewportIds: (segmentationId: string) => string[];
  getSegmentationCount: () => number;
}; };

test('focusing another viewport re-scopes the list to that viewport', async ({ page }) => {
  await loadTwoSeries(page, 'cross-for-ct-mr', 'ct-slice', 'mr-slice');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // panel_1 is focused after loadTwoSeries; create a container there.
  const { segmentationId } = await page.evaluate(
    () => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation('MR only'),
  );
  const on = await page.evaluate(
    (id) => (window as unknown as Win).__XNAT_E2E__.getSegmentationViewportIds(id),
    segmentationId,
  );
  test.skip(on.length !== 1, `container is on ${on.length} viewports; scoping needs a single-viewport one`);
  const homeViewport = on[0];
  const otherViewport = homeViewport === 'panel_0' ? 'panel_1' : 'panel_0';

  const row = panel.locator(`[data-testid="container-row-${segmentationId}"]`);

  // Focus the viewport it actually renders in. (Which one that is depends on where the
  // shared source volume lives, not on which viewport was focused at create time — so
  // the spec reads it back rather than assuming.)
  await page.locator(`[data-testid="unified-viewport:${homeViewport}"]`).click({ position: { x: 20, y: 20 } });
  await expect(row, 'the container is listed on the viewport it renders in').toBeVisible({ timeout: 10_000 });

  // Focus the viewport it does NOT render in — it must drop out of the list.
  await page.locator(`[data-testid="unified-viewport:${otherViewport}"]`).click({ position: { x: 20, y: 20 } });
  await expect(row, 'a container that renders nowhere in the focused viewport is not listed').toHaveCount(0);
  // ...but it is still LOADED. Scoping hides it from this list; it does not unload it.
  expect(await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getSegmentationCount())).toBeGreaterThan(0);

  // Focus back — it returns.
  await page.locator(`[data-testid="unified-viewport:${homeViewport}"]`).click({ position: { x: 20, y: 20 } });
  await expect(row, 'focusing its viewport again lists it').toBeVisible({ timeout: 10_000 });
});
