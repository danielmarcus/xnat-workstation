/**
 * The extension manifest (extension framework X1 — docs/extension-framework.md): what an
 * extension's `extension.json` declares about itself. Shared by the main process (loading), the
 * edition build (refusing a bad extension before it ships) and the SDK. Pure.
 */

/**
 * The extension API this host implements, major.minor. Before 1.0 every minor may break
 * extensions; from 1.0 a minor only adds (design point 3, R12).
 */
export const EXTENSION_API_VERSION = '0.2';

export interface ExtensionManifest {
  /** Reverse-DNS, lower case: `org.example.session-notes`. */
  id: string;
  name: string;
  /** Semantic version of the extension. */
  version: string;
  /** The API major.minor it was built against. */
  apiVersion: string;
  publisher: string;
  description?: string;
  /** The renderer part: an ES module, a path inside the extension. */
  renderer: string;
  /** The optional main part: a CommonJS module, a path inside the extension. */
  main?: string;
}

const FIELDS = new Set(['id', 'name', 'version', 'apiVersion', 'publisher', 'description', 'renderer', 'main']);
const ID = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const API = /^\d+\.\d+$/;

/** A relative path that stays inside the extension: no `..`, no absolute path, no backslash. */
function entryPath(v: unknown): boolean {
  return typeof v === 'string' && /\.(c|m)?js$/.test(v) && !v.startsWith('/') && !v.includes('\\')
    && !/^[A-Za-z]:/.test(v) && v.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export function validateExtensionManifest(raw: unknown): { ok: true; manifest: ExtensionManifest } | { ok: false; errors: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['the manifest must be a JSON object'] };
  const m = raw as Record<string, unknown>;
  const errors: string[] = [];
  const text = (k: string) => typeof m[k] === 'string' && (m[k] as string).trim() !== '';
  if (!text('id') || !ID.test(m.id as string)) errors.push('id: required, reverse-DNS in lower case (org.example.name)');
  if (!text('name')) errors.push('name: required');
  if (!text('version') || !SEMVER.test(m.version as string)) errors.push('version: required, semantic (1.2.0)');
  if (!text('apiVersion') || !API.test(m.apiVersion as string)) errors.push('apiVersion: required, major.minor (0.1)');
  if (!text('publisher')) errors.push('publisher: required');
  if (m.description !== undefined && typeof m.description !== 'string') errors.push('description: text, when present');
  if (!entryPath(m.renderer)) errors.push('renderer: required, a .js path inside the extension');
  if (m.main !== undefined && !entryPath(m.main)) errors.push('main: a .js path inside the extension, when present');
  for (const k of Object.keys(m)) if (!FIELDS.has(k)) errors.push(`unknown field "${k}"`);
  return errors.length ? { ok: false, errors } : { ok: true, manifest: m as unknown as ExtensionManifest };
}

/**
 * Whether an extension built against `built` runs on a host implementing `host` (both
 * major.minor). From 1.0: the same major, and a host minor at least the one built for. Before
 * 1.0: the same minor.
 */
export function apiCompatible(built: string, host: string): boolean {
  const [bMaj, bMin] = built.split('.').map(Number);
  const [hMaj, hMin] = host.split('.').map(Number);
  if (![bMaj, bMin, hMaj, hMin].every(Number.isInteger) || bMaj !== hMaj) return false;
  return bMaj === 0 ? bMin === hMin : hMin >= bMin;
}

/** The reason an extension built against `built` is refused by this host, for Settings. */
export function incompatibleReason(built: string, host = EXTENSION_API_VERSION): string {
  return `Needs extension API ${built}; this app provides ${host}. Update the app or the extension.`;
}
