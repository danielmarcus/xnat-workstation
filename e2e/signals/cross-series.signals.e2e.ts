/**
 * Pending acceptance signals — cross-series / Frame-of-Reference (S5).
 *
 * RED-BEFORE-GREEN against the rebuilt panel. Each test loads the relevant
 * paired fixture's primary series offline (proving the fixture flows through
 * the harness), then gates on the rebuilt entry point; the full cross-panel /
 * cross-series flow (two viewports, dashed non-native rendering, FoR gating)
 * lights up when the rebuilt viewport + panel land. See e2e/signals/README.md.
 */
import { test, expect } from '../fixtures/electron-app';
import { ensureFixture, enterLocalViewer, loadLocalDicom } from '../helpers/local-fixture';

const pick = (files: string[], prefix: string) => files.filter((f) => f.includes(prefix));

test.describe('Signal 9 — same-FoR sibling series: non-native dashed rendering (A2b)', () => {
  test('a contour drawn on T1 renders dashed on the same-FoR T2 at the same world coordinate', async ({ page }) => {
    await enterLocalViewer(page);
    await loadLocalDicom(page, pick(ensureFixture('mr-t1-t2-sameexam'), 't1-slice'));
    const createStructure = page.locator('[data-testid="create-structure"]');
    await expect(createStructure, 'rebuilt create-Structure action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: T1 + T2 (same FoR, slightly different slices) in two panels; draw
    // on T1; T2 shows the contour DASHED at the same world coord, snapped to the
    // nearest T2 slice; read-only on T2 with a tooltip naming the T1 series.
  });
});

test.describe('Signal 12 — drawing blocked on a non-native same-FoR series (A2)', () => {
  test('with active container native to series A, drawing on same-FoR series B is blocked at gesture-start', async ({ page }) => {
    await enterLocalViewer(page);
    await loadLocalDicom(page, pick(ensureFixture('mr-t1-t2-sameexam'), 't2-slice'));
    const createStructure = page.locator('[data-testid="create-structure"]');
    await expect(createStructure, 'rebuilt create-Structure action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: active container native to series A; focus a series-B (same FoR)
    // viewport; drawing is blocked at gesture-start with a hint; no partial
    // geometry; no auto-container created.
  });
});

test.describe('Signal 10 — breath-hold (same FoR, displaced): off by default, toggle on (A2c)', () => {
  test('a structure from breath-hold 1 does not display on breath-hold 2 until "show related" is toggled', async ({ page }) => {
    await enterLocalViewer(page);
    await loadLocalDicom(page, pick(ensureFixture('breath-hold-pair'), 'bh1-'));
    const createStructure = page.locator('[data-testid="create-structure"]');
    await expect(createStructure, 'rebuilt create-Structure action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: draw on breath-hold #1; #2 (same FoR, anatomy displaced) does NOT
    // show it by default; toggle "show structures from related series" -> appears
    // dashed at original world position (visibly displaced); toggle off -> hidden.
  });
});

test.describe('Signal 36 — A2c auto-classification of same-FoR series (A2c)', () => {
  test('AcquisitionNumber-only difference renders by default; bulk displacement defaults off', async ({ page }) => {
    await enterLocalViewer(page);
    await loadLocalDicom(page, pick(ensureFixture('breath-hold-pair'), 'bh1-'));
    const createStructure = page.locator('[data-testid="create-structure"]');
    await expect(createStructure, 'rebuilt create-Structure action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: same-FoR series differing only by AcquisitionNumber -> structures
    // render by default (A2b); detected bulk displacement (breath-hold) -> off by
    // default (A2c), toggleable; inconclusive -> default to show.
  });
});

test.describe('Signal 11 — different-FoR series: not displayed but still listed (A2d)', () => {
  test('a CT structure-set does not render on an unregistered MR but is listed with a different-FoR indicator', async ({ page }) => {
    await enterLocalViewer(page);
    await loadLocalDicom(page, pick(ensureFixture('cross-for-ct-mr'), 'ct-slice'));
    const panel = page.locator('[data-testid="annotations-panel"]');
    await expect(panel, 'rebuilt Annotations panel should mount').toBeVisible({ timeout: 5_000 });
    // Intended: CT + unregistered MR (different FoR). The CT structure-set does
    // not display on the MR viewport, but the panel still LISTS its structures
    // with a "different frame of reference" indicator (not silently empty).
  });
});
