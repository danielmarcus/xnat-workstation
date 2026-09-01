import { describe, it, expect } from 'vitest';
import { formatBackupStatus } from '../backupStatus';

const NOW = 1_700_000_000_000;

describe('formatBackupStatus', () => {
  it('is hidden when local backup is disabled', () => {
    expect(
      formatBackupStatus({ enabled: false, status: 'saved', lastSavedAt: NOW - 2000, now: NOW }),
    ).toBeNull();
  });

  it('is hidden while idle (nothing saved yet this session)', () => {
    expect(formatBackupStatus({ enabled: true, status: 'idle', lastSavedAt: null, now: NOW })).toBeNull();
  });

  it('reports an in-flight backup', () => {
    expect(formatBackupStatus({ enabled: true, status: 'saving', lastSavedAt: null, now: NOW })).toEqual({
      kind: 'saving',
      text: 'Backing up…',
    });
  });

  it('reports a completed backup with the mockup relative-time suffix', () => {
    expect(formatBackupStatus({ enabled: true, status: 'saved', lastSavedAt: NOW - 2000, now: NOW })).toEqual({
      kind: 'saved',
      text: 'Backed up · 2s ago',
    });
  });

  it('says "just now" under a second, and never a negative age', () => {
    expect(formatBackupStatus({ enabled: true, status: 'saved', lastSavedAt: NOW - 400, now: NOW })?.text).toBe(
      'Backed up · just now',
    );
    // Clock skew / a timestamp stamped a tick ahead must not render "-1s ago".
    expect(formatBackupStatus({ enabled: true, status: 'saved', lastSavedAt: NOW + 500, now: NOW })?.text).toBe(
      'Backed up · just now',
    );
  });

  it('scales the relative time to minutes and hours', () => {
    expect(formatBackupStatus({ enabled: true, status: 'saved', lastSavedAt: NOW - 90_000, now: NOW })?.text).toBe(
      'Backed up · 1m ago',
    );
    expect(formatBackupStatus({ enabled: true, status: 'saved', lastSavedAt: NOW - 7_200_000, now: NOW })?.text).toBe(
      'Backed up · 2h ago',
    );
  });

  it('drops the suffix when there is no timestamp', () => {
    expect(formatBackupStatus({ enabled: true, status: 'saved', lastSavedAt: null, now: NOW })).toEqual({
      kind: 'saved',
      text: 'Backed up',
    });
  });

  it('reports a failed backup (never as a success row)', () => {
    expect(formatBackupStatus({ enabled: true, status: 'error', lastSavedAt: NOW - 2000, now: NOW })).toEqual({
      kind: 'error',
      text: 'Backup failed',
    });
  });
});
