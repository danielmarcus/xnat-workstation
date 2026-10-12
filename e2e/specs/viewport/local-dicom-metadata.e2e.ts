/**
 * Patient / study metadata of a LOCALLY imported series reaches both surfaces that
 * show it: the viewport overlay's default Study Date + Institution fields, and the
 * DICOM Tags side panel.
 *
 * Both were empty for local files. The overlay read Cornerstone's legacy modules with
 * the wrong shapes (studyDate is a parsed {year,month,day}, and no legacy module
 * carries InstitutionName at all), and the Tags panel looked the dataset up under the
 * raw `dicomfile:N` id instead of the fileManager index the loader caches it by.
 *
 * Drives the real path: Import <input> → loader → overlay; toolbar Tags button → panel.
 * ct-axial-300 (e2e/fixtures/dicom/generate.cjs): PatientName PHANTOM^SPHERE,
 * StudyDate 20260101, InstitutionName "XNAT E2E PHANTOM".
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

test('overlay shows the study date and institution of a local import', async ({ page }: { page: Page }) => {
  await loadFixture(page, 'ct-axial-300');

  await expect(page.locator('[data-testid="overlay-field-studyDate:panel_0"]')).toHaveText('2026-01-01', {
    timeout: 20_000,
  });
  await expect(page.locator('[data-testid="overlay-field-institutionName:panel_0"]')).toHaveText(
    'XNAT E2E PHANTOM',
  );
});

test('Tags panel lists the header of a local import', async ({ page }: { page: Page }) => {
  await loadFixture(page, 'ct-axial-300');

  await page.getByRole('button', { name: 'Tags' }).click();

  const panel = page.getByRole('complementary', { name: 'DICOM tags' });
  const patientName = panel.locator('[data-tag="(0010,0010)"]');
  await expect(patientName).toContainText('Patient', { timeout: 20_000 });
  await expect(patientName).toContainText('PHANTOM^SPHERE');
  await expect(panel.getByText('No DICOM tags available for this image.')).toHaveCount(0);
});

test('Hide PHI masks the overlay and the Tags panel of a local import', async ({ page }: { page: Page }) => {
  // Hide PHI (SegWorks parity branch 2, R1) could only be checked by component tests while
  // local imports showed no overlay date / institution and an empty Tags panel; with those
  // real, the masking is checked here on the real surfaces.
  await loadFixture(page, 'ct-axial-300');
  const institution = page.locator('[data-testid="overlay-field-institutionName:panel_0"]');
  const studyDate = page.locator('[data-testid="overlay-field-studyDate:panel_0"]');
  await expect(institution).toHaveText('XNAT E2E PHANTOM', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Tags' }).click();
  const panel = page.getByRole('complementary', { name: 'DICOM tags' });
  const patientName = panel.locator('[data-tag="(0010,0010)"]');
  await expect(patientName).toContainText('PHANTOM^SPHERE', { timeout: 20_000 });

  await page.getByRole('button', { name: 'Hide PHI' }).click();
  await expect(institution).toHaveCount(0);
  await expect(studyDate).toHaveCount(0);
  await expect(patientName).not.toContainText('PHANTOM^SPHERE');
  await expect(patientName.locator('[data-testid^="phi-masked:"]')).toBeVisible();

  await page.getByRole('button', { name: 'Hide PHI' }).click();
  await expect(institution).toHaveText('XNAT E2E PHANTOM');
  await expect(patientName).toContainText('PHANTOM^SPHERE');
});
