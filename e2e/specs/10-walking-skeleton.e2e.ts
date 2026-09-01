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
    // Unified viewport path (the only path after P1.8d). Set explicitly ON since
    // the flag persists in localStorage across test runs. The toolbar Length
    // selection routes through viewerStore → unifiedToolService (P1.8a).
    const viewer = await loadCtAxial300(page);
    await expect(viewer.viewportCanvas).toBeVisible();

    // Open the Annotations side panel (toggled with the 'G' hotkey — the legacy
    // list panel and its 'O' hotkey were deleted in the Phase-6 cutover).
    const annotationPanel = page.locator('[data-testid="annotations-side-panel"]');
    if (!(await annotationPanel.isVisible().catch(() => false))) {
      await page.keyboard.press('g');
      await expect(annotationPanel).toBeVisible({ timeout: 5_000 });
    }

    // Select the Length tool. The toolbar's measurement dropdown was removed
    // (measurement tools moved to the Annotations side-panel toolbox, frozen §10);
    // activate Length via the unified tool service, which is the same routing the
    // side-panel toolbox uses (viewerStore.setActiveTool → unifiedToolService).
    await page.evaluate(() => {
      (window as unknown as { __XNAT_E2E__: { setActiveUnifiedTool: (t: string) => void } })
        .__XNAT_E2E__.setActiveUnifiedTool('Length');
    });

    // Draw a measurement on the rendered image.
    await viewer.canvas.drawLine({ x: 0.35, y: 0.35 }, { x: 0.65, y: 0.65 });
    await page.waitForTimeout(1_000);

    // The measurement flowed through the real Cornerstone → annotationService →
    // store → panel path: a Measurement (SR) container with one member row.
    await expect(annotationPanel.getByText('Measurements')).toBeVisible({ timeout: 10_000 });
    await expect(annotationPanel.locator('[data-testid^="member-row-"]')).toHaveCount(1);
    await expect(annotationPanel.locator('[data-testid^="member-row-"]').first()).toContainText('Length');

    // Independent cross-check via the renderer hook (no DOM dependency).
    const hookCount = await page.evaluate(() =>
      (window as unknown as { __XNAT_E2E__: { getMeasurementCount: () => number } })
        .__XNAT_E2E__.getMeasurementCount(),
    );
    expect(hookCount).toBe(1);
  });
});
