/**
 * XNAT for extensions (extension framework X3, R4): requests as the signed-in user through the
 * app's client — server-relative /data/ and /xapi/ paths only — HTTP errors as responses, the
 * permission query, and resource listings.
 */
import { describe, expect, it, vi } from 'vitest';
import { createExtensionXnat } from '../extensionXnat';

function client(routes: Record<string, { status?: number; body?: string; type?: string }>) {
  const calls: Array<{ endpoint: string; init: RequestInit }> = [];
  return {
    calls,
    rawRequest: vi.fn(async (endpoint: string, init: RequestInit = {}) => {
      calls.push({ endpoint, init });
      const key = Object.keys(routes).find((k) => endpoint.startsWith(k));
      const r = key ? routes[key] : { status: 404, body: 'Not Found' };
      return new Response(r.body ?? '', { status: r.status ?? 200, headers: { 'content-type': r.type ?? 'application/json' } });
    }),
  };
}
const connection = { serverUrl: 'https://xnat.example.org', username: 'dmarcus', connectedAt: 0 };

describe('ext.xnat', () => {
  it('user() is the signed-in user, or null', async () => {
    expect(await createExtensionXnat(() => null, () => null).user()).toBeNull();
    expect(await createExtensionXnat(() => client({}) as never, () => connection).user()).toEqual({ serverUrl: 'https://xnat.example.org', username: 'dmarcus' });
  });

  it('request() goes through the app\'s client, encodes the query, and returns HTTP errors as responses', async () => {
    const c = client({ '/data/projects/P1?x=a+b': { body: '{"ok":1}' }, '/data/missing': { status: 404, body: 'nope', type: 'text/plain' } });
    const x = createExtensionXnat(() => c as never, () => connection);
    expect(await x.request('/data/projects/P1', { query: { x: 'a b' } })).toEqual({ status: 200, ok: true, contentType: 'application/json', text: '{"ok":1}' });
    expect(await x.request('/data/missing')).toMatchObject({ status: 404, ok: false, text: 'nope' });
    await x.request('/data/experiments/E1/resources/NOTES/files/a.json', { method: 'PUT', body: '{}', contentType: 'application/json' });
    const put = c.calls.at(-1)!;
    expect(put.endpoint).toBe('/data/experiments/E1/resources/NOTES/files/a.json');
    expect(put.init).toMatchObject({ method: 'PUT', body: '{}' });
    expect(new Headers(put.init.headers).get('content-type')).toBe('application/json');
  });

  it.each([
    ['an absolute URL', 'https://evil.example/data/x'],
    ['a path outside /data and /xapi', '/app/template/Login.vm'],
    ['a parent segment', '/data/../xapi/x'],
    ['a protocol-relative path', '//evil.example/data'],
    ['an encoded parent segment', '/data/%2e%2e/admin'],
  ])('refuses %s', async (_label, path) => {
    const c = client({});
    await expect(createExtensionXnat(() => c as never, () => connection).request(path)).rejects.toThrow(/path/i);
    expect(c.rawRequest).not.toHaveBeenCalled();
  });

  it('rejects when no one is signed in', async () => {
    await expect(createExtensionXnat(() => null, () => null).request('/data/projects')).rejects.toThrow('Not signed in to XNAT');
  });

  it('getJson() adds format=json and rejects on an HTTP error', async () => {
    const c = client({ '/data/projects?format=json': { body: '{"ResultSet":{"Result":[]}}' }, '/data/nope': { status: 403, body: 'denied' } });
    const x = createExtensionXnat(() => c as never, () => connection);
    expect(await x.getJson('/data/projects')).toEqual({ ResultSet: { Result: [] } });
    await expect(x.getJson('/data/nope')).rejects.toThrow(/403/);
  });

  it('permissions(): read when the project is visible, write when XNAT lists it as editable', async () => {
    const x = (editable: string[], readable: boolean) => createExtensionXnat(() => client({
      '/data/projects?': { body: JSON.stringify({ ResultSet: { Result: editable.map((ID) => ({ ID })) } }) },
      '/data/projects/P1?': readable ? { body: '{}' } : { status: 403, body: '' },
    }) as never, () => connection);
    expect(await x(['P1', 'P2'], true).permissions('P1')).toEqual({ read: true, write: true });
    expect(await x(['P2'], true).permissions('P1')).toEqual({ read: true, write: false });
    expect(await x([], false).permissions('P1')).toEqual({ read: false, write: false });
  });

  it('permissions() asks XNAT for the projects the user may edit', async () => {
    const c = client({ '/data/projects': { body: '{"ResultSet":{"Result":[]}}' } });
    await createExtensionXnat(() => c as never, () => connection).permissions('P1');
    const listing = c.calls.find((k) => k.endpoint.startsWith('/data/projects?'))!.endpoint;
    expect(new URLSearchParams(listing.split('?')[1]).get('permissions')).toBe('edit');
  });

  it('resourceFiles() lists a resource\'s files', async () => {
    const c = client({ '/data/experiments/E1/resources/NOTES/files?format=json': { body: JSON.stringify({ ResultSet: { Result: [{ Name: 'notes.json', Size: '42', URI: '/data/experiments/E1/resources/NOTES/files/notes.json' }] } }) } });
    expect(await createExtensionXnat(() => c as never, () => connection).resourceFiles('/data/experiments/E1/resources/NOTES')).toEqual([
      { name: 'notes.json', size: 42, uri: '/data/experiments/E1/resources/NOTES/files/notes.json' },
    ]);
  });
});
