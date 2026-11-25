import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  discoverSignIn,
  parseOpenIdConfiguration,
  parseProtectedResource,
  protectedResourceMetadataUrl,
  sameRegistrableDomain,
} from './oidcDiscovery';

const ISSUER = 'https://idp.example.org/realms/r';

function resourceDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    resource: 'https://xnat.example.org',
    authorization_servers: [ISSUER],
    xnat_api_url: 'https://xnat-api.example.org',
    xnat_web_url: 'https://xnat.example.org',
    xnat_clients: {
      'xnat-workstation': { client_id: 'xnat-workstation', scope: 'openid' },
      default: { client_id: 'xnat-tools' },
    },
    ...overrides,
  };
}

const providerDoc = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
  token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
  revocation_endpoint: `${ISSUER}/protocol/openid-connect/revoke`,
  code_challenge_methods_supported: ['plain', 'S256'],
  authorization_response_iss_parameter_supported: true,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('protectedResourceMetadataUrl', () => {
  it('puts the well-known segment between the host and the path (RFC 9728 section 3.1)', () => {
    expect(protectedResourceMetadataUrl('https://xnat.example.org')).toBe(
      'https://xnat.example.org/.well-known/oauth-protected-resource',
    );
    expect(protectedResourceMetadataUrl('https://example.org/xnat')).toBe(
      'https://example.org/.well-known/oauth-protected-resource/xnat',
    );
  });
});

describe('sameRegistrableDomain', () => {
  it('compares registrable domains by the public suffix list, private suffixes included', () => {
    expect(sameRegistrableDomain('https://xnat.example.org', 'https://xnat-api.example.org')).toBe(true);
    expect(sameRegistrableDomain('https://xnat.example.co.uk', 'https://api.example.co.uk')).toBe(true);
    expect(sameRegistrableDomain('https://xnat.example.org', 'https://xnat.example.com')).toBe(false);
    expect(sameRegistrableDomain('https://a.example.co.uk', 'https://b.other.co.uk')).toBe(false);
    expect(sameRegistrableDomain('https://alice.github.io', 'https://mallory.github.io')).toBe(false);
    expect(sameRegistrableDomain('https://127.0.0.1:8080', 'https://127.0.0.1:9090')).toBe(true);
    expect(sameRegistrableDomain('https://10.0.0.1', 'https://10.0.0.2')).toBe(false);
  });
});

describe('parseProtectedResource', () => {
  it('reads the issuer, this app\'s client and the API and web URLs', () => {
    expect(parseProtectedResource(resourceDoc(), 'https://xnat.example.org')).toEqual({
      issuer: ISSUER,
      clientId: 'xnat-workstation',
      scope: 'openid',
      apiUrl: 'https://xnat-api.example.org',
      webUrl: 'https://xnat.example.org',
    });
  });

  it('falls back to the default client, and to the resource for the API and web URLs', () => {
    const doc = resourceDoc({ xnat_clients: { default: { client_id: 'xnat-tools' } } });
    delete doc.xnat_api_url;
    delete doc.xnat_web_url;
    expect(parseProtectedResource(doc, 'https://xnat.example.org')).toMatchObject({
      clientId: 'xnat-tools',
      scope: 'openid',
      apiUrl: 'https://xnat.example.org',
      webUrl: 'https://xnat.example.org',
    });
  });

  it.each([
    ['a resource for another server', { resource: 'https://other.example.org' }, 'resource does not match'],
    ['no authorization server', { authorization_servers: [] }, 'authorization_servers is empty'],
    ['a plain-http issuer', { authorization_servers: ['http://idp.example.org'] }, 'not https'],
    ['no client for this app', { xnat_clients: { xnatpy: { client_id: 'xnatpy' } } }, 'no xnat_clients entry'],
    ['an API URL on another domain', { xnat_api_url: 'https://xnat-api.attacker.example' }, 'outside the server\'s domain'],
    ['a web URL on another domain', { xnat_web_url: 'https://xnat.example.com' }, 'outside the server\'s domain'],
    ['a plain-http API URL', { xnat_api_url: 'http://xnat-api.example.org' }, 'not https'],
    ['an API URL with a query', { xnat_api_url: 'https://xnat-api.example.org/?x=1' }, 'query or fragment'],
  ])('rejects %s', (_label, overrides, message) => {
    expect(() => parseProtectedResource(resourceDoc(overrides), 'https://xnat.example.org')).toThrow(message);
  });

  it('rejects a plain-http server outside loopback', () => {
    expect(() => parseProtectedResource(resourceDoc({ resource: 'http://xnat.example.org' }), 'http://xnat.example.org'))
      .toThrow('server URL is not https');
  });
});

describe('parseOpenIdConfiguration', () => {
  it('reads the endpoints and whether the callback carries iss', () => {
    expect(parseOpenIdConfiguration(providerDoc, ISSUER)).toEqual({
      authorizationEndpoint: providerDoc.authorization_endpoint,
      tokenEndpoint: providerDoc.token_endpoint,
      revocationEndpoint: providerDoc.revocation_endpoint,
      issRequired: true,
    });
  });

  it('rejects a different issuer or a provider without PKCE S256', () => {
    expect(() => parseOpenIdConfiguration({ ...providerDoc, issuer: 'https://idp.example.org/realms/other' }, ISSUER))
      .toThrow('issuer does not match');
    expect(() => parseOpenIdConfiguration({ ...providerDoc, code_challenge_methods_supported: ['plain'] }, ISSUER))
      .toThrow('S256');
  });
});

describe('discoverSignIn', () => {
  function fetchWith(resourceResponse: Response | Error): ReturnType<typeof vi.fn> {
    return vi.fn(async (url: string) => {
      if (url === 'https://xnat.example.org/.well-known/oauth-protected-resource') {
        if (resourceResponse instanceof Error) throw resourceResponse;
        return resourceResponse;
      }
      if (url === `${ISSUER}/.well-known/openid-configuration`) return json(providerDoc);
      return new Response('', { status: 404 });
    });
  }

  it('returns the sign-in configuration, fetching without cookies or redirects', async () => {
    const fetch = fetchWith(json(resourceDoc()));
    const config = await discoverSignIn('https://xnat.example.org/', { fetch });

    expect(config).toMatchObject({
      resource: 'https://xnat.example.org',
      issuer: ISSUER,
      clientId: 'xnat-workstation',
      apiUrl: 'https://xnat-api.example.org',
      tokenEndpoint: providerDoc.token_endpoint,
      issRequired: true,
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://xnat.example.org/.well-known/oauth-protected-resource',
      expect.objectContaining({ redirect: 'manual', credentials: 'omit' }),
    );
  });

  it.each([
    ['a redirect to a sign-in page', new Response('', { status: 302, headers: { location: 'https://idp.example.org/' } })],
    ['no document', new Response('Not found', { status: 404 })],
    ['an HTML page', new Response('<html>login</html>', { status: 200 })],
    ['a network failure', new Error('ECONNREFUSED')],
    ['an invalid document', json(resourceDoc({ xnat_api_url: 'https://xnat-api.attacker.example' }))],
  ])('returns null (use the login window) for %s', async (_label, response) => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(discoverSignIn('https://xnat.example.org', { fetch: fetchWith(response) })).resolves.toBeNull();
  });

  it('returns null for a URL that does not parse', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(discoverSignIn('not a url', { fetch: vi.fn() })).resolves.toBeNull();
  });

  it('reads a development override file in place of the server document, still checked against the server URL', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'xw-discovery-')), 'doc.json');
    writeFileSync(file, JSON.stringify(resourceDoc()));
    const fetch = fetchWith(new Response('', { status: 404 }));

    await expect(discoverSignIn('https://xnat.example.org', { fetch, override: file })).resolves.toMatchObject({
      clientId: 'xnat-workstation',
    });
    expect(fetch).not.toHaveBeenCalledWith('https://xnat.example.org/.well-known/oauth-protected-resource', expect.anything());
    await expect(discoverSignIn('https://other.example.org', { fetch, override: file })).resolves.toBeNull();
  });
});
