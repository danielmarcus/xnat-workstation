/**
 * XNAT for extensions (extension framework X3, R4 — docs/extension-framework.md): requests as
 * the signed-in user through the app's own XnatClient, so the extension never sees credentials
 * or cookies and XNAT's project roles decide what succeeds. Paths are server-relative under
 * /data/ or /xapi/ — an extension cannot point the app's session at another host. The renderer
 * part reaches the same object over IPC (extensionHandlers).
 */
import type { ExtensionXnat, XnatRequestInit, XnatResourceFile, XnatResponse, XnatUser } from '../../shared/extensions/api';
import type { XnatConnectionInfo } from '../../shared/types/xnat';

/** What this needs of XnatClient. */
interface Client {
  rawRequest(endpoint: string, init?: RequestInit): Promise<Response>;
}

const ALLOWED = /^\/(data|xapi)\//;

function checkPath(path: string): void {
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { decoded = path; }
  const bad = typeof path !== 'string' || !ALLOWED.test(path) || path.startsWith('//') || path.includes('://')
    || decoded.split(/[/?#]/).some((seg) => seg === '..' || seg === '.');
  if (bad) throw new Error(`Not an XNAT path: ${String(path).slice(0, 120)} (use a server-relative path under /data/ or /xapi/)`);
}

function withQuery(path: string, query?: Record<string, string>): string {
  if (!query || Object.keys(query).length === 0) return path;
  const qs = new URLSearchParams(query).toString();
  return `${path}${path.includes('?') ? '&' : '?'}${qs}`;
}

export function createExtensionXnat(getClient: () => Client | null, getConnection: () => XnatConnectionInfo | null): ExtensionXnat {
  const client = (): Client => {
    const c = getClient();
    if (!c || !getConnection()) throw new Error('Not signed in to XNAT');
    return c;
  };

  async function request(path: string, init: XnatRequestInit = {}): Promise<XnatResponse> {
    checkPath(path);
    const c = client();
    const headers = new Headers();
    if (init.contentType) headers.set('Content-Type', init.contentType);
    const res = await c.rawRequest(withQuery(path, init.query), {
      method: init.method ?? 'GET',
      headers,
      ...(init.body !== undefined ? { body: init.body as BodyInit } : {}),
    });
    return { status: res.status, ok: res.ok, contentType: res.headers.get('content-type') ?? '', text: await res.text() };
  }

  async function getJson<T>(path: string, query?: Record<string, string>): Promise<T> {
    const r = await request(path, { query: { ...query, format: 'json' } });
    if (!r.ok) throw new Error(`XNAT ${r.status} for ${path}: ${r.text.slice(0, 200)}`);
    return (r.text.trim() ? JSON.parse(r.text) : null) as T;
  }

  return {
    async user(): Promise<XnatUser | null> {
      const info = getConnection();
      return info && getClient() ? { serverUrl: info.serverUrl, username: info.username } : null;
    },
    request,
    getJson,
    async permissions(projectId: string) {
      const project = encodeURIComponent(projectId);
      const read = (await request(`/data/projects/${project}`, { query: { format: 'json' } })).ok;
      if (!read) return { read: false, write: false };
      // XNAT lists the projects a user may edit (owners and members) with permissions=edit.
      const listing = await getJson<{ ResultSet?: { Result?: Array<{ ID?: string }> } }>('/data/projects', {
        permissions: 'edit', dataType: 'xnat:subjectData',
      });
      const write = (listing?.ResultSet?.Result ?? []).some((p) => p.ID === projectId);
      return { read, write };
    },
    async resourceFiles(resourcePath: string): Promise<XnatResourceFile[]> {
      const r = await getJson<{ ResultSet?: { Result?: Array<{ Name?: string; Size?: string | number; URI?: string }> } }>(`${resourcePath.replace(/\/+$/, '')}/files`);
      return (r?.ResultSet?.Result ?? []).map((f) => ({ name: String(f.Name ?? ''), size: Number(f.Size ?? 0), uri: String(f.URI ?? '') }));
    },
  };
}
