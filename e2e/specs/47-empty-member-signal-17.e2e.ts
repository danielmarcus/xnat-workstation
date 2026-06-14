/**
 * Phase 3/4 — signal 17 (empty member): an active member with no geometry shows the
 * "(empty)" marker; drawing appends to THAT member (not a new one) and the marker clears.
 *
 * MemberRow already renders "(empty)" for `empty`, but the panel never supplied the
 * resolver, so the marker was always dark. useAnnotationsPanel now computes emptyOf for
 * contour (RTSTRUCT) members from the contour-representation's annotationUIDsMap (no
 * geometry → empty); ContainerList threads it to the row.
 *
 * Faithful real-panel test: create a structure with one (empty) member → "(empty)" shows
 * and there is exactly ONE member row. Draw a contour into it → the marker clears and the
 * member count is STILL one (the geometry appended to the existing member, not a new one).
 * RED before the panel supplied emptyOf; GREEN once it's wired.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  resetUnifiedSegmentations: () => void;
  createTestStructure: (panelId: string, label: string) => Promise<string>;
  createTestContour: (panelId: string, segmentationId: string, segmentIndex?: number, provenance?: string) => string | null;
}
type Win = { __XNAT_E2E__: E2EHooks };

async function ensurePanelOpen(page: Page) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (await panel.isVisible()) return;
  await page.getByRole('button', { name: 'Show segmentation panel' }).click();
}

test('an empty member shows the "(empty)" marker; drawing appends to it and clears it (signal 17)', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  // A structure with one member, no geometry yet.
  const segId = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.createTestStructure('panel_0', 'GTV'));

  await ensurePanelOpen(page);
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });

  const memberRows = panel.locator('[data-testid^="member-row-"]');
  await expect(memberRows).toHaveCount(1, { timeout: 10_000 });
  await expect(panel.getByText('(empty)', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Draw a contour into that member.
  const uid = await page.evaluate(
    (id) => (window as unknown as Win).__XNAT_E2E__.createTestContour('panel_0', id, 1),
    segId,
  );
  expect(uid).toBeTruthy();

  // The marker clears (the member now has geometry) and there is STILL one member —
  // the contour appended to the existing member, it did not spawn a new one.
  await expect(panel.getByText('(empty)', { exact: true })).toHaveCount(0, { timeout: 10_000 });
  await expect(memberRows).toHaveCount(1);
});
