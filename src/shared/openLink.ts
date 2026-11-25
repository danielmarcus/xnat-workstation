/**
 * Links that open an XNAT session in the app (docs/open-from-link.md):
 *
 *   xnat-workstation://open?server=<https base URL>&project=<project ID>&session=<experiment ID>[&scan=<scan ID>]
 *
 * Parsed and validated in the main process; the renderer receives only the fields below.
 */
export const OPEN_LINK_SCHEME = 'xnat-workstation';

export interface OpenLinkRequest {
  /** Normalized: scheme, host and path, no trailing slash. */
  server: string;
  project: string;
  session: string;
  scan?: string;
}

export type OpenLinkParseResult =
  | { ok: true; request: OpenLinkRequest }
  | { ok: false; reason: string };

const MAX_LINK_LENGTH = 2048;
// XNAT IDs and labels are letters, digits, '_', '-' and '.'; a leading '.' would let '.' or '..'
// walk the REST path.
const ID_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

/** The XNAT base URL a link may name: https, or http to this machine only. Null when not allowed. */
export function normalizeServerUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const secure = url.protocol === 'https:';
  const loopback = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (!secure && !loopback) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

/** Whether two server URLs name the same XNAT (case of the host, default port, trailing slash). */
export function sameServer(a: string, b: string): boolean {
  const left = normalizeServerUrl(a) ?? a.replace(/\/+$/, '');
  const right = normalizeServerUrl(b) ?? b.replace(/\/+$/, '');
  return left === right;
}

export function parseOpenLink(raw: string): OpenLinkParseResult {
  if (typeof raw !== 'string' || raw.length > MAX_LINK_LENGTH) return { ok: false, reason: 'not a link, or too long' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a URL' };
  }
  if (url.protocol !== `${OPEN_LINK_SCHEME}:`) return { ok: false, reason: 'wrong scheme' };
  if (url.hostname !== 'open' || (url.pathname !== '' && url.pathname !== '/')) {
    return { ok: false, reason: 'unknown action' };
  }

  const params = url.searchParams;
  const single = (name: string): string | null | undefined => {
    const values = params.getAll(name);
    if (values.length > 1) return undefined;
    return values[0] ?? null;
  };

  const serverParam = single('server');
  if (!serverParam) return { ok: false, reason: 'server is missing or repeated' };
  const server = normalizeServerUrl(serverParam);
  if (!server) return { ok: false, reason: 'server must be an https URL (http only for localhost)' };

  const request: OpenLinkRequest = { server, project: '', session: '' };
  for (const name of ['project', 'session'] as const) {
    const value = single(name);
    if (!value || !ID_PATTERN.test(value)) return { ok: false, reason: `${name} is missing, repeated or not a valid ID` };
    request[name] = value;
  }
  const scan = single('scan');
  if (scan === undefined || (scan !== null && !ID_PATTERN.test(scan))) return { ok: false, reason: 'scan is repeated or not a valid ID' };
  if (scan) request.scan = scan;

  return { ok: true, request };
}

/** The link among command-line arguments (Windows and Linux pass it as one). */
export function findOpenLinkArg(argv: readonly string[]): string | undefined {
  const prefix = `${OPEN_LINK_SCHEME}:`;
  return argv.find((arg) => typeof arg === 'string' && arg.toLowerCase().startsWith(prefix));
}
