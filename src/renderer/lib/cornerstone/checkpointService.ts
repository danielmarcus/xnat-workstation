/**
 * Segmentation checkpoints (SegWorks parity D8; #15–16 baseline, #258–263 named backups).
 *
 * A checkpoint is every segment's voxels at a moment, saved to disk. Restoring writes them
 * back through the labelmap transaction — one undo step, refused if a segment is locked —
 * so a restore can itself be undone. Retention: the newest four named checkpoints per
 * Segmentation plus one baseline (kept until replaced).
 *
 * Identity across loads: container ids are regenerated on every load, and nothing else
 * survives one — a SEG's SeriesInstanceUID is minted afresh on every export, and a
 * never-saved container has no XNAT scan at all. So a checkpoint is filed under source
 * series + container label (#102):
 *   - no session: the series UID is globally unique, and the viewer's session is the
 *     last-loaded one, not necessarily the container's;
 *   - the label is followed on rename (followCheckpointRename), so a rename moves the
 *     checkpoints instead of orphaning them;
 *   - main hashes the key into the directory name, so labels that differ only in
 *     punctuation never share one;
 *   - a listing passes series + label so checkpoints filed under the pre-#102 key
 *     (session + series + label) are adopted.
 * A restore still checks the series and grid size match before touching anything.
 */
import { metaData } from '@cornerstonejs/core';
import type { CheckpointMeta, CheckpointRecord } from '@shared/types/checkpoint';
import { readSegmentVoxelGrid } from './segmentVoxelGrid';
import { getSourceImageIds } from './sourceImageTracking';
import { beginTransaction, type MemberRef } from './labelmapTransaction';
import { encodeRuns, forEachInRuns, packRuns, unpackRuns } from '../segmentation/checkpointCodec';
import { useSegmentationStore } from '../../stores/segmentationStore';

export const NAMED_RETENTION = 4;

interface Identity {
  key: string;
  seriesInstanceUID: string;
  label: string;
}

function api() {
  return window.electronAPI?.checkpoint ?? null;
}

/** The on-disk key for a Segmentation, or null when its series cannot be identified. */
export function checkpointIdentity(containerId: string): Identity | null {
  const summary = useSegmentationStore.getState().segmentations.find((s) => s.segmentationId === containerId);
  const imageId = getSourceImageIds(containerId)?.[0];
  const series = imageId
    ? (metaData.get('generalSeriesModule', imageId) as { seriesInstanceUID?: string } | undefined)?.seriesInstanceUID
    : undefined;
  if (!summary || !series) return null;
  return { key: `${series}__${summary.label}`, seriesInstanceUID: series, label: summary.label };
}

/** Containers that have checkpoints of their own this run: listed some, saved or imported one. */
const owners = new Set<string>();

async function listKey(id: Identity) {
  return api()?.list(id.key, { seriesInstanceUID: id.seriesInstanceUID, containerLabel: id.label });
}

/**
 * A container was renamed: move its checkpoints from the key it had (`before`) to its
 * current one. Only for a container that has checkpoints of its own or was loaded (not
 * created) — naming a brand-new "Segmentation 1" must not take the checkpoints an earlier
 * "Segmentation 1" on the same series left behind.
 */
export async function followCheckpointRename(containerId: string, before: Identity | null): Promise<void> {
  const after = checkpointIdentity(containerId);
  const store = api();
  if (!before || !after || !store || before.key === after.key) return;
  if (!owners.has(containerId) && !useSegmentationStore.getState().xnatOriginMap[containerId]) return;
  await listKey(before); // adopt anything still filed under the pre-#102 key first
  const r = await store.move(before.key, after.key, after.label);
  if (!r.ok) console.warn('[checkpointService] checkpoints not moved on rename:', r.error);
}

export type CheckpointResult =
  | { ok: true; id?: string; restoredMembers?: number; untouchedMembers?: number }
  | { ok: false; reason: 'no-identity' | 'no-storage' | 'no-labelmap' | 'write-failed' | 'not-found' | 'other-series' | 'other-grid' | 'locked'; detail?: string };

export async function saveCheckpoint(containerId: string, name: string, kind: 'baseline' | 'named'): Promise<CheckpointResult> {
  const id = checkpointIdentity(containerId);
  const store = api();
  if (!id) return { ok: false, reason: 'no-identity' };
  if (!store) return { ok: false, reason: 'no-storage' };
  const summary = useSegmentationStore.getState().segmentations.find((s) => s.segmentationId === containerId)!;
  let dims: [number, number, number] | null = null;
  const members: CheckpointRecord['members'] = [];
  for (const m of summary.segments) {
    const g = readSegmentVoxelGrid(containerId, m.segmentIndex);
    if (!g) continue;
    const d = g.geometry.dimensions;
    dims = [d[0], d[1], d[2]];
    const data = g.data, value = g.value;
    const runs = encodeRuns(data.length, (i) => data[i] === value);
    members.push({ segmentIndex: m.segmentIndex, label: m.label, runs: await packRuns(runs) });
  }
  if (!dims) return { ok: false, reason: 'no-labelmap' };
  const record: CheckpointRecord = {
    version: 1,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: kind === 'baseline' ? 'Baseline' : name,
    kind,
    createdAt: new Date().toISOString(),
    seriesInstanceUID: id.seriesInstanceUID,
    containerLabel: id.label,
    dims,
    members,
  };
  const w = await store.write(id.key, record);
  if (!w.ok) return { ok: false, reason: 'write-failed', detail: w.error };
  owners.add(containerId);
  await applyRetention(id, record);
  return { ok: true, id: record.id };
}

/** Keep one baseline (the new one) and the newest NAMED_RETENTION named checkpoints. */
async function applyRetention(id: Identity, saved: CheckpointRecord): Promise<void> {
  const store = api();
  const listed = await listKey(id);
  if (!store || !listed?.ok || !listed.checkpoints) return;
  const named = listed.checkpoints.filter((c) => c.kind === 'named');
  const doomed = [
    ...(saved.kind === 'baseline' ? listed.checkpoints.filter((c) => c.kind === 'baseline' && c.id !== saved.id) : []),
    ...named.slice(NAMED_RETENTION),
  ];
  for (const c of doomed) await store.delete(id.key, c.id);
}

/** Checkpoints for a Segmentation, baseline first then newest first. */
export async function listCheckpoints(containerId: string): Promise<CheckpointMeta[]> {
  const id = checkpointIdentity(containerId);
  const store = api();
  if (!id || !store) return [];
  const r = await listKey(id);
  if (!r?.ok || !r.checkpoints) return [];
  if (r.checkpoints.length > 0) owners.add(containerId);
  return [...r.checkpoints].sort((a, b) =>
    a.kind === b.kind ? b.createdAt.localeCompare(a.createdAt) : a.kind === 'baseline' ? -1 : 1);
}

export async function deleteCheckpoint(containerId: string, checkpointId: string): Promise<void> {
  const id = checkpointIdentity(containerId);
  if (id) await api()?.delete(id.key, checkpointId);
}

/** Write a checkpoint back as ONE undo step. */
export async function restoreCheckpoint(containerId: string, checkpointId: string): Promise<CheckpointResult> {
  const id = checkpointIdentity(containerId);
  const store = api();
  if (!id) return { ok: false, reason: 'no-identity' };
  if (!store) return { ok: false, reason: 'no-storage' };
  const r = await store.read(id.key, checkpointId);
  if (!r.ok || !r.record) return { ok: false, reason: 'not-found', detail: r.error };
  const rec = r.record;
  if (rec.seriesInstanceUID !== id.seriesInstanceUID) return { ok: false, reason: 'other-series' };

  const summary = useSegmentationStore.getState().segmentations.find((s) => s.segmentationId === containerId);
  const present = new Set(summary?.segments.map((m) => m.segmentIndex) ?? []);
  const members: MemberRef[] = rec.members.filter((m) => present.has(m.segmentIndex)).map((m) => ({ containerId, segmentIndex: m.segmentIndex }));
  const begun = beginTransaction(members);
  if (!begun.ok) return { ok: false, reason: begun.reason === 'locked' ? 'locked' : 'no-labelmap' };
  const { txn } = begun;

  for (const m of rec.members) {
    if (!present.has(m.segmentIndex)) continue;
    const ref = { containerId, segmentIndex: m.segmentIndex };
    const g = txn.grid(ref);
    if (!g) continue;
    const d = g.geometry.dimensions;
    if (d[0] !== rec.dims[0] || d[1] !== rec.dims[1] || d[2] !== rec.dims[2]) {
      txn.discard();
      return { ok: false, reason: 'other-grid' };
    }
    const data = g.data, value = g.value;
    const want = new Uint8Array(data.length);
    forEachInRuns(await unpackRuns(m.runs), (i) => { want[i] = 1; });
    for (let i = 0; i < want.length; i++) {
      const has = data[i] === value; // live value; set() is a no-op when unchanged
      if (has !== (want[i] === 1)) txn.set(ref, i, want[i] === 1);
    }
  }
  txn.commit();
  const untouched = (summary?.segments.length ?? 0) - members.length;
  return { ok: true, restoredMembers: members.length, untouchedMembers: Math.max(0, untouched) };
}

/** Save a checkpoint of this Segmentation to a file the user picks. */
export async function exportCheckpointFile(containerId: string, checkpointId: string): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
  const id = checkpointIdentity(containerId);
  const store = api();
  if (!id || !store) return { ok: false, error: 'no-identity' };
  return store.exportFile(id.key, checkpointId);
}

export type ImportResult =
  | { ok: true; name: string }
  | { ok: false; canceled?: boolean; reason: 'no-identity' | 'no-storage' | 'invalid' | 'other-series' | 'other-grid' | 'write-failed'; detail?: string };

/**
 * Bring a checkpoint file in for this Segmentation. Refused unless it was made from the
 * same series with the same grid — a checkpoint is only meaningful on the scan it came
 * from. Stored as a new checkpoint (a baseline replaces the current baseline).
 */
export async function importCheckpointFile(containerId: string): Promise<ImportResult> {
  const id = checkpointIdentity(containerId);
  const store = api();
  if (!id) return { ok: false, reason: 'no-identity' };
  if (!store) return { ok: false, reason: 'no-storage' };
  const r = await store.importFile();
  if (!r.ok || !r.record) return r.canceled ? { ok: false, canceled: true, reason: 'invalid' } : { ok: false, reason: 'invalid', detail: r.error };
  const rec = r.record;
  if (rec.seriesInstanceUID !== id.seriesInstanceUID) return { ok: false, reason: 'other-series' };
  const summary = useSegmentationStore.getState().segmentations.find((s) => s.segmentationId === containerId);
  const grid = summary?.segments.map((m) => readSegmentVoxelGrid(containerId, m.segmentIndex)).find((g) => g);
  const d = grid?.geometry.dimensions;
  if (!d || d[0] !== rec.dims[0] || d[1] !== rec.dims[1] || d[2] !== rec.dims[2]) return { ok: false, reason: 'other-grid' };
  // Stamped as made now: retention keeps the newest named checkpoints, and an import carrying
  // its file's older date was deleted the moment it was imported.
  const stored: CheckpointRecord = { ...rec, id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, containerLabel: id.label, createdAt: new Date().toISOString() };
  const w = await store.write(id.key, stored);
  if (!w.ok) return { ok: false, reason: 'write-failed', detail: w.error };
  owners.add(containerId);
  await applyRetention(id, stored);
  return { ok: true, name: stored.name };
}
