/**
 * P1.4 — unified Viewport (new path), offline, flag on.
 *
 * With multiviewport.enabled, ViewerPage renders the new UnifiedViewportGrid →
 * Viewport → useViewport → viewportService.createUnifiedViewport. This proves
 * the new rendering path mounts and that a 16-slice CT is created as a VOLUME
 * (ORTHOGRAPHIC) viewport per the stack-eligibility predicate — the old path
 * rendered the same fixture as a stack.
 *
 * (Pixel/visual content is verified later in P1.7; here we verify the unified
 * path mounts a volume viewport + canvas.)
 */
import { test, expect } from '../fixtures/electron-app';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

test('unified Viewport renders ct-axial-300 (16-slice CT) as a VOLUME (flag on)', async ({ page }) => {
  // Enable BEFORE the viewer mounts so ViewerPage renders the unified grid.
  await page.evaluate(() => {
    (window as unknown as { __XNAT_E2E__: { setMultiviewportEnabled: (v: boolean) => void } })
      .__XNAT_E2E__.setMultiviewportEnabled(true);
  });
  await enterLocalViewer(page);

  // Load via the app's real local-import path; the unified grid reads panelImageIds.
  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);

  // The unified Viewport mounts a Cornerstone element + canvas for panel_0.
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas'))
    .toBeVisible({ timeout: 30_000 });

  // CT 16-slice → volume (ORTHOGRAPHIC), not stack.
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as {
        __XNAT_E2E__: { getViewportType: (p: string) => string | null };
      }).__XNAT_E2E__.getViewportType('panel_0')),
      { timeout: 20_000, message: 'unified panel_0 should be a volume (orthographic) viewport' },
    )
    .toBe('orthographic');
});
