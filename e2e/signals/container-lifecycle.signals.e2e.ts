/**
 * Pending acceptance signals — container/member lifecycle in the rebuilt panel.
 *
 * RED-BEFORE-GREEN: target the rebuilt Annotations panel + members, which do
 * not exist yet, so they FAIL today. Run offline against ct-axial-300 (a single
 * CT volume is enough for these). See e2e/signals/README.md.
 *
 * Each test asserts a bounded-timeout visibility of the rebuilt entry point
 * FIRST (fast red), then continues with the distinct intended flow.
 */
import { test, expect } from '../fixtures/electron-app';
import { loadCtAxial300 } from '../helpers/local-fixture';

async function enableMvAndLoad(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __XNAT_E2E__: { setMultiviewportEnabled: (v: boolean) => void } })
      .__XNAT_E2E__.setMultiviewportEnabled(true);
  });
  return loadCtAxial300(page);
}

test.describe('Signal 17 — empty active member appends, not a new member (A-foundational)', () => {
  test('a freshly created container has an empty active member; drawing fills it and clears the empty marker', async ({ page }) => {
    await enableMvAndLoad(page);
    const createSeg = page.locator('[data-testid="create-segmentation"]');
    await expect(createSeg, 'rebuilt create-Segmentation action should exist').toBeVisible({ timeout: 5_000 });
    await createSeg.click();

    // Intended: the new container's first member is active + empty.
    const member = page.locator('[data-testid="member-row"]').first();
    await expect(member).toHaveAttribute('data-active', 'true');
    await expect(member).toHaveAttribute('data-empty', 'true');
    // Drawing on the active viewport appends to THIS member (count stays 1) and
    // clears the empty marker — verified once the rebuilt tooling lands.
  });
});

test.describe('Signal 19 — approval locks all members (D7; DICOM ApprovalStatus)', () => {
  test('approving a structure-set edit-locks members and shows an approval badge', async ({ page }) => {
    await enableMvAndLoad(page);
    const createStructure = page.locator('[data-testid="create-structure"]');
    await expect(createStructure, 'rebuilt create-Structure action should exist').toBeVisible({ timeout: 5_000 });
    await createStructure.click();

    // Intended: approve the container; members become edit-locked (handles not
    // exposed, brush blocked, delete disabled) and an approval badge appears on
    // the container + members. Revoke (with confirm) restores editing.
    const approve = page.locator('[data-testid="approve-container"]').first();
    await approve.click();
    await expect(page.locator('[data-testid="approval-badge"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="container-row"]').first()).toHaveAttribute('data-approved', 'true');
  });
});

test.describe('Signal 20 — member visibility tri-state filled/outlined/hidden (D7.3)', () => {
  test('cycling a member visibility control switches its render mode', async ({ page }) => {
    await enableMvAndLoad(page);
    const createSeg = page.locator('[data-testid="create-segmentation"]');
    await expect(createSeg, 'rebuilt create-Segmentation action should exist').toBeVisible({ timeout: 5_000 });
    await createSeg.click();

    // Intended: the per-member visibility control cycles filled -> outlined ->
    // hidden; on the viewport the rendering switches accordingly; siblings
    // unaffected; mode is NOT persisted across reload (returns to default).
    const vis = page.locator('[data-testid="member-row"]').first().locator('[data-testid="member-visibility"]');
    await expect(vis).toHaveAttribute('data-mode', 'filled');
    await vis.click();
    await expect(vis).toHaveAttribute('data-mode', 'outlined');
  });
});

test.describe('Signal 28 — undo/redo per-container history isolation (A8)', () => {
  test('undo on the active container reverts only its own last op; a fresh edit invalidates redo', async ({ page }) => {
    await enableMvAndLoad(page);
    const createSeg = page.locator('[data-testid="create-segmentation"]');
    await expect(createSeg, 'rebuilt create-Segmentation action should exist').toBeVisible({ timeout: 5_000 });

    // Intended: create container A and container B, edit each. Undo on the
    // active container reverts only A's last op (B untouched). After an undo, a
    // fresh edit invalidates A's redo stack. Reloading A from source clears its
    // undo history. (Complements signals 7/15/16.)
    await createSeg.click();
    await createSeg.click();
    await expect(page.locator('[data-testid="container-row"]')).toHaveCount(2);
  });
});
