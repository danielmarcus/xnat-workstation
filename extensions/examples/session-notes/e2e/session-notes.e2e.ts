/**
 * Session notes, tested from its own folder with the SDK's testing helpers (extension framework
 * X5, R11): the app is launched with this extension; the test drives the UI and reads the
 * extension's own `ext` to check what it stored. In an extension's own repository the import is
 * '@nrgxnat/workstation-extension-api/testing' and the core is a built checkout or a packaged
 * edition.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extension, launchWorkstation, openViewer, type WorkstationRun } from '../../../../packages/extension-api/src/testing';
import { demoLicence, PRO } from './demoLicence';

const CORE = path.resolve(__dirname, '..', '..', '..', '..');
const MAIN = path.join(CORE, 'dist', 'main', 'main', 'index.js');
const EXTENSIONS = path.join(CORE, 'dist', 'extensions', 'examples');
const ID = 'org.xnat.examples.session-notes';

async function launch(userDataDir: string): Promise<WorkstationRun> {
  const run = await launchWorkstation({ mainEntry: MAIN, extensionsDir: EXTENSIONS, userDataDir });
  await extension(run.page, ID).waitUntilRunning();
  // Every feature: a Pro licence, through its own import path (its main part verifies it).
  await extension(run.page, ID).evaluate((ext, text) => ext.channel.request({ op: 'install-licence', text }), demoLicence({ tier: 'Pro', features: PRO }));
  await openViewer(run.page);
  await run.page.getByRole('tablist', { name: 'Sidebar' }).getByRole('tab', { name: 'Notes', exact: true }).click();
  return run;
}

const tab = (run: WorkstationRun) => run.page.getByTestId(`extension-sidebar-tab-${ID}`);

async function addNote(run: WorkstationRun, text: string) {
  await tab(run).getByRole('button', { name: '+ Add note' }).click();
  const dialog = run.page.getByRole('dialog', { name: 'Add note' });
  await dialog.getByLabel('Note').fill(text);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
}

test('notes are kept on this computer, per session, and survive a restart', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'session-notes-e2e-'));
  try {
    let run = await launch(data);
    expect(await extension(run.page, ID).evaluate((ext) => ext.testing)).toBe(true);
    await addNote(run, 'Motion on slices 40–44');
    await expect(tab(run)).toContainText('1 note');
    expect(await extension(run.page, ID).evaluate((ext) => ext.storage.get('notes:local')))
      .toEqual([{ text: 'Motion on slices 40–44', at: expect.any(String) }]);
    await run.close();

    run = await launch(data); // the same user, a new app run
    await expect(tab(run)).toContainText('Motion on slices 40–44');
    await run.close();
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('notes are exported to, and imported from, a JSON file the user picks', async () => {
  const run = await launch(fs.mkdtempSync(path.join(os.tmpdir(), 'session-notes-e2e-')));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-notes-files-'));
  try {
    await addNote(run, 'Check left hippocampus');
    // The system dialogs are answered by the test.
    const out = path.join(dir, 'exported.json');
    await run.app.evaluate(({ dialog }, p) => { (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () => ({ canceled: false, filePath: p }); }, out);
    await tab(run).getByRole('button', { name: 'Export…' }).click();
    await expect(tab(run).getByTestId('notes-status')).toHaveText('Exported 1 note to exported.json');
    expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toEqual([{ text: 'Check left hippocampus', at: expect.any(String) }]);

    const incoming = path.join(dir, 'incoming.json');
    fs.writeFileSync(incoming, JSON.stringify([{ text: 'From a colleague', at: '2026-10-01T09:00:00Z' }, { text: 'Second', at: '2026-10-02T09:00:00Z' }]));
    await run.app.evaluate(({ dialog }, p) => { (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, incoming);
    await tab(run).getByRole('button', { name: 'Import…' }).click();
    await expect(tab(run).getByTestId('notes-status')).toHaveText('Imported 2 notes from incoming.json');
    await expect(tab(run)).toContainText('3 notes');
    await expect(tab(run)).toContainText('From a colleague');

    fs.writeFileSync(incoming, '{ not json');
    await tab(run).getByRole('button', { name: 'Import…' }).click();
    await expect(tab(run).getByTestId('notes-status')).toContainText('Could not import incoming.json');
    await expect(tab(run)).toContainText('3 notes');
  } finally {
    await run.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
