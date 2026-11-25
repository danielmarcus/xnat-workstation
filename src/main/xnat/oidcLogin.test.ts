import { createHash } from 'crypto';
import http from 'http';
import { networkInterfaces } from 'os';
import { describe, expect, it, vi } from 'vitest';
import type { SignInConfig } from './oidcDiscovery';
import {
  authorizeInBrowser,
  buildAuthorizationUrl,
  createPkce,
  OidcLoginError,
  parseTokenResponse,
  readCallback,
  startLoopbackListener,
} from './oidcLogin';

const ISSUER = 'https://idp.example.org/realms/r';

const config: SignInConfig = {
  resource: 'https://xnat.example.org',
  issuer: ISSUER,
  clientId: 'xnat-workstation',
  scope: 'openid',
  apiUrl: 'https://xnat.example.org',
  webUrl: 'https://xnat.example.org',
  authorizationEndpoint: `${ISSUER}/auth`,
  tokenEndpoint: `${ISSUER}/token`,
  issRequired: true,
};

/** A GET with an explicit Host header (fetch cannot set one). */
function get(url: string, host?: string): Promise<{ status: number; body: string }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: u.hostname, port: u.port, path: `${u.pathname}${u.search}`, headers: host ? { Host: host } : {} },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('createPkce', () => {
  it('makes a 32-byte base64url verifier and its S256 challenge', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(createPkce().verifier).not.toBe(verifier);
  });
});

describe('buildAuthorizationUrl', () => {
  it('asks for a code with PKCE S256 and the loopback redirect', () => {
    const url = new URL(buildAuthorizationUrl(config, { redirectUri: 'http://127.0.0.1:5000/callback', state: 'S', challenge: 'C' }));
    expect(`${url.origin}${url.pathname}`).toBe(`${ISSUER}/auth`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'xnat-workstation',
      redirect_uri: 'http://127.0.0.1:5000/callback',
      scope: 'openid',
      state: 'S',
      code_challenge: 'C',
      code_challenge_method: 'S256',
    });
  });
});

describe('readCallback', () => {
  const expected = { state: 'S', issuer: ISSUER, issRequired: true };
  const params = (p: Record<string, string>) => new URLSearchParams(p);

  it('returns the code when state and iss match', () => {
    expect(readCallback(params({ state: 'S', iss: ISSUER, code: 'abc' }), expected)).toBe('abc');
  });

  it('accepts a missing iss only when the provider does not promise one', () => {
    expect(() => readCallback(params({ state: 'S', code: 'abc' }), expected)).toThrow('unexpected identity provider');
    expect(readCallback(params({ state: 'S', code: 'abc' }), { ...expected, issRequired: false })).toBe('abc');
  });

  it.each([
    ['a different state', { state: 'X', iss: ISSUER, code: 'abc' }, 'did not match'],
    ['no state', { iss: ISSUER, code: 'abc' }, 'did not match'],
    ['a different iss', { state: 'S', iss: 'https://idp.attacker.example', code: 'abc' }, 'unexpected identity provider'],
    ['an error', { state: 'S', iss: ISSUER, error: 'access_denied' }, 'declined'],
    ['no code', { state: 'S', iss: ISSUER }, 'no authorization code'],
  ])('rejects %s', (_label, p, message) => {
    expect(() => readCallback(params(p), expected)).toThrow(message);
  });
});

describe('startLoopbackListener', () => {
  const read = (p: URLSearchParams) => {
    if (p.get('state') !== 'S') throw new OidcLoginError('bad state');
    return p.get('code') ?? '';
  };

  it('listens on 127.0.0.1 at a random port and takes exactly one callback', async () => {
    const listener = await startLoopbackListener({ read, timeoutMs: 5000 });
    expect(listener.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(listener.redirectUri).not.toBe('http://127.0.0.1:0/callback');

    expect((await get(listener.redirectUri.replace('/callback', '/favicon.ico'))).status).toBe(404);
    const first = await get(`${listener.redirectUri}?state=S&code=abc`);
    expect(first.status).toBe(200);
    expect(first.body).toContain('You can close this tab');
    await expect(listener.code).resolves.toBe('abc');

    await expect(get(`${listener.redirectUri}?state=S&code=second`)).rejects.toThrow();
  });

  const externalIPv4 = Object.values(networkInterfaces()).flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

  it.skipIf(!externalIPv4)('is not reachable on any other address', async () => {
    const listener = await startLoopbackListener({ read, timeoutMs: 5000 });
    const port = new URL(listener.redirectUri).port;
    await expect(get(`http://${externalIPv4}:${port}/callback?state=S&code=abc`)).rejects.toThrow();
    listener.close();
    await listener.code.catch(() => undefined);
  });

  it('ignores a request with another Host header (DNS rebinding)', async () => {
    const listener = await startLoopbackListener({ read, timeoutMs: 5000 });
    expect((await get(`${listener.redirectUri}?state=S&code=abc`, 'attacker.example')).status).toBe(404);
    await get(`${listener.redirectUri}?state=S&code=abc`);
    await expect(listener.code).resolves.toBe('abc');
  });

  it('fails the sign-in and shows a failure page when the callback does not check out', async () => {
    const listener = await startLoopbackListener({ read, timeoutMs: 5000 });
    const caught = listener.code.catch((e) => e);
    const res = await get(`${listener.redirectUri}?state=X&code=abc`);
    expect(res.status).toBe(400);
    expect(res.body).toContain('Sign-in failed');
    expect(await caught).toBeInstanceOf(OidcLoginError);
  });

  it('times out', async () => {
    const listener = await startLoopbackListener({ read, timeoutMs: 20 });
    await expect(listener.code).rejects.toThrow('timed out');
    await expect(get(listener.redirectUri)).rejects.toThrow();
  });

  it('stops when cancelled', async () => {
    const abort = new AbortController();
    const listener = await startLoopbackListener({ read, timeoutMs: 5000, signal: abort.signal });
    abort.abort();
    const err = await listener.code.catch((e) => e);
    expect(err).toBeInstanceOf(OidcLoginError);
    expect(err.cancelled).toBe(true);
    await expect(get(listener.redirectUri)).rejects.toThrow();
  });
});

describe('parseTokenResponse', () => {
  it('reads the tokens and rejects a response without an access token', () => {
    expect(parseTokenResponse({ access_token: 'A', refresh_token: 'R', expires_in: 300, token_type: 'Bearer' }))
      .toEqual({ accessToken: 'A', refreshToken: 'R', expiresIn: 300 });
    expect(parseTokenResponse({ access_token: 'A' })).toEqual({ accessToken: 'A', refreshToken: undefined, expiresIn: 300 });
    expect(() => parseTokenResponse({ token_type: 'Bearer' })).toThrow('no access token');
    expect(() => parseTokenResponse({ access_token: 'A', token_type: 'DPoP' })).toThrow('unsupported token type');
  });
});

describe('authorizeInBrowser', () => {
  it('opens the browser, takes the callback and exchanges the code with the PKCE verifier', async () => {
    let challenge = '';
    const openExternal = vi.fn(async (url: string) => {
      const auth = new URL(url);
      challenge = auth.searchParams.get('code_challenge')!;
      const callback = new URL(auth.searchParams.get('redirect_uri')!);
      callback.searchParams.set('state', auth.searchParams.get('state')!);
      callback.searchParams.set('iss', ISSUER);
      callback.searchParams.set('code', 'the-code');
      void get(callback.toString());
    });
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ access_token: 'A', refresh_token: 'R', expires_in: 300, token_type: 'Bearer' }), { status: 200 }));

    const tokens = await authorizeInBrowser(config, { fetch, openExternal });

    expect(tokens).toEqual({ accessToken: 'A', refreshToken: 'R', expiresIn: 300 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${ISSUER}/token`);
    expect(init?.credentials).toBe('omit');
    const form = new URLSearchParams(String(init?.body));
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('the-code');
    expect(form.get('client_id')).toBe('xnat-workstation');
    expect(form.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(createHash('sha256').update(form.get('code_verifier')!).digest('base64url')).toBe(challenge);
  });

  it('fails when the provider refuses the code', async () => {
    const openExternal = async (url: string) => {
      const auth = new URL(url);
      void get(`${auth.searchParams.get('redirect_uri')}?state=${auth.searchParams.get('state')}&iss=${encodeURIComponent(ISSUER)}&code=c`);
    };
    const fetch = vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 }));
    await expect(authorizeInBrowser(config, { fetch, openExternal })).rejects.toThrow('refused the sign-in (400)');
  });
});
