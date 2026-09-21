/**
 * An annotation reaches viewports that appear AFTER it was made.
 *
 * Switching to MPR, or otherwise mounting new viewports, must not leave an annotation
 * stranded on the plane it was created on. Measured before the fix: create through the
 * panel, then switch to MPR — 1 representation on panel_0, 0 on panel_1, for both a
 * Segmentation and a Structure.
 *
 * Distinct from the MPR case in same-scan-viewport-parity, which creates INTO an MPR that
 * is already up. That path is fixed by enumerating the mounted viewports at create time.
 * This is the other order — the viewport arrives second — and is handled where a viewport
 * mounts, not where a container is created.
 *
 * `unifiedSegService.attachExistingToViewport` already ran at exactly the right moment on
 * mount, but iterated only the containers that service created. Everything made through
 * the panel — every container a user has — was invisible to it.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: {
  resetUnifiedSegmentations: () => void;
  setLayoutPreset: (p: string) => void;
  getViewportSegRepCount: (p: string) => number;
}; };

const reps = (page: Page, panelId: string) =>
  page.evaluate((p) => (window as unknown as Win).__XNAT_E2E__.getViewportSegRepCount(p), panelId);

for (const kind of [
  { button: 'New Segmentation (SEG)', label: 'Segmentation' },
  { button: 'New Structure (RTSTRUCT)', label: 'Structure' },
]) {
  test(`a ${kind.label} created before switching to MPR reaches the new planes`, async ({ page }) => {
    await enterLocalViewer(page);
    await page.locator('[data-testid="local-import-input"]').setInputFiles([]);
    await page.locator('[data-testid="local-import-input"]').setInputFiles(ensureFixture('ct-axial-300'));
    await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas')).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

    const panel = page.locator('[data-testid="annotations-side-panel"]');
    if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Create FIRST, while there is a single viewport.
    await panel.getByRole('button', { name: kind.button }).click();
    await panel.getByLabel('Rename container').press('Enter');
    const memberRename = panel.getByLabel('Rename member');
    if (await memberRename.count()) await memberRename.press('Enter');
    await page.waitForTimeout(800);
    expect(await reps(page, 'panel_0'), 'it must be on the viewport it was made in').toBeGreaterThan(0);

    // THEN bring up the other planes.
    await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setLayoutPreset('mpr-2x2'));
    for (const pid of ['panel_1', 'panel_2']) {
      await expect(page.locator(`[data-testid="unified-viewport-element:${pid}"] canvas`)).toBeVisible({ timeout: 30_000 });
    }
    await page.waitForTimeout(2000);

    expect(
      await reps(page, 'panel_1'),
      'a plane that appears after the annotation was made must still receive it',
    ).toBeGreaterThan(0);
    expect(await reps(page, 'panel_2'), 'and so must the third plane').toBeGreaterThan(0);
  });
}
