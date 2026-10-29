#!/usr/bin/env node
/**
 * Build the example extensions (docs/extension-framework.md): each extensions/examples/<name>/
 * is copied to dist/extensions/examples/<name>/ with its src/renderer.tsx bundled into
 * renderer.js — the way any extension is built: an ES module with `react` and
 * `react/jsx-runtime` aliased to the SDK's, so it renders with the app's React, and the SDK's
 * types erased.
 */
import { build } from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = path.join(root, 'packages', 'extension-api', 'src');
const src = path.join(root, 'extensions', 'examples');
for (const name of fs.readdirSync(src).filter((d) => fs.existsSync(path.join(src, d, 'extension.json')))) {
  const from = path.join(src, name);
  const out = path.join(root, 'dist', 'extensions', 'examples', name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    if (f === 'src' || f === 'tsconfig.json' || f.startsWith('.')) continue;
    fs.cpSync(path.join(from, f), path.join(out, f), { recursive: true });
  }
  await build({
    entryPoints: [path.join(from, 'src', 'renderer.tsx')],
    outfile: path.join(out, 'renderer.js'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', logLevel: 'warning',
    alias: {
      react: path.join(sdk, 'react.ts'),
      'react/jsx-runtime': path.join(sdk, 'jsx-runtime.ts'),
      '@nrgxnat/workstation-extension-api': path.join(sdk, 'index.ts'),
    },
  });
  console.log(`[build-extensions] ${name} → ${path.relative(root, out)}`);
}
