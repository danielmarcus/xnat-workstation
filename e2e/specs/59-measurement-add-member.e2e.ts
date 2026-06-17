/**
 * Bug (user-reported): clicking the row "+" (Add member) on a Measurement (SR)
 * container threw `[segmentationService] Not a multi-layer group: sr:local:1` —
 * onAddMember routed every kind through the SEG addSegment path. A measurement has
 * no empty member; "+" must instead ready the container + a measurement tool so the
 * next drawn shape becomes its member.
 *
 * Real affordance: create a Measurement container → click its "+" → no error, the
 * Length tool is active, and drawing adds a measurement member to THAT container.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  getActiveUnifiedTool: () => string | null;
  clearAllContainers: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const cleanSlate = async (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
test.beforeEach(({ page }) => cleanSlate(page));
test.afterEach(({ page }) => cleanSlate(page));

test('Add-member "+" on a Measurement container readies drawing (no addSegment throw)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Create an empty Measurement (SR) container and name it.
  await panel.getByRole('button', { name: 'New Measurement (SR)' }).click();
  await panel.getByLabel('Rename container').fill('Lesions');
  await panel.getByLabel('Rename container').press('Enter');
  const srRow = panel.locator('[data-testid^="container-row-sr:"]');
  await expect(srRow).toBeVisible({ timeout: 10_000 });
  await expect(srRow.locator('[data-testid="member-count"]')).toHaveText('0');

  // Click the row "+" (Add member). Previously this threw.
  await srRow.getByLabel('Add member').click();

  // It readied a measurement tool (Length) instead of throwing the SEG addSegment error.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveUnifiedTool()), { timeout: 10_000 })
    .toBe('Length');
  expect(errors.join('\n')).not.toContain('Not a multi-layer group');

  // Drawing now adds a measurement member to THIS container (count 0 → 1).
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const cy = box!.y + box!.height / 2;
  await page.mouse.move(box!.x + box!.width * 0.35, cy);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.65, cy, { steps: 6 });
  await page.mouse.up();

  await expect(srRow.locator('[data-testid="member-count"]')).toHaveText('1', { timeout: 15_000 });
  await expect(panel.locator('[data-testid^="member-row-"]')).toHaveCount(1);
});
