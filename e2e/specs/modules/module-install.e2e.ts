/**
 * Installing and managing modules (SegWorks parity branch 9, M2 — docs/segworks-parity.md §12):
 * Settings › Modules. Packages are built in the test with the app's own packaging and signing
 * code; the native file dialog is stubbed in the main process — everything else (IPC, the
 * checks, the files on disk, re-checks at every listing) is the real path.
 */
import * as fs from 'fs';
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { buildPackage, installedFile, manifest, PUBLISHER, PUBLISHER_KEY_FILE, resetModules, stubOpen } from '../../helpers/modules';
import { readZip } from '../../../src/main/modules/zip';
import { loadFixture } from '../../helpers/local-fixture';

const SCRIPT = 'export function run() { return {}; }';

test.beforeEach(async ({ electronApp, page }) => {
  await resetModules(electronApp);
  await page.reload();
  await loadFixture(page, 'ct-axial-300', 'panel_0'); // the viewer, whose toolbar opens Settings
});

async function openModules(page: Page): Promise<Locator> {
  await page.getByTitle('Open settings').click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Modules', exact: true }).click();
  const s = dialog.getByTestId('modules-settings');
  await expect(s).toBeVisible();
  return s;
}

test('a module signed by a trusted publisher installs at once, as Verified', async ({ electronApp, page }) => {
  const s = await openModules(page);
  await stubOpen(electronApp, PUBLISHER_KEY_FILE);
  await s.getByRole('button', { name: 'Add trusted publisher…' }).click();
  await expect(s.getByTestId(`trusted-key-${PUBLISHER.keyId}`)).toContainText('E2E Publisher');
  await stubOpen(electronApp, buildPackage('verified', manifest('org.e2e.verified'), SCRIPT, { sign: true }));
  await s.getByRole('button', { name: 'Install module…' }).click();
  await expect(s.getByTestId('modules-status')).toContainText('Installed Module verified 1.0.0');
  await expect(s.getByTestId('module-confirm')).toHaveCount(0);
  await expect(s.getByTestId('module-row-org.e2e.verified')).toContainText('Verified');
});

test('a community module asks first — who signed it, what it reads and writes — and carries its badge', async ({ electronApp, page }) => {
  const s = await openModules(page);
  await stubOpen(electronApp, buildPackage('community', manifest('org.e2e.community', { reads: { image: true, members: 'active' }, writes: { target: 'new', mode: 'add', newMembers: [{ name: 'Edema', color: [255, 200, 0] }] } }), SCRIPT));
  await s.getByRole('button', { name: 'Install module…' }).click();
  const confirm = s.getByTestId('module-confirm');
  await expect(confirm).toContainText('Not signed');
  await expect(confirm).toContainText('the image, the active segment');
  await expect(confirm).toContainText('a new segment “Edema”');
  await expect(s.getByTestId('module-row-org.e2e.community')).toHaveCount(0); // not until confirmed
  await confirm.getByRole('button', { name: 'Install' }).click();
  await expect(s.getByTestId('module-row-org.e2e.community')).toContainText('Community');
});

test('a module signed by a key you have not trusted is Community, and names the key', async ({ electronApp, page }) => {
  const s = await openModules(page);
  await stubOpen(electronApp, buildPackage('stranger', manifest('org.e2e.stranger'), SCRIPT, { sign: true }));
  await s.getByRole('button', { name: 'Install module…' }).click();
  await expect(s.getByTestId('module-confirm')).toContainText(`Signed by key ${PUBLISHER.keyId}`);
  await expect(s.getByTestId('module-confirm')).toContainText('which you have not trusted');
});

test('a package changed after signing is refused, with the reason', async ({ electronApp, page }) => {
  const s = await openModules(page);
  const file = buildPackage('tampered', manifest('org.e2e.tampered'), SCRIPT, { sign: true });
  // Re-pack with one file changed and the old signature kept.
  const files = readZip(fs.readFileSync(file));
  files.set('module.js', Buffer.from('export function run() { /* changed */ return {}; }'));
  const { packFiles } = await import('../../../src/main/modules/modulePackage');
  fs.writeFileSync(file, packFiles(files));
  await stubOpen(electronApp, file);
  await s.getByRole('button', { name: 'Install module…' }).click();
  await expect(s.getByTestId('modules-status')).toContainText('Not installed: The signature is invalid');
  await expect(s.getByTestId('module-row-org.e2e.tampered')).toHaveCount(0);
});

test('with community modules turned off, a community module is refused', async ({ electronApp, page }) => {
  const s = await openModules(page);
  await s.getByLabel('Allow community modules').uncheck();
  await stubOpen(electronApp, buildPackage('off', manifest('org.e2e.off'), SCRIPT));
  await s.getByRole('button', { name: 'Install module…' }).click();
  await expect(s.getByTestId('modules-status')).toContainText('community modules are turned off');
  await expect(s.getByTestId('module-confirm')).toHaveCount(0);
});

test('a module whose files change on disk after install is refused; Remove deletes it', async ({ electronApp, page }) => {
  let s = await openModules(page);
  await stubOpen(electronApp, buildPackage('altered', manifest('org.e2e.altered'), SCRIPT));
  await s.getByRole('button', { name: 'Install module…' }).click();
  await s.getByTestId('module-confirm').getByRole('button', { name: 'Install' }).click();
  await expect(s.getByTestId('module-row-org.e2e.altered')).toContainText('Community');
  fs.writeFileSync(await installedFile(electronApp, 'org.e2e.altered', 'module.js'), 'export function run() { /* altered on disk */ }');
  await page.getByRole('dialog', { name: 'Settings' }).getByTitle('Close', { exact: true }).click();
  s = await openModules(page);
  await expect(s.getByTestId('module-row-org.e2e.altered')).toContainText('Refused');
  await expect(s.getByTestId('module-row-org.e2e.altered')).toContainText('changed after it was installed');
  await s.getByTestId('module-row-org.e2e.altered').getByRole('button', { name: 'Remove' }).click();
  await expect(s.getByTestId('module-row-org.e2e.altered')).toHaveCount(0);
  expect(fs.existsSync(await installedFile(electronApp, 'org.e2e.altered', 'module.js'))).toBe(false);
});

test('a module this version cannot run is refused by name', async ({ electronApp, page }) => {
  const s = await openModules(page);
  await stubOpen(electronApp, buildPackage('runtime', manifest('org.e2e.runtime', { runtime: 'xnat-container' }), SCRIPT));
  await s.getByRole('button', { name: 'Install module…' }).click();
  await expect(s.getByTestId('modules-status')).toContainText('"xnat-container"');
});
