/**
 * Phase-6 cutover parity — the silent in-place backup row (§3.4, frozen mockup §4).
 *
 * The rebuilt panel rendered `ContextToolbox.backupStatus` but nothing ever fed it,
 * so the local-auto-backup state the legacy SegmentationPanel footer showed
 * ("Backing up…" / "Backed up" / "Backup failed") was invisible in the new panel.
 * This drives the REAL panel (toolbar toggle → header create → live toolbox) and
 * asserts the row renders the live store state.
 *
 * Injection point: `segmentationStore._setAutoSaveStatus` — the producer
 * (`segmentationService.autoSaveToLocalBackup` → backupService) requires a live
 * XNAT session context (`viewerStore.xnatContext`), which the offline fixture
 * harness has no way to provide. The seam under test is the one that was broken:
 * store → useAnnotationsPanel → ContextToolbox render.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setLocalBackupStatus: (status: 'idle' | 'saving' | 'saved' | 'error') => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const openPanel = (page: Page) => page.getByRole('button', { name: 'Show segmentation panel' }).click();

const setBackupState = (page: Page, status: 'idle' | 'saving' | 'saved' | 'error') =>
  page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.setLocalBackupStatus(s), status);

test('the annotations toolbox surfaces the live local-backup state', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  await openPanel(page);
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Real create → the toolbox (which hosts the backup row) mounts.
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await expect(panel.getByLabel('Rename container')).toBeVisible({ timeout: 15_000 });
  await panel.getByLabel('Rename container').press('Enter');
  await expect(panel.getByLabel('Rename member')).toBeVisible({ timeout: 10_000 });
  await panel.getByLabel('Rename member').press('Enter');
  await expect(panel.locator('[data-testid="context-toolbox"]')).toBeVisible({ timeout: 10_000 });

  // Idle (nothing backed up yet) → no row at all.
  const row = panel.locator('[data-testid="backup-status"]');
  await expect(row).toHaveCount(0);

  // A backup in flight → the in-place row, never a toast/banner.
  await setBackupState(page, 'saving');
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row).toContainText('Backing up');

  // Completed → the mockup's "Backed up · <age>" text.
  await setBackupState(page, 'saved');
  await expect(row).toContainText('Backed up');

  // Failure is reported in the same row (not silently dropped).
  await setBackupState(page, 'error');
  await expect(row).toContainText('Backup failed');

  // Routine backup state stays silent: no toast, no banner.
  await expect(page.locator('[data-testid="toast"]')).toHaveCount(0);
});
