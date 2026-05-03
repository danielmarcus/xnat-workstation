/**
 * Fixture-load helper for E2E specs that don't need a live XNAT.
 *
 * Drives __XNAT_E2E__.setFakeConnected + loadLocalDicomFiles + waits
 * for the relevant canvas (stack or volume) to be visible. Mirrors
 * the role the authenticatedPage fixture plays for live-XNAT specs:
 * one call gets the spec from "Electron just launched" to "viewport
 * is rendered with data, ready for assertions" — same code path the
 * production drag-and-drop import uses (wadouri.fileManager).
 *
 * If the fixture isn't on disk locally (CI without LFS pull, fresh
 * clone, etc.) the loader returns null and the spec should
 * test.skip() with a clear message.
 */
import type { Page } from '@playwright/test';
import {
  FIXTURE_NAMES,
  loadLocalDicomFixture,
  type FixtureName,
} from './local-dicom-fixtures';

export interface LoadFixtureScanOptions {
  /** Default 'panel_0'. */
  panelId?: string;
  /** Slice the fixture's image paths before passing them to the
   *  hook. Useful for keeping per-test loads small without committing
   *  multiple fixture variants. Default: all paths. */
  pathSlice?: { start?: number; end?: number };
  /** Timeout for waiting on the canvas (ms). Default 30_000. */
  canvasTimeout?: number;
}

export interface LoadedFixtureScanResult {
  fixtureName: FixtureName;
  panelId: string;
  imagePaths: string[];
  imageIds: string[];
}

/**
 * Open the viewer (without XNAT auth) and load a local fixture into
 * the named panel. Resolves once the panel's canvas is visible. Returns
 * `null` if the fixture isn't present on disk.
 */
export async function loadFixtureScan(
  page: Page,
  fixtureName: FixtureName,
  opts: LoadFixtureScanOptions = {},
): Promise<LoadedFixtureScanResult | null> {
  const fixture = await loadLocalDicomFixture(fixtureName);
  if (!fixture) return null;

  const panelId = opts.panelId ?? 'panel_0';
  const canvasTimeout = opts.canvasTimeout ?? 30_000;

  const imagePaths = fixture.imagePaths.slice(
    opts.pathSlice?.start ?? 0,
    opts.pathSlice?.end ?? fixture.imagePaths.length,
  );

  await page.waitForLoadState('domcontentloaded');

  // Wait until the renderer has installed the __XNAT_E2E__ surface
  // (initCornerstone has resolved). Without this, the first evaluate
  // call can race against the cornerstoneReady gate.
  await page.waitForFunction(() => !!window.__XNAT_E2E__, undefined, {
    timeout: 30_000,
  });

  await page.evaluate(() => window.__XNAT_E2E__?.setFakeConnected(true));

  // Drive the load. The bridge handles wadouri.fileManager registration
  // + metadata pre-load + setPanelImageIds.
  const result = await page.evaluate(
    async ([pid, paths]: [string, string[]]) => {
      const r = await window.__XNAT_E2E__!.loadLocalDicomFiles(pid, paths);
      return { imageIds: r.imageIds };
    },
    [panelId, imagePaths] as [string, string[]],
  );

  // Wait for whichever canvas root is mounted on the panel — either
  // the legacy stack viewport or the new volume viewport.
  const stackCanvas = page.locator(`[data-testid="stack-viewport-canvas:${panelId}"] canvas`);
  const volumeCanvas = page.locator(`[data-testid="volume-viewport-canvas:${panelId}"] canvas`);
  await Promise.race([
    stackCanvas.first().waitFor({ state: 'visible', timeout: canvasTimeout }),
    volumeCanvas.first().waitFor({ state: 'visible', timeout: canvasTimeout }),
  ]);

  return {
    fixtureName,
    panelId,
    imagePaths,
    imageIds: result.imageIds,
  };
}

/**
 * Convenience: equivalent to `loadFixtureScan(page, FIXTURE_NAMES.CT_AXIAL_300)`.
 * Use as the default "I just need a viewport with some data" call.
 */
export async function loadDefaultFixtureScan(
  page: Page,
  opts?: LoadFixtureScanOptions,
): Promise<LoadedFixtureScanResult | null> {
  return loadFixtureScan(page, FIXTURE_NAMES.CT_AXIAL_300, opts);
}

export { FIXTURE_NAMES };
