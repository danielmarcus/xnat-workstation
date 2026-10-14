/**
 * IPC handlers for segmentation checkpoints (SegWorks parity D8).
 *
 *   <userData>/checkpoints/<dir of key>/<id>.json   — one CheckpointRecord per file
 *
 * `key` identifies a Segmentation across loads (source series + label, see
 * checkpointService); the renderer builds it. The directory is a readable prefix plus a
 * hash of the whole key, so keys that differ only in punctuation or past the length cap
 * never share one (#102). Ids are sanitised against path traversal.
 *
 * Before #102 the directory was safe(`${session}__${series}__${label}`). A listing that is
 * given its series + label adopts matching records from such directories (moved, not
 * copied), so checkpoints saved before the change are not lost.
 */
import { ipcMain, app, dialog, BrowserWindow } from 'electron';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IPC } from '../../shared/ipcChannels';
import type { CheckpointMeta, CheckpointRecord } from '../../shared/types/checkpoint';

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 180);
const root = () => path.join(app.getPath('userData'), 'checkpoints');
/** Every current directory starts with this; legacy ones never do (a session id came first). */
const DIR_PREFIX = 'k-';
export const dirNameOf = (key: string) =>
  `${DIR_PREFIX}${safe(key).slice(0, 100)}-${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
const dirOf = (key: string) => path.join(root(), dirNameOf(key));
const fileOf = (key: string, id: string) => path.join(dirOf(key), `${safe(id)}.json`);

/** Series + label of the container a listing is for — enough to find its legacy records. */
export interface LegacyIdentity { seriesInstanceUID: string; containerLabel: string }

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Whether a parsed file looks like a CheckpointRecord this version can apply. */
export function isCheckpointRecord(v: unknown): v is CheckpointRecord {
  const r = v as CheckpointRecord;
  return !!r && r.version === 1 && typeof r.id === 'string' && typeof r.name === 'string'
    && (r.kind === 'named' || r.kind === 'baseline') && typeof r.seriesInstanceUID === 'string'
    && typeof r.createdAt === 'string' && !Number.isNaN(Date.parse(r.createdAt))
    && Array.isArray(r.dims) && r.dims.length === 3 && r.dims.every((d) => Number.isInteger(d) && d > 0)
    && Array.isArray(r.members) && r.members.every((m) => Number.isInteger(m.segmentIndex) && typeof m.runs === 'string');
}

const FILTERS = [{ name: 'Workstation checkpoint', extensions: ['wscheckpoint'] }];

/** The valid records in a directory, each with its file name; malformed files are skipped. */
async function readAll(dir: string): Promise<CheckpointRecord[]> {
  return (await readFiles(dir)).map((f) => f.rec);
}
async function readFiles(dir: string): Promise<{ file: string; rec: CheckpointRecord }[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const out: { file: string; rec: CheckpointRecord }[] = [];
  for (const n of names.filter((f) => f.endsWith('.json'))) {
    try {
      const rec = JSON.parse(await fs.readFile(path.join(dir, n), 'utf8'));
      if (isCheckpointRecord(rec)) out.push({ file: path.join(dir, n), rec });
    } catch { /* unreadable file: skip */ }
  }
  return out;
}

/**
 * Move this container's records out of pre-#102 directories into its current one. A legacy
 * directory was shared by every label that sanitised alike, so records are matched on their
 * own series and label, not on the directory name.
 */
async function adoptLegacy(key: string, legacy: LegacyIdentity): Promise<void> {
  const marker = `__${safe(legacy.seriesInstanceUID)}__`;
  const dirs = await fs.readdir(root()).catch(() => [] as string[]);
  for (const d of dirs) {
    if (d.startsWith(DIR_PREFIX) || !d.includes(marker)) continue;
    const dir = path.join(root(), d);
    for (const { file, rec } of await readFiles(dir)) {
      if (rec.seriesInstanceUID !== legacy.seriesInstanceUID || rec.containerLabel !== legacy.containerLabel) continue;
      await fs.mkdir(dirOf(key), { recursive: true });
      await fs.writeFile(fileOf(key, rec.id), JSON.stringify(rec));
      await fs.rm(file, { force: true });
    }
    await fs.rmdir(dir).catch(() => { /* still holds another label's records */ });
  }
}

export function registerCheckpointHandlers(): void {
  ipcMain.handle(IPC.CHECKPOINT_EXPORT, async (e, key: string, id: string) => {
    try {
      const rec = JSON.parse(await fs.readFile(fileOf(key, id), 'utf8')) as CheckpointRecord;
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const opts = { defaultPath: `${safe(`${rec.containerLabel}-${rec.name}`)}.wscheckpoint`, filters: FILTERS };
      const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      await fs.writeFile(result.filePath, JSON.stringify(rec));
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  });

  ipcMain.handle(IPC.CHECKPOINT_IMPORT, async (e) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const opts = { properties: ['openFile' as const], filters: FILTERS };
      const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
      const parsed = JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'));
      if (!isCheckpointRecord(parsed)) return { ok: false, error: 'not a Workstation checkpoint file' };
      return { ok: true, record: parsed };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  });

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

  ipcMain.handle(IPC.CHECKPOINT_LIST, async (_e, key: string, legacy?: LegacyIdentity) => {
    try {
      if (legacy) await adoptLegacy(key, legacy);
      const metas: CheckpointMeta[] = [];
      for (const rec of await readAll(dirOf(key))) {
        const { members, ...meta } = rec;
        metas.push({ ...meta, memberCount: members.length });
      }
      metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { ok: true, checkpoints: metas };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  });

  /** A rename: move every checkpoint from one key to another, relabelled. */
  ipcMain.handle(IPC.CHECKPOINT_MOVE, async (_e, fromKey: string, toKey: string, containerLabel: string) => {
    try {
      if (dirOf(fromKey) === dirOf(toKey)) return { ok: true };
      const recs = await readAll(dirOf(fromKey));
      if (recs.length === 0) return { ok: true };
      await fs.mkdir(dirOf(toKey), { recursive: true });
      for (const rec of recs) {
        await fs.writeFile(fileOf(toKey, rec.id), JSON.stringify({ ...rec, containerLabel }));
        await fs.rm(fileOf(fromKey, rec.id), { force: true });
      }
      await fs.rmdir(dirOf(fromKey)).catch(() => { /* not empty: leave it */ });
      return { ok: true };
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
