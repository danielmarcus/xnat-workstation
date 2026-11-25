import { describe, expect, it } from 'vitest';
import { findOpenLinkArg, normalizeServerUrl, parseOpenLink, sameServer } from './openLink';

const link = (query: string) => `xnat-workstation://open?${query}`;
const server = encodeURIComponent('https://xnat.example.org');

describe('parseOpenLink', () => {
  it('reads server, project, session and scan', () => {
    expect(parseOpenLink(link(`server=${server}&project=PROJ_1&session=XNAT_E00012&scan=4`))).toEqual({
      ok: true,
      request: { server: 'https://xnat.example.org', project: 'PROJ_1', session: 'XNAT_E00012', scan: '4' },
    });
  });

  it('scan is optional; unknown parameters (subject among them) are ignored', () => {
    const parsed = parseOpenLink(link(`server=${server}&project=P1&session=E1&subject=S1&utm_source=web`));
    expect(parsed).toEqual({ ok: true, request: { server: 'https://xnat.example.org', project: 'P1', session: 'E1' } });
  });

  it('accepts a trailing slash after the action, and a server with a path', () => {
    const parsed = parseOpenLink(`xnat-workstation://open/?server=${encodeURIComponent('https://Host.example.org:443/xnat/')}&project=P1&session=E1`);
    expect(parsed.ok && parsed.request.server).toBe('https://host.example.org/xnat');
  });

  it.each([
    ['http to a remote host', 'http://xnat.example.org'],
    ['another scheme', 'file:///etc/passwd'],
    ['javascript', 'javascript:alert(1)'],
    ['credentials in the URL', 'https://user:pass@xnat.example.org'],
    ['a query', 'https://xnat.example.org/?next=/evil'],
    ['a fragment', 'https://xnat.example.org/#x'],
    ['not a URL', 'xnat.example.org'],
  ])('rejects a server with %s', (_case, value) => {
    expect(parseOpenLink(link(`server=${encodeURIComponent(value)}&project=P1&session=E1`)).ok).toBe(false);
  });

  it('allows http only to this machine', () => {
    for (const host of ['http://localhost:8080', 'http://127.0.0.1']) {
      expect(parseOpenLink(link(`server=${encodeURIComponent(host)}&project=P1&session=E1`)).ok).toBe(true);
    }
    expect(parseOpenLink(link(`server=${encodeURIComponent('http://localhost.evil.org')}&project=P1&session=E1`)).ok).toBe(false);
  });

  it.each([
    ['a missing project', `server=${server}&session=E1`],
    ['a missing session', `server=${server}&project=P1`],
    ['a missing server', 'project=P1&session=E1'],
    ['a repeated session', `server=${server}&project=P1&session=E1&session=E2`],
    ['a repeated server', `server=${server}&server=${encodeURIComponent('https://evil.example')}&project=P1&session=E1`],
    ['a path in an ID', `server=${server}&project=P1&session=${encodeURIComponent('../E1')}`],
    ['a dot-only ID', `server=${server}&project=P1&session=..`],
    ['a slash in a scan', `server=${server}&project=P1&session=E1&scan=${encodeURIComponent('4/resources')}`],
    ['spaces', `server=${server}&project=${encodeURIComponent('P 1')}&session=E1`],
    ['markup', `server=${server}&project=P1&session=${encodeURIComponent('<img>')}`],
    ['an overlong ID', `server=${server}&project=P1&session=${'E'.repeat(65)}`],
  ])('rejects %s', (_case, query) => {
    expect(parseOpenLink(link(query)).ok).toBe(false);
  });

  it('rejects other schemes, other actions and overlong links', () => {
    expect(parseOpenLink(`https://open?server=${server}&project=P1&session=E1`).ok).toBe(false);
    expect(parseOpenLink(`xnat-workstation://run?server=${server}&project=P1&session=E1`).ok).toBe(false);
    expect(parseOpenLink(`xnat-workstation://open/extra?server=${server}&project=P1&session=E1`).ok).toBe(false);
    expect(parseOpenLink(link(`server=${server}&project=P1&session=E1&pad=${'x'.repeat(2100)}`)).ok).toBe(false);
    expect(parseOpenLink('not a url').ok).toBe(false);
  });

  it('accepts IDs with dots, dashes and underscores', () => {
    const parsed = parseOpenLink(link(`server=${server}&project=My-Proj_2&session=Sess.01-a&scan=3.1`));
    expect(parsed.ok).toBe(true);
  });
});

describe('normalizeServerUrl / sameServer', () => {
  it('drops the trailing slash and the default port, and lowercases the host', () => {
    expect(normalizeServerUrl('https://XNAT.example.org:443/')).toBe('https://xnat.example.org');
    expect(sameServer('https://XNAT.example.org/', 'https://xnat.example.org')).toBe(true);
    expect(sameServer('https://xnat.example.org/a', 'https://xnat.example.org/b')).toBe(false);
  });

  it('compares a stored http URL (allowed by the login form) as text', () => {
    expect(sameServer('http://xnat.local/', 'http://xnat.local')).toBe(true);
    expect(sameServer('http://xnat.example.org', 'https://xnat.example.org')).toBe(false);
  });
});

describe('findOpenLinkArg', () => {
  it('finds the link among command-line arguments', () => {
    const url = link(`server=${server}&project=P1&session=E1`);
    expect(findOpenLinkArg(['/path/XNAT Workstation.exe', '--allow-file-access-from-files', url])).toBe(url);
    expect(findOpenLinkArg(['electron', '.'])).toBeUndefined();
  });
});
