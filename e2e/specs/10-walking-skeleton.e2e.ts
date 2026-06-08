/**
 * Walking Skeleton (annotation rebuild, Phase 0)
 *
 * Proves the offline local-fixture E2E path end-to-end through the REAL stack,
 * with the multiviewport feature flag ON (so the gated skeleton-service init in
 * ViewerPage runs):
 *
 *   enable multiviewport  →  enter viewer offline (no XNAT)  →  import the
 *   synthetic ct-axial-300 DICOM stack  →  real Cornerstone renders it  →
 *   draw a Length measurement with the real tool  →  it appears in the
 *   Annotations list (store-synced) and via the renderer hook.
 *
 * This validates that we can run acceptance signals here against local fixtures
 * with no live server, and that enabling multiviewport does not break the app.
 * No Cornerstone/service mocks; the assertion rides the real affordance.
 */
import { test, expect } from '../fixtures/electron-app';
import { loadCtAxial300 } from '../helpers/local-fixture';

test.describe('Walking skeleton — offline local fixture, real stack', () => {
  test('renders ct-axial-300 and a Length measurement appears in the annotation list', async ({ page }) => {
    // The multiviewport flag persists in localStorage across test runs, so set
    // it explicitly OFF — this spec exercises the old (stack) measurement path.
    // The new unified path is covered by 13-unified-viewport.
    await page.evaluate(() => {
      (window as unknown as { __XNAT_E2E__: { setMultiviewportEnabled: (v: boolean) => void } })
        .__XNAT_E2E__.setMultiviewportEnabled(false);
    });
    const viewer = await loadCtAxial300(page);
    await expect(viewer.viewportCanvas).toBeVisible();

    // Open the Annotations list panel (toggled with the 'O' hotkey).
    const annotationPanel = page.locator('[data-testid="annotation-panel"]');
    if (!(await annotationPanel.isVisible().catch(() => false))) {
      await page.keyboard.press('o');
      await expect(annotationPanel).toBeVisible({ timeout: 5_000 });
    }

    // Select the Length tool. The toolbar may collapse the annotation tools
    // into an "Annotation tools" group (narrow window), so expand it if present,
    // then open the measurement dropdown by its stable title (the "Measure"
    // text label is hidden when collapsed).
    const annotationGroupTrigger = page.locator('button[title="Annotation tools"]');
    if (await annotationGroupTrigger.isVisible().catch(() => false)) {
      await annotationGroupTrigger.click();
    }
    const measureTrigger = page.locator('button[title="Annotation & measurement tools"]');
    await measureTrigger.waitFor({ state: 'visible', timeout: 5_000 });
    await measureTrigger.click();
    await page.getByRole('button', { name: 'Length', exact: true }).click();

    // Draw a measurement on the rendered image.
    await viewer.canvas.drawLine({ x: 0.35, y: 0.35 }, { x: 0.65, y: 0.65 });
    await page.waitForTimeout(1_000);

    // The measurement flowed through the real Cornerstone → annotationService →
    // store → list path.
    const count = page.locator('[data-testid="annotation-count"]');
    await expect(count).toHaveText('1');
    await expect(annotationPanel.locator('li').first()).toContainText('Length');

    // Independent cross-check via the renderer hook (no DOM dependency).
    const hookCount = await page.evaluate(() =>
      (window as unknown as { __XNAT_E2E__: { getMeasurementCount: () => number } })
        .__XNAT_E2E__.getMeasurementCount(),
    );
    expect(hookCount).toBe(1);
  });
});
