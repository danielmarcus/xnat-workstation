import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPinnedItem,
  clearServerScopedStorage,
  isPinned,
  loadPinnedItems,
  loadRecentSessions,
  migrateOldStorage,
  removePinnedItem,
  removeRecentSession,
  saveRecentSession,
  type PinnedItem,
} from './pinnedItems';

const PINNED_KEY = 'xnat-viewer:pinned-items';
const RECENT_KEY = 'xnat-viewer:recent-sessions';
const OLD_KEY = 'xnat-viewer:recent-session';

function readJson<T>(key: string): T {
  return JSON.parse(localStorage.getItem(key) || 'null') as T;
}

describe('pinnedItems storage helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('adds pinned items with dedupe-by-id/type/server and sorted loads', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    addPinnedItem({
      type: 'project',
      serverUrl: 'https://xnat.example.com/',
      projectId: 'P1',
      projectName: 'Project 1',
      timestamp: 1,
    });

    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    addPinnedItem({
      type: 'project',
      serverUrl: 'https://xnat.example.com',
      projectId: 'P1',
      projectName: 'Project 1 renamed',
      timestamp: 2,
    });

    addPinnedItem({
      type: 'subject',
      serverUrl: 'https://xnat.example.com',
      projectId: 'P1',
      projectName: 'Project 1',
      subjectId: 'S1',
      subjectLabel: 'Subject 1',
      timestamp: 3,
    });

    const loaded = loadPinnedItems('https://xnat.example.com/');
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toMatchObject({
      type: 'subject',
      subjectId: 'S1',
    });
    expect(loaded[1]).toMatchObject({
      type: 'project',
      projectId: 'P1',
      projectName: 'Project 1 renamed',
    });
  });

  it('removes pinned entries by type/id/server and resolves pin checks', () => {
    const items: PinnedItem[] = [
      {
        type: 'project',
        serverUrl: 'https://xnat.example',
        projectId: 'P1',
        projectName: 'P1',
        timestamp: 1,
      },
      {
        type: 'session',
        serverUrl: 'https://xnat.example',
        projectId: 'P1',
        projectName: 'P1',
        subjectId: 'S1',
        subjectLabel: 'S1',
        sessionId: 'E1',
        sessionLabel: 'E1',
        timestamp: 2,
      },
    ];
    localStorage.setItem(PINNED_KEY, JSON.stringify(items));

    expect(isPinned(items, 'project', 'P1')).toBe(true);
    expect(isPinned(items, 'session', 'missing')).toBe(false);

    removePinnedItem('project', 'P1', 'https://xnat.example');
    const after = readJson<PinnedItem[]>(PINNED_KEY);
    expect(after).toHaveLength(1);
    expect(after[0].type).toBe('session');
  });

  it('saves/reloads recent sessions with per-server trim, dedupe, and remove', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    for (let i = 0; i < 7; i++) {
      saveRecentSession('https://xnat.example', {
        projectId: 'P1',
        projectName: 'P1',
        subjectId: `S${i}`,
        subjectLabel: `Subject ${i}`,
        sessionId: `E${i}`,
        sessionLabel: `Session ${i}`,
      });
      vi.setSystemTime(new Date(Date.now() + 1000));
    }
    saveRecentSession('https://other.example', {
      projectId: 'P2',
      projectName: 'P2',
      subjectId: 'S9',
      subjectLabel: 'Subject 9',
      sessionId: 'E9',
      sessionLabel: 'Session 9',
    });

    // Deduplicate by session/server and move to front.
    saveRecentSession('https://xnat.example', {
      projectId: 'P1',
      projectName: 'P1',
      subjectId: 'S4',
      subjectLabel: 'Subject 4',
      sessionId: 'E4',
      sessionLabel: 'Session 4 updated',
    });

    const xnatRecents = loadRecentSessions('https://xnat.example');
    expect(xnatRecents).toHaveLength(5);
    expect(xnatRecents[0]).toMatchObject({ sessionId: 'E4', sessionLabel: 'Session 4 updated' });

    removeRecentSession('E4', 'https://xnat.example/');
    expect(loadRecentSessions('https://xnat.example').some((s) => s.sessionId === 'E4')).toBe(false);

    // Other server entries are independent.
    expect(loadRecentSessions('https://other.example')).toHaveLength(1);
  });

  it('migrates legacy recent-session storage into pinned/recent keys and clears old key', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    localStorage.setItem(
      OLD_KEY,
      JSON.stringify([
        {
          serverUrl: 'https://xnat.example',
          projectId: 'P1',
          subjectId: 'S1',
          sessionId: 'E1',
          sessionLabel: 'Session 1',
          pinned: true,
          timestamp: 100,
        },
        {
          serverUrl: 'https://xnat.example',
          projectId: 'P1',
          subjectId: 'S1',
          sessionId: 'E2',
          sessionLabel: 'Session 2',
          pinned: false,
          timestamp: 101,
        },
      ]),
    );

    migrateOldStorage();

    const pinned = readJson<PinnedItem[]>(PINNED_KEY);
    const recent = readJson<any[]>(RECENT_KEY);
    expect(pinned.some((item) => item.type === 'session' && item.sessionId === 'E1')).toBe(true);
    expect(recent.some((item) => item.sessionId === 'E2')).toBe(true);
    expect(localStorage.getItem(OLD_KEY)).toBeNull();
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('clearServerScopedStorage removes only pinned/recent entries for the target server', () => {
    localStorage.setItem(
      PINNED_KEY,
      JSON.stringify([
        { type: 'project', serverUrl: 'https://xnat.example', projectId: 'P1', projectName: 'P1', timestamp: 1 },
        { type: 'project', serverUrl: 'https://other.example', projectId: 'P2', projectName: 'P2', timestamp: 2 },
      ]),
    );
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([
        { serverUrl: 'https://xnat.example', sessionId: 'E1' },
        { serverUrl: 'https://other.example', sessionId: 'E2' },
      ]),
    );

    clearServerScopedStorage('https://xnat.example/');

    const pinnedAfter = readJson<any[]>(PINNED_KEY);
    const recentAfter = readJson<any[]>(RECENT_KEY);
    expect(pinnedAfter).toEqual([
      expect.objectContaining({ serverUrl: 'https://other.example', projectId: 'P2' }),
    ]);
    expect(recentAfter).toEqual([
      expect.objectContaining({ serverUrl: 'https://other.example', sessionId: 'E2' }),
    ]);
  });
});
