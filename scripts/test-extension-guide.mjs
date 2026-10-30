#!/usr/bin/env node
/**
 * The extension authoring guide's acceptance check (docs/extension-framework.md, X7): an
 * extension built FROM THE GUIDE, in a directory of its own outside this repository, against the
 * packed SDK — typechecked, built, licensed, and run by its own E2E against this core's build.
 *
 *   1. build and `npm pack` the SDK;
 *   2. copy docs/extension-authoring-example/ to a fresh folder and install the SDK tarball there
 *      (unpacked: it has no dependencies); its other dev tools — esbuild, TypeScript, Playwright,
 *      React's types — are linked from this checkout, standing in for `npm install`, so the check
 *      needs no network;
 *   3. make the publisher's key pair, typecheck, build;
 *   4. run its E2E (`npx playwright test`) with XW_CORE pointing here.
 *
 * Run after `npm run build`.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xw-guide-'));
const ext = path.join(tmp, 'hello-licensed');
const run = (cmd, args, cwd, env = {}) => execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

try {
  run('node', ['scripts/build-sdk.mjs'], root);
  const packed = execFileSync('npm', ['pack', '--pack-destination', tmp, '--silent'], { cwd: path.join(root, 'packages', 'extension-api'), encoding: 'utf8' }).trim().split('\n').pop();
  const tarball = path.join(tmp, packed);
  console.log(`[test-extension-guide] packed ${packed}`);

  fs.cpSync(path.join(root, 'docs', 'extension-authoring-example'), ext, { recursive: true, filter: (src) => !/node_modules|[\\/]out([\\/]|$)|private-key\.pem/.test(src) });
  // Install the SDK from its tarball — the package has no dependencies, so unpacking it into
  // node_modules is what `npm install <tarball>` does, without reaching the registry.
  const sdk = path.join(ext, 'node_modules', '@nrgxnat', 'workstation-extension-api');
  fs.mkdirSync(sdk, { recursive: true });
  run('tar', ['-xzf', tarball, '-C', sdk, '--strip-components=1'], ext);
  for (const dep of ['esbuild', '@esbuild', 'typescript', '@playwright', 'playwright', 'playwright-core', '@types']) {
    const from = path.join(root, 'node_modules', dep);
    const to = path.join(ext, 'node_modules', dep);
    if (fs.existsSync(from) && !fs.existsSync(to)) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.symlinkSync(from, to); }
  }
  const bin = (name) => path.join(ext, 'node_modules', '.bin', name);
  fs.mkdirSync(path.join(ext, 'node_modules', '.bin'), { recursive: true });
  for (const [name, target] of [['tsc', 'typescript/bin/tsc'], ['playwright', '@playwright/test/cli.js']]) {
    if (!fs.existsSync(bin(name))) fs.symlinkSync(path.join(ext, 'node_modules', target), bin(name));
  }

  run('node', ['licence.mjs', 'key'], ext);
  run(bin('tsc'), ['--noEmit', '-p', '.'], ext);
  run('node', ['build.mjs'], ext);
  run(bin('playwright'), ['test'], ext, { XW_CORE: root });
  console.log('[test-extension-guide] the guide\'s extension, built outside the repository against the packed SDK, loads and its licence gate works');
} catch (e) {
  console.error(`[test-extension-guide] FAILED: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  if (process.env.XW_GUIDE_KEEP) console.log(`[test-extension-guide] kept ${tmp}`);
  else fs.rmSync(tmp, { recursive: true, force: true });
}
