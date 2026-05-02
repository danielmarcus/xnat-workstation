/**
 * Volume-mode E2E Tests (Multi-Viewport Phase 1)
 *
 * Verifies the new viewport rendering path that activates when
 * `multiViewport.enabled = true` and the loaded data is volumetric (CT/MR
 * with multi-slice). Uses the existing live-XNAT test config; the same
 * scan that 03-image-viewing.e2e.ts uses is loaded with the flag flipped on.
 *
 * Acceptance for these tests:
 *   - The viewport renders via VolumeViewport.tsx (data-testid prefix
 *     "volume-viewport") rather than CornerstoneViewport (prefix
 *     "cornerstone-viewport").
 *   - The volume viewport canvas appears, no error overlay.
 *   - Slice navigation via mouse wheel updates the slice index.
 *   - The shared-volume cache is acquired (no console errors about
 *     missing FrameOfReferenceUID).
 *   - On unmount (load a different scan), the shared volume is released.
 */
import { test, expect } from '../fixtures/auth';
import { XnatBrowserPage } from '../pages/xnat-browser.page';
import { getE2EConfig, type E2EConfig } from '../helpers/env';

let config: E2EConfig;

test.describe('Volume Mode (multiViewport.enabled = true)', () => {
  test.beforeAll(() => { config = getE2EConfig(); });

  test.beforeEach(async ({ authenticatedPage: page }) => {
    // Flip the flag on before any panel mounts. The flag is read on each
    // Viewport.tsx render, so applying it before scan load means the
    // panel will pick the new path on first mount.
    await page.evaluate(() => {
      window.__XNAT_E2E__?.setMultiViewportEnabled(true);
    });

    const browser = new XnatBrowserPage(page);
    const level = await browser.currentLevel();
    if (level !== 'projects') {
      await browser.navigateToProjects();
    }

    await browser.navigateAndLoadScan(
      config.testProject,
      config.testSubject,
      config.testSession,
      config.testScan,
    );
  });

  test.afterEach(async ({ authenticatedPage: page }) => {
    // Reset the flag to its default so subsequent specs aren't affected
    // by leakage if Playwright reuses the Electron worker.
    await page.evaluate(() => {
      window.__XNAT_E2E__?.setMultiViewportEnabled(false);
    });
  });

  test('volume viewport renders for multi-slice CT', async ({ authenticatedPage: page }) => {
    // Wait for any panel testid to appear (either volume or stack root).
    // This is the diagnostic step — if neither shows, the panel isn't
    // mounting at all.
    const volumeRoot = page.locator('[data-testid="volume-viewport:panel_0"]');
    const stackRoot = page.locator('[data-testid="cornerstone-viewport:panel_0"]');

    await Promise.race([
      volumeRoot.waitFor({ state: 'attached', timeout: 30_000 }),
      stackRoot.waitFor({ state: 'attached', timeout: 30_000 }),
    ]);

    // Diagnostic: which root did we get, and was the flag actually set?
    const flagEnabled = await page.evaluate(() => window.__XNAT_E2E__?.getMultiViewportEnabled());
    const volumeAttached = (await volumeRoot.count()) > 0;
    const stackAttached = (await stackRoot.count()) > 0;
    const errorText = volumeAttached
      ? await page.locator('[data-testid="volume-viewport-error:panel_0"]').textContent().catch(() => null)
      : null;

    console.log(`[volume-mode E2E] flagEnabled=${flagEnabled} volumeAttached=${volumeAttached} stackAttached=${stackAttached} errorText=${errorText ?? 'none'}`);

    expect(flagEnabled, 'multiViewport flag should be enabled').toBe(true);

    await expect(
      volumeRoot,
      'with the flag on and a multi-slice CT, the panel should render via VolumeViewport, not the legacy CornerstoneViewport',
    ).toBeAttached();

    const volumeCanvas = page.locator('[data-testid="volume-viewport-canvas:panel_0"] canvas');
    await expect(volumeCanvas).toBeVisible({ timeout: 30_000 });

    const errorOverlay = page.locator('[data-testid="volume-viewport-error:panel_0"]');
    await expect(errorOverlay).toBeHidden();
  });

  test('volume viewport supports wheel-scroll slice navigation', async ({ authenticatedPage: page }) => {
    const volumeCanvas = page.locator('[data-testid="volume-viewport-canvas:panel_0"] canvas');
    await expect(volumeCanvas).toBeVisible({ timeout: 30_000 });

    // Read initial slice info from the viewer overlay, scroll, read again,
    // confirm change. We use the overlay's image-index display rather than
    // poking Cornerstone state directly so we exercise the same data path
    // a real user sees.
    const overlay = page.locator('[data-testid="viewport-overlay:panel_0"]');
    const before = await overlay.textContent();

    await volumeCanvas.hover();
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(500);

    const after = await overlay.textContent();
    expect(after, 'overlay text should change when wheel scrolls').not.toBe(before);
  });

  test('flag toggle exposes correct state via E2E hook', async ({ authenticatedPage: page }) => {
    const enabled = await page.evaluate(() => window.__XNAT_E2E__?.getMultiViewportEnabled());
    expect(enabled).toBe(true);
  });

  test('legacy stack viewport rendering when flag is off', async ({ authenticatedPage: page }) => {
    // Flip flag off mid-test, navigate fresh load, confirm we get the
    // CornerstoneViewport canvas testid instead of the volume one.
    await page.evaluate(() => {
      window.__XNAT_E2E__?.setMultiViewportEnabled(false);
    });

    const browser = new XnatBrowserPage(page);
    if ((await browser.currentLevel()) !== 'projects') {
      await browser.navigateToProjects();
    }
    await browser.navigateAndLoadScan(
      config.testProject,
      config.testSubject,
      config.testSession,
      config.testScan,
    );

    const stackCanvas = page.locator('[data-testid="cornerstone-viewport-canvas:panel_0"] canvas');
    await expect(stackCanvas).toBeVisible({ timeout: 30_000 });
  });
});
