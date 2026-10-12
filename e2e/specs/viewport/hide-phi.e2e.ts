/**
 * Hide PHI (SegWorks parity D7 — docs/mockup/segworks-wireframes.html §9): the toolbar
 * toggle (and ⇧H) hides patient-identifying fields in the viewport overlay and masks PHI
 * values in the DICOM header panel, one-at-a-time reveal; XNAT labels and acquisition
 * fields stay; the setting survives a reload.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

const toggle = (page: Page) => page.getByRole('button', { name: 'Hide PHI' });

async function setHidden(page: Page, hidden: boolean) {
  const pressed = (await toggle(page).getAttribute('aria-pressed')) === 'true';
  if (pressed !== hidden) await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', String(hidden));
}

/** The toolbar exists once the viewer is open; start every test with PHI shown. */
async function viewer(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await setHidden(page, false);
}
test.afterEach(async ({ page }) => {
  if (await toggle(page).isVisible()) await setHidden(page, false);
});

/*
 * The overlay's own PHI fields (patient name/ID, study date, institution) are covered by
 * the ViewportOverlay component test: on locally loaded fixtures the patient and
 * general-study metadata modules come back empty, so those fields never render here even
 * with Hide PHI off — nothing to observe disappearing. What E2E can and does check is that
 * hiding PHI leaves the acquisition fields alone.
 */
test('hiding PHI keeps the non-identifying overlay fields', async ({ page }) => {
  await viewer(page);
  await setHidden(page, true);
  await expect(page.getByTestId('overlay-field-seriesDescription:panel_0')).toBeVisible();
  await expect(page.getByTestId('overlay-field-imageIndex:panel_0')).toBeVisible();
  await expect(page.getByTestId('overlay-field-windowLevel:panel_0')).toBeVisible();
});

test('⇧H toggles it from the viewport', async ({ page }) => {
  await viewer(page);
  await page.locator('[data-testid="unified-viewport-element:panel_0"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+H');
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Shift+H');
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
});

// Header-panel masking is covered by DicomHeaderPanel.test: for locally imported files the
// Tags panel reads the wadouri cache and shows "No DICOM tags available", so there is nothing
// to mask in an offline E2E run.

test('the setting survives a reload', async ({ page }) => {
  await viewer(page);
  await setHidden(page, true);
  await page.reload();
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('overlay-field-studyDate:panel_0')).toHaveCount(0);
});
