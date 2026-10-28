#!/usr/bin/env node
/**
 * Build the edition (branch 9, M6 — docs/editions.md): read the edition configuration
 * (XNAT_EDITION, default edition.config.json), pack its modules into build/edition/modules/,
 * and record it in build/edition/edition.json for the app and for electron-builder. Needs the
 * main process built (npm run build:main) — it packs with the app's own packaging code.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { readEditionConfig, editionPaths } = require(path.join(root, 'dist/main/main/modules/edition.js'));
const { packFiles, readPackage } = require(path.join(root, 'dist/main/main/modules/modulePackage.js'));

const configFile = path.resolve(process.env.XNAT_EDITION || path.join(root, 'edition.config.json'));
const edition = readEditionConfig(configFile);
const out = path.join(root, 'build', 'edition');
const { info, modules } = editionPaths(out);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(modules, { recursive: true });

const readTree = (dir) => {
  const files = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && !e.name.endsWith('.ts') && e.name !== '.DS_Store') files.set(path.relative(dir, full).split(path.sep).join('/'), fs.readFileSync(full));
    }
  };
  walk(dir);
  return files;
};

const ids = [];
for (const entry of edition.modules) {
  const src = path.resolve(path.dirname(configFile), entry);
  const buf = fs.statSync(src).isDirectory() ? packFiles(readTree(src)) : fs.readFileSync(src);
  const r = readPackage(buf, new Set(), { bundled: true });
  if (!r.ok) throw new Error(`${entry}: ${r.reason}`);
  fs.writeFileSync(path.join(modules, `${r.manifest.id}.xwmodule`), buf);
  ids.push(r.manifest.id);
  console.log(`[build-edition] ${edition.id}: ${r.manifest.id} ${r.manifest.version}`);
}
fs.writeFileSync(info, JSON.stringify({ ...edition, modules: ids }, null, 2));
console.log(`[build-edition] ${edition.productName} → ${path.relative(root, out)}`);
