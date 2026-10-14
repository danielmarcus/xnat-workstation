#!/usr/bin/env node
/**
 * Build the modules made from the host's own source (branch 9, M5(b)): each
 * modules/builtins/<name>/module.ts is bundled (ES module, no imports left) with its
 * manifest.json into dist/modules/<name>/, ready for `npm run module:pack`.
 */
import { build } from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'modules', 'builtins');
for (const name of fs.readdirSync(src).filter((d) => fs.existsSync(path.join(src, d, 'module.ts')))) {
  const out = path.join(root, 'dist', 'modules', name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  await build({
    entryPoints: [path.join(src, name, 'module.ts')],
    outfile: path.join(out, 'module.js'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'warning',
  });
  fs.copyFileSync(path.join(src, name, 'manifest.json'), path.join(out, 'manifest.json'));
  console.log(`[build-modules] ${name} → ${path.relative(root, out)}`);
}
