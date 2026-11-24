/**
 * Browser sign-in: OAuth 2.0 authorization code with PKCE (S256) in the system browser, redirected
 * to a one-shot listener on 127.0.0.1 (RFC 8252 section 7.3). Runs in the main process only.
 */
import { createHash, randomBytes } from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';
import type { FetchLike, SignInConfig } from './oidcDiscovery';

export const BROWSER_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export class OidcLoginError extends Error {
  constructor(message: string, readonly cancelled = false) {
    super(message);
    this.name = 'OidcLoginError';
  }
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Seconds. */
  expiresIn: number;
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizationUrl(
  config: Pick<SignInConfig, 'authorizationEndpoint' | 'clientId' | 'scope'>,
  params: { redirectUri: string; state: string; challenge: string },
): string {
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** Check the callback's state, iss (RFC 9207) and error, and return the authorization code. */
export function readCallback(
  params: URLSearchParams,
  expected: { state: string; issuer: string; issRequired: boolean },
): string {
  if (params.get('state') !== expected.state) throw new OidcLoginError('The sign-in response did not match this request.');
  const iss = params.get('iss');
  if (iss !== null ? iss !== expected.issuer : expected.issRequired) {
    throw new OidcLoginError('The sign-in response came from an unexpected identity provider.');
  }
  const error = params.get('error');
  if (error) {
    throw new OidcLoginError(error === 'access_denied' ? 'Sign-in was declined.' : `Sign-in failed (${error}).`);
  }
  const code = params.get('code');
  if (!code) throw new OidcLoginError('The sign-in response had no authorization code.');
  return code;
}

function page(title: string, message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>`
    + '<body style="font-family:system-ui,sans-serif;background:#09090b;color:#e4e4e7;display:flex;'
    + 'align-items:center;justify-content:center;height:100vh;margin:0">'
    + `<div style="text-align:center"><h1 style="font-size:18px;font-weight:600">${title}</h1>`
    + `<p style="color:#a1a1aa;font-size:14px">${message}</p></div>`;
}

export interface LoopbackListener {
  redirectUri: string;
  /** Resolves with the authorization code, once. */
  code: Promise<string>;
  close(): void;
}

/**
 * Listen on 127.0.0.1 at a random port for exactly one `/callback` request, check it with
 * `read`, answer with a short page and close. Rejects on timeout or when `signal` aborts.
 */
export async function startLoopbackListener(opts: {
  read: (params: URLSearchParams) => string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<LoopbackListener> {
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  const host = `127.0.0.1:${port}`;

  let settle: { resolve: (code: string) => void; reject: (err: Error) => void } | undefined;
  const code = new Promise<string>((resolve, reject) => { settle = { resolve, reject }; });
  let done = false;
  const finish = (err: Error | null, value?: string) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    server.close();
    server.closeIdleConnections();
    if (err) settle!.reject(err);
    else settle!.resolve(value!);
  };

  const timer = setTimeout(
    () => finish(new OidcLoginError('Sign-in timed out. Try again, or use the XNAT login window.')),
    opts.timeoutMs,
  );
  const onAbort = () => finish(new OidcLoginError('Login cancelled', true));
  if (opts.signal?.aborted) onAbort();
  else opts.signal?.addEventListener('abort', onAbort);

  server.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (done || req.method !== 'GET' || url.pathname !== '/callback' || req.headers.host !== host) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    let result: string;
    try {
      result = opts.read(url.searchParams);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'close' })
        .end(page('Sign-in failed', 'Return to XNAT Workstation and try again.'));
      finish(error);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'close' })
      .end(page('Signed in', 'You can close this tab and return to XNAT Workstation.'));
    finish(null, result);
  });

  return { redirectUri: `http://${host}/callback`, code, close: () => finish(new OidcLoginError('Login cancelled', true)) };
}

export function parseTokenResponse(body: unknown): TokenSet {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.access_token !== 'string' || !b.access_token) throw new OidcLoginError('The identity provider returned no access token.');
  if (typeof b.token_type === 'string' && b.token_type.toLowerCase() !== 'bearer') {
    throw new OidcLoginError('The identity provider returned an unsupported token type.');
  }
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === 'string' && b.refresh_token ? b.refresh_token : undefined,
    expiresIn: typeof b.expires_in === 'number' && b.expires_in > 0 ? b.expires_in : 300,
  };
}

/** POST a form to the token or revocation endpoint. Never sends cookies. */
export function postForm(fetchFn: FetchLike, url: string, form: Record<string, string>): Promise<Response> {
  return fetchFn(url, {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
}

/** Run the whole browser flow and return the tokens. */
export async function authorizeInBrowser(
  config: SignInConfig,
  deps: {
    fetch: FetchLike;
    openExternal: (url: string) => Promise<void>;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<TokenSet> {
  const { verifier, challenge } = createPkce();
  const state = randomBytes(16).toString('base64url');
  const listener = await startLoopbackListener({
    read: (params) => readCallback(params, { state, issuer: config.issuer, issRequired: config.issRequired }),
    timeoutMs: deps.timeoutMs ?? BROWSER_LOGIN_TIMEOUT_MS,
    signal: deps.signal,
  });
  try {
    await deps.openExternal(buildAuthorizationUrl(config, { redirectUri: listener.redirectUri, state, challenge }));
  } catch (err) {
    listener.close();
    await listener.code.catch(() => undefined);
    throw new OidcLoginError(`Could not open the browser: ${err instanceof Error ? err.message : String(err)}`);
  }
  const code = await listener.code;

  const response = await postForm(deps.fetch, config.tokenEndpoint, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: listener.redirectUri,
    client_id: config.clientId,
    code_verifier: verifier,
  });
  if (!response.ok) throw new OidcLoginError(`The identity provider refused the sign-in (${response.status}).`);
  return parseTokenResponse(await response.json().catch(() => null));
}
