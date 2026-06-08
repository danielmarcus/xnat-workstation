/**
 * Pending acceptance signals — lifecycle / autosave (S7, offline-expressible).
 *
 * RED-BEFORE-GREEN against the rebuilt panel. These cover the lifecycle/autosave
 * behaviors the offline harness can express (session-scope simulated via the
 * offline viewer entry + fixture loads). The conflict/save-failure round-trip
 * (27) needs live XNAT and the performance budget (37) is a benchmark — both are
 * gated under the Transport workstream / benchmark, not authored as offline E2E.
 * See e2e/signals/README.md.
 */
import { test, expect } from '../fixtures/electron-app';
import { ensureFixture, enterLocalViewer, loadLocalDicom } from '../helpers/local-fixture';

async function enableMv(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __XNAT_E2E__: { setMultiviewportEnabled: (v: boolean) => void } })
      .__XNAT_E2E__.setMultiviewportEnabled(true);
  });
}

test.describe('Signal 25 — auto-load + navigate within a session (A13, B5)', () => {
  test('a session with a saved RTSTRUCT auto-loads into the panel and lists its members', async ({ page }) => {
    await enableMv(page);
    await enterLocalViewer(page);
    await loadLocalDicom(page, ensureFixture('rtstruct-typed')); // source + RTSTRUCT
    const panel = page.locator('[data-testid="annotations-panel"]');
    await expect(panel, 'rebuilt panel should auto-list the loaded container').toBeVisible({ timeout: 5_000 });
    await expect(panel.locator('[data-testid="container-row"]')).toHaveCount(1);
    // Intended: members native to the active series render normally; same-FoR
    // sibling-series members render dimmed with a cross-series pill; different-FoR
    // members show "not viewable here" — all remain listed. Navigating the active
    // viewport to a sibling series flips only the markers, not the set.
  });
});

test.describe('Signal 26 — session switch + unsaved retention (A13, E3)', () => {
  test('dirty containers are retained across a session switch and surfaced in a banner', async ({ page }) => {
    await enableMv(page);
    await enterLocalViewer(page);
    await loadLocalDicom(page, ensureFixture('rtstruct-typed'));
    await expect(
      page.locator('[data-testid="unsaved-sessions-banner"]'),
      'rebuilt unsaved-sessions banner should exist',
    ).toBeVisible({ timeout: 5_000 });
    // Intended: edit a container in session 1 (dirty); select a scan from session
    // 2 -> panel re-scopes; session 1 clean containers unload but its dirty one is
    // retained and the "N sessions with unsaved annotations" banner reflects it;
    // returning to session 1 restores the dirty container intact.
  });
});

test.describe('Signal 14 — queue-next-save during in-flight autosave (E2)', () => {
  test('rapid edits while a save is in flight queue a follow-up save; no edits lost', async ({ page }) => {
    await enableMv(page);
    await enterLocalViewer(page);
    await loadLocalDicom(page, ensureFixture('seg-multilabel'));
    await expect(
      page.locator('[data-testid="autosave-row"]').first(),
      'rebuilt per-container autosave row should exist',
    ).toBeVisible({ timeout: 5_000 });
    // Intended: with autosave on, draw rapidly while a save is in flight; one
    // continuous "saving" state; on completion a follow-up save fires for the
    // queued edits and the final saved file matches in-memory state.
  });
});

test.describe('Signal 15 — undo across the save point (A9)', () => {
  test('undoing past a save re-sets the dirty flag; a new save flushes the post-undo state', async ({ page }) => {
    await enableMv(page);
    await enterLocalViewer(page);
    await loadLocalDicom(page, ensureFixture('seg-multilabel'));
    const panel = page.locator('[data-testid="annotations-panel"]');
    await expect(panel, 'rebuilt panel should mount').toBeVisible({ timeout: 5_000 });
    // Intended: make edits, save, continue editing; undo enough to cross the save
    // point; state reverts past it; dirty flag becomes set; a new save flushes the
    // post-undo state.
  });
});
