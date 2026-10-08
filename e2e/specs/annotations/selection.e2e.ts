/**
 * Annotations panel — one row state (supersedes the two-state D7.5 model).
 *
 * A row used to have two blue states: single-click "selected" (a ring; meant for
 * multi-member bulk actions that were never built) and double-click "active" (a left
 * bar; the draw target). Single-click changed neither the toolbox nor the brush, so it
 * read as a state that did nothing. Now a single click makes the member ACTIVE — the
 * draw target the toolbox names — and that is the only row state. Shift/Ctrl-click does
 * not build a set.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

const panelOf = (page: Page) => page.locator('[data-testid="annotations-side-panel"]');
const row = (page: Page, id: string) => panelOf(page).locator(`[data-testid="member-row-${id}"]`);

async function setupTwoMemberSeg(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  const panel = panelOf(page);
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Create a Segmentation (member "Segment 1"). Create captures keystrokes into the
  // labels with focus left on the viewport; Escape ends that sequence, keeping the
  // default names, which is what this test wants.
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');

  // A second member via the container "+", so there are two rows to select between.
  await panel.getByRole('button', { name: 'Add member' }).click();
  await page.keyboard.press('Escape');

  await expect(row(page, '1')).toBeVisible({ timeout: 10_000 });
  await expect(row(page, '2')).toBeVisible({ timeout: 10_000 });
}

type Win = { __XNAT_E2E__: { getActiveSegmentationState: () => { activeSegmentIndex: number } } };
const activeIndex = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveSegmentationState().activeSegmentIndex);

test('a single click makes the member active — the one row state; Shift-click does not build a set', async ({ page }) => {
  await setupTwoMemberSeg(page);
  const r1 = row(page, '1');
  const r2 = row(page, '2');
  const toolbox = panelOf(page).locator('[data-testid="context-toolbox"]');

  await r1.getByText('Segment 1').click();
  await expect(r1, 'the clicked member is active').toHaveAttribute('data-active', 'true');
  await expect(r2).toHaveAttribute('data-active', 'false');
  await expect(toolbox.getByText('Segment 1', { exact: true }).first(), 'the toolbox names it').toBeVisible();
  await expect.poll(() => activeIndex(page), { message: 'and the brush targets it' }).toBe(1);

  await r2.getByText('Segment 2').click();
  await expect(r2).toHaveAttribute('data-active', 'true');
  await expect(r1).toHaveAttribute('data-active', 'false');
  await expect.poll(() => activeIndex(page)).toBe(2);

  // Shift-click is a plain click: it moves the one state, it does not add to a set.
  await r1.getByText('Segment 1').click({ modifiers: ['Shift'] });
  await expect(r1).toHaveAttribute('data-active', 'true');
  await expect(r2).toHaveAttribute('data-active', 'false');

  // No second state: no row carries a separate "selected" mark.
  await expect(panelOf(page).locator('[data-selected]'), 'no separate selected state').toHaveCount(0);
});
