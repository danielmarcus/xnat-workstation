/**
 * LoginForm — full-screen login dialog for connecting to an XNAT server.
 *
 * Takes only a server URL. Clicking "Sign In" opens XNAT's own login page
 * in a secure browser window, supporting all auth methods (local, LDAP, OIDC).
 *
 * Remembers recent server URLs in localStorage.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import { IconServer, XnatLogo } from '../icons';

// ─── Recent Connections ──────────────────────────────────────────

interface RecentConnection {
  serverUrl: string;
  lastUsed: number; // Date.now()
}

const STORAGE_KEY = 'xnat-viewer:recent-connections';
const MAX_RECENT = 10;

function loadRecent(): RecentConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r: any) => r.serverUrl)
      .map((r: any) => ({ serverUrl: r.serverUrl, lastUsed: r.lastUsed }))
      .sort((a: RecentConnection, b: RecentConnection) => b.lastUsed - a.lastUsed)
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function saveRecent(serverUrl: string): void {
  try {
    const existing = loadRecent();
    // Remove duplicate if exists
    const filtered = existing.filter((r) => r.serverUrl !== serverUrl);
    // Prepend new entry
    const updated = [
      { serverUrl, lastUsed: Date.now() },
      ...filtered,
    ].slice(0, MAX_RECENT);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // localStorage unavailable — ignore
  }
}

// ─── Component ──────────────────────────────────────────────────

export default function LoginForm() {
  const status = useConnectionStore((s) => s.status);
  const error = useConnectionStore((s) => s.error);
  const browserLogin = useConnectionStore((s) => s.browserLogin);

  const [recentConnections] = useState(loadRecent);
  const [serverUrl, setServerUrl] = useState('');
  const [showRecent, setShowRecent] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isConnecting = status === 'connecting';

  // Pre-fill with most recent connection on mount
  useEffect(() => {
    if (recentConnections.length > 0) {
      setServerUrl(recentConnections[0].serverUrl);
    }
  }, [recentConnections]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showRecent) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowRecent(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showRecent]);

  const selectRecent = useCallback((conn: RecentConnection) => {
    setServerUrl(conn.serverUrl);
    setShowRecent(false);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      let trimmedUrl = serverUrl.trim().replace(/\/+$/, '');

      if (!trimmedUrl) return;

      // Auto-prepend https:// if no protocol specified
      if (!/^https?:\/\//i.test(trimmedUrl)) {
        trimmedUrl = `https://${trimmedUrl}`;
      }

      // Warn on plain HTTP (credentials and medical data should use TLS)
      if (/^http:\/\//i.test(trimmedUrl) && !trimmedUrl.includes('localhost') && !trimmedUrl.includes('127.0.0.1')) {
        console.warn('[LoginForm] Insecure HTTP connection — credentials will be sent in plaintext');
      }

      const success = await browserLogin(trimmedUrl);

      if (success) {
        saveRecent(trimmedUrl);
      }
    },
    [serverUrl, browserLogin],
  );

  const hasRecent = recentConnections.length > 0;

  return (
    <div data-testid="login-form" className="h-full flex items-center justify-center bg-zinc-950">
      <div className="w-full max-w-sm px-6">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <XnatLogo className="w-16 h-16" />
          </div>
          <p className="text-sm text-zinc-500">
            Connect to your XNAT server
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Server URL */}
          <div className="relative" ref={dropdownRef}>
            <label
              htmlFor="serverUrl"
              className="block text-xs font-medium text-zinc-400 mb-1.5"
            >
              Server
            </label>
            <div className="relative">
              <input
                id="serverUrl"
                type="text"
                placeholder="xnat.example.com"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                disabled={isConnecting}
                autoFocus
                className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 pr-8"
              />
              {/* Recent connections dropdown toggle */}
              {hasRecent && !isConnecting && (
                <button
                  type="button"
                  onClick={() => setShowRecent((v) => !v)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                  title="Recent connections"
                >
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${showRecent ? 'rotate-180' : ''}`}
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polyline points="2,4 6,8 10,4" />
                  </svg>
                </button>
              )}
            </div>

            {/* Recent connections dropdown */}
            {showRecent && (
              <div className="absolute z-50 left-0 right-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-md shadow-xl overflow-hidden">
                <div className="px-3 py-1.5 text-[10px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                  Recent Servers
                </div>
                {recentConnections.map((conn, i) => (
                  <button
                    key={conn.serverUrl}
                    type="button"
                    onClick={() => selectRecent(conn)}
                    className={`w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors flex items-center gap-2.5 ${
                      i === 0 ? 'bg-zinc-800/50' : ''
                    }`}
                  >
                    <IconServer className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                    <div className="text-xs text-zinc-200 truncate">
                      {conn.serverUrl}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="bg-red-950/50 border border-red-800/50 rounded-md px-3 py-2">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={isConnecting || !serverUrl.trim()}
            data-testid="login-submit"
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium text-sm rounded-md px-4 py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-950"
          >
            {isConnecting ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                    className="opacity-25"
                  />
                  <path
                    d="M4 12a8 8 0 018-8"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    className="opacity-75"
                  />
                </svg>
                Connecting...
              </span>
            ) : (
              'Sign In with XNAT'
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="text-center text-xs text-zinc-600 mt-6">
          Opens your XNAT login page in a secure window
        </p>
      </div>
    </div>
  );
}
