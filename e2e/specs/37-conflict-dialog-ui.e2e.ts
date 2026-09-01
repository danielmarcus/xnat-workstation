/**
 * Conflict resolution UI (Transport TR4 / signal 27, visual acceptance). Drives the
 * REAL affordance — no setter shortcuts: a save conflict surfaces in-place as a
 * conflict badge on the container row; clicking it opens the H7 ConflictDialog;
 * clicking the real "Keep local" button re-bases + re-saves and the conflict clears.
 * The conflict itself is injected via the mock XNAT (external edit); resolution
 * routes through the panel → segmentationService → the injected transport.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (toolName: string) => void;
  setUnifiedBrushSize: (size: number) => void;
  installMockXnatTransport: () => void;
  flushContainerSave: (id: string) => Promise<void>;
  getTransportEntry: (id: string) => { phase: string; errorKind?: string; versionToken?: string } | null;
  injectTransportConflict: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

async function brush(page: Page) {
  const box = await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  await page.mouse.move(cx - 20, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy + 20, { steps: 4 });
  await page.mouse.up();
}

const entry = (page: Page, id: string) =>
  page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.getTransportEntry(s), id);

test('signal 27: a save conflict shows a row badge → ConflictDialog → Keep local resolves it', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  // Open the real panel + install the mock transport (autosave-to-XNAT opt-in on).
  await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.installMockXnatTransport());

  // Create a Segmentation from the header (real create flow) → read its id from the row.
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  await panel.getByLabel('Rename member').press('Enter');
  const row = panel.locator('[data-testid^="container-row-"]').first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  const segId = (await row.getAttribute('data-testid'))!.replace('container-row-', '');

  // Paint + first save → idle, no conflict badge.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(25));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Brush'));
  await brush(page);
  await page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.flushContainerSave(s), segId);
  await expect.poll(async () => (await entry(page, segId))?.phase, { timeout: 10_000 }).toBe('idle');
  await expect(panel.locator('[data-testid="conflict-badge"]')).toHaveCount(0);

  // External edit on the server → the next save conflicts.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.injectTransportConflict());
  await brush(page);
  await page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.flushContainerSave(s), segId);
  await expect.poll(async () => (await entry(page, segId))?.errorKind, { timeout: 10_000 }).toBe('conflict');

  // The conflict surfaces in-place as a badge on the row (no toast/banner).
  const badge = panel.locator('[data-testid="conflict-badge"]');
  await expect(badge).toBeVisible({ timeout: 10_000 });

  // Click it → the H7 ConflictDialog appears (the real modal).
  await badge.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Version conflict')).toBeVisible({ timeout: 10_000 });
  await dialog.screenshot({ path: 'test-results/conflict-dialog.png' });

  // Click the real "Keep local" button → rebase + resave → the conflict clears.
  await dialog.getByRole('button', { name: 'Keep local' }).click();
  await expect.poll(async () => (await entry(page, segId))?.phase, { timeout: 10_000 }).toBe('idle');
  expect((await entry(page, segId))?.errorKind).toBeUndefined();
  await expect(panel.locator('[data-testid="conflict-badge"]')).toHaveCount(0);
});
