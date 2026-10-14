/**
 * The module manifest (SegWorks parity branch 9, M1 — docs/segworks-parity.md §12): what a
 * module package declares about itself. Shared by the main process (install, verification) and
 * the renderer (the operation it becomes). Pure.
 */

/** The API this host implements. A module declares the major it was built for. */
export const MODULE_API_MAJOR = 1;
export const MODULE_API_VERSION = '1.0';

/** Runtimes this host can run. Others are refused, by name (§12 design point 1). */
export const SUPPORTED_RUNTIMES = ['wasm-worker'] as const;
export type ModuleRuntime = (typeof SUPPORTED_RUNTIMES)[number];

export type ModuleParamSpec =
  | { key: string; label: string; kind: 'number'; min: number; max: number; step: number; default: number; unit?: string; advanced?: boolean; hint?: string }
  | { key: string; label: string; kind: 'select'; options: Array<{ value: string; label: string }>; default: string; advanced?: boolean; hint?: string }
  | { key: string; label: string; kind: 'boolean'; default: boolean; advanced?: boolean; hint?: string };

export type ModuleScope = 'slice' | 'range' | 'volume' | 'roi';

export interface ModuleManifest {
  /** Reverse-DNS, lower case: `edu.wustl.postop-edema`. */
  id: string;
  name: string;
  /** Semantic version of the module. */
  version: string;
  /** The API major.minor it was built for, e.g. "1.0". */
  apiVersion: string;
  runtime: string;
  publisher: string;
  license: string;
  description: string;
  /** The ES-module script to run, a path inside the package. */
  entry: string;
  params: ModuleParamSpec[];
  /** What the module reads. Nothing undeclared is posted to it. */
  reads: {
    image: boolean;
    /** Member masks: none, the active member, or every member of the container. */
    members: 'none' | 'active' | 'all';
    seeds?: boolean;
    roi?: boolean;
  };
  /** What it writes: the active member, or one new member it creates. */
  writes: {
    target: 'active' | 'new';
    /** add: the mask joins the member; replace: within the scope the member becomes the mask. */
    mode: 'add' | 'replace';
    /** May take pixels of other (unlocked) members it touches. */
    claims?: boolean;
    /** For target "new": the member it creates. */
    newMember?: { name: string; color: [number, number, number] };
  };
  scopes: ModuleScope[];
  /** Built-in Cleanup operations offered after a run (#278–279). */
  postSteps?: Array<{ op: string; params?: Record<string, number | string> }>;
  /** Peak bytes per voxel of the box, for the memory guard. */
  bytesPerVoxel?: number;
}

export type ManifestCheck = { ok: true; manifest: ModuleManifest } | { ok: false; errors: string[] };

const ID = /^[a-z0-9]+(\.[a-z0-9][a-z0-9-]*)+$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const API = /^(\d+)\.(\d+)$/;
const SAFE_PATH = /^(?!\/)(?!.*\.\.)(?!.*\\)[A-Za-z0-9._/-]+$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 500): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function checkParam(p: unknown, i: number, errors: string[]): void {
  const at = `params[${i}]`;
  if (!isObj(p)) { errors.push(`${at}: not an object`); return; }
  if (!isStr(p.key, 64) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.key)) errors.push(`${at}.key: an identifier is required`);
  if (!isStr(p.label, 80)) errors.push(`${at}.label: required`);
  if (p.kind === 'number') {
    if (!isNum(p.min) || !isNum(p.max) || !isNum(p.step) || !isNum(p.default)) errors.push(`${at}: number parameters need min, max, step and default`);
    else if (p.min > p.max || p.default < p.min || p.default > p.max || p.step <= 0) errors.push(`${at}: needs min ≤ default ≤ max and step > 0`);
    // A slider snaps to min + k·step: a default off that grid would show (and run with) another value.
    else if (Math.abs((p.default - p.min) / p.step - Math.round((p.default - p.min) / p.step)) > 1e-6) errors.push(`${at}.default: must be min plus a whole number of steps`);
  } else if (p.kind === 'select') {
    if (!Array.isArray(p.options) || !p.options.length || !p.options.every((o) => isObj(o) && isStr(o.value, 64) && isStr(o.label, 80))) errors.push(`${at}.options: a list of { value, label } is required`);
    else if (!p.options.some((o) => (o as { value: string }).value === p.default)) errors.push(`${at}.default: must be one of the options`);
  } else if (p.kind === 'boolean') {
    if (typeof p.default !== 'boolean') errors.push(`${at}.default: true or false`);
  } else {
    errors.push(`${at}.kind: number, select or boolean`);
  }
}

/** Validate a parsed manifest.json; every problem is reported, not just the first. */
export function validateManifest(json: unknown): ManifestCheck {
  const errors: string[] = [];
  if (!isObj(json)) return { ok: false, errors: ['manifest.json: not a JSON object'] };
  const m = json;
  if (!isStr(m.id, 128) || !ID.test(m.id)) errors.push('id: reverse-DNS in lower case is required (e.g. org.example.my-module)');
  if (!isStr(m.name, 80)) errors.push('name: required (at most 80 characters)');
  if (!isStr(m.version, 64) || !SEMVER.test(m.version)) errors.push('version: a semantic version is required (e.g. 1.2.0)');
  if (!isStr(m.apiVersion, 16) || !API.test(m.apiVersion)) errors.push('apiVersion: major.minor is required (e.g. 1.0)');
  if (!isStr(m.runtime, 64)) errors.push('runtime: required');
  for (const k of ['publisher', 'license', 'description'] as const) if (!isStr(m[k], k === 'description' ? 2000 : 200)) errors.push(`${k}: required`);
  if (!isStr(m.entry, 200) || !SAFE_PATH.test(m.entry) || !/\.m?js$/.test(m.entry)) errors.push('entry: a .js or .mjs path inside the package is required');
  if (!Array.isArray(m.params)) errors.push('params: a list is required (it may be empty)');
  else {
    m.params.forEach((p, i) => checkParam(p, i, errors));
    const keys = m.params.map((p) => (isObj(p) ? p.key : undefined));
    if (new Set(keys).size !== keys.length) errors.push('params: keys must be unique');
  }
  if (!isObj(m.reads) || typeof m.reads.image !== 'boolean' || !['none', 'active', 'all'].includes(m.reads.members as string)) {
    errors.push('reads: { image: boolean, members: "none" | "active" | "all" } is required');
  }
  if (!isObj(m.writes) || !['active', 'new'].includes(m.writes.target as string) || !['add', 'replace'].includes(m.writes.mode as string)) {
    errors.push('writes: { target: "active" | "new", mode: "add" | "replace" } is required');
  } else if (m.writes.target === 'new') {
    const nm = m.writes.newMember;
    if (!isObj(nm) || !isStr(nm.name, 64) || !Array.isArray(nm.color) || nm.color.length !== 3 || !nm.color.every((c) => isNum(c) && c >= 0 && c <= 255)) {
      errors.push('writes.newMember: { name, color: [r, g, b] } is required when target is "new"');
    }
  }
  if (!Array.isArray(m.scopes) || !m.scopes.length || !m.scopes.every((s) => ['slice', 'range', 'volume', 'roi'].includes(s as string))) {
    errors.push('scopes: one or more of "slice", "range", "volume", "roi"');
  }
  if (m.postSteps !== undefined && (!Array.isArray(m.postSteps) || !m.postSteps.every((s) => isObj(s) && isStr(s.op, 64)))) errors.push('postSteps: a list of { op } is required when present');
  if (m.bytesPerVoxel !== undefined && (!isNum(m.bytesPerVoxel) || m.bytesPerVoxel <= 0 || m.bytesPerVoxel > 10_000)) errors.push('bytesPerVoxel: a positive number when present');
  return errors.length ? { ok: false, errors } : { ok: true, manifest: m as unknown as ModuleManifest };
}

export type Compatibility = { ok: true } | { ok: false; reason: string };

/** Can this host run the module? (API major and runtime — refused by name, never guessed.) */
export function checkCompatibility(m: Pick<ModuleManifest, 'apiVersion' | 'runtime'>): Compatibility {
  const major = Number(API.exec(m.apiVersion)?.[1]);
  if (major !== MODULE_API_MAJOR) return { ok: false, reason: `It was built for module API ${m.apiVersion}; this version of Workstation supports API ${MODULE_API_VERSION}` };
  if (!(SUPPORTED_RUNTIMES as readonly string[]).includes(m.runtime)) {
    return { ok: false, reason: `It needs the "${m.runtime}" runtime; this version of Workstation runs ${SUPPORTED_RUNTIMES.map((r) => `"${r}"`).join(', ')} modules` };
  }
  return { ok: true };
}
