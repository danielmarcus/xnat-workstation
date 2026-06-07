/**
 * Pending acceptance signals — rebuilt Annotations side panel.
 *
 * RED-BEFORE-GREEN: these target the rebuilt panel (frozen mockup, design §8.8)
 * which does not exist yet, so they FAIL today. They run offline against the
 * ct-axial-300 fixture with the multiviewport flag enabled. See e2e/signals/README.md.
 *
 * Each test asserts a bounded-timeout visibility of the key rebuilt element FIRST
 * so the red state is observed quickly (no long action hangs), then continues
 * with the full intended flow for when the feature lands.
 */
import { test, expect } from '../fixtures/electron-app';
import { loadCtAxial300 } from '../helpers/local-fixture';

async function enableMultiviewportAndLoad(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __XNAT_E2E__: { setMultiviewportEnabled: (v: boolean) => void } })
      .__XNAT_E2E__.setMultiviewportEnabled(true);
  });
  await loadCtAxial300(page);
}

test.describe('Signal 31 — list-panel structure & create actions (D7.6)', () => {
  test('rebuilt Annotations panel exposes three create buttons and save-all', async ({ page }) => {
    await enableMultiviewportAndLoad(page);

    const panel = page.locator('[data-testid="annotations-panel"]');
    await expect(panel, 'rebuilt Annotations panel should be mounted').toBeVisible({ timeout: 5_000 });

    await expect(panel.locator('[data-testid="create-segmentation"]')).toBeVisible();
    await expect(panel.locator('[data-testid="create-structure"]')).toBeVisible();
    await expect(panel.locator('[data-testid="create-measurement"]')).toBeVisible();
    await expect(panel.locator('[data-testid="save-all-annotations"]')).toBeVisible();
  });
});

test.describe('Signal 32 — Measurement (SR) container is a first-class peer (D7.1)', () => {
  test('creating a Measurement container and drawing a length yields a member row with value+unit', async ({ page }) => {
    await enableMultiviewportAndLoad(page);

    const createMeasurement = page.locator('[data-testid="create-measurement"]');
    await expect(createMeasurement, 'rebuilt "create Measurement" action should exist').toBeVisible({ timeout: 5_000 });
    await createMeasurement.click();

    // Draw a Length with the real tool (collapse-robust toolbar access).
    const groupTrigger = page.locator('button[title="Annotation tools"]');
    if (await groupTrigger.isVisible().catch(() => false)) await groupTrigger.click();
    await page.locator('button[title="Annotation & measurement tools"]').click();
    await page.getByRole('button', { name: 'Length', exact: true }).click();
    const viewer = await loadCtAxial300(page); // returns ViewerPage; canvas already loaded
    await viewer.canvas.drawLine({ x: 0.35, y: 0.35 }, { x: 0.65, y: 0.65 });

    const memberRow = page.locator('[data-testid="member-row"]').first();
    await expect(memberRow).toBeVisible();
    await expect(memberRow).toContainText('mm');
  });
});

test.describe('Signal 33 — selection model: single-click selects globally (A11, D7.5)', () => {
  test('single-clicking a member row selects it (highlighted)', async ({ page }) => {
    await enableMultiviewportAndLoad(page);

    const createMeasurement = page.locator('[data-testid="create-measurement"]');
    await expect(createMeasurement, 'rebuilt "create Measurement" action should exist').toBeVisible({ timeout: 5_000 });
    await createMeasurement.click();

    const memberRow = page.locator('[data-testid="member-row"]').first();
    await expect(memberRow).toBeVisible();
    await memberRow.click();
    await expect(memberRow).toHaveAttribute('data-selected', 'true');
  });
});
