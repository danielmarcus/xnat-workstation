/**
 * Which E2E specs a renderer source file reaches — by content, not by name (plan item C1).
 *
 * E2E specs never import app code, so a spec "covers" a source file in one of two ways:
 *
 *   - UI: the spec finds an element the file renders — by a `data-testid` it sets or an
 *     `aria-label` / toolbar `label` it gives — or quotes a message the file defines (a toast,
 *     dialog or tooltip sentence).
 *   - Hooks: the spec calls a `window.__XNAT_E2E__` hook (src/renderer/lib/e2e/
 *     installRendererE2eHooks.ts) whose code — directly or through the hooks file's own
 *     helpers — uses something the hooks file imports from that source file.
 *
 * A file that neither renders nor is imported by the hooks file is followed up its importers
 * (up to MAX_DEPTH), so a store reaches the specs of the components and hooks that read it.
 * Each match is scored by distance (nearer is stronger) and specificity (a link few specs
 * share is stronger); test-changed runs the strongest few per file.
 */
import * as fs from 'fs';
import * as path from 'path';

const HOOKS_FILE = 'src/renderer/lib/e2e/installRendererE2eHooks.ts';
/** Importers not followed: they import nearly everything, so they would select every spec. */
const STOP = /^src\/renderer\/(App|main)\.tsx$|^src\/renderer\/pages\/ViewerPage\.tsx$|^src\/renderer\/lib\/e2e\//;
const MAX_DEPTH = 2;
/** UI tokens too generic to say a spec is about this file. */
const MIN_TOKEN = 6;
const GENERIC_TOKENS = new Set(['Close', 'toolbar', 'dialog', 'Cancel', 'Delete', 'Rename', 'Settings']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** `import … from '…'` statements (multi-line too): [{ names, source }]. */
function parseImports(text) {
  const out = [];
  const re = /import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  for (let m; (m = re.exec(text));) {
    const clause = m[2];
    const names = [];
    const braces = clause.match(/\{([\s\S]*)\}/);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const t = part.trim().replace(/^type\s+/, '');
        if (!t) continue;
        const as = t.split(/\s+as\s+/);
        names.push((as[1] ?? as[0]).trim());
      }
    }
    const def = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, ' ').trim();
    if (def) for (const d of def.split(/\s+/)) if (d && d !== '*' && d !== 'as') names.push(d);
    out.push({ names, source: m[3] });
  }
  return out;
}

function resolveImport(root, from, source) {
  let base;
  if (source.startsWith('.')) base = path.join(path.dirname(from), source);
  else if (source.startsWith('@renderer/')) base = path.join('src/renderer', source.slice(10));
  else if (source.startsWith('@shared/')) base = path.join('src/shared', source.slice(8));
  else if (source.startsWith('@/')) base = path.join('src', source.slice(2));
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(path.join(root, c)) && fs.statSync(path.join(root, c)).isFile()) return c.split(path.sep).join('/');
  }
  return null;
}

/** data-testid values (a template's static prefix) and accessible names the file renders. */
function uiTokens(text) {
  const tokens = new Set();
  for (const m of text.matchAll(/data-testid=(?:"([^"]+)"|\{`([^`$]+)(?:\$\{|`))/g)) tokens.add(m[1] ?? m[2]);
  for (const m of text.matchAll(/\b(?:aria-label|label|triggerTitle)="([^"]+)"/g)) tokens.add(m[1]);
  return [...tokens].filter((t) => t.length >= MIN_TOKEN && !GENERIC_TOKENS.has(t));
}

/**
 * User-facing sentences the file defines — toast, dialog and tooltip text — long enough that a
 * spec quoting one is checking this file's message (e.g. the "need WebGPU" refusal).
 */
function messageTokens(text) {
  const out = new Set();
  for (const m of text.matchAll(/'([^'\\\n]{24,})'|"([^"\\\n]{24,})"|`([^`$\\\n]{24,})(?:`|\$\{)/g)) {
    const s = m[1] ?? m[2] ?? m[3];
    if (/[A-Za-z]{3,} [a-z]{2,} [a-z]{2,}/.test(s) && !/[{};=<>]|\bimport\b|https?:/.test(s)) out.add(s);
  }
  return [...out];
}

/**
 * The hooks file: for each hook, the identifiers its code uses — including through the
 * file's own top-level helpers, transitively.
 */
function hookIdentifiers(text) {
  const start = text.indexOf('window.__XNAT_E2E__ = {');
  if (start < 0) return new Map();
  const ids = (s) => new Set(s.match(/\b[A-Za-z_$][\w$]*\b/g) ?? []);

  // Top-level declarations before the hooks object: name → body text.
  const decls = new Map();
  const head = text.slice(0, start);
  const declRe = /^(?:export\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=)/gm;
  const marks = [...head.matchAll(declRe)].map((m) => ({ name: m[1] ?? m[2], at: m.index }));
  marks.forEach((m, i) => decls.set(m.name, head.slice(m.at, marks[i + 1]?.at ?? head.length)));
  const closure = (seed) => {
    const seen = new Set(seed);
    const queue = [...seed].filter((n) => decls.has(n));
    while (queue.length) {
      for (const id of ids(decls.get(queue.pop()))) {
        if (!seen.has(id)) { seen.add(id); if (decls.has(id)) queue.push(id); }
      }
    }
    return seen;
  };

  // Hooks: keys of the object literal, four spaces in.
  const body = text.slice(start);
  const keys = [...body.matchAll(/^ {4}([A-Za-z_$][\w$]*)\s*(?::|\(|,\s*$)/gm)];
  const hooks = new Map();
  keys.forEach((k, i) => hooks.set(k[1], closure(ids(body.slice(k.index, keys[i + 1]?.index ?? body.length)))));
  return hooks;
}

/** Build once per run: the graph and the indexes the lookups need. */
export function buildSpecMap(root) {
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const sources = walk(path.join(root, 'src', 'renderer'))
    .map(rel)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|__tests__|\.d\.ts$/.test(f));
  const text = new Map(sources.map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));

  const importers = new Map(); // file → files that import it
  for (const f of sources) {
    for (const { source } of parseImports(text.get(f))) {
      const target = resolveImport(root, f, source);
      if (!target) continue;
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(f);
    }
  }

  // What the hooks file imports from each module, and which hooks use it.
  const hooksText = text.get(HOOKS_FILE) ?? '';
  const hookIds = hookIdentifiers(hooksText);
  const hooksByModule = new Map();
  for (const { names, source } of parseImports(hooksText)) {
    const target = resolveImport(root, HOOKS_FILE, source);
    if (!target) continue;
    const using = [...hookIds].filter(([, used]) => names.some((n) => used.has(n))).map(([h]) => h);
    if (using.length) hooksByModule.set(target, [...new Set([...(hooksByModule.get(target) ?? []), ...using])]);
  }

  const specs = walk(path.join(root, 'e2e', 'specs')).map(rel).filter((f) => f.endsWith('.e2e.ts'));
  const specText = new Map(specs.map((s) => [s, fs.readFileSync(path.join(root, s), 'utf8')]));
  return { root, text, importers, hooksByModule, specs, specText };
}

/**
 * The specs one file reaches directly, each weighted by how specific the link is: a token or
 * hook used by few specs says more than one every spec uses (the side panel's test id, say).
 * @returns {Map<string, { weight: number, why: string }>}
 */
function specsForNode(map, file) {
  const links = []; // [label, specs[]]
  const t = map.text.get(file);
  if (t && file.endsWith('.tsx')) {
    for (const token of uiTokens(t)) {
      const specs = [...map.specText].filter(([, st]) => st.includes(token)).map(([s]) => s);
      if (specs.length) links.push([`renders "${token}"`, specs]);
    }
  }
  if (t) {
    for (const msg of messageTokens(t)) {
      const specs = [...map.specText].filter(([, st]) => st.includes(msg)).map(([s]) => s);
      if (specs.length) links.push([`message "${msg.slice(0, 40)}…"`, specs]);
    }
  }
  for (const hook of map.hooksByModule.get(file) ?? []) {
    const re = new RegExp(`\\b${hook}\\b`);
    const specs = [...map.specText].filter(([, st]) => st.includes('__XNAT_E2E__') && re.test(st)).map(([s]) => s);
    if (specs.length) links.push([`hook ${hook}()`, specs]);
  }
  const hits = new Map();
  for (const [why, specs] of links) {
    const w = 1 / specs.length;
    for (const spec of specs) {
      const prev = hits.get(spec);
      hits.set(spec, { weight: (prev?.weight ?? 0) + w, why: prev && prev.weight >= w ? prev.why : why });
    }
  }
  return hits;
}

/**
 * Specs related to one changed renderer file, strongest first.
 * @returns {Map<string, { score: number, why: string }>}
 */
export function relatedSpecs(map, file) {
  const out = new Map();
  let frontier = [file];
  const seen = new Set(frontier);
  for (let depth = 0; depth <= MAX_DEPTH && frontier.length; depth++) {
    const score = MAX_DEPTH + 1 - depth;
    for (const node of frontier) {
      for (const [spec, why] of specsForNode(map, node)) {
        const prev = out.get(spec);
        const value = score * why.weight;
        if (!prev || prev.score < value) out.set(spec, { score: value, why: node === file ? why.why : `${why.why} via ${path.basename(node)}` });
      }
    }
    if (out.size) break; // the nearest layer that reaches any spec decides
    const next = [];
    for (const node of frontier) {
      for (const imp of map.importers.get(node) ?? []) {
        if (!seen.has(imp) && !STOP.test(imp)) { seen.add(imp); next.push(imp); }
      }
    }
    frontier = next;
  }
  return new Map([...out].sort((a, b) => b[1].score - a[1].score));
}
