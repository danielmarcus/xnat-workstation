/**
 * Annotations panel — selection model (Rebuild Phase 3 / signal 33, A11 / D7.5).
 *
 * Drives the REAL panel: single-click a member selects it (replacing any prior
 * selection); ctrl-click builds a selection SET; and selection is INDEPENDENT of
 * the active (draw-target) member. (Activate-sets-draw-target is covered by spec 31
 * — the toolbox only appears once a member is active — and the unit tests.)
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

const panelOf = (page: Page) => page.locator('[data-testid="annotations-side-panel"]');
const row = (page: Page, id: string) => panelOf(page).locator(`[data-testid="member-row-${id}"]`);

async function setupTwoMemberSeg(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  const panel = panelOf(page);
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Create a Segmentation (member "Segment 1"), commit the two-step rename.
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  await panel.getByLabel('Rename member').press('Enter');

  // Add a second member via the container "+", commit its name.
  await panel.getByRole('button', { name: 'Add member' }).click();
  await panel.getByLabel('Rename member').press('Enter');

  await expect(row(page, '1')).toBeVisible({ timeout: 10_000 });
  await expect(row(page, '2')).toBeVisible({ timeout: 10_000 });
}

test('single-click selects (replacing); ctrl-click builds a set; selection is independent of active', async ({ page }) => {
  await setupTwoMemberSeg(page);
  const r1 = row(page, '1');
  const r2 = row(page, '2');

  // Whichever member is active after setup stays active across pure selection clicks.
  const activeBefore = await r1.getAttribute('data-active');

  // Single-click member 1 → only member 1 selected.
  await r1.getByText('Segment 1').click();
  await expect(r1).toHaveAttribute('data-selected', 'true');
  await expect(r2).toHaveAttribute('data-selected', 'false');

  // Single-click member 2 → selection REPLACED (only member 2).
  await r2.getByText('Segment 2').click();
  await expect(r2).toHaveAttribute('data-selected', 'true');
  await expect(r1).toHaveAttribute('data-selected', 'false');

  // Shift-click member 1 → both selected (a SET). (Shift, not Control: on macOS
  // Control+click is a secondary/right click, so the left-click handler wouldn't fire.)
  await r1.getByText('Segment 1').click({ modifiers: ['Shift'] });
  await expect(r1).toHaveAttribute('data-selected', 'true');
  await expect(r2).toHaveAttribute('data-selected', 'true');

  // Selection never changed which member is active (independent — D7.5).
  expect(await r1.getAttribute('data-active')).toBe(activeBefore);
});
