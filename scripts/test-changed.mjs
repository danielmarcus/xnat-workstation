#!/usr/bin/env node
/**
 * Test what changed (CLAUDE.md, "Testing: what to run when"): lint, typecheck, the unit tests
 * related to the changed files, and the E2E specs for the code that changed — not the whole
 * hour-long suite.
 *
 *   npm run test:changed                  # changes since the base (see below) + uncommitted ones
 *   npm run test:changed -- --dry-run     # print the plan only
 *   npm run test:changed -- --base <ref>  # compare against <ref> instead
 *   npm run test:changed -- --base <c>~1 --head <c> --dry-run   # what one past commit would run
 *   npm run test:changed -- --area annotations --area tools   # add whole spec folders
 *   npm run test:changed -- --no-build    # E2E against the existing dist/
 *
 * The base: on a branch, where it left origin/main; on main, the upstream (unpushed commits).
 * Uncommitted and untracked files always count.
 *
 * E2E specs are chosen three ways: specs that changed themselves; specs whose file name matches
 * a changed file's name (maskPreview.ts, useMaskPreview.ts → mask-preview.e2e.ts); and whole
 * folders for areas with clear borders (extensions, modules, transport). A change to the E2E
 * harness itself (helpers, fixtures, page objects, the config) runs the offline suite. Changed
 * files no spec covers are listed with the folders that would, so the choice is explicit. The
 * sweep and the live specs are never run unasked; the script says when they are worth running.
 */
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const values = (f) => args.flatMap((a, i) => (a === f && args[i + 1] ? [args[i + 1]] : []));
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const tryGit = (...a) => { try { return git(...a); } catch { return ''; } };

// ── What changed ────────────────────────────────────────────────────────────────────────────
function baseRef() {
  const [given] = values('--base');
  if (given) return given;
  const branch = tryGit('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') return tryGit('merge-base', 'HEAD', 'origin/main') || 'origin/main';
  return tryGit('rev-parse', '--abbrev-ref', '@{upstream}') || 'origin/main';
}
const base = baseRef();
const RELEVANT = /^(src|e2e|extensions|modules|packages|scripts)\/|^(playwright\.config\.ts|package\.json|electron-builder\.config\.js)$/;
const [head] = values('--head');
const changed = [...new Set([
  ...tryGit('diff', '--name-only', `${base}...${head ?? 'HEAD'}`).split('\n'),
  // Uncommitted work counts unless a past --head is being examined.
  ...(head ? [] : tryGit('diff', '--name-only', 'HEAD').split('\n')),
  ...(head ? [] : tryGit('ls-files', '--others', '--exclude-standard').split('\n')),
])].filter((f) => f && RELEVANT.test(f) && fs.existsSync(path.join(root, f)));

// ── Which E2E specs ─────────────────────────────────────────────────────────────────────────
const SPECS = path.join('e2e', 'specs');
const allSpecs = fs.readdirSync(path.join(root, SPECS), { recursive: true }).map(String)
  .filter((f) => f.endsWith('.e2e.ts')).map((f) => path.join(SPECS, f));
const folder = (name) => allSpecs.filter((s) => s.startsWith(path.join(SPECS, name) + path.sep));

/** Areas with clear borders: a change inside runs the whole folder. */
const AREAS = [
  { name: 'extensions', match: /(^|\/)extensions?\/|extensionHandlers|ExtensionsSection|^packages\/extension-api\// },
  { name: 'modules', match: /^modules\/|\/modules\/|moduleHandlers|ModulesSection|useModule/ },
  { name: 'transport', match: /^src\/main\/xnat\/|^src\/renderer\/lib\/(xnat|backup)\/|components\/connection\/|ipc\/(auth|proxy|upload|export|backup|checkpoint)Handlers|lib\/cornerstone\/(xnat\w*|transport\w*|annotationTransport|srExport|srImport|rtStructService|dicomExportHelpers|writeDicomDict)\.ts|transportStore/ },
];
/** Changes the specs all lean on: run the offline suite. */
const HARNESS = /^e2e\/(helpers|fixtures|pages)\/|^playwright\.config\.ts$|^src\/renderer\/lib\/e2e\//;
/** Worth the 30-minute sweep: the operations and tools it sweeps. */
const SWEEP = /lib\/segmentation\/(maskOps|solvers|semiauto|interpolation|contours)\/|lib\/compute\/|lib\/cornerstone\/(tools\/|maskOps\w*|unifiedToolService|unifiedSegService|solverService|semiAuto\w*|labelmapTransaction|growCutGpu|undoService)|hooks\/(use\w*Sheet|useOperationsSection|operationLifecycle)\.ts|components\/annotations\/(ContextToolbox|toolCatalog|Operation\w*)\.tsx/;
/** Worth the live CNDA run (needs a fresh token): signing in and reading XNAT. */
const LIVE = /^src\/main\/xnat\/|ipc\/authHandlers|extensionXnat|lib\/app\/appNavigation/;
/** Where an uncovered renderer file's specs probably are. */
const RELATED = [
  [/components\/annotations\/|lib\/annotations\/|lib\/segmentation\/|hooks\/use(Annotations|\w*Sheet|Operations)|segmentation\w*Store|annotation\w*Store/, ['annotations', 'tools']],
  [/components\/viewer\/|hooks\/use(Viewport|Slice|Crosshair|HoverProbe|TimeScrubber|ToolbarCollapse)|viewerStore|viewport\w*\.ts/, ['viewport']],
  [/lib\/cornerstone\/|lib\/hotkeys\/|hooks\/useHotkeys/, ['tools', 'annotations', 'viewport']],
  [/^src\/renderer\/(App|main)\.tsx|^src\/main\/index\.ts|^src\/preload\//, ['viewport', 'transport']],
];

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
/** maskPreviewStore.ts / useMaskPreview.ts → 'mask-preview'. */
const stem = (f) => kebab(path.basename(f).replace(/\.(test\.)?(tsx?|mjs|js)$/, ''))
  .replace(/^use-/, '').replace(/-(service|store|sheet|section|dialog|panel|tool)$/, '');
/** Names too general to pick specs by: they would match half a folder, or the wrong one. */
const GENERIC = new Set(['annotations', 'segmentation', 'viewport', 'viewer', 'toolbox', 'catalog', 'tools', 'index', 'icons', 'types', 'utils', 'helpers', 'constants', 'init', 'main', 'app']);

const picked = new Set();
const why = new Map();
const add = (spec, reason) => { if (!picked.has(spec)) { picked.add(spec); why.set(spec, reason); } };
const uncovered = [];
let harness = false;

for (const f of changed) {
  if (f.endsWith('.e2e.ts')) { add(f, 'changed'); continue; }
  if (HARNESS.test(f)) { harness = true; continue; }
  let covered = false;
  for (const area of AREAS) {
    if (area.match.test(f)) { folder(area.name).forEach((s) => add(s, `area ${area.name} (${f})`)); covered = true; }
  }
  const s = stem(f);
  if (s.length >= 5 && !GENERIC.has(s)) {
    for (const spec of allSpecs) {
      const name = path.basename(spec, '.e2e.ts');
      if (name === s || name.startsWith(`${s}-`) || name.endsWith(`-${s}`) || name.includes(`-${s}-`)) { add(spec, `name (${f})`); covered = true; }
    }
  }
  if (!covered && /^src\/(renderer|main|preload)\//.test(f) && !/\.test\.tsx?$|__tests__/.test(f)) uncovered.push(f);
}
for (const a of values('--area')) folder(a).forEach((s) => add(s, `--area ${a}`));

const isSweep = (s) => s.startsWith(path.join(SPECS, 'sweep') + path.sep);
const isLive = (s) => s.startsWith(path.join(SPECS, 'auth') + path.sep);

// ── The plan ────────────────────────────────────────────────────────────────────────────────
const srcChanged = changed.filter((f) => /^(src|packages)\//.test(f) && /\.(tsx?|mjs|js)$/.test(f));
console.log(`[test:changed] base ${base}: ${changed.length} changed file(s)`);
if (harness) console.log('  E2E harness changed (helpers / fixtures / pages / config) → the offline suite');
else if (picked.size === 0) console.log('  no E2E specs selected');
else for (const s of picked) console.log(`  E2E ${path.relative(SPECS, s)}  ← ${why.get(s)}`);
if (uncovered.length) {
  console.log('  No spec matched these by name or area:');
  for (const f of uncovered) {
    const areas = [...new Set(RELATED.filter(([re]) => re.test(f)).flatMap(([, a]) => a))];
    console.log(`    ${f}${areas.length ? `  (specs likely in: ${areas.join(', ')} — add with --area)` : ''}`);
  }
}
if (changed.some((f) => SWEEP.test(f))) console.log('  Operations or tools changed: the sweep may be worth a run (npm run test:e2e:sweep, ~30 min).');
if (changed.some((f) => LIVE.test(f))) console.log('  XNAT sign-in or access changed: the live specs may be worth a run (npm run test:e2e:live; needs a fresh token).');
if (changed.some((f) => /^electron-builder\.config\.js$|scripts\/(build|test)-edition/.test(f))) console.log('  Packaging changed: npm run test:edition checks the packaged app.');
if (flag('--dry-run')) process.exit(0);

// ── Run ─────────────────────────────────────────────────────────────────────────────────────
const steps = [
  ['lint', 'npm', ['run', 'lint']],
  ['typecheck', 'npm', ['run', 'typecheck']],
];
if (srcChanged.length) steps.push(['unit tests (related)', 'npx', ['vitest', 'related', '--run', '--passWithNoTests', ...srcChanged]]);
const e2e = harness ? ['--project=smoke', '--project=app'] : picked.size ? [
  '--project=smoke', '--project=app',
  ...([...picked].some(isSweep) ? ['--project=sweep'] : []),
  ...([...picked].some(isLive) ? ['--project=auth'] : []),
  ...picked,
] : null;
if (e2e) {
  if (!flag('--no-build')) steps.push(['build', 'npm', ['run', 'build']]);
  steps.push(['E2E', 'npx', ['playwright', 'test', '--config', 'playwright.config.ts', '--reporter=list', ...e2e]]);
}

for (const [label, cmd, cmdArgs] of steps) {
  console.log(`\n[test:changed] ── ${label}`);
  const started = Date.now();
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit' });
  const secs = Math.round((Date.now() - started) / 1000);
  if (r.status !== 0) {
    console.error(`\n[test:changed] ✘ ${label} failed (exit ${r.status}, ${secs}s)`);
    process.exit(r.status ?? 1);
  }
  console.log(`[test:changed] ✓ ${label} (${secs}s)`);
}
console.log('\n[test:changed] all steps passed');
