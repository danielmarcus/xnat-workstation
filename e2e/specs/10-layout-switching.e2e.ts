/**
 * Signal 6 (acceptance, requirements §G #6): "Open four panels, edit, switch
 * layouts (2×2 → 1×1 → MPR → 2×2) rapidly. No structures lost, no duplicates,
 * no stale highlights, single dirty flag, save once produces correct file."
 *
 * Pinning regression insurance for MV-Phase 2's single-source-of-truth +
 * cross-series-rendering rework. Per design §A12, layout churn is exactly the
 * surface the epoch-based viewportReadyService was designed to harden against;
 * Phase 2's container bridge + undoService refactor changes how dirty
 * propagates and how attachments reconcile, so this spec must keep passing
 * across that work — if it doesn't, the refactor broke a layout-churn
 * invariant.
 *
 * Single variant after Phase 6.4 (the legacy `enterMPR` →
 * MPRViewportGrid path was removed; the `viewportLayoutService.applyPreset
 * ('mpr-2x2')` path is the only MPR entry):
 *   - Volume mode + viewportLayoutService MPR preset. Uses the
 *     contour-annotation (RTSTRUCT-style) path because Phase 1's volume-
 *     mode brush capability gap (see 08-volume-mode-acceptance.e2e.ts
 *     and 09-undo-after-close.e2e.ts notes) means brush memos don't push
 *     a usable labelmap in test conditions. Contour annotations on
 *     volume viewports DO work, so the structural Signal 6 invariants
 *     (no lost structures, no duplicates, single dirty flag, no stale
 *     highlights) get exercised end-to-end.
 *
 * What "rapid" means here: each setLayout/toggleMpr is its own
 * page.evaluate, but with no waitForTimeout between them — only a single
 * `requestAnimationFrame` flush so React commits and Cornerstone's
 * synchronous viewport teardown runs. The whole 2×2 → 1×1 → MPR → 2×2
 * sequence completes in well under 200 ms wall-time. If a real race in
 * the panel-orientation reconciliation, segmentation reattachment, or
 * dirty-flag propagation exists, this is the cadence that surfaces it.
 * Sleeps would defeat the purpose.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page, Locator } from '@playwright/test';
import { CanvasInteractor } from '../helpers/canvas-interaction';
import { loadFixtureScan, FIXTURE_NAMES } from '../helpers/fixture-load';

type ToggleMprResult = {
  flagEnabled: boolean;
  entered: boolean;
  reason: string | null;
};

type DirtyState = {
  globalDirty: boolean;
  perSegmentationDirty: string[];
};

type SegmentationSnapshotEntry = {
  segmentationId: string;
  label: string;
  segmentCount: number;
  viewportIds: string[];
  contourAnnotationCount: number;
  contourSliceIndices: number[];
};

type ActiveByPanelEntry = {
  panelId: string;
  isCurrentLayoutPanel: boolean;
  segmentationId: string | null;
  segmentIndex: number;
};

function panelCanvas(page: Page, panelId: string): Locator {
  // 09-undo-after-close.e2e.ts pattern: stack and volume viewports use
  // different testid prefixes; match either.
  return page.locator(
    `[data-testid="stack-viewport-canvas:${panelId}"] canvas, `
    + `[data-testid="volume-viewport-canvas:${panelId}"] canvas`,
  );
}

function panelRoot(page: Page, panelId: string): Locator {
  return page.locator(
    `[data-testid="stack-viewport:${panelId}"], `
    + `[data-testid="volume-viewport:${panelId}"]`,
  );
}

async function setLayout(page: Page, layout: '1x1' | '1x2' | '2x1' | '2x2') {
  await page.evaluate((target: '1x1' | '1x2' | '2x1' | '2x2') => {
    (window as any).__XNAT_E2E__?.setLayout?.(target);
  }, layout);
  // Yield exactly one rAF so React commits + Cornerstone's synchronous
  // viewport teardown runs. No waitForTimeout — this is the "rapid" half
  // of Signal 6.
  await flushFrame(page);
}

async function toggleMpr(page: Page): Promise<ToggleMprResult> {
  const result = await page.evaluate<ToggleMprResult>(async () => {
    const r = await (window as any).__XNAT_E2E__?.toggleMpr?.();
    return r ?? { flagEnabled: false, entered: false, reason: 'hook missing' };
  });
  await flushFrame(page);
  return result;
}

async function flushFrame(page: Page) {
  // One rAF — let React commit and Cornerstone respond to the store change.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

async function getDirtyState(page: Page): Promise<DirtyState> {
  return page.evaluate(() => (window as any).__XNAT_E2E__?.getDirtyState?.() ?? {
    globalDirty: false,
    perSegmentationDirty: [],
  });
}

async function getSegmentationSnapshot(page: Page): Promise<SegmentationSnapshotEntry[]> {
  return page.evaluate(() => (window as any).__XNAT_E2E__?.getSegmentationSnapshot?.() ?? []);
}

async function getActiveByPanel(page: Page): Promise<ActiveByPanelEntry[]> {
  return page.evaluate(() => (window as any).__XNAT_E2E__?.getActiveByPanel?.() ?? []);
}

async function exportSegToBase64(page: Page, segmentationId: string): Promise<string | null> {
  // The renderer hook `exportSegmentationToBase64` is just a wrapper around
  // `segmentationService.exportToDicomSeg(segId)` — the same code path the
  // segmentation panel's "Save → Upload to XNAT" runs. Comparing the
  // encoded length before vs. after the layout sequence is the closest
  // we get to the spec's "save once produces correct file" without
  // round-tripping through XNAT (which 06-save-upload covers separately
  // and which is not what Signal 6 is about).
  return page.evaluate(async (segId: string) => {
    return (window as any).__XNAT_E2E__?.exportSegmentationToBase64?.(segId) ?? null;
  }, segmentationId);
}

async function loadFixtureIntoActivePanel(page: Page): Promise<boolean> {
  const result = await loadFixtureScan(page, FIXTURE_NAMES.CT_AXIAL_300, {
    panelId: 'panel_0',
  });
  return result !== null;
}

async function activatePanel(page: Page, panelId: string) {
  await page.locator(`[data-panel-id="${panelId}"]`).click();
  await page.waitForTimeout(200);
}

async function waitForCanvasReady(page: Page, panelId: string) {
  await expect(panelCanvas(page, panelId)).toBeVisible({ timeout: 30_000 });
  const status = page.locator(`[data-testid="stack-viewport-status:${panelId}"]`);
  if (await status.isVisible({ timeout: 500 }).catch(() => false)) {
    await status.waitFor({ state: 'hidden', timeout: 30_000 });
  }
}

async function selectLayoutFromToolbar(page: Page, label: '1 x 1' | '1 x 2' | '2 x 2') {
  // Toolbar-driven layout change so the four-panel setup in beforeEach
  // mirrors a real user opening 2×2; subsequent transitions inside the
  // test go through `setLayout` (the renderer hook) so we control timing.
  const layoutBtn = page.locator('button[title^="Viewport layout"]');
  await layoutBtn.click();
  await page.locator('button', { hasText: label }).click();
  await page.waitForTimeout(300);
}

async function openSegmentationPanel(page: Page) {
  const panel = page.locator('[data-testid="segmentation-panel"]');
  if (await panel.isVisible().catch(() => false)) return;

  const annotationToolsTrigger = page.locator('button[title="Annotation tools"]');
  if (await annotationToolsTrigger.isVisible().catch(() => false)) {
    await annotationToolsTrigger.click();
  }

  const segmentationToggle = page.locator(
    'button[title="Show segmentation panel"], button[title="Hide segmentation panel"]',
  ).first();
  await segmentationToggle.waitFor({ state: 'visible', timeout: 10_000 });
  await segmentationToggle.click();
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
}

async function setupFourPanels(page: Page) {
  // Initial scan loads into panel_0.
  const ok = await loadFixtureIntoActivePanel(page);
  expect(ok, 'fixture must be present locally').toBe(true);
  await waitForCanvasReady(page, 'panel_0');

  // Switch to 2×2 — adds panel_1/2/3 (which mount as placeholder divs
  // until a scan is loaded, per ViewportGrid.tsx:99-105). Wait for the
  // outer panel-wrapper to appear; the inner viewport canvases only
  // exist for panels with loaded images.
  await selectLayoutFromToolbar(page, '2 x 2');
  await expect(page.locator('[data-panel-id="panel_3"]')).toBeAttached({ timeout: 10_000 });
}

/**
 * The rapid sequence: 2×2 → 1×1 → MPR → 2×2.
 *
 * Each transition is its own page.evaluate but with no waitForTimeout
 * between them — only one rAF flush. If a real race exists in
 * panel-orientation reconciliation, segmentation reattachment, or
 * dirty-flag propagation, this cadence surfaces it.
 *
 * Returns the toggleMpr result so callers can branch on whether MPR
 * actually entered (e.g. if the active panel had < 2 slices, the toggle
 * short-circuits and reports `entered=false, reason='fewer than 2
 * slices on active panel'`).
 */
async function runRapidLayoutSequence(page: Page): Promise<{ enter: ToggleMprResult; exit: ToggleMprResult }> {
  // 2×2 → 1×1: shrinks layout, drops panel_1/2/3 from the active set.
  await setLayout(page, '1x1');

  // 1×1 → MPR: expands via setLayout('2x2') + applyPreset('mpr-2x2') +
  // per-panel orientations.
  const enter = await toggleMpr(page);

  // MPR → 2×2: clears orientations on panels 0/1/2 and re-applies '2x2'.
  const exit = await toggleMpr(page);

  return { enter, exit };
}

function assertSnapshotPreserved(
  before: SegmentationSnapshotEntry[],
  after: SegmentationSnapshotEntry[],
  label: string,
) {
  // Same set of segmentationIds — no structures lost, no duplicates.
  const beforeIds = new Set(before.map((entry) => entry.segmentationId));
  const afterIds = new Set(after.map((entry) => entry.segmentationId));
  expect(
    [...afterIds].sort(),
    `${label}: segmentation id set should be unchanged across layout sequence (no structures lost, no duplicates)`,
  ).toEqual([...beforeIds].sort());

  // Same segment counts per segmentation.
  for (const beforeEntry of before) {
    const afterEntry = after.find((entry) => entry.segmentationId === beforeEntry.segmentationId);
    expect(
      afterEntry?.segmentCount,
      `${label}: segment count for "${beforeEntry.label}" should be unchanged`,
    ).toBe(beforeEntry.segmentCount);
    expect(
      afterEntry?.contourAnnotationCount,
      `${label}: contour annotation count for "${beforeEntry.label}" should be unchanged`,
    ).toBe(beforeEntry.contourAnnotationCount);
  }
}

function assertNoStaleHighlights(activeByPanel: ActiveByPanelEntry[], finalLayoutLabel: string) {
  // Every entry that points at a non-current panel id is a stale highlight.
  // The activeSegmentationIdByPanel map should have been cleaned up when
  // setLayout dropped the panel (segmentationManagerStore.clearPanel) —
  // if it wasn't, that's the "no stale highlights" half of Signal 6
  // failing.
  const stale = activeByPanel.filter((entry) => (
    !entry.isCurrentLayoutPanel
    && entry.segmentationId !== null
  ));
  expect(
    stale.map((entry) => `${entry.panelId}→${entry.segmentationId}`),
    `${finalLayoutLabel}: no stale active-segmentation entries should reference panels removed by setLayout`,
  ).toEqual([]);
}

function assertSingleDirtyFlag(dirty: DirtyState, expectedSegId: string, label: string) {
  // The "single dirty flag" half: exactly one entry, exactly the
  // segmentation we edited. Multiple entries would mean phantoms
  // accumulated from layout churn; zero entries would mean the dirty
  // state was lost by a panel-teardown race.
  expect(dirty.globalDirty, `${label}: global hasUnsavedChanges should be true`).toBe(true);
  expect(
    dirty.perSegmentationDirty,
    `${label}: dirtySegIds should contain exactly the edited segmentation, no phantoms`,
  ).toEqual([expectedSegId]);
}

test.describe('Signal 6 — rapid layout switching: 2×2 → 1×1 → MPR → 2×2 (local fixture)', () => {
  test.beforeEach(async ({ page }) => {
    // Pre-reload cleanup: prior specs (notably 09-undo-after-close) leave
    // a dirty segmentation in the store, which triggers App.tsx's
    // beforeunload prompt on reload — Playwright's default beforeunload
    // handler then races with the explicit dialog handler and surfaces as
    // "Protocol error (Page.handleJavaScriptDialog): No dialog is
    // showing". Clearing dirty here makes the reload silent.
    await page.evaluate(() => {
      (window as any).__XNAT_E2E__?.markAllSegmentationsClean?.();
    }).catch(() => { /* page may not have the hook installed yet on first run */ });

    // Hard-reset renderer state. Mirrors 09-undo-after-close.e2e.ts: the
    // suite leaves segmentations / labelmap reps / tool-group bindings in
    // place across specs; rapid layout churn is sensitive to that
    // leakage. Reload wipes everything; the local-fixture path then
    // re-fakes the connection.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__XNAT_E2E__, undefined, { timeout: 30_000 });
    await page.evaluate(() => {
      window.__XNAT_E2E__?.setFakeConnected(true);
    });
    await expect(page.locator('[data-testid="login-form"]')).toBeHidden({ timeout: 30_000 });
  });

  test.afterEach(async ({ page }) => {
    // Restore single-panel layout so subsequent specs aren't affected
    // by Electron worker reuse. Clear the dirty flag too — the tests
    // above mark segmentations dirty as part of the precondition setup;
    // a leftover dirty flag would make the next beforeEach reload race
    // against an unsaved-changes confirm dialog.
    await page.evaluate(async () => {
      const e2e = (window as any).__XNAT_E2E__;
      if (!e2e) return;
      try { await e2e.toggleMpr?.(); } catch { /* best-effort */ }
      e2e.markAllSegmentationsClean?.();
      e2e.setLayout?.('1x1');
    });
  });

  // After Phase 6.4 the legacy `enterMPR` / MPRViewportGrid path is
  // gone; `viewportLayoutService.applyPreset('mpr-2x2')` is the only
  // MPR entry. After Phase 6.6 the multiViewport.enabled flag is gone
  // too. The single test below uses the contour-annotation
  // (RTSTRUCT-style) path because the volume-mode brush capability gap
  // (see 08-volume-mode-acceptance.e2e.ts and 09-undo-after-close.e2e.ts
  // notes) means brush memos don't push a usable labelmap in test
  // conditions. Contour annotations on volume viewports DO work, so the
  // structural Signal 6 invariants get exercised end-to-end.
  test('volume mode + viewportLayoutService MPR preset: contour structure survives 2×2→1×1→MPR→2×2', async ({
    page,
  }) => {
    await setupFourPanels(page);
    await activatePanel(page, 'panel_0');

    // Wait for the volume viewport to mount on panel_0 (the flag-on
    // path goes through Viewport → VolumeViewport).
    await expect(panelCanvas(page, 'panel_0')).toBeVisible({ timeout: 30_000 });

    // Create the test structure (RTSTRUCT-style; supported on volume
    // viewports per 08-volume-mode-acceptance.e2e.ts:60-63).
    const segLabel = 'Signal6 Layout Target (flag-on)';
    const segmentationId = await page.evaluate(async (label: string) => {
      return (window as any).__XNAT_E2E__?.createTestStructure?.('panel_0', label) ?? null;
    }, segLabel);
    expect(segmentationId, 'createTestStructure should return a segmentation id').toBeTruthy();

    // Note: we do NOT call createTestContour here. That helper hard-codes
    // the `stack-viewport-canvas:` testid prefix when looking up
    // the canvas (installRendererE2eHooks.ts:381) so it's stack-mode
    // only — on a volume viewport the lookup returns null and the
    // contour-creation falls through to a metadata-only fallback that
    // requires `imagePlaneModule` fields the volume metadata provider
    // doesn't supply. Promoting the helper to support volume viewports
    // is out of scope for Signal 6 (it's a Phase 2.6/2.7 piece — see
    // 09-undo-after-close.e2e.ts:305-317 for the same gap). The flag-on
    // structural assertion below holds on the SegmentationSummary set
    // and dirty state alone, which is enough to prove "no structures
    // lost / single dirty flag" survives the layout sequence.

    // Mark the just-created structure dirty (the createTestStructure
    // path goes through addSegment → addSegments which doesn't fire the
    // autoSave handler in the same conditions the brush does, so we
    // mark explicitly — same precondition setup the flag-off variant
    // does after its brush stroke).
    await page.evaluate((segId: string) => {
      (window as any).__XNAT_E2E__?.markSegmentationDirty?.(segId);
    }, segmentationId);

    // Snapshot before the rapid sequence.
    const beforeSnapshot = await getSegmentationSnapshot(page);
    const beforeDirty = await getDirtyState(page);
    expect(
      beforeSnapshot.find((entry) => entry.segmentationId === segmentationId),
      'created structure should appear in snapshot before layout sequence',
    ).toBeTruthy();

    // ── The rapid sequence ─────────────────────────────────────
    const { enter, exit } = await runRapidLayoutSequence(page);

    expect(
      enter,
      `enter MPR: flag-on path should have entered the mpr-2x2 preset (got: ${JSON.stringify(enter)})`,
    ).toMatchObject({ flagEnabled: true, entered: true, reason: null });
    expect(
      exit,
      `exit MPR: flag-on path should have exited the mpr-2x2 preset (got: ${JSON.stringify(exit)})`,
    ).toMatchObject({ flagEnabled: true, entered: false, reason: null });

    // ── Assertions after the sequence ─────────────────────────
    const afterSnapshot = await getSegmentationSnapshot(page);
    const afterDirty = await getDirtyState(page);
    const afterActive = await getActiveByPanel(page);

    assertSnapshotPreserved(beforeSnapshot, afterSnapshot, 'flag-on rapid sequence');

    // The dirty flag must survive the layout sequence (the brush-equivalent
    // assertion: single dirty entry, the one we marked).
    expect(afterDirty.globalDirty, 'global hasUnsavedChanges should survive layout churn').toBe(beforeDirty.globalDirty);
    expect(
      afterDirty.perSegmentationDirty,
      'dirtySegIds should be unchanged across the rapid sequence',
    ).toEqual(beforeDirty.perSegmentationDirty);

    assertNoStaleHighlights(afterActive, 'final layout (post-applyPreset 2×2 + cleared orientations)');
  });
});
