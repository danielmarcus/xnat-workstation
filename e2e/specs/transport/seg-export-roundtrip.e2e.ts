/**
 * A SEG exported from painted app state is valid DICOM and loads back with the same mask.
 *
 * Nothing exercised the real export on real app state: the compliance suite builds its
 * SEG from hand-made fixtures, and transport specs stub serialization. Cornerstone 5 broke
 * SEG output once already (the adapter dropped Type 1 / 1C attributes from every frame's
 * DerivationImageSequence) — this is the end-to-end guard: paint through the panel,
 * export through `segmentationService.exportToDicomSeg`, validate with dciodvfy, re-import
 * through the local-file loader, and compare voxels.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer, loadLocalDicom } from '../../helpers/local-fixture';

type Win = {
  __XNAT_E2E__: {
    resetUnifiedSegmentations: () => void;
    setUnifiedBrushSize: (n: number) => void;
    getPaintedVoxelCount: () => number;
    getActiveSegmentationState: () => { activeSegmentationId: string | null; activeSegmentIndex: number };
    exportSegBase64: (segmentationId: string) => Promise<string>;
    getSegmentationCount: () => number;
  };
};

const DCIODVFY = process.env.DCIODVFY_BIN || join(process.env.HOME ?? '', '.local/bin/dciodvfy');
const painted = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());

test('a painted SEG exports as valid DICOM and loads back with the same voxels', async ({ page }) => {
  const sources = ensureFixture('ct-axial-300');
  await enterLocalViewer(page);
  await loadLocalDicom(page, sources);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await expect(panel.locator('[data-testid^="member-row-"]').first()).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(12));

  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => painted(page), { message: 'the stroke paints' }).toBeGreaterThan(0);
  const before = await painted(page);

  const segId = await page.evaluate(
    () => (window as unknown as Win).__XNAT_E2E__.getActiveSegmentationState().activeSegmentationId,
  );
  expect(segId, 'the new segmentation is active').toBeTruthy();
  const base64 = await page.evaluate((id) => (window as unknown as Win).__XNAT_E2E__.exportSegBase64(id!), segId);

  const dir = mkdtempSync(join(tmpdir(), 'xnatws-seg-export-'));
  const segPath = join(dir, 'exported-seg.dcm');
  writeFileSync(segPath, Buffer.from(base64, 'base64'));

  // dciodvfy reports IOD violations as "Error - …" lines; warnings are informational.
  const v = spawnSync(DCIODVFY, ['-new', segPath], { encoding: 'utf8' });
  expect(v.error, `dciodvfy must be runnable (${DCIODVFY})`).toBeUndefined();
  const errors = `${v.stdout}\n${v.stderr}`.split('\n').filter((l) => l.startsWith('Error'));
  expect(errors, 'the exported SEG must pass dciodvfy').toEqual([]);

  // Round trip: load the source series plus the exported SEG, as a user importing both.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  expect(await painted(page), 'cleared before re-import').toBe(0);
  await loadLocalDicom(page, [...sources, segPath]);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getSegmentationCount()), {
      timeout: 20_000,
      message: 'the exported SEG loads as a container',
    })
    .toBeGreaterThan(0);
  await expect.poll(() => painted(page), { timeout: 20_000, message: 'the mask comes back voxel for voxel' }).toBe(before);
});
