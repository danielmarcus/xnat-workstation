/**
 * Licensing hooks (extension framework X6 — docs/extension-framework.md, design point 10,
 * wireframes E4–E5), with the example's demonstration gate. Licences are imported through the
 * extension's own Settings page (the file dialog answered by the test); its main part verifies
 * them; the host shows exactly what the gate enables — a locked feature is absent, not disabled
 * — and changes it live.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/electron-app';
import { enterLocalViewer } from '../../helpers/local-fixture';
import { BASIC, NOTES, PRO, demoLicence, removeLicence, waitForExtension } from '../../helpers/extensions';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const edition = fs.mkdtempSync(path.join(os.tmpdir(), 'xnat-e2e-ext-licence-'));
fs.cpSync(path.join(ROOT, 'dist', 'extensions', 'examples', 'session-notes'), path.join(edition, 'session-notes'), { recursive: true });
fs.cpSync(path.join(ROOT, 'e2e', 'fixtures', 'extensions', 'probe'), path.join(edition, 'probe'), { recursive: true });
test.use({ extensionsDir: edition });

const files = fs.mkdtempSync(path.join(os.tmpdir(), 'xnat-e2e-licences-'));

test.beforeEach(async ({ page }) => {
  await waitForExtension(page, NOTES);
  await removeLicence(page);
  await page.reload({ waitUntil: 'load' });
  await enterLocalViewer(page);
});

const sidebarTab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Sidebar' }).getByRole('tab', { name, exact: true });
const notesItem = (page: Page) => page.getByTestId(`extension-toolbar-item-${NOTES}`);

async function openNotesSettings(page: Page): Promise<Locator> {
  await page.getByTitle('Open settings').click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Extensions', exact: true }).click();
  return settings;
}

/** Import a licence file through Session notes' Settings page, answering the system dialog. */
async function importLicence(app: ElectronApplication, settings: Locator, text: string, name = 'licence.json') {
  const file = path.join(files, name);
  fs.writeFileSync(file, text);
  await app.evaluate(({ dialog }, p) => { (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, file);
  await settings.getByRole('button', { name: 'Session notes', exact: true }).click(); // its page, under Extensions
  await settings.getByTestId(`extension-settings-page-${NOTES}`).getByRole('button', { name: 'Import licence file…' }).click();
}

test('no licence: inactive with the reason, nothing in the viewer, features listed locked — its Settings page stays', async ({ page }) => {
  await expect(sidebarTab(page, 'Notes')).toHaveCount(0);
  await expect(notesItem(page)).toHaveCount(0);
  await page.keyboard.press('n'); // its key is unbound: nothing happens, nothing throws
  const settings = await openNotesSettings(page);
  const row = settings.getByTestId(`extension-row-${NOTES}`);
  await expect(row.getByTestId('extension-state')).toHaveText('Inactive');
  await expect(row.getByTestId('extension-reason')).toHaveText('No licence. Import one in Settings › Extensions › Session notes.');
  await expect(row.locator('[data-feature][data-enabled="false"]')).toHaveCount(3);
  await expect(row.getByTestId('extension-features')).toContainText('Notes tab — not in your licence');
  await row.getByRole('button', { name: 'Settings…' }).click();
  await expect(settings.getByTestId('notes-licence-status')).toContainText('No licence');
  await settings.getByRole('button', { name: 'Hotkeys', exact: true }).click();
  await expect(settings.getByRole('combobox').first().locator('option', { hasText: 'Session notes:' })).toHaveCount(0);
});

test('Basic: only its features; importing Pro mounts the rest live; removing the licence takes them away live', async ({ page, electronApp }) => {
  let settings = await openNotesSettings(page);
  await importLicence(electronApp, settings, demoLicence({ tier: 'Basic', features: BASIC }), 'basic.json');
  await expect(settings.getByTestId('notes-licence-message')).toHaveText('Imported basic.json');
  await settings.getByRole('button', { name: 'Extensions', exact: true }).click();
  const row = settings.getByTestId(`extension-row-${NOTES}`);
  await expect(row.getByTestId('extension-state')).toHaveText('Active · Basic');
  await expect(row.locator('[data-feature="notes"]')).toHaveAttribute('data-enabled', 'true');
  await expect(row.locator('[data-feature="count"]')).toHaveAttribute('data-enabled', 'false');
  await settings.getByTitle('Close', { exact: true }).click();
  await expect(sidebarTab(page, 'Notes')).toBeVisible();
  await expect(notesItem(page)).toHaveCount(0); // Pro only

  settings = await openNotesSettings(page);
  await importLicence(electronApp, settings, demoLicence({ tier: 'Pro', features: PRO }), 'pro.json');
  await expect(settings.getByTestId('notes-licence-status')).toContainText('Pro · Example Hospital');
  await settings.getByTitle('Close', { exact: true }).click();
  await expect(notesItem(page)).toBeVisible(); // live: no restart
  await notesItem(page).getByRole('button').click();
  await page.getByTestId('extension-toolbar-popover').getByRole('button', { name: 'All notes…' }).click();
  await expect(page.getByTestId('extension-view')).toContainText('All notes');

  settings = await openNotesSettings(page);
  await settings.getByTestId(`extension-row-${NOTES}`).getByRole('button', { name: 'Settings…' }).click();
  await settings.getByRole('button', { name: 'Remove licence' }).click();
  await expect(settings.getByTestId('notes-licence-status')).toContainText('No licence');
  await settings.getByTitle('Close', { exact: true }).click();
  await expect(page.getByTestId('extension-view')).toHaveCount(0); // its view closed with the licence
  await expect(sidebarTab(page, 'Notes')).toHaveCount(0);
  await expect(notesItem(page)).toHaveCount(0);
});

test('a licence for an XNAT server needs that server; an expired one, or one edited after signing, is refused', async ({ page, electronApp }) => {
  const settings = await openNotesSettings(page);
  await importLicence(electronApp, settings, demoLicence({ tier: 'Pro', features: PRO, server: 'https://xnat.example.org' }), 'site.json');
  await expect(settings.getByTestId('notes-licence-status')).toContainText('Sign in to xnat.example.org to use this licence');

  await importLicence(electronApp, settings, demoLicence({ tier: 'Pro', features: PRO, expires: '2020-01-01' }), 'old.json');
  await expect(settings.getByTestId('notes-licence-status')).toContainText('Licence expired 2020-01-01');

  const tampered = JSON.parse(demoLicence({ tier: 'Basic', features: BASIC }));
  tampered.licence.features = PRO; // a Basic licence edited to Pro
  await importLicence(electronApp, settings, JSON.stringify(tampered), 'edited.json');
  await expect(settings.getByTestId('notes-licence-message')).toHaveText('Could not import edited.json: its signature does not match');
  await expect(settings.getByTestId('notes-licence-status')).toContainText('Licence expired 2020-01-01'); // the edited one was not kept
});

test('Settings lists the servers an extension declares it contacts', async ({ page }) => {
  const settings = await openNotesSettings(page);
  await expect(settings.getByTestId('extension-row-org.xnat.e2e.probe').getByTestId('extension-hosts')).toHaveText('Contacts: check.example.org');
});
