#!/usr/bin/env node
/**
 * Generates THIRD-PARTY-NOTICES.txt: the licence of every package the application ships.
 *
 *   node scripts/generate-third-party-notices.cjs           write the file
 *   node scripts/generate-third-party-notices.cjs --check   fail if the committed file is stale
 *
 * Sources, in order:
 *  1. Every installed production npm package (`npm ls --omit=dev --all`), with the text of
 *     its LICENSE / LICENCE / COPYING file. When it ships none: its repository's licence kept
 *     in build/notices/upstream/ (mapped in UPSTREAM below), else (MIT) the licence with its package.json
 *     author, else its declared licence and a pointer to the repository.
 *  2. Libraries compiled INTO packages (the image codecs' C sources): their npm packages carry
 *     only the wrapper's licence, so the upstream notices are kept by hand in
 *     build/notices/embedded/*.txt (one file per library; the first line is its heading).
 *  3. Electron's own LICENSE. Chromium's notices (LICENSES.chromium.html, ~15 MB) ship beside
 *     this file as their own document (electron-builder.config.js extraResources).
 *
 * Build tools (Vite, TypeScript, Playwright, …) are not distributed and are not listed.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'THIRD-PARTY-NOTICES.txt');
const EMBEDDED_DIR = path.join(ROOT, 'build', 'notices', 'embedded');
const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;

function productionPackages() {
  const json = execSync('npm ls --omit=dev --all --json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  const tree = JSON.parse(json);
  const found = new Map();
  const walk = (node) => {
    for (const [name, dep] of Object.entries(node.dependencies || {})) {
      // Optional peers / other-platform binaries that are not installed are not shipped.
      if (!dep.version || dep.missing) continue;
      const key = `${name}@${dep.version}`;
      if (found.has(key)) continue;
      const dir = dep.path || path.join(ROOT, 'node_modules', name);
      // Platform-restricted binaries (package.json os / cpu) differ per machine, so listing them
      // would make this file platform-dependent. The one in the tree — Rollup's Linux binary,
      // an optionalDependency of jpeg-lossless-decoder-js by a packaging slip — is a build tool
      // the app never loads, and electron-builder.config.js keeps it out of the package.
      try {
        const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (pj.os || pj.cpu) continue;
      } catch { /* not installed: handled above */ }
      found.set(key, { name, version: dep.version, dir });
      walk(dep);
    }
  };
  walk(tree);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function declaredLicense(pkg) {
  const l = pkg.license || pkg.licenses;
  if (!l) return 'UNKNOWN';
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) return l.map((x) => (typeof x === 'string' ? x : x.type)).join(' OR ');
  return l.type || 'UNKNOWN';
}

function licenseText(dir) {
  if (!fs.existsSync(dir)) return null;
  const file = fs.readdirSync(dir).find((f) => LICENSE_FILE.test(f));
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : null;
}

const RULE = '-'.repeat(78);

const MIT_TEXT = (holder) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/**
 * Packages that ship no licence file, and the upstream licence (build/notices/upstream/*.txt,
 * each recording its source) that covers them.
 */
const UPSTREAM = {
  '@cornerstonejs/core': 'cornerstone3d',
  '@cornerstonejs/metadata': 'cornerstone3d',
  '@cornerstonejs/polymorphic-segmentation': 'cornerstone3d',
  '@cornerstonejs/tools': 'cornerstone3d',
  '@cornerstonejs/utils': 'cornerstone3d',
};
const overrideText = (name) => {
  const f = UPSTREAM[name] && path.join(ROOT, 'build', 'notices', 'upstream', `${UPSTREAM[name]}.txt`);
  return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null;
};
const authorName = (pkg) => (typeof pkg.author === 'string' ? pkg.author : pkg.author && pkg.author.name) || null;

function generate() {
  const parts = [
    'THIRD-PARTY NOTICES — XNAT Workstation',
    '',
    'XNAT Workstation includes the third-party software listed below. Each is distributed',
    'under its own licence, reproduced here. Generated by',
    'scripts/generate-third-party-notices.cjs — do not edit by hand.',
    '',
    'The notices for Chromium, which Electron includes, are in LICENSES.chromium.html,',
    'distributed with the application.',
    '',
  ];
  const unknown = [];
  const pkgs = productionPackages().map((p) => {
    const json = JSON.parse(fs.readFileSync(path.join(p.dir, 'package.json'), 'utf8'));
    return { ...p, json, text: licenseText(p.dir) };
  });
  // A package that ships no licence file: the upstream text kept in build/notices/upstream,
  // else (MIT) the licence with the author its package.json names. Never a sibling package's
  // file — packages from one repository can carry different licences.
  for (const p of pkgs) {
    const declared = declaredLicense(p.json);
    let text = p.text;
    let note = '';
    const override = text ? null : overrideText(p.name);
    if (override) { text = override; note = '(The package ships no licence file: its repository\'s licence.)'; }
    else if (!text && declared === 'MIT' && authorName(p.json)) { text = MIT_TEXT(authorName(p.json)); note = '(The package ships no licence file: the MIT licence, with the author its package.json names.)'; }
    if (declared === 'UNKNOWN' && !text) unknown.push(`${p.name}@${p.version}`);
    parts.push(RULE, `${p.name} ${p.version} — ${declared}`, p.json.homepage ? `${p.json.homepage}` : '', '');
    if (note) parts.push(note);
    parts.push(text || `Licensed under ${declared}. (The package ships no licence file; see its repository.)`, '');
  }
  if (fs.existsSync(EMBEDDED_DIR)) {
    const files = fs.readdirSync(EMBEDDED_DIR).filter((f) => f.endsWith('.txt')).sort();
    if (files.length) parts.push(RULE, 'LIBRARIES COMPILED INTO THE IMAGE CODECS', '');
    for (const f of files) parts.push(RULE, fs.readFileSync(path.join(EMBEDDED_DIR, f), 'utf8').trim(), '');
  }
  const electronDir = path.join(ROOT, 'node_modules', 'electron');
  const electronPkg = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'));
  parts.push(RULE, `electron ${electronPkg.version} — ${declaredLicense(electronPkg)}`, 'https://github.com/electron/electron', '');
  parts.push(licenseText(path.join(electronDir, 'dist')) || licenseText(electronDir) || 'MIT', '');
  if (unknown.length) {
    console.error(`[notices] packages with no declared licence and no licence file: ${unknown.join(', ')}`);
    process.exitCode = 1;
  }
  return parts.join('\n').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

const text = generate();
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== text) {
    console.error('[notices] THIRD-PARTY-NOTICES.txt is out of date — run: npm run notices');
    process.exit(1);
  }
  console.log('[notices] THIRD-PARTY-NOTICES.txt is up to date');
} else {
  fs.writeFileSync(OUT, text);
  console.log(`[notices] wrote ${path.relative(ROOT, OUT)} (${text.length.toLocaleString('en-US')} bytes)`);
}
