/**
 * Checkpoint storage in the main process (#102): directory names never collide, a record
 * without a date cannot empty a listing, checkpoints filed under the old
 * session + series + label key are found again, and a rename moves them.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipcChannels';
import type { CheckpointRecord } from '../../shared/types/checkpoint';
import { createIpcMainMock } from '../../test/ipc/ipcMocks';

const ipcMainMock = createIpcMainMock();
let userData = '';

let mod: typeof import('./checkpointHandlers');

beforeAll(async () => {
  vi.doMock('electron', () => ({
    ipcMain: ipcMainMock.ipcMain,
    app: { getPath: () => userData },
    dialog: {},
    BrowserWindow: { fromWebContents: () => null },
  }));
  mod = await import('./checkpointHandlers');
});

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt-main-'));
  ipcMainMock.handlers.clear();
  mod.registerCheckpointHandlers();
});

const SERIES = '1.2.840.113619.2.1';
let n = 0;
function record(over: Partial<CheckpointRecord> = {}): CheckpointRecord {
  n += 1;
  return {
    version: 1,
    id: `id${n}`,
    name: `c${n}`,
    kind: 'named',
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString(),
    seriesInstanceUID: SERIES,
    containerLabel: 'Liver',
    dims: [4, 4, 2],
    members: [{ segmentIndex: 1, label: 'Seg', runs: 'AA==' }],
    ...over,
  };
}
const list = async (key: string, legacy?: { seriesInstanceUID: string; containerLabel: string }) =>
  (await ipcMainMock.invoke(IPC.CHECKPOINT_LIST, key, legacy)) as { ok: boolean; checkpoints?: { id: string; name: string; containerLabel: string }[] };
const write = (key: string, rec: CheckpointRecord) => ipcMainMock.invoke(IPC.CHECKPOINT_WRITE, key, rec);

describe('isCheckpointRecord', () => {
  it('requires a parseable createdAt (a dateless import made the listing throw)', () => {
    const { createdAt: _drop, ...noDate } = record();
    expect(mod.isCheckpointRecord(record())).toBe(true);
    expect(mod.isCheckpointRecord(noDate)).toBe(false);
    expect(mod.isCheckpointRecord(record({ createdAt: 'yesterday' }))).toBe(false);
    expect(mod.isCheckpointRecord(record({ createdAt: 42 as unknown as string }))).toBe(false);
  });
});

describe('checkpoint storage', () => {
  it('a record on disk without createdAt does not empty the listing', async () => {
    const key = `${SERIES}__Liver`;
    await write(key, record({ name: 'good' }));
    const { createdAt: _drop, ...noDate } = record({ name: 'dateless' });
    await write(key, noDate as CheckpointRecord);
    const r = await list(key);
    expect(r.ok).toBe(true);
    expect(r.checkpoints?.map((c) => c.name)).toEqual(['good']);
  });

  it('keys that differ only in punctuation do not share a directory', async () => {
    await write(`${SERIES}__Liver/Tumor`, record({ name: 'slash', containerLabel: 'Liver/Tumor' }));
    await write(`${SERIES}__Liver Tumor`, record({ name: 'space', containerLabel: 'Liver Tumor' }));
    expect((await list(`${SERIES}__Liver/Tumor`)).checkpoints?.map((c) => c.name)).toEqual(['slash']);
    expect((await list(`${SERIES}__Liver Tumor`)).checkpoints?.map((c) => c.name)).toEqual(['space']);
  });

  it('a very long label still gets its own directory', async () => {
    const long = 'L'.repeat(300);
    await write(`${SERIES}__${long}A`, record({ name: 'a' }));
    await write(`${SERIES}__${long}B`, record({ name: 'b' }));
    expect((await list(`${SERIES}__${long}A`)).checkpoints?.map((c) => c.name)).toEqual(['a']);
  });

  it('checkpoints filed under the legacy session + series + label directory are adopted by their own container only', async () => {
    // Before #102 the directory was safe(`${session}__${series}__${label}`), so "Liver/Tumor"
    // and "Liver Tumor" shared one.
    const legacyDir = path.join(userData, 'checkpoints', `XNAT_E00042__${SERIES}__Liver_Tumor`);
    fs.mkdirSync(legacyDir, { recursive: true });
    const mine = record({ name: 'mine', containerLabel: 'Liver/Tumor' });
    const theirs = record({ name: 'theirs', containerLabel: 'Liver Tumor' });
    fs.writeFileSync(path.join(legacyDir, `${mine.id}.json`), JSON.stringify(mine));
    fs.writeFileSync(path.join(legacyDir, `${theirs.id}.json`), JSON.stringify(theirs));
    const otherSeries = path.join(userData, 'checkpoints', `XNAT_E00042__1.2.3__Liver_Tumor`);
    fs.mkdirSync(otherSeries, { recursive: true });
    fs.writeFileSync(path.join(otherSeries, 'x.json'), JSON.stringify(record({ name: 'other', containerLabel: 'Liver/Tumor', seriesInstanceUID: '1.2.3' })));

    const legacy = { seriesInstanceUID: SERIES, containerLabel: 'Liver/Tumor' };
    expect((await list(`${SERIES}__Liver/Tumor`, legacy)).checkpoints?.map((c) => c.name)).toEqual(['mine']);
    // Moved, not copied: the other container still finds its own, and only its own.
    expect((await list(`${SERIES}__Liver/Tumor`, legacy)).checkpoints?.map((c) => c.name)).toEqual(['mine']);
    expect((await list(`${SERIES}__Liver Tumor`, { seriesInstanceUID: SERIES, containerLabel: 'Liver Tumor' }))
      .checkpoints?.map((c) => c.name)).toEqual(['theirs']);
    expect(fs.existsSync(path.join(otherSeries, 'x.json'))).toBe(true);
  });

  it('a rename moves a container’s checkpoints to its new key and relabels them', async () => {
    await write(`${SERIES}__Liver`, record({ name: 'kept' }));
    await ipcMainMock.invoke(IPC.CHECKPOINT_MOVE, `${SERIES}__Liver`, `${SERIES}__Liver lobe`, 'Liver lobe');
    expect((await list(`${SERIES}__Liver`)).checkpoints).toEqual([]);
    const moved = (await list(`${SERIES}__Liver lobe`)).checkpoints;
    expect(moved?.map((c) => [c.name, c.containerLabel])).toEqual([['kept', 'Liver lobe']]);
  });
});
