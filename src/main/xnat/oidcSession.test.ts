import { mkdtempSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EncryptedRefreshTokenStore, OidcSession, OidcSessionEndedError, type RefreshTokenStore } from './oidcSession';

const config = {
  tokenEndpoint: 'https://idp.example.org/token',
  revocationEndpoint: 'https://idp.example.org/revoke',
  clientId: 'xnat-workstation',
  storeKey: 'k',
};

function tokenResponse(n: number, status = 200): Response {
  return new Response(JSON.stringify({ access_token: `AT${n}`, refresh_token: `RT${n}`, expires_in: 300 }), { status });
}

function memoryStore(initial: Record<string, string> = {}): RefreshTokenStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    load: (k) => data[k] ?? null,
    save: (k, t) => { data[k] = t; },
    remove: (k) => { delete data[k]; },
  };
}

function form(init: RequestInit | undefined): URLSearchParams {
  return new URLSearchParams(String(init?.body));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OidcSession', () => {
  it('runs one refresh for concurrent 401s on the same token, and none for a token already replaced', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fetch = vi.fn(async () => { await gate; return tokenResponse(2); });
    const session = new OidcSession(config, { fetch, store: null }, { accessToken: 'AT1', refreshToken: 'RT1', expiresIn: 300 });

    const all = Promise.all([1, 2, 3, 4, 5].map(() => session.refreshIfStale('AT1')));
    release();
    expect(await all).toEqual(['AT2', 'AT2', 'AT2', 'AT2', 'AT2']);
    expect(fetch).toHaveBeenCalledTimes(1);

    await expect(session.refreshIfStale('AT1')).resolves.toBe('AT2');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(form(fetch.mock.calls[0][1]).get('refresh_token')).toBe('RT1');
  });

  it('refreshes before handing out a token about to expire', async () => {
    let now = 1_000_000;
    const fetch = vi.fn(async () => tokenResponse(2));
    const session = new OidcSession(config, { fetch, store: null, now: () => now }, { accessToken: 'AT1', refreshToken: 'RT1', expiresIn: 300 });

    await expect(session.getAccessToken()).resolves.toBe('AT1');
    now += 280 * 1000;
    await expect(session.getAccessToken()).resolves.toBe('AT2');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the rotated refresh token, and forgets it when the provider ends the session', async () => {
    const store = memoryStore();
    const fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse(2))
      .mockResolvedValueOnce(new Response('{"error":"invalid_grant"}', { status: 400 }));
    const session = new OidcSession(config, { fetch, store }, { accessToken: 'AT1', refreshToken: 'RT1', expiresIn: 300 });
    expect(store.data.k).toBe('RT1');

    await session.refresh();
    expect(store.data.k).toBe('RT2');

    await expect(session.refresh()).rejects.toBeInstanceOf(OidcSessionEndedError);
    expect(store.data.k).toBeUndefined();
    await expect(session.refresh()).rejects.toBeInstanceOf(OidcSessionEndedError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refreshes a minute ahead of expiry and reports a session the provider has ended', async () => {
    vi.useFakeTimers();
    const onSessionEnded = vi.fn();
    const fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse(2))
      .mockResolvedValueOnce(new Response('{"error":"invalid_grant"}', { status: 400 }));
    const session = new OidcSession(config, { fetch, store: null, onSessionEnded }, { accessToken: 'AT1', refreshToken: 'RT1', expiresIn: 300 });
    session.startAutoRefresh();

    await vi.advanceTimersByTimeAsync(239 * 1000);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(session.accessToken).toBe('AT2');

    await vi.advanceTimersByTimeAsync(240 * 1000);
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
  });

  it('retries a scheduled refresh that fails for another reason', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(tokenResponse(2));
    const session = new OidcSession(config, { fetch, store: null }, { accessToken: 'AT1', refreshToken: 'RT1', expiresIn: 300 });
    session.startAutoRefresh();

    await vi.advanceTimersByTimeAsync(240 * 1000);
    await vi.advanceTimersByTimeAsync(30 * 1000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(session.accessToken).toBe('AT2');
    session.stopAutoRefresh();
  });

  it('revokes the refresh token on sign-out and forgets it', async () => {
    const store = memoryStore();
    const fetch = vi.fn(async () => new Response('', { status: 200 }));
    const session = new OidcSession(config, { fetch, store }, { accessToken: 'AT1', refreshToken: 'RT1', expiresIn: 300 });

    await session.revoke();

    expect(fetch).toHaveBeenCalledWith('https://idp.example.org/revoke', expect.objectContaining({ method: 'POST', credentials: 'omit' }));
    expect(Object.fromEntries(form(fetch.mock.calls[0][1]))).toEqual({
      token: 'RT1',
      token_type_hint: 'refresh_token',
      client_id: 'xnat-workstation',
    });
    expect(store.data.k).toBeUndefined();
  });

  it('restores from a stored refresh token, or returns null without one', async () => {
    const fetch = vi.fn(async () => tokenResponse(2));
    await expect(OidcSession.restore(config, { fetch, store: memoryStore() })).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();

    const session = await OidcSession.restore(config, { fetch, store: memoryStore({ k: 'RT1' }) });
    expect(session?.accessToken).toBe('AT2');
  });
});

describe('EncryptedRefreshTokenStore', () => {
  const cipher = (available = true) => ({
    isAvailable: () => available,
    encrypt: (t: string) => Buffer.from(`enc:${t}`),
    decrypt: (b: Buffer) => b.toString().replace(/^enc:/, ''),
  });

  it('keeps tokens encrypted in a file only the user can read', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'xw-tokens-')), 'tokens.json');
    const store = new EncryptedRefreshTokenStore(file, cipher());
    store.save('k', 'secret');

    expect(readFileSync(file, 'utf8')).not.toContain('secret');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(store.load('k')).toBe('secret');
    store.remove('k');
    expect(store.load('k')).toBeNull();
  });

  it('writes nothing when the system offers no encryption', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'xw-tokens-')), 'tokens.json');
    new EncryptedRefreshTokenStore(file, cipher(false)).save('k', 'secret');
    expect(() => readFileSync(file)).toThrow();
  });
});
