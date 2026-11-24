/**
 * Discovery for browser sign-in (docs/authentication.md, "Browser sign-in").
 *
 * An XNAT server that supports it publishes an RFC 9728 protected-resource document naming its
 * identity provider, plus `xnat_clients`, `xnat_api_url` and `xnat_web_url`. Anything missing,
 * malformed or unreachable makes discovery return null, and the caller uses the login window.
 */
import { readFile } from 'fs/promises';
import { getDomain } from 'tldts';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface SignInConfig {
  /** The server URL the user typed, normalized: the RFC 9728 resource identifier. */
  resource: string;
  issuer: string;
  clientId: string;
  scope: string;
  /** Where bearer requests go. */
  apiUrl: string;
  /** Where links meant for a person's browser go. */
  webUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  /** RFC 9207: the server says it returns `iss` on the callback, so the callback must carry it. */
  issRequired: boolean;
}

export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoveryError';
  }
}

const CLIENT_NAME = 'xnat-workstation';
const DISCOVERY_TIMEOUT_MS = 5000;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** https, or http on a loopback host (a local test server). */
function isSecureUrl(url: URL): boolean {
  return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
}

function parseSecureUrl(value: unknown, field: string): URL {
  if (typeof value !== 'string' || !value) throw new DiscoveryError(`${field} is missing`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DiscoveryError(`${field} is not a URL`);
  }
  if (!isSecureUrl(url)) throw new DiscoveryError(`${field} is not https`);
  return url;
}

export function normalizeResource(serverUrl: string): string {
  const url = new URL(serverUrl.trim());
  return stripTrailingSlash(`${url.origin}${url.pathname}`);
}

/** RFC 9728 section 3.1: the well-known segment goes between the host and the path. */
export function protectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  return `${url.origin}/.well-known/oauth-protected-resource${stripTrailingSlash(url.pathname)}`;
}

/**
 * Same host, or the same registrable domain by the Public Suffix List (tldts, including its
 * private section, so two tenants of one hosting suffix never count as one site).
 */
export function sameRegistrableDomain(a: string, b: string): boolean {
  const hostA = new URL(a).hostname;
  const hostB = new URL(b).hostname;
  if (hostA === hostB) return true;
  const domainA = getDomain(hostA, { allowPrivateDomains: true });
  const domainB = getDomain(hostB, { allowPrivateDomains: true });
  return domainA !== null && domainA === domainB;
}

function siteUrl(value: unknown, field: string, resource: string): string {
  if (value === undefined || value === null) return resource;
  const url = parseSecureUrl(value, field);
  if (url.search || url.hash) throw new DiscoveryError(`${field} has a query or fragment`);
  const normalized = stripTrailingSlash(`${url.origin}${url.pathname}`);
  if (!sameRegistrableDomain(normalized, resource)) {
    throw new DiscoveryError(`${field} is outside the server's domain`);
  }
  return normalized;
}

export interface ProtectedResourceInfo {
  issuer: string;
  clientId: string;
  scope: string;
  apiUrl: string;
  webUrl: string;
}

export function parseProtectedResource(doc: unknown, resource: string): ProtectedResourceInfo {
  if (!doc || typeof doc !== 'object') throw new DiscoveryError('document is not a JSON object');
  const d = doc as Record<string, unknown>;

  if (typeof d.resource !== 'string' || stripTrailingSlash(d.resource) !== resource) {
    throw new DiscoveryError('resource does not match the server URL');
  }
  if (!isSecureUrl(new URL(resource))) throw new DiscoveryError('server URL is not https');

  const servers = d.authorization_servers;
  if (!Array.isArray(servers) || servers.length === 0) {
    throw new DiscoveryError('authorization_servers is empty');
  }
  parseSecureUrl(servers[0], 'authorization_servers[0]');
  const issuer = servers[0] as string;

  const clients = d.xnat_clients;
  const entry = clients && typeof clients === 'object'
    ? ((clients as Record<string, unknown>)[CLIENT_NAME] ?? (clients as Record<string, unknown>).default)
    : undefined;
  if (!entry || typeof entry !== 'object') throw new DiscoveryError('no xnat_clients entry for this app');
  const { client_id: clientId, scope } = entry as Record<string, unknown>;
  if (typeof clientId !== 'string' || !clientId) throw new DiscoveryError('client_id is missing');
  if (scope !== undefined && typeof scope !== 'string') throw new DiscoveryError('scope is not a string');

  return {
    issuer,
    clientId,
    scope: scope || 'openid',
    apiUrl: siteUrl(d.xnat_api_url, 'xnat_api_url', resource),
    webUrl: siteUrl(d.xnat_web_url, 'xnat_web_url', resource),
  };
}

export function parseOpenIdConfiguration(
  doc: unknown,
  issuer: string,
): Pick<SignInConfig, 'authorizationEndpoint' | 'tokenEndpoint' | 'revocationEndpoint' | 'issRequired'> {
  if (!doc || typeof doc !== 'object') throw new DiscoveryError('provider configuration is not a JSON object');
  const d = doc as Record<string, unknown>;
  if (d.issuer !== issuer) throw new DiscoveryError('provider issuer does not match');
  const methods = d.code_challenge_methods_supported;
  if (!Array.isArray(methods) || !methods.includes('S256')) {
    throw new DiscoveryError('provider does not support PKCE S256');
  }
  return {
    authorizationEndpoint: parseSecureUrl(d.authorization_endpoint, 'authorization_endpoint').href,
    tokenEndpoint: parseSecureUrl(d.token_endpoint, 'token_endpoint').href,
    revocationEndpoint: d.revocation_endpoint === undefined
      ? undefined
      : parseSecureUrl(d.revocation_endpoint, 'revocation_endpoint').href,
    issRequired: d.authorization_response_iss_parameter_supported === true,
  };
}

async function fetchJson(fetchFn: FetchLike, url: string): Promise<unknown> {
  const response = await fetchFn(url, {
    method: 'GET',
    redirect: 'manual',
    credentials: 'omit',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });
  if (response.status !== 200) throw new DiscoveryError(`${url} answered ${response.status}`);
  try {
    return JSON.parse(await response.text());
  } catch {
    throw new DiscoveryError(`${url} did not return JSON`);
  }
}

/** A development override: a local JSON file, or an http(s) URL, standing in for the server's document. */
async function loadOverride(fetchFn: FetchLike, override: string): Promise<unknown> {
  if (/^https?:\/\//i.test(override)) return fetchJson(fetchFn, override);
  try {
    return JSON.parse(await readFile(override, 'utf8'));
  } catch {
    throw new DiscoveryError('the discovery override file could not be read as JSON');
  }
}

/**
 * Find how to sign in to `serverUrl` in the browser. Null means "use the login window"; the reason
 * is logged, never shown.
 */
export async function discoverSignIn(
  serverUrl: string,
  deps: { fetch: FetchLike; override?: string },
): Promise<SignInConfig | null> {
  try {
    const resource = normalizeResource(serverUrl);
    const doc = deps.override
      ? await loadOverride(deps.fetch, deps.override)
      : await fetchJson(deps.fetch, protectedResourceMetadataUrl(resource));
    const info = parseProtectedResource(doc, resource);
    const providerUrl = `${stripTrailingSlash(info.issuer)}/.well-known/openid-configuration`;
    const provider = parseOpenIdConfiguration(await fetchJson(deps.fetch, providerUrl), info.issuer);
    return { resource, ...info, ...provider };
  } catch (err) {
    console.log(`[oidcDiscovery] Browser sign-in not available: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
