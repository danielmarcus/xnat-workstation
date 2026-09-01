/**
 * Container approval (requirements D7.11) — the real panel affordance.
 *
 * Before this landed, the approve toggle was a `console.warn` no-op: `approvalOf` was
 * never passed to the projection, the confirm dialog was unmounted, and nothing
 * enforced the lock. This drives the whole loop through the real UI:
 *
 *   create a SEG → approve (confirm) → the container reports approved, its members
 *   are approved-locked, add/delete are disabled, and the draw gate refuses →
 *   revoke (confirm) → editing affordances return.
 *
 * The DICOM persistence half (ApprovalStatus round-tripping through a written file)
 * is covered by the dicomExportHelpers round-trip unit test; what a live XNAT does
 * with the attribute is CNDA-gated and NOT claimed here.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  clearAllContainers: () => void;
  getSegmentationIdByLabel: (label: string) => string | null;
  canDrawOnActiveViewport: () => { allowed: boolean; reason?: string };
}
type Win = { __XNAT_E2E__: E2EHooks };

const hook = <T,>(page: Page, fn: keyof E2EHooks, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    ([name, a]) => (window as unknown as Win).__XNAT_E2E__[name as keyof E2EHooks](...(a as [])),
    [fn, args] as const,
  ) as Promise<T>;

test.beforeEach(({ page }) => hook(page, 'clearAllContainers'));
test.afterEach(({ page }) => hook(page, 'clearAllContainers'));

test('approving a container edit-locks it until it is revoked', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await expect(panel.getByLabel('Rename container')).toBeVisible({ timeout: 15_000 });
  await panel.getByLabel('Rename container').press('Enter');
  await expect(panel.getByLabel('Rename member')).toBeVisible({ timeout: 10_000 });
  await panel.getByLabel('Rename member').press('Enter');

  // Baseline: unapproved → the toggle offers "Approve", the member is unlocked, and
  // the draw gate allows drawing into the active container.
  const approveToggle = panel.getByLabel('Approve');
  await expect(approveToggle).toBeVisible({ timeout: 10_000 });
  expect((await hook<{ allowed: boolean }>(page, 'canDrawOnActiveViewport')).allowed).toBe(true);

  // Approve → explicit confirmation (D7.11), not a silent toggle.
  await approveToggle.click();
  const dialog = page.getByText(/^Approve "/);
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Approve', exact: true }).last().click();

  // The row flips to the revoke affordance…
  await expect(panel.getByLabel('Revoke approval')).toBeVisible({ timeout: 10_000 });
  // …the member row shows the approved lock (not the session lock)…
  await expect(panel.locator('[data-testid^="member-row-"]').first().getByTitle('Approved-locked')).toBeVisible();
  // …add-member is disabled…
  await expect(panel.getByLabel('Add member')).toBeDisabled();
  // …and the draw gate refuses with an actionable reason.
  const blocked = await hook<{ allowed: boolean; reason?: string }>(page, 'canDrawOnActiveViewport');
  expect(blocked.allowed).toBe(false);
  expect(blocked.reason).toContain('approved');

  // Revoke → also confirmed → editing affordances return.
  await panel.getByLabel('Revoke approval').click();
  await expect(page.getByText(/^Revoke approval for "/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Revoke approval', exact: true }).last().click();

  await expect(panel.getByLabel('Approve')).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByLabel('Add member')).toBeEnabled();
  expect((await hook<{ allowed: boolean }>(page, 'canDrawOnActiveViewport')).allowed).toBe(true);
});
