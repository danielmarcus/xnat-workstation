/**
 * Segmentation checkpoints (SegWorks parity D8, #15–16, #258–268): a named snapshot of a
 * Segmentation's voxels that can be restored as one undo step. Stored on disk beside the
 * autosave backups, keyed by session + source series + container label (container ids
 * are not stable across loads).
 */
export interface CheckpointMemberData {
  segmentIndex: number;
  label: string;
  /** gzip(Int32 [start, length, start, length, …] over flat grid indices), base64. */
  runs: string;
}

export interface CheckpointRecord {
  version: 1;
  id: string;
  name: string;
  /** 'baseline' is the reserved reference checkpoint — at most one per container, kept until replaced. */
  kind: 'baseline' | 'named';
  createdAt: string;
  seriesInstanceUID: string;
  containerLabel: string;
  /** Voxel grid the runs index, [nx, ny, nz]. */
  dims: [number, number, number];
  members: CheckpointMemberData[];
}

/** What a listing returns: the record without the voxel payload. */
export type CheckpointMeta = Omit<CheckpointRecord, 'members'> & { memberCount: number };
