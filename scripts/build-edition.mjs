#!/usr/bin/env node
/**
 * Build the edition (branch 9, M6 — docs/editions.md): read the edition configuration
 * (XNAT_EDITION, default edition.config.json), pack its modules into build/edition/modules/,
 * copy its extensions into build/edition/extensions/<id>/ (docs/extension-framework.md), and
 * record it in build/edition/edition.json for the app and for electron-builder. Needs the main
 * process built (npm run build:main) — it packs and checks with the app's own code. An extension
 * the app would refuse fails the build: it never ships.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { readEditionConfig, editionPaths } = require(path.join(root, 'dist/main/main/modules/edition.js'));
const { packFiles, readPackage } = require(path.join(root, 'dist/main/main/modules/modulePackage.js'));
const { EXTENSION_API_VERSION, apiCompatible, incompatibleReason, validateExtensionManifest } = require(path.join(root, 'dist/main/shared/extensions/manifest.js'));

const configFile = path.resolve(process.env.XNAT_EDITION || path.join(root, 'edition.config.json'));
const edition = readEditionConfig(configFile);
const out = path.join(root, 'build', 'edition');
const { info, modules, extensions } = editionPaths(out);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(modules, { recursive: true });
fs.mkdirSync(extensions, { recursive: true });

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
const extIds = [];
for (const entry of edition.extensions ?? []) {
  const src = path.resolve(path.dirname(configFile), entry);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(src, 'extension.json'), 'utf8'));
  } catch (e) {
    throw new Error(`${entry}: no readable extension.json (${e.message})`);
  }
  const v = validateExtensionManifest(manifest);
  if (!v.ok) throw new Error(`${entry}: ${v.errors.join('; ')}`);
  const m = v.manifest;
  if (!apiCompatible(m.apiVersion, EXTENSION_API_VERSION)) throw new Error(`${entry}: ${incompatibleReason(m.apiVersion)}`);
  for (const f of [m.renderer, m.main].filter(Boolean)) if (!fs.existsSync(path.join(src, f))) throw new Error(`${entry}: ${f} is missing`);
  if (extIds.includes(m.id)) throw new Error(`${entry}: the id ${m.id} is listed twice`);
  const dest = path.join(extensions, m.id);
  for (const [rel, data] of readTree(src)) {
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    fs.writeFileSync(path.join(dest, rel), data);
  }
  extIds.push(m.id);
  console.log(`[build-edition] ${edition.id}: extension ${m.id} ${m.version}`);
}
fs.writeFileSync(info, JSON.stringify({ ...edition, modules: ids, extensions: extIds }, null, 2));
console.log(`[build-edition] ${edition.productName} → ${path.relative(root, out)}`);
