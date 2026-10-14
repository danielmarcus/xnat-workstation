/**
 * Fixture validation — rtstruct-typed loads through the app's real loader.
 *
 * Offline (no XNAT): load the rtstruct-typed dataset (source CT slices + the
 * hand-built RTSTRUCT, shared UIDs) via the app's local-import path and confirm
 * the RTSTRUCT parses + attaches as a structure container. This is the "loads
 * in-harness" gate for the hand-built RTSTRUCT fixture (S4).
 */
import { test, expect } from '../../fixtures/electron-app';
import { ensureFixture, enterLocalViewer, loadLocalDicom } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: { getSegmentationCount: () => number } };

test('rtstruct-typed loads as a structure container', async ({ page }) => {
  const files = ensureFixture('rtstruct-typed'); // source slices + rtstruct.dcm
  await enterLocalViewer(page);
  await loadLocalDicom(page, files);

  // The RTSTRUCT should parse + attach as a (contour) segmentation container.
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getSegmentationCount()),
      { timeout: 20_000, message: 'rtstruct-typed should load as >=1 container' },
    )
    .toBeGreaterThan(0);

  const label = await page.evaluate(() => {
    const w = window as unknown as { __XNAT_E2E__: { getSegmentationIdByLabel: (l: string) => string | null } };
    return w.__XNAT_E2E__.getSegmentationIdByLabel('RTSTRUCT-TYPED');
  });
  // eslint-disable-next-line no-console
  console.log('[fixture] rtstruct-typed container id by label:', label);
});

/**
 * #99 item 5 (ledger T12): a loaded contour takes its plane from its OWN points, not from
 * the camera of the viewport it is loaded into. The fixture's contours are axial squares;
 * importing the RTSTRUCT while the viewport shows the volume SAGITTALLY tagged every one
 * with the sagittal normal — and Cornerstone, which matches a contour to a view by its
 * normal, then drew them in no axial view.
 */
test('an RTSTRUCT imported onto a sagittal view keeps its contours\' own (axial) plane', async ({ page }) => {
  const files = ensureFixture('rtstruct-typed');
  const slices = files.filter((f) => !f.endsWith('rtstruct.dcm'));
  const rtstruct = files.filter((f) => f.endsWith('rtstruct.dcm'));
  expect(rtstruct).toHaveLength(1);
  await enterLocalViewer(page);
  await loadLocalDicom(page, slices);
  const select = page.locator('[data-testid="orientation-select:panel_0"]');
  await select.selectOption('SAGITTAL');
  await expect(select).toHaveValue('SAGITTAL');
  await page.waitForTimeout(500);
  // The RTSTRUCT alone, through the same Import.
  await page.locator('[data-testid="local-import-input"]').setInputFiles([]);
  await page.locator('[data-testid="local-import-input"]').setInputFiles(rtstruct);

  type Shapes = { __XNAT_E2E__: { getContourShapes: () => Array<{ polyline: string; viewPlaneNormal: number[] | null }> } };
  const shapes = () => page.evaluate(() => (window as unknown as Shapes).__XNAT_E2E__.getContourShapes());
  await expect.poll(async () => (await shapes()).length, { timeout: 20_000 }).toBeGreaterThan(0);
  for (const s of await shapes()) {
    // Every point of the contour has one z: it lies in an axial plane.
    const zs = new Set((JSON.parse(s.polyline) as number[][]).map((p) => p[2]));
    expect(zs.size).toBe(1);
    expect(s.viewPlaneNormal, 'the contour carries a plane normal').not.toBeNull();
    expect(Math.abs(s.viewPlaneNormal![2]), `normal ${JSON.stringify(s.viewPlaneNormal)} is the contour's own (axial)`).toBeCloseTo(1, 3);
  }
});
