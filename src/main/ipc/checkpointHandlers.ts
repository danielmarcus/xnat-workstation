/**
 * IPC handlers for segmentation checkpoints (SegWorks parity D8).
 *
 *   <userData>/checkpoints/<key>/<id>.json   — one CheckpointRecord per file
 *
 * `key` identifies a Segmentation across loads (session + source series + label); the
 * renderer builds it. Both key and id are sanitised against path traversal.
 */
import { ipcMain, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IPC } from '../../shared/ipcChannels';
import type { CheckpointMeta, CheckpointRecord } from '../../shared/types/checkpoint';

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 180);
const root = () => path.join(app.getPath('userData'), 'checkpoints');
const dirOf = (key: string) => path.join(root(), safe(key));
const fileOf = (key: string, id: string) => path.join(dirOf(key), `${safe(id)}.json`);

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function registerCheckpointHandlers(): void {
  ipcMain.handle(IPC.CHECKPOINT_WRITE, async (_e, key: string, record: CheckpointRecord) => {
    try {
      await fs.mkdir(dirOf(key), { recursive: true });
      await fs.writeFile(fileOf(key, record.id), JSON.stringify(record));
      return { ok: true };
    } catch (err) {
      console.error('[checkpointHandlers] write error:', errMsg(err));
      return { ok: false, error: errMsg(err) };
    }
  });

  ipcMain.handle(IPC.CHECKPOINT_LIST, async (_e, key: string) => {
    try {
      const names = await fs.readdir(dirOf(key)).catch(() => [] as string[]);
      const metas: CheckpointMeta[] = [];
      for (const n of names.filter((f) => f.endsWith('.json'))) {
        try {
          const rec = JSON.parse(await fs.readFile(path.join(dirOf(key), n), 'utf8')) as CheckpointRecord;
          const { members, ...meta } = rec;
          metas.push({ ...meta, memberCount: members.length });
        } catch { /* unreadable file: skip */ }
      }
      metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { ok: true, checkpoints: metas };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  });

  ipcMain.handle(IPC.CHECKPOINT_READ, async (_e, key: string, id: string) => {
    try {
      const rec = JSON.parse(await fs.readFile(fileOf(key, id), 'utf8')) as CheckpointRecord;
      return { ok: true, record: rec };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  });

  ipcMain.handle(IPC.CHECKPOINT_DELETE, async (_e, key: string, id: string) => {
    try {
      await fs.rm(fileOf(key, id), { force: true });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  });
}
