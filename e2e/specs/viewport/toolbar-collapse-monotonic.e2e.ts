/**
 * The toolbar must not flicker while the window is dragged (frozen toolbar §10).
 *
 * Regression guarded: collapse used to be a measure-and-react loop, and the thing it
 * measured was an OUTPUT of its own decision — the right group (Annotate · Tags ·
 * Settings) is 203px wide with labels and 119px without, so expanding shrank the space
 * that justified expanding. Widening the window made labels flicker in and out around
 * 1480–1550px. It is now a pure function of the outer toolbar width.
 *
 * The invariant is direction-only, so it survives any redesign of the toolbar: widening
 * must never REDUCE the labelled-button count, narrowing must never increase it.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

/** Matches BrowserWindow minWidth in src/main/index.ts — narrower is unreachable in the
 *  real app, and the toolbar cannot fit there even fully collapsed. */
const MIN_WINDOW_WIDTH = 1000;

const labelCount = (page: Page) =>
  page.evaluate(() => Array.from(document.querySelectorAll('button'))
    .filter((b) => (b.textContent ?? '').trim().length > 0 && b.getBoundingClientRect().width > 0).length);

async function sweep(page: Page, from: number, to: number, step: number) {
  const out: { w: number; n: number }[] = [];
  for (let w = from; step > 0 ? w <= to : w >= to; w += step) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(80);
    out.push({ w, n: await labelCount(page) });
  }
  return out;
}

test('widening the window never collapses the toolbar', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.setViewportSize({ width: MIN_WINDOW_WIDTH, height: 900 });
  await page.waitForTimeout(500);
  const trace = await sweep(page, MIN_WINDOW_WIDTH, 1700, 10);
  const flaps = trace.filter((p, i) => i > 0 && p.n < trace[i - 1].n);
  expect(flaps, `toolbar collapsed while the window grew: ${JSON.stringify(flaps)}`).toEqual([]);
});

test('narrowing the window never expands the toolbar', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.setViewportSize({ width: 1700, height: 900 });
  await page.waitForTimeout(500);
  const trace = await sweep(page, 1700, MIN_WINDOW_WIDTH, -10);
  const flaps = trace.filter((p, i) => i > 0 && p.n > trace[i - 1].n);
  expect(flaps, `toolbar expanded while the window shrank: ${JSON.stringify(flaps)}`).toEqual([]);
});

test('no toolbar label is clipped at any collapse level', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  for (const w of [1700, 1500, 1300, 1200, 1100, MIN_WINDOW_WIDTH]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(150);
    const clipped = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="toolbar"]')!;
      const out: string[] = [];
      for (const el of Array.from(bar.querySelectorAll<HTMLElement>('*'))) {
        if (el.children.length) continue;
        const text = (el.textContent ?? '').trim();
        if (!text) continue;
        const box = el.getBoundingClientRect().width;
        const prev = el.getAttribute('style') ?? '';
        el.style.width = 'auto'; el.style.maxWidth = 'none';
        el.style.overflow = 'visible'; el.style.whiteSpace = 'nowrap';
        const needed = el.getBoundingClientRect().width;
        el.setAttribute('style', prev);
        if (needed > box + 0.5) out.push(text);
      }
      return out;
    });
    expect(clipped, `clipped toolbar text at ${w}px: ${clipped.join(', ')}`).toEqual([]);
  }
});

/**
 * Guards the threshold table against toolbar drift.
 *
 * LEVEL_MIN_WIDTHS does not self-adjust: add or widen a toolbar item and the thresholds
 * silently become too generous, so the bar renders at a level it no longer fits. The
 * clipped-text check above catches that only incidentally — measured, adding two labelled
 * buttons overflowed by 155px but reported just ONE clipped label, because the rest were
 * pushed out of the hidden overflow entirely rather than ellipsized.
 *
 * This asserts the thing that matters: at the narrowest width where a level is chosen,
 * the content that level renders must FIT. The boundaries are DISCOVERED by sweeping, not
 * copied from the hook — a duplicated table would go stale the moment the hook's changed,
 * and the test would then be checking widths the app no longer uses.
 *
 * On failure: re-measure and update LEVEL_MIN_WIDTHS (derivation in useToolbarCollapse).
 */
test('every collapse threshold is wide enough for the content it renders', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const readLevel = () =>
    page.evaluate(() => Number(document.querySelector('[data-collapse-level]')!.getAttribute('data-collapse-level')));

  // Discover the narrowest width at which each level is still chosen.
  const boundary = new Map<number, number>();
  for (let w = 1800; w >= MIN_WINDOW_WIDTH; w -= 2) {
    await page.setViewportSize({ width: w, height: 900 });
    const level = await readLevel();
    boundary.set(level, w); // keep overwriting → ends up the narrowest for that level
  }
  expect(boundary.size, 'expected several collapse levels across the sweep').toBeGreaterThan(1);

  for (const [level, minWidth] of [...boundary.entries()].sort((a, b) => a[0] - b[0])) {
    await page.setViewportSize({ width: minWidth, height: 900 });
    await page.waitForTimeout(150);
    const m = await page.evaluate(() => {
      const inner = document.querySelector<HTMLElement>('[data-collapse-level]')!;
      const pw = inner.style.width, po = inner.style.overflow;
      inner.style.width = 'max-content'; inner.style.overflow = 'visible';
      const intrinsic = Math.ceil(inner.getBoundingClientRect().width);
      inner.style.width = pw; inner.style.overflow = po;
      return { intrinsic, available: inner.clientWidth };
    });
    expect(
      m.intrinsic,
      `level ${level} is chosen down to ${minWidth}px, but its content needs ${m.intrinsic}px and only ${m.available}px is available — re-measure LEVEL_MIN_WIDTHS`,
    ).toBeLessThanOrEqual(m.available);
  }
});
