#!/usr/bin/env node
/**
 * The packaged-edition check (branch 9, M6 — docs/editions.md): package the app, unsigned and
 * unpacked, with a TEST edition (e2e/fixtures/edition/test-edition.json — its own name, app id
 * one bundled module and one extension); check the package carries them; run the packaging spec against the
 * packaged app; then restore the default edition in build/edition. Run after `npm run build`.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = path.join(root, 'e2e', 'fixtures', 'edition', 'test-edition.json');
const edition = JSON.parse(fs.readFileSync(config, 'utf8'));
const out = path.join(root, 'release', 'edition-check');
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
const fail = (msg) => { console.error(`[test-edition] FAILED: ${msg}`); process.exitCode = 1; };

try {
  run('node', ['scripts/build-edition.mjs'], { XNAT_EDITION: config });
  fs.rmSync(out, { recursive: true, force: true });
  run(path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'),
    ['--config', 'electron-builder.config.js', '--dir', '--publish', 'never', '-c.mac.notarize=false', `-c.directories.output=${out}`],
    { CSC_IDENTITY_AUTO_DISCOVERY: 'false' });

  const unpacked = fs.readdirSync(out).map((d) => path.join(out, d)).find((d) => /(mac|linux|win).*/.test(path.basename(d)) && fs.statSync(d).isDirectory());
  if (!unpacked) throw new Error(`no unpacked app in ${out}`);
  let exe, resources;
  if (process.platform === 'darwin') {
    const app = path.join(unpacked, `${edition.productName}.app`);
    exe = path.join(app, 'Contents', 'MacOS', edition.productName);
    resources = path.join(app, 'Contents', 'Resources');
  } else {
    const name = fs.readdirSync(unpacked).find((f) => f.toLowerCase().startsWith(edition.productName.toLowerCase().split(' ')[0].toLowerCase()) && !f.endsWith('.pak'));
    exe = path.join(unpacked, name);
    resources = path.join(unpacked, 'resources');
  }
  if (!fs.existsSync(exe)) fail(`the app is not named for the edition (${exe})`);
  const info = JSON.parse(fs.readFileSync(path.join(resources, 'edition.json'), 'utf8'));
  if (info.id !== edition.id || info.productName !== edition.productName) fail(`resources/edition.json is not the test edition's: ${JSON.stringify(info)}`);
  const bundled = fs.readdirSync(path.join(resources, 'modules'));
  if (bundled.join() !== 'org.xnat.examples.threshold.xwmodule') fail(`resources/modules holds ${bundled.join(', ') || 'nothing'}`);
  // Extensions are inside the app archive (docs/extension-framework.md, design point 5), not loose resources.
  const asar = createRequire(import.meta.url)('@electron/asar');
  const inArchive = asar.listPackage(path.join(resources, 'app.asar')).map((f) => f.split(path.sep).join('/'));
  for (const f of ['extension.json', 'renderer.js', 'main.js']) {
    if (!inArchive.includes(`/extensions/org.xnat.examples.session-notes/${f}`)) fail(`app.asar has no extensions/org.xnat.examples.session-notes/${f}`);
  }
  if (fs.existsSync(path.join(resources, 'extensions'))) fail('extensions were also shipped as loose resources');
  if ((info.extensions ?? []).join() !== 'org.xnat.examples.session-notes') fail(`edition.json lists extensions ${JSON.stringify(info.extensions)}`);
  console.log(`[test-edition] package: ${path.relative(root, exe)}; edition.json, modules/ and the archive's extensions/ are the test edition's`);

  run('npx', ['playwright', 'test', '--config', 'playwright.config.ts', '--project=app', 'e2e/specs/packaging/edition-package.e2e.ts', '--reporter=list'], {
    E2E_EXECUTABLE_PATH: exe, E2E_KEEP_BUNDLED: '1', E2E_EDITION_CHECK: '1', E2E_EDITION_PRODUCT: edition.productName, E2E_EDITION_APP_NAME: edition.appName,
  });
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  run('node', ['scripts/build-edition.mjs']); // the default edition again
}
