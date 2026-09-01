/**
 * SR reload from an XNAT scan click — the missing half of the Measurement round-trip.
 *
 * The upload half (transport `uploadSr`, scan 50xx) was CNDA-verified in #74; the
 * RELOAD branch was never wired: clicking a Measurement scan in the XNAT browser fell
 * through to the "regular scan" path, so a stored SR could not be read back.
 *
 * This drives the REAL production entry point — `App.loadFromXnatScan`, the very
 * callback the browser's `onLoadScan` invokes — with `electronAPI.xnat` faked
 * (`getScans` + `downloadScanFile`). The SR payload is a real DICOM-SR produced by the
 * app's own exporter from measurements drawn on the loaded fixture, so the reference
 * resolution under test (`getSrReferenceInfo` → source series → panel) runs against a
 * genuine file rather than a stub.
 *
 * NOT covered here: the IPC download against a live XNAT and the browser row click
 * itself — those stay CNDA-gated.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (toolName: string) => void;
  getMeasurementCount: () => number;
  exportSrBase64: () => Promise<string | null>;
  clearAllContainers: () => void;
  installFakeXnatScanApi: (config: {
    sessionId: string;
    scans: unknown[];
    filesByScanId: Record<string, string>;
  }) => void;
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

const SESSION = 'XNAT_E2E_SESSION';
const SR_SCAN_ID = '5001';

const hook = <T,>(page: Page, fn: keyof E2EHooks, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    ([name, a]) => (window as unknown as Win).__XNAT_E2E__[name as keyof E2EHooks](...(a as [])),
    [fn, args] as const,
  ) as Promise<T>;

test.beforeEach(({ page }) => hook(page, 'clearAllContainers'));
test.afterEach(({ page }) => hook(page, 'clearAllContainers'));

test('clicking a Measurement (SR) scan reloads its measurements onto the source series', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  // ── Produce a real SR from real measurements drawn on the loaded series ──
  await hook(page, 'setActiveUnifiedTool', 'Length');
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const drawAt = async (yFraction: number) => {
    const y = box!.y + box!.height * yFraction;
    await page.mouse.move(box!.x + box!.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.7, y, { steps: 6 });
    await page.mouse.up();
  };
  await drawAt(0.4);
  await drawAt(0.6);
  await expect.poll(() => hook<number>(page, 'getMeasurementCount'), { timeout: 15_000 }).toBe(2);

  const srBase64 = await hook<string | null>(page, 'exportSrBase64');
  expect(srBase64, 'the app should serialize the drawn measurements to an SR').toBeTruthy();

  // Clear the session: the measurements now exist ONLY inside the SR payload.
  await hook(page, 'clearAllContainers');
  await expect.poll(() => hook<number>(page, 'getMeasurementCount'), { timeout: 10_000 }).toBe(0);

  // ── Serve that SR as a stored XNAT scan and click it ──
  const srScan = {
    id: SR_SCAN_ID,
    type: 'SR',
    modality: 'SR',
    xsiType: 'xnat:srScanData',
    seriesDescription: 'Lesion measurements',
    frames: 1,
  };
  await hook(page, 'installFakeXnatScanApi', {
    sessionId: SESSION,
    scans: [srScan],
    filesByScanId: { [SR_SCAN_ID]: srBase64 },
  });

  await page.evaluate(
    ([sessionId, scanId, scan]) =>
      (window as unknown as Win).__XNAT_E2E_APP__.loadFromXnatScan(
        sessionId as string,
        scanId as string,
        scan as Record<string, unknown>,
        { projectId: 'PRJ', subjectId: 'SUBJ', sessionLabel: 'SESSION_LABEL' },
      ),
    [SESSION, SR_SCAN_ID, srScan] as const,
  );

  // The measurements are back…
  await expect.poll(() => hook<number>(page, 'getMeasurementCount'), { timeout: 20_000 }).toBe(2);

  // …as a Measurement container in the panel, labelled from the scan description,
  // and the panel opened itself to show them.
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText('Lesion measurements')).toBeVisible({ timeout: 10_000 });
  await expect(panel.locator('[data-testid^="member-row-"]')).toHaveCount(2);

  // A second click does NOT duplicate them (the origin guard).
  await page.evaluate(
    ([sessionId, scanId, scan]) =>
      (window as unknown as Win).__XNAT_E2E_APP__.loadFromXnatScan(
        sessionId as string,
        scanId as string,
        scan as Record<string, unknown>,
        { projectId: 'PRJ', subjectId: 'SUBJ', sessionLabel: 'SESSION_LABEL' },
      ),
    [SESSION, SR_SCAN_ID, srScan] as const,
  );
  await page.waitForTimeout(1_000);
  expect(await hook<number>(page, 'getMeasurementCount')).toBe(2);
});
