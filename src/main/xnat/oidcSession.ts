/**
 * The tokens of a browser sign-in, held in the main process only. The access token is refreshed
 * shortly before it expires and once on a 401, with at most one refresh in flight. The refresh
 * token is kept encrypted with the system keychain when there is one, in memory otherwise.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { FetchLike } from './oidcDiscovery';
import { parseTokenResponse, postForm, type TokenSet } from './oidcLogin';

const REFRESH_AHEAD_MS = 60 * 1000;
const EXPIRY_MARGIN_MS = 30 * 1000;
const RETRY_AFTER_FAILURE_MS = 30 * 1000;

export class OidcSessionEndedError extends Error {
  constructor(message = 'The sign-in session has ended') {
    super(message);
    this.name = 'OidcSessionEndedError';
  }
}

export interface RefreshTokenStore {
  load(key: string): string | null;
  save(key: string, token: string): void;
  remove(key: string): void;
}

export interface SystemCipher {
  isAvailable(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

/** Refresh tokens in one file, each encrypted with the system keychain. */
export class EncryptedRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly file: string, private readonly cipher: SystemCipher) {}

  private read(): Record<string, string> {
    try {
      const v = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  }

  private write(data: Record<string, string>): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  load(key: string): string | null {
    const v = this.read()[key];
    if (!v || !this.cipher.isAvailable()) return null;
    try {
      return this.cipher.decrypt(Buffer.from(v, 'base64'));
    } catch {
      return null;
    }
  }

  save(key: string, token: string): void {
    if (!this.cipher.isAvailable()) return;
    const data = this.read();
    data[key] = this.cipher.encrypt(token).toString('base64');
    this.write(data);
  }

  remove(key: string): void {
    const data = this.read();
    if (!(key in data)) return;
    delete data[key];
    this.write(data);
  }
}

export interface OidcSessionConfig {
  tokenEndpoint: string;
  revocationEndpoint?: string;
  clientId: string;
  /** Identifies the stored refresh token: issuer, client and API URL. */
  storeKey: string;
}

export interface OidcSessionDeps {
  fetch: FetchLike;
  store: RefreshTokenStore | null;
  now?: () => number;
  /** Called when a scheduled refresh finds the session over. */
  onSessionEnded?: () => void;
}

export class OidcSession {
  private token = '';
  private expiresAt = 0;
  private refreshToken: string | null = null;
  private refreshing: Promise<string> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ended = false;
  private readonly now: () => number;

  constructor(private readonly config: OidcSessionConfig, private readonly deps: OidcSessionDeps, tokens?: TokenSet) {
    this.now = deps.now ?? Date.now;
    if (tokens) this.apply(tokens);
  }

  /** Reconnect from a stored refresh token, or null when there is none or it no longer works. */
  static async restore(config: OidcSessionConfig, deps: OidcSessionDeps): Promise<OidcSession | null> {
    const stored = deps.store?.load(config.storeKey) ?? null;
    if (!stored) return null;
    const session = new OidcSession(config, deps);
    session.refreshToken = stored;
    try {
      await session.refresh();
      return session;
    } catch {
      return null;
    }
  }

  /** The current access token, for the renderer's request interceptor. May be expired. */
  get accessToken(): string {
    return this.token;
  }

  /** A usable access token: refreshed first when it is about to expire. */
  async getAccessToken(): Promise<string> {
    if (this.now() < this.expiresAt - EXPIRY_MARGIN_MS) return this.token;
    return this.refreshIfStale(this.token);
  }

  /**
   * After a 401 with `usedToken`: refresh, unless another request already did, so concurrent
   * 401s cost one refresh.
   */
  refreshIfStale(usedToken: string): Promise<string> {
    if (usedToken !== this.token && this.now() < this.expiresAt - EXPIRY_MARGIN_MS) return Promise.resolve(this.token);
    return this.refresh();
  }

  refresh(): Promise<string> {
    this.refreshing ??= this.doRefresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async doRefresh(): Promise<string> {
    if (this.ended || !this.refreshToken) throw new OidcSessionEndedError();
    const response = await postForm(this.deps.fetch, this.config.tokenEndpoint, {
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      client_id: this.config.clientId,
    });
    // Signed out while the request was out: the tokens it returns must not be kept, or the
    // rotated refresh token would be saved again after revoke() removed it.
    if (this.ended) throw new OidcSessionEndedError();
    if (response.status === 400 || response.status === 401) {
      this.end();
      throw new OidcSessionEndedError();
    }
    if (!response.ok) throw new Error(`Token refresh failed (${response.status})`);
    const tokens = parseTokenResponse(await response.json().catch(() => null));
    if (this.ended) throw new OidcSessionEndedError();
    this.apply(tokens);
    this.schedule();
    return this.token;
  }

  private apply(tokens: TokenSet): void {
    this.token = tokens.accessToken;
    this.expiresAt = this.now() + tokens.expiresIn * 1000;
    if (tokens.refreshToken) {
      this.refreshToken = tokens.refreshToken;
      this.deps.store?.save(this.config.storeKey, tokens.refreshToken);
    }
  }

  private end(): void {
    this.ended = true;
    this.refreshToken = null;
    this.deps.store?.remove(this.config.storeKey);
    this.stopAutoRefresh();
  }

  /** Keep the access token fresh ahead of its expiry until stopped. */
  startAutoRefresh(): void {
    this.schedule();
  }

  private schedule(delayMs = Math.max(this.expiresAt - REFRESH_AHEAD_MS - this.now(), 5000)): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.ended || !this.refreshToken) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.refresh().catch((err) => {
        if (err instanceof OidcSessionEndedError) this.deps.onSessionEnded?.();
        else this.schedule(RETRY_AFTER_FAILURE_MS);
      });
    }, delayMs);
  }

  stopAutoRefresh(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Sign out: revoke the refresh token at the provider (best effort) and forget it. */
  async revoke(): Promise<void> {
    const token = this.refreshToken;
    this.end();
    if (!token || !this.config.revocationEndpoint) return;
    try {
      await postForm(this.deps.fetch, this.config.revocationEndpoint, {
        token,
        token_type_hint: 'refresh_token',
        client_id: this.config.clientId,
      });
    } catch {
      // The provider is unreachable; the token still expires with the provider's session.
    }
  }
}
