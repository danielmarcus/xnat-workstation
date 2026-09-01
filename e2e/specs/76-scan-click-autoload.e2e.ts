/**
 * Signals 25 / 26 — annotations AUTO-LOAD when a scan is selected (A13), and a
 * same-session re-selection preserves what is already loaded.
 *
 * The retention + unsaved-banner halves of signal 26 are covered offline by spec 39.
 * The missing half was the browser-driven TRIGGER: nothing offline could exercise
 * "select a scan → its stored SEG/RTSTRUCT load themselves, with no manual load
 * action", because that path needs a session's scan list, a DICOMweb image source and
 * a derived-file download.
 *
 * This drives the real trigger with those three replaced at their existing seams:
 *   • `xnatScanApi` (the injection point that exists because contextBridge objects are
 *     immutable) serves the scan list + the SEG file — the SEG is the hand-built
 *     `seg-multilabel` fixture, a real DICOM SEG referencing the loaded series;
 *   • `dicomwebLoader.primeScanImageIds` seeds the scan → imageIds cache with the
 *     fixture's own imageIds, so the "source scan" resolves to the loaded series;
 *   • `App.loadFromXnatScan` — the REAL callback the XNAT browser's `onLoadScan`
 *     invokes — is called directly.
 *
 * NOT covered: the DOM click on a browser row and the real IPC/DICOMweb transport.
 * Those stay CNDA-gated.
 */
import fs from 'node:fs';
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer, loadLocalDicom } from '../helpers/local-fixture';

interface E2EHooks {
  getSegmentationCount: () => number;
  clearAllContainers: () => void;
  getPanelImageIds: (panelId: string) => string[];
  primeScanImageIds: (sessionId: string, scanId: string, imageIds: string[]) => void;
  setAutoLoadAnnotations: (enabled: boolean) => void;
  installFakeXnatScanApi: (config: {
    sessionId: string;
    scans: unknown[];
    filesByScanId: Record<string, string>;
  }) => void;
  restoreXnatScanApi: () => void;
}
interface AppHooks {
  loadFromXnatScan: (
    sessionId: string,
    scanId: string,
    scan: Record<string, unknown>,
    context: { projectId: string; subjectId: string; sessionLabel: string },
  ) => Promise<void>;
}
type Win = { __XNAT_E2E__: E2EHooks; __XNAT_E2E_APP__: AppHooks };

const SESSION = 'XNAT_AUTOLOAD_SESSION';
const SOURCE_SCAN_ID = '1';
const SEG_SCAN_ID = '3001';
const CONTEXT = { projectId: 'PRJ', subjectId: 'SUBJ', sessionLabel: 'AUTOLOAD' };

const hook = <T,>(page: Page, fn: keyof E2EHooks, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    ([name, a]) => (window as unknown as Win).__XNAT_E2E__[name as keyof E2EHooks](...(a as [])),
    [fn, args] as const,
  ) as Promise<T>;

const clickScan = (page: Page, scan: Record<string, unknown>, scanId: string) =>
  page.evaluate(
    ([sessionId, id, s, ctx]) =>
      (window as unknown as Win).__XNAT_E2E_APP__.loadFromXnatScan(
        sessionId as string,
        id as string,
        s as Record<string, unknown>,
        ctx as { projectId: string; subjectId: string; sessionLabel: string },
      ),
    [SESSION, scanId, scan, CONTEXT] as const,
  );

test.afterEach(async ({ page }) => {
  await hook(page, 'restoreXnatScanApi');
  await hook(page, 'clearAllContainers');
});

test('selecting a scan auto-loads its stored annotations, and re-selecting preserves them', async ({ page }) => {
  // The seg-multilabel fixture = source slices + a real SEG referencing them.
  const files = ensureFixture('seg-multilabel');
  const segFile = files.find((f) => f.endsWith('seg.dcm'));
  const sourceFiles = files.filter((f) => f !== segFile);
  expect(segFile, 'the seg-multilabel fixture should contain seg.dcm').toBeTruthy();

  await enterLocalViewer(page);
  await loadLocalDicom(page, sourceFiles);
  await hook(page, 'clearAllContainers');

  // Serve those loaded images as XNAT scan #1, and the SEG file as scan #3001
  // (the 30xx convention marks it as derived from scan 1).
  const panelImageIds = await hook<string[]>(page, 'getPanelImageIds', 'panel_0');
  expect(panelImageIds.length).toBeGreaterThan(0);
  await hook(page, 'primeScanImageIds', SESSION, SOURCE_SCAN_ID, panelImageIds);

  const sourceScan = { id: SOURCE_SCAN_ID, type: 'CT', modality: 'CT', seriesDescription: 'CT source', frames: sourceFiles.length };
  const segScan = {
    id: SEG_SCAN_ID,
    type: 'SEG',
    modality: 'SEG',
    xsiType: 'xnat:segScanData',
    seriesDescription: 'Stored segmentation',
    frames: 1,
  };
  await hook(page, 'installFakeXnatScanApi', {
    sessionId: SESSION,
    scans: [sourceScan, segScan],
    filesByScanId: { [SEG_SCAN_ID]: fs.readFileSync(segFile!).toString('base64') },
  });

  // Auto-display ON (A13): selecting the scan must load its annotations with no
  // further user action.
  await hook(page, 'setAutoLoadAnnotations', true);
  expect(await hook<number>(page, 'getSegmentationCount')).toBe(0);

  await clickScan(page, sourceScan, SOURCE_SCAN_ID);

  // Signal 25: the stored SEG loaded itself…
  await expect
    .poll(() => hook<number>(page, 'getSegmentationCount'), {
      timeout: 30_000,
      message: 'selecting the source scan should auto-load its stored SEG',
    })
    .toBeGreaterThan(0);
  // …and the Annotations panel opened itself to show it.
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('[data-testid^="member-row-"]').first()).toBeVisible({ timeout: 15_000 });
  const afterFirst = await hook<number>(page, 'getSegmentationCount');

  // Signal 26 (same-session half): re-selecting the same scan in the same session
  // preserves the loaded container — it is neither dropped nor duplicated.
  await clickScan(page, sourceScan, SOURCE_SCAN_ID);
  await page.waitForTimeout(2_000);
  expect(await hook<number>(page, 'getSegmentationCount')).toBe(afterFirst);
  await expect(panel).toBeVisible();
});
