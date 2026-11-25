import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { adoptPreviousProfile } from './devProfile';

function profiles() {
  const root = mkdtempSync(path.join(tmpdir(), 'dev-profile-'));
  return { from: path.join(root, 'XNAT'), to: path.join(root, 'XNAT (dev)') };
}

describe('adoptPreviousProfile', () => {
  it("copies the app's data once, leaving Chromium's caches and the old folder alone", () => {
    const { from, to } = profiles();
    mkdirSync(path.join(from, 'backups', 'S1'), { recursive: true });
    writeFileSync(path.join(from, 'backups', 'S1', 'seg.dcm'), 'SEG');
    mkdirSync(path.join(from, 'Local Storage', 'leveldb'), { recursive: true });
    writeFileSync(path.join(from, 'Local Storage', 'leveldb', '000003.log'), 'settings');
    writeFileSync(path.join(from, 'extensions.json'), '{}');
    mkdirSync(path.join(from, 'Cache'), { recursive: true });

    expect(adoptPreviousProfile(from, to).sort()).toEqual(['Local Storage', 'backups', 'extensions.json']);
    expect(readFileSync(path.join(to, 'backups', 'S1', 'seg.dcm'), 'utf8')).toBe('SEG');
    expect(readFileSync(path.join(to, 'Local Storage', 'leveldb', '000003.log'), 'utf8')).toBe('settings');
    expect(existsSync(path.join(to, 'Cache'))).toBe(false);
    expect(existsSync(path.join(from, 'backups', 'S1', 'seg.dcm'))).toBe(true);

    // Once only: a backup made in the old folder later is not copied again.
    writeFileSync(path.join(from, 'backups', 'S1', 'later.dcm'), 'LATER');
    expect(adoptPreviousProfile(from, to)).toEqual([]);
    expect(existsSync(path.join(to, 'backups', 'S1', 'later.dcm'))).toBe(false);
  });

  it('never replaces data the new folder already has', () => {
    const { from, to } = profiles();
    mkdirSync(path.join(from, 'checkpoints'), { recursive: true });
    writeFileSync(path.join(from, 'checkpoints', 'c.json'), 'old');
    mkdirSync(path.join(to, 'checkpoints'), { recursive: true });
    writeFileSync(path.join(to, 'checkpoints', 'c.json'), 'new');

    expect(adoptPreviousProfile(from, to)).toEqual([]);
    expect(readFileSync(path.join(to, 'checkpoints', 'c.json'), 'utf8')).toBe('new');
  });

  it('does nothing without an old folder, or when both are the same folder', () => {
    const { from, to } = profiles();
    expect(adoptPreviousProfile(from, to)).toEqual([]);
    expect(existsSync(path.join(to, '.adopted-profile'))).toBe(true);
    expect(adoptPreviousProfile(to, to)).toEqual([]);
  });
});
