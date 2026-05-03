/**
 * Volume-mode E2E Tests (local-fixture)
 *
 * Verifies that multi-slice volumetric data routes through the new
 * VolumeViewport rendering path (not the legacy StackViewport which
 * survives only for non-volumetric data per stackEligibility.ts).
 * Loads from the local CT fixture so PHI never enters test artifacts.
 *
 * Acceptance for these tests:
 *   - The viewport renders via VolumeViewport.tsx (data-testid prefix
 *     "volume-viewport") rather than StackViewport (prefix
 *     "stack-viewport").
 *   - The volume viewport canvas appears, no error overlay.
 *   - Slice navigation via mouse wheel updates the slice index.
 *   - The shared-volume cache is acquired (no console errors about
 *     missing FrameOfReferenceUID).
 */
import { test, expect } from '../fixtures/electron-app';
import { loadFixtureScan, FIXTURE_NAMES } from '../helpers/fixture-load';

test.describe('Volume Mode (local fixture)', () => {
  test.beforeEach(async ({ page }) => {
    const result = await loadFixtureScan(page, FIXTURE_NAMES.CT_AXIAL_300);
    test.skip(
      result === null,
      `Fixture '${FIXTURE_NAMES.CT_AXIAL_300}' is not present locally — run 'git lfs pull'.`,
    );
  });

  test('volume viewport renders for multi-slice CT', async ({ page }) => {
    // Wait for any panel testid to appear (either volume or stack root).
    // This is the diagnostic step — if neither shows, the panel isn't
    // mounting at all.
    const volumeRoot = page.locator('[data-testid="volume-viewport:panel_0"]');
    const stackRoot = page.locator('[data-testid="stack-viewport:panel_0"]');

    await Promise.race([
      volumeRoot.waitFor({ state: 'attached', timeout: 30_000 }),
      stackRoot.waitFor({ state: 'attached', timeout: 30_000 }),
    ]);

    // Diagnostic: which root did we get?
    const volumeAttached = (await volumeRoot.count()) > 0;
    const stackAttached = (await stackRoot.count()) > 0;
    const errorText = volumeAttached
      ? await page.locator('[data-testid="volume-viewport-error:panel_0"]').textContent().catch(() => null)
      : null;

    console.log(`[volume-mode E2E] volumeAttached=${volumeAttached} stackAttached=${stackAttached} errorText=${errorText ?? 'none'}`);

    await expect(
      volumeRoot,
      'multi-slice CT should render via VolumeViewport, not the stack-mode StackViewport',
    ).toBeAttached();

    const volumeCanvas = page.locator('[data-testid="volume-viewport-canvas:panel_0"] canvas');
    await expect(volumeCanvas).toBeVisible({ timeout: 30_000 });

    const errorOverlay = page.locator('[data-testid="volume-viewport-error:panel_0"]');
    await expect(errorOverlay).toBeHidden();
  });

  test('volume viewport supports wheel-scroll slice navigation', async ({ page }) => {
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
});
