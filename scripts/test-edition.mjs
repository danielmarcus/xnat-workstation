#!/usr/bin/env node
/**
 * The packaged-edition check (branch 9, M6 — docs/editions.md): package the app, unsigned and
 * unpacked, with a TEST edition (e2e/fixtures/edition/test-edition.json — its own name, app id
 * one bundled module and one extension); check the package carries them; prove the build's
 * protections hold (docs/extension-framework.md, design point 11) — the fuses are set, running as
 * Node, NODE_OPTIONS and --inspect do nothing, and an archive edited after packaging does not
 * run; then turn the inspector back on in this copy only, so Playwright can drive it; run the packaging spec against the
 * packaged app; then restore the default edition in build/edition. Run after `npm run build`.
 */
import { execFileSync, spawn } from 'child_process';
import * as net from 'net';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = path.join(root, 'e2e', 'fixtures', 'edition', 'test-edition.json');
const edition = JSON.parse(fs.readFileSync(config, 'utf8'));
const out = path.join(root, 'release', 'edition-check');
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
let failures = 0;
const fail = (msg) => { failures += 1; console.error(`[test-edition] FAILED: ${msg}`); process.exitCode = 1; };

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
  const asar = createRequire(import.meta.url)('@electron/asar');
  const archive = path.join(resources, 'app.asar');
  // The edition record is inside the archive, covered by its integrity check (design point 11).
  if (fs.existsSync(path.join(resources, 'edition.json'))) fail('edition.json was also shipped as a loose resource');
  const info = JSON.parse(asar.extractFile(archive, 'edition/edition.json').toString('utf8'));
  if (info.id !== edition.id || info.productName !== edition.productName) fail(`the archive's edition.json is not the test edition's: ${JSON.stringify(info)}`);
  if (!info.extensionDigests?.['org.xnat.examples.session-notes']?.['renderer.js']) fail('the edition record has no fingerprints for its extension');
  const bundled = fs.readdirSync(path.join(resources, 'modules'));
  if (bundled.join() !== 'org.xnat.examples.threshold.xwmodule') fail(`resources/modules holds ${bundled.join(', ') || 'nothing'}`);
  // Extensions are inside the app archive (docs/extension-framework.md, design point 5), not loose resources.
  const inArchive = asar.listPackage(archive).map((f) => f.split(path.sep).join('/'));
  for (const f of ['extension.json', 'renderer.js', 'main.js']) {
    if (!inArchive.includes(`/extensions/org.xnat.examples.session-notes/${f}`)) fail(`app.asar has no extensions/org.xnat.examples.session-notes/${f}`);
  }
  if (fs.existsSync(path.join(resources, 'extensions'))) fail('extensions were also shipped as loose resources');
  if ((info.extensions ?? []).join() !== 'org.xnat.examples.session-notes') fail(`edition.json lists extensions ${JSON.stringify(info.extensions)}`);
  console.log(`[test-edition] package: ${path.relative(root, exe)}; edition.json, modules/ and the archive's extensions/ are the test edition's`);

  await checkProtections(exe, resources);

  // Playwright drives Electron through its inspector, which the fuse turns off: turn it back on in
  // THIS copy only (the build's configuration is unchanged), and re-sign it ad hoc on macOS.
  const fuses = createRequire(import.meta.url)('@electron/fuses');
  await fuses.flipFuses(exe, { version: fuses.FuseVersion.V1, resetAdHocDarwinSignature: process.platform === 'darwin', [fuses.FuseV1Options.EnableNodeCliInspectArguments]: true });

  run('npx', ['playwright', 'test', '--config', 'playwright.config.ts', '--project=app', 'e2e/specs/packaging/edition-package.e2e.ts', '--reporter=list'], {
    E2E_EXECUTABLE_PATH: exe, E2E_KEEP_BUNDLED: '1', E2E_EDITION_CHECK: '1', E2E_EDITION_PRODUCT: edition.productName, E2E_EDITION_APP_NAME: edition.appName,
    E2E_EDITION_DEVTOOLS: String(edition.devTools !== false),
  });
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  run('node', ['scripts/build-edition.mjs']); // the default edition again
}

// ─── The build's protections (design point 11) ──────────────────────────────

/** Start the packaged app; resolve when it exits or after `ms` (then kill it). */
function runFor(exe, args, env, ms) {
  return new Promise((resolve) => {
    // E2E_TESTING: the app uses the stand-in keychain, never the user's real one.
    const child = spawn(exe, args, { env: { ...process.env, E2E_TESTING: '1', ...env }, stdio: 'ignore' });
    let done = false;
    const finish = (code) => { if (!done) { done = true; clearTimeout(t); resolve(code); } };
    const t = setTimeout(() => { child.kill('SIGKILL'); finish('running'); }, ms);
    child.on('exit', (code, signal) => finish(code ?? signal));
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
}

async function checkProtections(exe, resources) {
  const failuresBefore = failures;
  const fuses = createRequire(import.meta.url)('@electron/fuses');
  const wire = await fuses.getCurrentFuseWire(exe);
  const O = fuses.FuseV1Options;
  const want = { RunAsNode: 48, EnableNodeOptionsEnvironmentVariable: 48, EnableNodeCliInspectArguments: 48, EnableEmbeddedAsarIntegrityValidation: 49, OnlyLoadAppFromAsar: 49 };
  for (const [name, state] of Object.entries(want)) {
    if (wire[O[name]] !== state) fail(`fuse ${name} is ${String.fromCharCode(wire[O[name]])}, not ${String.fromCharCode(state)}`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xw-protect-'));
  const data = (n) => `--user-data-dir=${path.join(tmp, `data-${n}`)}`;
  try {
    // Run as plain Node: with the fuse open, the -e script writes the marker at once. Nothing may
    // follow the script (Node would refuse it as a bad option before running anything), so the
    // app — if it starts instead, as it should — gets a HOME of its own for its profile.
    const marker1 = path.join(tmp, 'ran-as-node');
    await runFor(exe, ['-e', `require('fs').writeFileSync(${JSON.stringify(marker1)}, 'x')`], { ELECTRON_RUN_AS_NODE: '1', HOME: path.join(tmp, 'home') }, 8000);
    if (fs.existsSync(marker1)) fail('ELECTRON_RUN_AS_NODE ran a script in the packaged app');

    // NODE_OPTIONS: a --require'd script must not run. (Packaged Electron already refuses
    // --require, fuse or not; the fuse — checked above — closes NODE_OPTIONS entirely.)
    const marker2 = path.join(tmp, 'node-options');
    const evil = path.join(tmp, 'evil.js');
    fs.writeFileSync(evil, `require('fs').writeFileSync(${JSON.stringify(marker2)}, 'x')`);
    await runFor(exe, [data(2)], { NODE_OPTIONS: `--require ${evil}` }, 8000);
    if (fs.existsSync(marker2)) fail('NODE_OPTIONS loaded a script into the packaged app');

    // --inspect: nothing may listen on the port.
    const port = 19000 + Math.floor(Math.random() * 1000);
    let listening = false;
    const watch = setInterval(async () => { if (await portOpen(port)) listening = true; }, 500);
    await runFor(exe, [`--inspect=${port}`, data(3)], {}, 8000);
    clearInterval(watch);
    if (listening) fail(`--inspect opened a debugger on port ${port}`);

    // An archive edited after packaging must not run (macOS, Windows: the integrity check).
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const copy = path.join(tmp, 'tampered');
      const appRoot = process.platform === 'darwin' ? path.resolve(resources, '..', '..') : path.dirname(exe);
      fs.cpSync(appRoot, copy, { recursive: true, verbatimSymlinks: true });
      const copyExe = process.platform === 'darwin' ? path.join(copy, 'Contents', 'MacOS', path.basename(exe)) : path.join(copy, path.basename(exe));
      const copyArchive = process.platform === 'darwin' ? path.join(copy, 'Contents', 'Resources', 'app.asar') : path.join(copy, 'resources', 'app.asar');
      const bytes = fs.readFileSync(copyArchive);
      const at = bytes.indexOf(Buffer.from('"productName"'));
      if (at < 0) throw new Error('nothing to tamper with in the archive');
      bytes[at + 1] = 'P'.charCodeAt(0); // "productName" → "ProductName", same length
      fs.writeFileSync(copyArchive, bytes);
      const code = await runFor(copyExe, [data(4)], {}, 20000);
      if (code === 'running') fail('an app whose archive was edited after packaging still ran');
      else console.log(`[test-edition] the edited archive did not run (exit ${code})`);
    }
    if (failures === failuresBefore) console.log('[test-edition] protections hold: fuses set; run-as-Node, NODE_OPTIONS and --inspect have no effect');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
