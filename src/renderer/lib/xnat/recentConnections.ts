/**
 * The servers the user has signed in to, most recent first (localStorage). The login form
 * offers them, and a link to a server not among them asks before opening (useOpenLink).
 */
import { sameServer } from '@shared/openLink';

export interface RecentConnection {
  serverUrl: string;
  lastUsed: number; // Date.now()
}

const STORAGE_KEY = 'xnat-viewer:recent-connections';
const MAX_RECENT = 10;

export function loadRecentConnections(): RecentConnection[] {
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

export function saveRecentConnection(serverUrl: string): void {
  try {
    const existing = loadRecentConnections();
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

export function isRecentServer(serverUrl: string): boolean {
  return loadRecentConnections().some((r) => sameServer(r.serverUrl, serverUrl));
}
