/**
 * Local-fixture E2E helpers (annotation rebuild, Phase 0).
 *
 * Drive the app fully offline — no live XNAT, no network — by:
 *   1. forcing the connection store into a synthetic "connected" state
 *      (window.__XNAT_E2E__.enterLocalViewer), so the viewer chrome renders;
 *   2. loading a synthetic DICOM fixture through the app's real local-import
 *      path (the toolbar Import <input type=file>, => App.loadLocalFiles).
 *
 * Fixtures are generated on demand (e2e/fixtures/dicom/generate.cjs) so the
 * suite is reproducible on a clean checkout without a manual pre-step.
 */
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { expect, type Page } from '@playwright/test';
import { ViewerPage } from '../pages/viewer.page';

const DICOM_FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures', 'dicom');

/** Absolute path to a generated fixture dataset directory. */
export function fixtureDir(datasetName: string): string {
  return path.join(DICOM_FIXTURES_DIR, datasetName);
}

function listDicomFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.dcm'))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Ensure a fixture dataset exists on disk, generating it on demand if missing.
 * Returns the sorted list of slice file paths.
 */
export function ensureFixture(datasetName: string): string[] {
  const dir = fixtureDir(datasetName);
  let files = listDicomFiles(dir);
  if (files.length === 0) {
    const generator = path.join(DICOM_FIXTURES_DIR, 'generate.cjs');
    execFileSync(process.execPath, [generator, datasetName], { stdio: 'inherit' });
    files = listDicomFiles(dir);
  }
  if (files.length === 0) {
    throw new Error(
      `No DICOM fixtures found in ${dir} after generation. Run: node e2e/fixtures/dicom/generate.cjs ${datasetName}`,
    );
  }
  return files;
}

/** Back-compat: ct-axial-300 dataset directory + ensure. */
export function ctAxial300Dir(): string {
  return fixtureDir('ct-axial-300');
}
export function ensureCtAxial300(): string[] {
  return ensureFixture('ct-axial-300');
}

/**
 * Force the app into the viewer state offline (no XNAT) and wait for the
 * Import affordance to be present.
 */
export async function enterLocalViewer(page: Page): Promise<void> {
  const ok = await page.evaluate(() => {
    const e2e = (window as unknown as { __XNAT_E2E__?: { enterLocalViewer?: () => void } }).__XNAT_E2E__;
    if (!e2e?.enterLocalViewer) return false;
    e2e.enterLocalViewer();
    return true;
  });
  if (!ok) {
    throw new Error('window.__XNAT_E2E__.enterLocalViewer is unavailable (E2E hooks not installed?)');
  }
  // The Import input is hidden (className="hidden"); wait for it to be attached.
  await page.locator('[data-testid="local-import-input"]').waitFor({ state: 'attached', timeout: 15_000 });
}

/**
 * Load a local DICOM stack via the app's Import <input type=file> path and wait
 * for the viewport to finish rendering.
 */
export async function loadLocalDicom(page: Page, filePaths: string[], panelId = 'panel_0'): Promise<ViewerPage> {
  await page.locator('[data-testid="local-import-input"]').setInputFiles(filePaths);
  const viewer = new ViewerPage(page, panelId);
  await viewer.waitForImageLoaded();
  return viewer;
}

/** Enter the viewer offline and load a named fixture dataset into a panel. */
export async function loadFixture(page: Page, datasetName: string, panelId = 'panel_0'): Promise<ViewerPage> {
  const files = ensureFixture(datasetName);
  await enterLocalViewer(page);
  const viewer = await loadLocalDicom(page, files, panelId);
  expect(files.length).toBeGreaterThan(1); // sanity: a multi-slice stack
  return viewer;
}

/** Convenience: load the ct-axial-300 binary sphere phantom. */
export function loadCtAxial300(page: Page, panelId = 'panel_0'): Promise<ViewerPage> {
  return loadFixture(page, 'ct-axial-300', panelId);
}

/** Convenience: load the ct-axial-anatomy intensity-varied phantom. */
export function loadCtAxialAnatomy(page: Page, panelId = 'panel_0'): Promise<ViewerPage> {
  return loadFixture(page, 'ct-axial-anatomy', panelId);
}
