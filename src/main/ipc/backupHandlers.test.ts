/**
 * Local backup storage in the main process: a session id names a folder under
 * <userData>/backups, and no id — whatever the XNAT server sends — may name anything else.
 * An id of `..` once resolved to userData itself, and deleting that "session" removed the
 * app's whole user-data folder.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipcChannels';
import { createIpcMainMock } from '../../test/ipc/ipcMocks';

const ipcMainMock = createIpcMainMock();
// One userData for the file: the handlers cache the backup root on first use.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-main-'));
const sentinel = path.join(userData, 'settings.json');

beforeAll(async () => {
  vi.doMock('electron', () => ({
    ipcMain: ipcMainMock.ipcMain,
    app: { getPath: () => userData },
  }));
  const mod = await import('./backupHandlers');
  mod.registerBackupHandlers();
});

beforeEach(() => {
  fs.rmSync(path.join(userData, 'backups'), { recursive: true, force: true });
  fs.writeFileSync(sentinel, '{}');
});

type Result = { ok: boolean; error?: string };
const write = (sessionId: string) =>
  ipcMainMock.invoke(IPC.BACKUP_WRITE_FILE, sessionId, 'seg_1.dcm', Buffer.from('DICM').toString('base64')) as Promise<Result>;
const deleteSession = (sessionId: string) => ipcMainMock.invoke(IPC.BACKUP_DELETE_SESSION, sessionId) as Promise<Result>;

describe('backup session folders', () => {
  it('an ordinary XNAT experiment id gets its own folder, and deleting it removes only that', async () => {
    expect((await write('XNAT_E00042')).ok).toBe(true);
    expect((await write('XNAT_E00043')).ok).toBe(true);
    expect((await deleteSession('XNAT_E00042')).ok).toBe(true);
    expect(fs.existsSync(path.join(userData, 'backups', 'XNAT_E00042'))).toBe(false);
    expect(fs.existsSync(path.join(userData, 'backups', 'XNAT_E00043', 'seg_1.dcm'))).toBe(true);
  });

  it.each(['..', '.', '', '...'])('refuses the session id %j and leaves userData and every backup in place', async (id) => {
    expect((await write('XNAT_E00042')).ok).toBe(true);
    expect((await write(id)).ok).toBe(false);
    expect((await deleteSession(id)).ok).toBe(false);
    expect(fs.existsSync(sentinel)).toBe(true);
    expect(fs.existsSync(path.join(userData, 'backups', 'XNAT_E00042', 'seg_1.dcm'))).toBe(true);
    expect(fs.existsSync(path.join(userData, 'seg_1.dcm'))).toBe(false);
  });

  it('turns separators into underscores, so a traversal attempt stays a folder under backups', async () => {
    expect((await write('../..')).ok).toBe(true);
    expect(fs.existsSync(path.join(userData, 'backups', '.._..', 'seg_1.dcm'))).toBe(true);
    expect(fs.existsSync(sentinel)).toBe(true);
  });

  it('keeps ids that contain dots among other characters (labels like "MR.1")', async () => {
    expect((await write('MR.1')).ok).toBe(true);
    expect(fs.existsSync(path.join(userData, 'backups', 'MR.1', 'seg_1.dcm'))).toBe(true);
  });
});
