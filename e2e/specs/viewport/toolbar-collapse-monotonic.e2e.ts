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
 * Whatever level the toolbar picks, at any width, it must render INTACT — no clipped
 * label, nothing pushed out of the hidden overflow.
 *
 * This replaces an earlier guard that asserted several collapse levels appear across a
 * sweep. That assumption stopped holding once calibration switched from `max-content` to
 * a real fit test: level 0 now fits across the whole supported width range, so the levels
 * below it are rarely reached. Asserting "several levels appear" would have been testing
 * the calibration's incidental output rather than the property that matters.
 */
test('the chosen level always renders intact', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  for (let w = 1800; w >= MIN_WINDOW_WIDTH; w -= 50) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(120);

    const r = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-testid="toolbar"]')!;
      const content = document.querySelector<HTMLElement>('[data-toolbar-content]')!;
      const clipped: string[] = [];
      for (const el of Array.from(content.querySelectorAll<HTMLElement>('*'))) {
        if (el.children.length) continue;
        const t = (el.textContent ?? '').trim();
        if (!t) continue;
        const box = el.getBoundingClientRect().width;
        const prev = el.getAttribute('style') ?? '';
        el.style.width = 'auto'; el.style.maxWidth = 'none';
        el.style.overflow = 'visible'; el.style.whiteSpace = 'nowrap';
        const needed = el.getBoundingClientRect().width;
        el.setAttribute('style', prev);
        if (needed > box + 0.5) clipped.push(t);
      }
      const last = content.querySelector('button:last-of-type');
      const cutOff = last
        ? Math.ceil(last.getBoundingClientRect().right - content.getBoundingClientRect().right)
        : 0;
      return { level: root.getAttribute('data-collapse-level'), clipped, cutOff };
    });

    expect(r.clipped, `clipped at ${w}px (level ${r.level}): ${r.clipped.join(', ')}`).toEqual([]);
    expect(r.cutOff, `content cut off by ${r.cutOff}px at ${w}px (level ${r.level})`).toBeLessThanOrEqual(0);
  }
});
