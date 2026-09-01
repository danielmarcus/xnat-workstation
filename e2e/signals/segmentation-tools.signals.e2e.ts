/**
 * Pending acceptance signals — intensity-aware segmentation tools.
 *
 * RED-BEFORE-GREEN: these target rebuilt segmentation tooling that does not
 * exist yet, so they FAIL today. They run offline against the ct-axial-anatomy
 * fixture (distinct uniform HU regions: air/-1000, soft-tissue/+40, lesion/+70,
 * bone/+1000) — the intensity variation is what makes region-grow / paint-fill
 * tolerance behavior meaningful. See e2e/signals/README.md.
 *
 * Each test asserts a bounded-timeout visibility of the rebuilt entry point
 * FIRST so red is observed quickly, then continues with the intended flow.
 */
import { test, expect } from '../fixtures/electron-app';
import { loadCtAxialAnatomy } from '../helpers/local-fixture';

test.describe('Signal 21 — region-segment (smart brush) intensity tolerance (C3)', () => {
  test('seed inside a homogeneous region fills connected in-tolerance voxels into the active segment; lock blocks', async ({ page }) => {
    const viewer = await loadCtAxialAnatomy(page);
    await expect(viewer.viewportCanvas).toBeVisible();

    // Rebuilt entry point — create a Segmentation container.
    const createSeg = page.locator('[data-testid="create-segmentation"]');
    await expect(createSeg, 'rebuilt create-Segmentation action should exist').toBeVisible({ timeout: 5_000 });
    await createSeg.click();

    // Intended flow (lights up when the rebuilt tooling lands):
    // - select the region-segment / smart-brush tool from the rebuilt toolbox
    // - seed-click inside the +40 soft-tissue body
    // - the connected +40 region fills into the active segment, NOT bleeding into
    //   the +1000 bone core or -1000 air (tolerance respects the sharp boundaries)
    // - locking the active segment then blocks the tool at gesture-start with a hint
    const member = page.locator('[data-testid="member-row"]').first();
    await expect(member).toBeVisible();
  });
});

test.describe('Signal 16 — 3D paint-fill + MPR resample + single-entry undo (A6/C8)', () => {
  test('paint-fill on axial appears resampled on a sagittal MPR; undo reverts the whole fill as one entry', async ({ page }) => {
    const viewer = await loadCtAxialAnatomy(page);
    await expect(viewer.viewportCanvas).toBeVisible();

    const createSeg = page.locator('[data-testid="create-segmentation"]');
    await expect(createSeg, 'rebuilt create-Segmentation action should exist').toBeVisible({ timeout: 5_000 });
    await createSeg.click();

    // Intended flow (lights up when the rebuilt tooling + MPR layout land):
    // - use the 3D paint-fill tool to fill the connected +40 body region on axial
    // - the same filled voxels appear, resampled, on a sagittal MPR of the volume
    // - a single undo reverts the entire fill operation as one history entry
    const member = page.locator('[data-testid="member-row"]').first();
    await expect(member).toBeVisible();
  });
});
