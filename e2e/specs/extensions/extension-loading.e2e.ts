/**
 * Loading extensions (extension framework X1 — docs/extension-framework.md, wireframe E4): an
 * edition's extensions are listed in Settings › Extensions with their state; a valid one starts
 * in both halves; one whose main or renderer part fails is Inactive with the reason; an
 * incompatible or malformed one is Refused with the reason and has no switch; the Enabled switch
 * stops and starts the extension. (That the choice survives a restart of the app is
 * src/main/extensions/__tests__/extensionHost.test.ts's: this worker's app is not restarted.)
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/electron-app';
import { enterLocalViewer } from '../../helpers/local-fixture';
import { installPro } from '../../helpers/extensions';
import { EXTENSION_API_VERSION as API } from '../../../src/shared/extensions/manifest';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const edition = fs.mkdtempSync(path.join(os.tmpdir(), 'xnat-e2e-ext-edition-'));
// The built example (npm run build): its renderer part is bundled from TSX.
fs.cpSync(path.join(ROOT, 'dist', 'extensions', 'examples', 'session-notes'), path.join(edition, 'session-notes'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'e2e', 'fixtures', 'extensions')).filter((d) => d !== 'ui-throws' && d !== 'probe')) {
  fs.cpSync(path.join(ROOT, 'e2e', 'fixtures', 'extensions', f), path.join(edition, f), { recursive: true });
}
test.use({ extensionsDir: edition });

const NOTES = 'org.xnat.examples.session-notes';

/** The example's own log lines, from a reload on (with a Pro licence: it is Active — X6). */
async function reloadCollectingLogs(page: Page): Promise<string[]> {
  await page.waitForFunction((id) => !!(window as unknown as { __xnatWorkstationExtensions?: Record<string, unknown> }).__xnatWorkstationExtensions?.[id], NOTES).catch(() => {});
  if (await page.evaluate((id) => !!(window as unknown as { __xnatWorkstationExtensions?: Record<string, unknown> }).__xnatWorkstationExtensions?.[id], NOTES)) await installPro(page);
  const lines: string[] = [];
  page.on('console', (m) => { if (m.text().startsWith(`[ext:${NOTES}]`)) lines.push(m.text()); });
  await page.reload({ waitUntil: 'load' });
  return lines;
}

async function openExtensions(page: Page): Promise<Locator> {
  await enterLocalViewer(page);
  await page.getByTitle('Open settings').click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Extensions', exact: true }).click();
  return dialog.getByTestId('extensions-settings');
}

test('Settings › Extensions lists every extension with its state and reason', async ({ page }) => {
  const logs = await reloadCollectingLogs(page);
  await expect.poll(() => logs).toContain(`[ext:${NOTES}] renderer part started (API ${API})`);
  const s = await openExtensions(page);

  const notes = s.getByTestId(`extension-row-${NOTES}`);
  await expect(notes).toContainText('Session notes');
  await expect(notes).toContainText('0.1.0 · XNAT Workstation examples');
  await expect(notes.getByTestId('extension-state')).toHaveText('Active · Pro');
  await expect(notes.getByLabel('Enable Session notes')).toBeChecked();

  const rendererThrows = s.getByTestId('extension-row-org.xnat.e2e.renderer-throws');
  await expect(rendererThrows.getByTestId('extension-state')).toHaveText('Inactive');
  await expect(rendererThrows.getByTestId('extension-reason')).toHaveText('Failed to start: renderer boom');

  const mainThrows = s.getByTestId('extension-row-org.xnat.e2e.main-throws');
  await expect(mainThrows.getByTestId('extension-state')).toHaveText('Inactive');
  await expect(mainThrows.getByTestId('extension-reason')).toHaveText('Failed to start: No licence for this XNAT server');

  const newer = s.getByTestId('extension-row-org.xnat.e2e.newer-api');
  await expect(newer.getByTestId('extension-state')).toHaveText('Refused');
  await expect(newer.getByTestId('extension-reason')).toHaveText(`Needs extension API 9.0; this app provides ${API}. Update the app or the extension.`);
  await expect(newer.getByRole('checkbox')).toHaveCount(0);

  const malformed = s.getByTestId('extension-row-org.xnat.e2e.malformed');
  await expect(malformed).toContainText('Malformed');
  await expect(malformed.getByTestId('extension-state')).toHaveText('Refused');
  await expect(malformed.getByTestId('extension-reason')).toContainText('Invalid extension.json: version: required');
  await expect(malformed.getByRole('checkbox')).toHaveCount(0);

  await expect(s.locator('[data-testid^="extension-row-"]')).toHaveCount(5);
});

test('the Enabled switch stops the extension, a new window leaves it stopped, and it starts again', async ({ page }) => {
  let logs = await reloadCollectingLogs(page);
  await expect.poll(() => logs).toContain(`[ext:${NOTES}] renderer part started (API ${API})`);
  let s = await openExtensions(page);
  let row = s.getByTestId(`extension-row-${NOTES}`);

  await row.getByLabel('Enable Session notes').click(); // controlled: it changes once the app has done it
  await expect(row.getByTestId('extension-state')).toHaveText('Disabled');
  await expect.poll(() => logs).toContain(`[ext:${NOTES}] renderer part stopped`);

  // A new window (a reload) does not start a disabled extension.
  logs = await reloadCollectingLogs(page);
  s = await openExtensions(page);
  row = s.getByTestId(`extension-row-${NOTES}`);
  await expect(row.getByTestId('extension-state')).toHaveText('Disabled');
  await expect(row.getByLabel('Enable Session notes')).not.toBeChecked();
  expect(logs.filter((l) => l.includes('started'))).toEqual([]);

  await row.getByLabel('Enable Session notes').click();
  await expect(row.getByTestId('extension-state')).toHaveText('Active · Pro');
  await expect.poll(() => logs).toContain(`[ext:${NOTES}] renderer part started (API ${API})`);
});
