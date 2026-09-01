/**
 * Annotations side panel — live end-to-end (Rebuild Phase 3, R3.8 / signal 31).
 *
 * Drives the REAL panel (no setter shortcuts): open it from the toolbar, create a
 * container from the header, and verify the create-in-edit-mode + the context
 * toolbox light up — the §8.0 behavioural acceptance for the rebuilt panel mounted
 * on the Segment toggle.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

const openPanel = (page: Page) => page.getByRole('button', { name: 'Show segmentation panel' }).click();

test('the rebuilt Annotations panel opens, creates a container, and shows the toolbox', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  // Open the panel from the toolbar.
  await openPanel(page);
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // A scan is loaded but there are no annotations yet → empty state + enabled create.
  await expect(panel.getByText('No annotations yet')).toBeVisible();
  const createSeg = panel.getByRole('button', { name: 'New Segmentation (SEG)' });
  await expect(createSeg).toBeEnabled();

  // Create a Segmentation from the header.
  await createSeg.click();

  // Create-in-edit-mode (D7.6): the new container's name drops into an inline edit.
  await expect(panel.getByLabel('Rename container')).toBeVisible({ timeout: 15_000 });
  // The empty state is gone — a container now exists.
  await expect(panel.getByText('No annotations yet')).toHaveCount(0);

  // Commit the container name → the default member enters edit (two-step create).
  await panel.getByLabel('Rename container').press('Enter');
  await expect(panel.getByLabel('Rename member')).toBeVisible({ timeout: 10_000 });
  await panel.getByLabel('Rename member').press('Enter');

  // The active member lit up the kind-adaptive toolbox.
  await expect(panel.locator('[data-testid="context-toolbox"]')).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByText('Segmentation tools')).toBeVisible();
});
