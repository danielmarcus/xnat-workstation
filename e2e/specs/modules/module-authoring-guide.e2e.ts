/**
 * The authoring guide's quick start, as written (SegWorks parity branch 9, M6): the commands
 * between `quickstart:start` and `quickstart:end` in docs/module-authoring.md run, line by line,
 * in the repository; then the module they built is installed the way the guide says — trust the
 * publisher's public.json, Install module… — and is Verified and in the Operations picker.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../../fixtures/electron-app';
import { loadFixture } from '../../helpers/local-fixture';
import { resetModules, stubOpen } from '../../helpers/modules';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MADE = ['my-module', 'my-module.xwmodule', 'my-publisher.private.pem', 'my-publisher.public.json'].map((f) => path.join(ROOT, f));
const clean = () => { for (const f of MADE) fs.rmSync(f, { recursive: true, force: true }); };

function quickstart(): string[] {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'module-authoring.md'), 'utf8');
  const block = /<!-- quickstart:start -->\s*```bash\n([\s\S]*?)```\s*<!-- quickstart:end -->/.exec(doc);
  if (!block) throw new Error('docs/module-authoring.md has no quickstart block');
  return block[1].split('\n').map((l) => l.trim()).filter(Boolean);
}

test('the authoring guide\'s quick start builds, signs and installs as written', async ({ electronApp, page }) => {
  test.setTimeout(240_000);
  clean();
  try {
    const lines = quickstart();
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) execSync(line, { cwd: ROOT, stdio: 'pipe', shell: '/bin/bash' });
    expect(execSync('npm run --silent module:verify -- my-module.xwmodule --trust my-publisher.public.json', { cwd: ROOT, encoding: 'utf8' }))
      .toMatch(/org\.example\.my-threshold 1\.0\.0 .*VERIFIED[\s\S]*\(My Lab\)/);

    await resetModules(electronApp);
    await page.reload();
    await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
    await page.getByTitle('Open settings').click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('button', { name: 'Modules', exact: true }).click();
    await stubOpen(electronApp, path.join(ROOT, 'my-publisher.public.json'));
    await dialog.getByRole('button', { name: 'Add trusted publisher…' }).click();
    await stubOpen(electronApp, path.join(ROOT, 'my-module.xwmodule'));
    await dialog.getByRole('button', { name: 'Install module…' }).click();
    const row = dialog.getByTestId('module-row-org.example.my-threshold');
    await expect(row).toContainText('Verified');
    await expect(dialog.getByTestId('module-confirm')).toHaveCount(0); // no warning for a trusted publisher
    await dialog.getByTitle('Close', { exact: true }).click();
    const panel = page.locator('[data-testid="annotations-side-panel"]');
    if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
    await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
    await page.keyboard.press('Escape');
    await expect(panel.getByLabel('Operation', { exact: true }).locator('optgroup[label="Modules"] option')).toHaveText(['My threshold']);
  } finally {
    clean();
  }
});
