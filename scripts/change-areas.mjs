#!/usr/bin/env node
/**
 * What a change touches — the one place the file patterns live, shared by CI
 * (.github/workflows/ci.yml, "Classify changes") and `npm run test:changed`.
 *
 *   node scripts/change-areas.mjs ci [--base <ref>]   # CI: classify, write $GITHUB_OUTPUT
 *
 * Pure functions are exported for scripts/test-changed.mjs and for the unit tests
 * (scripts/change-areas.test.mjs). Keep a pattern here, never a copy of it elsewhere.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ── CI tiers ────────────────────────────────────────────────────────────────────────────────
/** Dependencies, the test setup or the workflows themselves: run everything. */
export const FULL = /^(package(-lock)?\.json|vitest\.config\.ts|eslint\.config\.mjs)$|^src\/(renderer\/)?test\/|^\.github\/workflows\/|^scripts\/change-areas\.mjs$/;
/** Prose only: nothing to check. */
export const DOCS = /\.md$|^docs\/|^LICENSE$/;
/** What the bundlers and packaging read beyond the TypeScript the typecheck already covers. */
export const BUILD = /^(vite\.config\.ts|tsconfig[^/]*\.json|electron-builder\.config\.js|edition\.config\.json|postcss\.config\.cjs|tailwind\.config\.cjs)$|^scripts\/build-|^(modules|extensions|packages|build)\/|^src\/(main\/index\.ts|preload\/)|^src\/.*\.(css|html|png|svg|wasm)$/;
/** DICOM writing and parsing, and the compliance suites (npm run test:dicom:compliance). */
export const DICOM = /^src\/renderer\/lib\/cornerstone\/(dicomExportHelpers|dicomDatasetSource|writeDicomDict|dicomComplianceDebug|rtStructService|segmentationService|srExport|srImport)|^src\/renderer\/lib\/dicom\/|^src\/renderer\/lib\/annotations\/approval|^src\/renderer\/lib\/cornerstone\/__tests__\/(dicomExportHelpers|rtStructService|segmentationService\.loadExport|dicomExternalCompliance)\.test\.ts$/;

/**
 * The CI tier for a list of changed files.
 * @returns {{ mode: 'full'|'selective'|'skip', build: boolean, dicom: boolean, related: string[] }}
 */
export function classifyForCi(files) {
  if (files.some((f) => FULL.test(f))) return { mode: 'full', build: true, dicom: true, related: [] };
  const code = files.filter((f) => !DOCS.test(f));
  if (code.length === 0) return { mode: 'skip', build: false, dicom: false, related: [] };
  return {
    mode: 'selective',
    build: code.some((f) => BUILD.test(f)),
    dicom: code.some((f) => DICOM.test(f)),
    related: code.filter((f) => /^src\/.*\.tsx?$/.test(f)),
  };
}

// ── E2E areas (test:changed) ────────────────────────────────────────────────────────────────
/** Areas with clear borders: a change inside runs the whole spec folder. */
export const AREAS = [
  { name: 'extensions', match: /(^|\/)extensions?\/|extensionHandlers|ExtensionsSection|^packages\/extension-api\// },
  { name: 'modules', match: /^modules\/|\/modules\/|moduleHandlers|ModulesSection|useModule/ },
  { name: 'transport', match: /^src\/main\/xnat\/|^src\/renderer\/lib\/(xnat|backup)\/|components\/connection\/|ipc\/(auth|proxy|upload|export|backup|checkpoint)Handlers|lib\/cornerstone\/(xnat\w*|transport\w*|annotationTransport|srExport|srImport|rtStructService|dicomExportHelpers|writeDicomDict)\.ts|transportStore/ },
];
/** Changes the specs all lean on: run the offline suite. */
export const HARNESS = /^e2e\/(helpers|fixtures|pages)\/|^playwright\.config\.ts$|^src\/renderer\/lib\/e2e\//;
/** Worth the 30-minute sweep: the operations and tools it sweeps. */
export const SWEEP = /lib\/segmentation\/(maskOps|solvers|semiauto|interpolation|contours)\/|lib\/compute\/|lib\/cornerstone\/(tools\/|maskOps\w*|unifiedToolService|unifiedSegService|solverService|semiAuto\w*|labelmapTransaction|growCutGpu|undoService)|hooks\/(use\w*Sheet|useOperationsSection|operationLifecycle)\.ts|components\/annotations\/(ContextToolbox|toolCatalog|Operation\w*)\.tsx/;
/** Worth the live run against XNAT_URL in .env.e2e (needs current credentials): signing in and reading XNAT. */
export const LIVE = /^src\/main\/xnat\/|ipc\/authHandlers|extensionXnat|lib\/app\/appNavigation/;
/** Where an uncovered renderer file's specs probably are (a hint when nothing else matched). */
export const RELATED = [
  [/components\/annotations\/|lib\/annotations\/|lib\/segmentation\/|hooks\/use(Annotations|\w*Sheet|Operations)|segmentation\w*Store|annotation\w*Store/, ['annotations', 'tools']],
  [/components\/viewer\/|hooks\/use(Viewport|Slice|Crosshair|HoverProbe|TimeScrubber|ToolbarCollapse)|viewerStore|viewport\w*\.ts/, ['viewport']],
  [/lib\/cornerstone\/|lib\/hotkeys\/|hooks\/useHotkeys/, ['tools', 'annotations', 'viewport']],
  [/^src\/renderer\/(App|main)\.tsx|^src\/main\/index\.ts|^src\/preload\//, ['viewport', 'transport']],
];
/** Files whose changes count for test:changed at all. */
export const RELEVANT = /^(src|e2e|extensions|modules|packages|scripts)\/|^(playwright\.config\.ts|package\.json|electron-builder\.config\.js)$/;

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────
function changedFilesSince(root, base) {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root, encoding: 'utf8' });
  return out.split('\n').filter((f) => f && fs.existsSync(path.join(root, f)));
}

function ciMain(args) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const i = args.indexOf('--base');
  const event = process.env.EVENT ?? '';
  const ref = process.env.REF ?? '';
  const out = (k, v) => {
    const line = `${k}=${Array.isArray(v) ? v.join(' ') : v}\n`;
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, line);
    else process.stdout.write(line);
  };
  let plan;
  if (event === 'workflow_dispatch' || ref === 'refs/heads/main') {
    console.log(`Full run: ${event} on ${ref}`);
    plan = { mode: 'full', build: true, dicom: true, related: [] };
  } else {
    const base = i >= 0 ? args[i + 1] : execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim();
    const files = changedFilesSince(root, base);
    console.log(`Changed (${files.length}):\n${files.map((f) => `  ${f}`).join('\n')}`);
    plan = classifyForCi(files);
    console.log({ full: 'Full run: dependencies, test setup or workflows changed', skip: 'Docs only: no checks needed', selective: 'Selective run' }[plan.mode]);
  }
  out('mode', plan.mode);
  out('build', plan.build);
  out('dicom', plan.dicom);
  out('related', plan.related);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'ci') ciMain(rest);
  else {
    console.error('usage: node scripts/change-areas.mjs ci [--base <ref>]');
    process.exit(2);
  }
}
