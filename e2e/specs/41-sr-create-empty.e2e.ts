/**
 * New Measurement (SR) create-empty (D7.1) — live panel end-to-end.
 *
 * Click the header "New Measurement (SR)" button → an empty SR container is created,
 * drops into create-in-edit-mode, and persists as a listed container (0 members) after
 * naming. Drives the real panel + the real annotationStore SR-container path (no setter
 * shortcuts). Multi-SR routing of drawn measurements is unit-tested (containerProjection
 * + annotationStore); this verifies the create-empty affordance.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks { setMultiviewportEnabled: (v: boolean) => void }
type Win = { __XNAT_E2E__: E2EHooks };

const openPanel = (page: Page) => page.getByRole('button', { name: 'Show segmentation panel' }).click();

test('the "New Measurement (SR)" button creates an empty, named, listed container (D7.1)', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  await openPanel(page);
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText('No annotations yet')).toBeVisible();

  const createSr = panel.getByRole('button', { name: 'New Measurement (SR)' });
  await expect(createSr).toBeEnabled();
  await createSr.click();

  // Create-in-edit-mode: the new SR container's name drops into an inline edit, and the
  // empty state is gone (a container now exists even though it has no measurements).
  await expect(panel.getByLabel('Rename container')).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText('No annotations yet')).toHaveCount(0);

  // Name it → it persists as a listed SR container with zero members.
  await panel.getByLabel('Rename container').fill('Lesions');
  await panel.getByLabel('Rename container').press('Enter');
  const srRow = panel.locator('[data-testid^="container-row-sr:"]');
  await expect(srRow).toBeVisible({ timeout: 10_000 });
  await expect(srRow.getByText('Lesions')).toBeVisible();
  await expect(srRow.locator('[data-testid="member-count"]')).toHaveText('0');
});
