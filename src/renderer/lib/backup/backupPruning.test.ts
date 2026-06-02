import { describe, expect, it } from 'vitest';
import {
  partitionEntriesForPrune,
  partitionSessionsForPrune,
  manifestAfterPrune,
  detectSyncFolder,
  syncFolderWarningMessage,
} from './backupPruning';
import type { BackupManifest, BackupManifestEntry, BackupSessionSummary } from '@shared/types/backup';

const DAY = 24 * 60 * 60 * 1000;

function entry(filename: string, ageDays: number, now: number): BackupManifestEntry {
  return {
    segmentationId: `seg-${filename}`,
    filename,
    format: 'SEG',
    sourceScanId: '7',
    timestamp: new Date(now - ageDays * DAY).toISOString(),
    sizeBytes: 1024,
  };
}

function manifest(entries: BackupManifestEntry[]): BackupManifest {
  return {
    version: 1,
    sessionId: 'S1',
    serverUrl: 'https://xnat.example',
    lastUpdated: new Date(0).toISOString(),
    entries,
  };
}

describe('partitionEntriesForPrune', () => {
  const now = Date.parse('2026-04-01T00:00:00Z');

  it('entries younger than the cutoff stay in `keep`', () => {
    const e1 = entry('a.dcm', 5, now);
    const e2 = entry('b.dcm', 29, now);
    const { keep, prune } = partitionEntriesForPrune([e1, e2], 30, now);
    expect(keep).toEqual([e1, e2]);
    expect(prune).toEqual([]);
  });

  it('entries older than the cutoff land in `prune`', () => {
    const fresh = entry('fresh.dcm', 1, now);
    const stale = entry('stale.dcm', 31, now);
    const ancient = entry('ancient.dcm', 365, now);
    const { keep, prune } = partitionEntriesForPrune([fresh, stale, ancient], 30, now);
    expect(keep).toEqual([fresh]);
    expect(prune).toEqual([stale, ancient]);
  });

  it('cutoff is exclusive — an entry exactly at the boundary stays', () => {
    const e = entry('boundary.dcm', 30, now);
    const { keep } = partitionEntriesForPrune([e], 30, now);
    expect(keep).toEqual([e]);
  });

  it('unparseable timestamp → keep (better safe than silent loss)', () => {
    const bad: BackupManifestEntry = {
      segmentationId: 'x',
      filename: 'bad.dcm',
      format: 'SEG',
      sourceScanId: '1',
      timestamp: 'not-a-date',
      sizeBytes: 0,
    };
    const { keep, prune } = partitionEntriesForPrune([bad], 30, now);
    expect(keep).toEqual([bad]);
    expect(prune).toEqual([]);
  });

  it('configurable cutoff (1 day, 365 days)', () => {
    const e1 = entry('e1.dcm', 0.5, now);
    const e2 = entry('e2.dcm', 2, now);
    expect(partitionEntriesForPrune([e1, e2], 1, now).prune.map((e) => e.filename)).toEqual(['e2.dcm']);
    const e365 = entry('e365.dcm', 366, now);
    expect(partitionEntriesForPrune([e1, e365], 365, now).prune.map((e) => e.filename)).toEqual(['e365.dcm']);
  });
});

describe('manifestAfterPrune', () => {
  const now = Date.parse('2026-04-01T00:00:00Z');

  it('returns the same manifest object when nothing is pruned', () => {
    const m = manifest([entry('a.dcm', 5, now)]);
    const after = manifestAfterPrune(m, [], now);
    expect(after).toBe(m);
  });

  it('removes the pruned filenames and advances lastUpdated', () => {
    const fresh = entry('fresh.dcm', 5, now);
    const stale = entry('stale.dcm', 60, now);
    const m = manifest([fresh, stale]);
    const after = manifestAfterPrune(m, [stale], now);
    expect(after.entries).toEqual([fresh]);
    expect(after.lastUpdated).toBe(new Date(now).toISOString());
  });
});

describe('partitionSessionsForPrune', () => {
  const now = Date.parse('2026-04-01T00:00:00Z');
  function session(label: string, ageDays: number): BackupSessionSummary {
    return {
      sessionId: label,
      serverUrl: '',
      entryCount: 0,
      totalSizeBytes: 0,
      lastUpdated: new Date(now - ageDays * DAY).toISOString(),
      projectId: '', subjectId: '', subjectLabel: '', sessionLabel: '',
    };
  }
  it('classifies fresh vs stale by lastUpdated', () => {
    const { keep, prune } = partitionSessionsForPrune(
      [session('fresh', 1), session('stale', 31)],
      30,
      now,
    );
    expect(keep.map((s) => s.sessionId)).toEqual(['fresh']);
    expect(prune.map((s) => s.sessionId)).toEqual(['stale']);
  });
});

describe('detectSyncFolder', () => {
  it('returns null for an empty / non-sync path', () => {
    expect(detectSyncFolder('')).toBeNull();
    expect(detectSyncFolder('/Users/dan/Documents/Backups')).toBeNull();
    expect(detectSyncFolder('C:\\Users\\dan\\AppData\\Local\\xnat\\backups')).toBeNull();
  });

  it('detects OneDrive paths (POSIX + Windows)', () => {
    expect(detectSyncFolder('/Users/dan/OneDrive/Backups')).toBe('OneDrive');
    expect(detectSyncFolder('/Users/dan/Library/CloudStorage/OneDrive-WashU/Projects')).toBe('OneDrive');
    expect(detectSyncFolder('C:\\Users\\dan\\OneDrive\\xnat-backups')).toBe('OneDrive');
  });

  it('detects iCloud Drive on macOS', () => {
    expect(detectSyncFolder('/Users/dan/Library/Mobile Documents/com~apple~CloudDocs/xnat'))
      .toBe('iCloud Drive');
    expect(detectSyncFolder('/Users/dan/iCloud Drive/xnat')).toBe('iCloud Drive');
  });

  it('detects Dropbox', () => {
    expect(detectSyncFolder('/Users/dan/Dropbox/Backups')).toBe('Dropbox');
    expect(detectSyncFolder('C:\\Users\\dan\\Dropbox\\xnat')).toBe('Dropbox');
  });

  it('detects Google Drive', () => {
    expect(detectSyncFolder('/Users/dan/Library/CloudStorage/GoogleDrive-foo@gmail.com/xnat'))
      .toBe('Google Drive');
    expect(detectSyncFolder('/Users/dan/Google Drive/xnat')).toBe('Google Drive');
  });

  it('warning message names the provider', () => {
    expect(syncFolderWarningMessage('OneDrive')).toMatch(/inside OneDrive/);
    expect(syncFolderWarningMessage('iCloud Drive')).toMatch(/inside iCloud Drive/);
    expect(syncFolderWarningMessage('Dropbox')).toMatch(/inside Dropbox/);
  });
});
