/**
 * Pinned Items & Recent Sessions — localStorage persistence.
 *
 * Centralizes all bookmark/recent-session storage logic.
 * Items are scoped per XNAT server URL.
 */

// ─── Types ────────────────────────────────────────────────────────

export interface PinnedProject {
  type: 'project';
  serverUrl: string;
  projectId: string;
  projectName: string;
  timestamp: number;
}

export interface PinnedSubject {
  type: 'subject';
  serverUrl: string;
  projectId: string;
  projectName: string;
  subjectId: string;
  subjectLabel: string;
  timestamp: number;
}

export interface PinnedSession {
  type: 'session';
  serverUrl: string;
  projectId: string;
  projectName: string;
  subjectId: string;
  subjectLabel: string;
  sessionId: string;
  sessionLabel: string;
  timestamp: number;
}

export type PinnedItem = PinnedProject | PinnedSubject | PinnedSession;

export interface RecentSession {
  serverUrl: string;
  projectId: string;
  projectName: string;
  subjectId: string;
  subjectLabel: string;
  sessionId: string;
  sessionLabel: string;
  timestamp: number;
}

/** Target for programmatic navigation of the XnatBrowser. */
export interface NavigateToTarget {
  type: 'project' | 'subject' | 'session';
  projectId: string;
  projectName: string;
  subjectId?: string;
  subjectLabel?: string;
  sessionId?: string;
  sessionLabel?: string;
}

// ─── Constants ────────────────────────────────────────────────────

const PINNED_KEY = 'xnat-viewer:pinned-items';
const RECENT_KEY = 'xnat-viewer:recent-sessions';
const OLD_KEY = 'xnat-viewer:recent-session'; // Legacy key to migrate from
const RECENT_CONNECTIONS_KEY = 'xnat-viewer:recent-connections';
const MAX_RECENT = 5;

function normalize(url: string): string {
  return url.replace(/\/+$/, '');
}

// ─── Pinned Items ─────────────────────────────────────────────────

function readPinned(): PinnedItem[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writePinned(items: PinnedItem[]): void {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(items));
  } catch { /* ignore */ }
}

export function loadPinnedItems(serverUrl: string): PinnedItem[] {
  const norm = normalize(serverUrl);
  return readPinned()
    .filter((i) => normalize(i.serverUrl) === norm)
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function addPinnedItem(item: PinnedItem): void {
  const all = readPinned();
  // Remove existing duplicate
  const filtered = all.filter((i) => !isSameItem(i, item));
  filtered.unshift({ ...item, timestamp: Date.now() });
  writePinned(filtered);
}

export function removePinnedItem(
  type: PinnedItem['type'],
  id: string,
  serverUrl: string,
): void {
  const norm = normalize(serverUrl);
  const all = readPinned();
  writePinned(
    all.filter((i) => {
      if (normalize(i.serverUrl) !== norm || i.type !== type) return true;
      return getItemId(i) !== id;
    }),
  );
}

export function isPinned(
  items: PinnedItem[],
  type: PinnedItem['type'],
  id: string,
): boolean {
  return items.some((i) => i.type === type && getItemId(i) === id);
}

/** Get the primary identifier for a pinned item. */
function getItemId(item: PinnedItem): string {
  switch (item.type) {
    case 'project':
      return item.projectId;
    case 'subject':
      return item.subjectId;
    case 'session':
      return item.sessionId;
  }
}

function isSameItem(a: PinnedItem, b: PinnedItem): boolean {
  if (a.type !== b.type) return false;
  if (normalize(a.serverUrl) !== normalize(b.serverUrl)) return false;
  return getItemId(a) === getItemId(b);
}

// ─── Recent Sessions ──────────────────────────────────────────────

function readRecent(): RecentSession[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeRecent(sessions: RecentSession[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(sessions));
  } catch { /* ignore */ }
}

export function loadRecentSessions(serverUrl: string): RecentSession[] {
  const norm = normalize(serverUrl);
  return readRecent()
    .filter((s) => normalize(s.serverUrl) === norm)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_RECENT);
}

export function saveRecentSession(
  serverUrl: string,
  context: {
    projectId: string;
    projectName: string;
    subjectId: string;
    subjectLabel: string;
    sessionId: string;
    sessionLabel: string;
  },
): void {
  const norm = normalize(serverUrl);
  const all = readRecent();

  // Remove duplicate
  const filtered = all.filter(
    (s) => !(s.sessionId === context.sessionId && normalize(s.serverUrl) === norm),
  );

  filtered.unshift({
    serverUrl: norm,
    projectId: context.projectId,
    projectName: context.projectName,
    subjectId: context.subjectId,
    subjectLabel: context.subjectLabel,
    sessionId: context.sessionId,
    sessionLabel: context.sessionLabel,
    timestamp: Date.now(),
  });

  // Trim per server: keep MAX_RECENT per serverUrl
  const byServer = new Map<string, RecentSession[]>();
  for (const s of filtered) {
    const key = normalize(s.serverUrl);
    if (!byServer.has(key)) byServer.set(key, []);
    byServer.get(key)!.push(s);
  }
  const trimmed: RecentSession[] = [];
  for (const sessions of byServer.values()) {
    trimmed.push(...sessions.slice(0, MAX_RECENT));
  }

  writeRecent(trimmed);
}

export function removeRecentSession(sessionId: string, serverUrl: string): void {
  const norm = normalize(serverUrl);
  const all = readRecent();
  writeRecent(
    all.filter(
      (s) => !(s.sessionId === sessionId && normalize(s.serverUrl) === norm),
    ),
  );
}

// ─── Migration from Old Format ────────────────────────────────────

/**
 * Migrate from the old `xnat-viewer:recent-session` key (array of objects
 * with optional `pinned` flag) to the new split keys.
 * Call once on app start.
 */
export function migrateOldStorage(): void {
  try {
    const raw = localStorage.getItem(OLD_KEY);
    if (!raw) return;

    const old = JSON.parse(raw);
    const items: any[] = Array.isArray(old) ? old : [old];

    for (const item of items) {
      if (!item.serverUrl || !item.sessionId) continue;

      if (item.pinned) {
        addPinnedItem({
          type: 'session',
          serverUrl: item.serverUrl,
          projectId: item.projectId ?? '',
          projectName: item.sessionLabel ?? '', // best effort — old format didn't store projectName
          subjectId: item.subjectId ?? '',
          subjectLabel: '', // not available in old format
          sessionId: item.sessionId,
          sessionLabel: item.sessionLabel ?? '',
          timestamp: item.timestamp ?? Date.now(),
        });
      } else {
        saveRecentSession(item.serverUrl, {
          projectId: item.projectId ?? '',
          projectName: '', // not available in old format
          subjectId: item.subjectId ?? '',
          subjectLabel: '',
          sessionId: item.sessionId,
          sessionLabel: item.sessionLabel ?? '',
        });
      }
    }

    localStorage.removeItem(OLD_KEY);
    console.log('[pinnedItems] Migrated old recent-session storage');
  } catch {
    // Migration failed — not critical, just remove old key
    try { localStorage.removeItem(OLD_KEY); } catch { /* ignore */ }
  }
}

/**
 * Clear per-server pinned and recent scan items on disconnect.
 * Preserves recent connections (server URLs) so the login form
 * remembers previously used servers.
 */
export function clearServerScopedStorage(serverUrl: string): void {
  const norm = normalize(serverUrl);
  try {
    const pinned = readPinned().filter((item) => normalize(item.serverUrl) !== norm);
    writePinned(pinned);
  } catch {
    // ignore
  }

  try {
    const recent = readRecent().filter((item) => normalize(item.serverUrl) !== norm);
    writeRecent(recent);
  } catch {
    // ignore
  }
}
