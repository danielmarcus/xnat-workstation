/**
 * Signal 32 — effect coverage for every measurement tool in the toolbox.
 *
 * Before this spec only Length was proven to produce a measurement (specs 34 / 56).
 * Angle, Ellipse and Arrow rested on `tools/active-tool-registration`, which asserts only that the active
 * tool NAME changed; Bidirectional, Rect ROI, Circle ROI, Probe and Freehand had no test
 * at all. Activation is not the claim that matters — the threshold brush activated
 * perfectly while doing nothing.
 *
 * Each case drives the real user path end to end: create a Measurement (SR)
 * container, click the tool IN THE TOOLBOX (not the setActiveUnifiedTool hook), draw
 * with real mouse events, then assert a measurement actually registered and a member
 * row appeared in the panel. That also makes this the first coverage of toolbox
 * routing for anything other than Length.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

interface E2EHooks {
  getMeasurementCount: () => number;
  clearAllContainers: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const cleanSlate = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
const measurementCount = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getMeasurementCount());

test.beforeEach(({ page }) => cleanSlate(page));
test.afterEach(({ page }) => cleanSlate(page));

type Box = { x: number; y: number; width: number; height: number };
const at = (b: Box, fx: number, fy: number): [number, number] => [b.x + b.width * fx, b.y + b.height * fy];

/** Two-point drag — Length / Bidirectional / the ROI tools / Arrow. */
async function drag(page: Page, b: Box) {
  await page.mouse.move(...at(b, 0.35, 0.5));
  await page.mouse.down();
  await page.mouse.move(...at(b, 0.6, 0.6), { steps: 6 });
  await page.mouse.up();
}

/** Three clicks — Angle needs two rays. */
async function threeClicks(page: Page, b: Box) {
  await page.mouse.click(...at(b, 0.35, 0.6));
  await page.mouse.click(...at(b, 0.5, 0.4));
  await page.mouse.click(...at(b, 0.65, 0.6));
}

/** Single click — Probe samples one point. */
async function click(page: Page, b: Box) {
  await page.mouse.click(...at(b, 0.5, 0.5));
}

/** Freehand loop back to the start so the contour closes. */
async function loop(page: Page, b: Box) {
  await page.mouse.move(...at(b, 0.4, 0.4));
  await page.mouse.down();
  await page.mouse.move(...at(b, 0.6, 0.4), { steps: 8 });
  await page.mouse.move(...at(b, 0.6, 0.6), { steps: 8 });
  await page.mouse.move(...at(b, 0.4, 0.6), { steps: 8 });
  await page.mouse.move(...at(b, 0.4, 0.41), { steps: 8 });
  await page.mouse.up();
}

const CASES: Array<{ label: string; gesture: (p: Page, b: Box) => Promise<void> }> = [
  { label: 'Angle', gesture: threeClicks },
  { label: 'Bidir.', gesture: drag },
  { label: 'Ellipse', gesture: drag },
  { label: 'Rect ROI', gesture: drag },
  { label: 'Circle ROI', gesture: drag },
  { label: 'Probe', gesture: click },
  { label: 'Freehand ROI', gesture: loop },
];

for (const { label, gesture } of CASES) {
  test(`${label} draws a measurement that becomes an SR member (signal 32)`, async ({ page }) => {
    await loadFixture(page, 'ct-axial-300', 'panel_0');
    const panel = page.locator('[data-testid="annotations-side-panel"]');
    if (!(await panel.isVisible())) {
      await page.getByRole('button', { name: 'Show segmentation panel' }).click();
    }
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Create + name a Measurement container so the toolbox adapts to the SR kind.
    await panel.getByRole('button', { name: 'New Measurement (SR)' }).click();
    await expect(panel.locator('[data-testid^="container-row-"]').first()).toBeVisible({ timeout: 15_000 });

    const toolbox = panel.locator('[data-testid="context-toolbox"]');
    await expect(toolbox).toBeVisible({ timeout: 10_000 });
    await toolbox.getByRole('button', { name: label, exact: true }).click();

    const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
    expect(box).not.toBeNull();
    await gesture(page, box);

    await expect
      .poll(() => measurementCount(page), { timeout: 15_000, message: `${label} should register a measurement` })
      .toBeGreaterThan(0);
    await expect(panel.locator('[data-testid^="member-row-"]')).toHaveCount(1);
  });
}

/**
 * Arrow is separated out because completing one opens a label prompt.
 *
 * Cornerstone's DEFAULT getTextCallback is `prompt('Enter your annotation:')`, which
 * Electron blocks; ArrowAnnotateTool then DELETES the annotation if the callback
 * yields no label. The app ships a DOM-overlay replacement, but it was configured
 * only on the legacy tool group — the unified group (the only path since P1.8d)
 * added ArrowAnnotateTool with no configuration, so no prompt appeared and an arrow
 * could never be labelled. Asserting the measurement exists is NOT enough to catch
 * that: the blocked prompt throws before the delete runs, so the annotation survives
 * unlabelled and a count-only test stays green. This asserts the prompt itself.
 */
test('Arrow opens the label prompt and the labelled arrow becomes an SR member (signal 32)', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await panel.getByRole('button', { name: 'New Measurement (SR)' }).click();
  await expect(panel.locator('[data-testid^="container-row-"]').first()).toBeVisible({ timeout: 15_000 });

  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox).toBeVisible({ timeout: 10_000 });
  await toolbox.getByRole('button', { name: 'Arrow', exact: true }).click();

  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  await drag(page, box);

  // The app's own prompt must appear — not Cornerstone's blocked window.prompt().
  const prompt = page.locator('[data-testid="arrow-label-prompt"]');
  await expect(prompt, 'the arrow label prompt must open on the unified path').toBeVisible({ timeout: 10_000 });
  await prompt.locator('input').fill('Lesion A');
  await prompt.locator('input').press('Enter');
  await expect(prompt).toHaveCount(0);

  await expect
    .poll(() => measurementCount(page), { timeout: 15_000, message: 'Arrow should register a measurement' })
    .toBeGreaterThan(0);
  await expect(panel.locator('[data-testid^="member-row-"]')).toHaveCount(1);
});
