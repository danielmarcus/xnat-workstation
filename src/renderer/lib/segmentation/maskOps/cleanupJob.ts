/**
 * A Volume Cleanup run off the UI thread (O8, #97): the labelmaps live in Cornerstone on the
 * UI thread, so that thread GATHERS what the run needs — per slice the scope's members have
 * pixels on, every member's plane cropped to one window (the targets' bounding box grown by
 * the operations' reach), the image under it when an operation is image-guided, the ROI —
 * the Cleanup worker RUNS it (`runCleanupJob`, the same `runPlaneOpOn` runner the synchronous
 * path uses, over the gathered planes), and the UI thread APPLIES the changed planes to a
 * labelmap transaction, which becomes the preview exactly as a synchronous run's does.
 *
 * Locks, claims, the ROI and "other members are preserved" are the runner's, so they hold in
 * the worker as they do here; scopeEquivalence.test runs both paths and compares the voxels.
 * The window is exact, not approximate: an operation's `reach` is how far beyond the set
 * pixels it can look or write (catalog.ts), so cropped and uncropped results are identical.
 */
import type { LabelmapTransaction, MemberRef } from '../../cornerstone/labelmapTransaction';
import { cleanupOp, type ParamValues } from './catalog';
import type { MaskPlane, PlaneSpacing } from './plane';
import { type Axis, planeSize, planeSpacing } from './planeIO';
import { runPlaneOpOn, type RunPlaneOpResult } from './scope';

export interface CleanupAction {
  opId: string;
  params: ParamValues;
}

/** The part of each plane a run sees: plane pixels [x0, x0 + width) × [y0, y0 + height). */
export interface CleanupWindow {
  x0: number;
  y0: number;
  width: number;
  height: number;
}

/** What the worker is sent: plain data and typed arrays (transferred, not copied). */
export interface CleanupJobInput {
  window: CleanupWindow;
  spacing: PlaneSpacing;
  /** The members the run rewrites, in order (a later one sees an earlier one's result). */
  members: MemberRef[];
  allMembers: MemberRef[];
  lockedMembers: MemberRef[];
  /** The action per target segment index (Smart Cleanup gives each its own). */
  actions: Record<number, CleanupAction>;
  /** The slices some target has pixels on — the only ones a Cleanup can change. */
  slices: number[];
  /** `planes[i][j]`: allMembers[j] on slices[i], cropped to the window; null where it has no pixel there. */
  planes: Array<Array<Uint8Array | null>>;
  /** The image under the window per slice, for image-guided operations. */
  images?: Array<Float32Array | null>;
  roi?: Uint8Array;
}

export interface CleanupJobOutput extends RunPlaneOpResult {
  /** Every member plane the run changed, cropped to the window (`member` indexes allMembers). */
  changes: Array<{ slice: number; member: number; data: Uint8Array }>;
}

const keyOf = (m: MemberRef) => `${m.containerId}|${m.segmentIndex}`;

/** The run itself — the Cleanup worker's body (protocol.ts), and the tests'. */
export function runCleanupJob(input: CleanupJobInput, progress?: (fraction: number) => void): CleanupJobOutput {
  const { window: win, allMembers } = input;
  const n = win.width * win.height;
  const memberIndex = new Map(allMembers.map((m, j) => [keyOf(m), j]));
  const sliceIndex = new Map(input.slices.map((s, i) => [s, i]));
  // The planes as the run leaves them; a write replaces the array, so `input.planes` stays the "before".
  const current = input.planes.map((row) => row.slice());
  const touched = new Set<number>();
  const at = (m: MemberRef, slice: number) => {
    const i = sliceIndex.get(slice);
    const j = memberIndex.get(keyOf(m));
    return i === undefined || j === undefined ? null : { i, j };
  };
  const result = runPlaneOpOn({
    size: (m) => (memberIndex.has(keyOf(m)) ? { width: win.width, height: win.height, spacing: input.spacing } : null),
    any: (m, slice) => {
      const k = at(m, slice);
      const p = k && current[k.i][k.j];
      return !!p && p.includes(1);
    },
    read: (m, slice) => {
      const k = at(m, slice);
      if (!k) return null;
      return { width: win.width, height: win.height, data: current[k.i][k.j] ?? new Uint8Array(n) };
    },
    // LabelmapTransaction.applyPlane, on planes: other members are never touched — the runner
    // blocks their pixels (no takeover in a Cleanup) and clears claimed ones itself.
    apply: (m, slice, after, opts) => {
      const k = at(m, slice);
      if (!k) return { added: 0, removed: 0 };
      const had = opts.current?.data ?? current[k.i][k.j] ?? new Uint8Array(n);
      const next = new Uint8Array(had);
      let added = 0;
      let removed = 0;
      for (let p = 0; p < n; p++) {
        const want = after.data[p] === 1;
        if ((had[p] === 1) === want) continue;
        if (opts.roi && !opts.roi[p]) continue;
        if (want) {
          if (opts.blocked?.[p]) continue;
          next[p] = 1;
          added++;
        } else {
          next[p] = 0;
          removed++;
        }
      }
      if (added || removed) {
        current[k.i][k.j] = next;
        touched.add(k.i * allMembers.length + k.j);
      }
      return { added, removed };
    },
  }, {
    members: input.members,
    allMembers,
    lockedMembers: input.lockedMembers,
    slices: input.slices,
    op: (plane, ctx) => {
      const a = input.actions[ctx.member.segmentIndex];
      const op = a && cleanupOp(a.opId);
      return op?.run ? op.run(plane, ctx, a.params) : plane;
    },
    readImage: input.images ? (slice) => input.images![sliceIndex.get(slice)!] ?? undefined : undefined,
    roi: input.roi,
    skipEmpty: true,
    onSlice: (done, total) => { if (done < total) progress?.(done / total); },
  });
  const changes: CleanupJobOutput['changes'] = [];
  for (const t of [...touched].sort((a, b) => a - b)) {
    const i = Math.floor(t / allMembers.length);
    const j = t % allMembers.length;
    const before = input.planes[i][j];
    const after = current[i][j]!;
    if (before ? !before.every((v, p) => v === after[p]) : after.includes(1)) changes.push({ slice: input.slices[i], member: j, data: after });
  }
  return { ...result, changes };
}

/** The typed arrays of a job's input or output, to transfer instead of copy. */
export function cleanupTransfer(x: CleanupJobInput | CleanupJobOutput): Transferable[] {
  if ('changes' in x) return x.changes.map((c) => c.data.buffer as ArrayBuffer);
  const out: Transferable[] = [];
  for (const row of x.planes) for (const p of row) if (p) out.push(p.buffer as ArrayBuffer);
  for (const im of x.images ?? []) if (im) out.push(im.buffer as ArrayBuffer);
  if (x.roi) out.push(x.roi.buffer as ArrayBuffer);
  return out;
}

// ─── The UI thread's halves ──────────────────────────────────────────────────

/**
 * Hand the thread back now and then (a gather or apply over 300 slices takes a while), and
 * stop when the run was cancelled or went stale meanwhile: `pause` resolves to false then.
 */
export type Pause = () => Promise<boolean>;

export interface GatherOptions {
  axis: Axis;
  members: MemberRef[];
  allMembers: MemberRef[];
  lockedMembers: MemberRef[];
  actions: Record<number, CleanupAction>;
  /** Every slice in scope. */
  slices: number[];
  roi?: ArrayLike<number>;
  /** The image of a slice in plane order, when an action is image-guided. */
  readImage?: (slice: number) => Float32Array | undefined;
}

function cropInto(src: ArrayLike<number>, planeWidth: number, win: CleanupWindow, out: Uint8Array | Float32Array): void {
  for (let y = 0; y < win.height; y++) {
    const row = (win.y0 + y) * planeWidth + win.x0;
    for (let x = 0; x < win.width; x++) out[x + y * win.width] = src[row + x];
  }
}

/** Gather a run's input from the transaction (nothing staged in it yet); null when there is nothing to run on. */
export async function gatherCleanupJob(txn: LabelmapTransaction, o: GatherOptions, pause: Pause): Promise<CleanupJobInput | null | 'stopped'> {
  const grid = o.members.map((m) => txn.grid(m)).find((g) => g);
  if (!grid) return null;
  const { width: pw, height: ph } = planeSize(grid.geometry.dimensions, o.axis);
  // Pass 1: the slices a target is on, and the targets' bounding box over all of them.
  let x0 = pw, x1 = -1, y0 = ph, y1 = -1;
  const live: number[] = [];
  for (const slice of o.slices) {
    let on = false;
    for (const m of o.members) {
      if (!txn.anyOnPlane(m, o.axis, slice)) continue;
      const p = txn.readPlane(m, o.axis, slice);
      if (!p) continue;
      on = true;
      for (let y = 0; y < ph; y++) {
        const row = p.data.subarray(y * pw, (y + 1) * pw);
        const first = row.indexOf(1);
        if (first < 0) continue;
        const last = row.lastIndexOf(1);
        if (first < x0) x0 = first;
        if (last > x1) x1 = last;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (on) live.push(slice);
    if (!(await pause())) return 'stopped';
  }
  if (!live.length) return null;
  const spacing = planeSpacing(grid.geometry.spacing, o.axis);
  const reach = Math.max(0, ...o.members.map((m) => {
    const a = o.actions[m.segmentIndex];
    const op = a && cleanupOp(a.opId);
    return op?.reach ? op.reach(a.params, spacing) : Infinity;
  }));
  const win: CleanupWindow = Number.isFinite(reach)
    ? { x0: Math.max(0, x0 - reach), y0: Math.max(0, y0 - reach), width: 0, height: 0 }
    : { x0: 0, y0: 0, width: pw, height: ph };
  if (Number.isFinite(reach)) {
    win.width = Math.min(pw - 1, x1 + reach) - win.x0 + 1;
    win.height = Math.min(ph - 1, y1 + reach) - win.y0 + 1;
  }
  // Pass 2: every member's plane on those slices, cropped (others block, locked ones protect).
  const planes: CleanupJobInput['planes'] = [];
  const images: Array<Float32Array | null> | undefined = o.readImage ? [] : undefined;
  for (const slice of live) {
    planes.push(o.allMembers.map((m) => {
      if (!txn.anyOnPlane(m, o.axis, slice)) return null;
      const p = txn.readPlane(m, o.axis, slice);
      if (!p) return null;
      const crop = new Uint8Array(win.width * win.height);
      cropInto(p.data, pw, win, crop);
      return crop.includes(1) ? crop : null;
    }));
    if (images) {
      const im = o.readImage!(slice);
      let crop: Float32Array | null = null;
      if (im) cropInto(im, pw, win, (crop = new Float32Array(win.width * win.height)));
      images.push(crop);
    }
    if (!(await pause())) return 'stopped';
  }
  let roi: Uint8Array | undefined;
  if (o.roi) cropInto(o.roi, pw, win, (roi = new Uint8Array(win.width * win.height)));
  return {
    window: win,
    spacing,
    members: o.members,
    allMembers: o.allMembers,
    lockedMembers: o.lockedMembers,
    actions: o.actions,
    slices: live,
    planes,
    images,
    roi,
  };
}

/**
 * Stage a run's changes in the transaction: each changed plane written back into its window.
 * The run already applied locks, the ROI and the other members, so nothing is blocked here;
 * in a shared labelmap the order does not matter (a member only loses a pixel to the one that
 * claimed it, which both orders leave owning it).
 */
export async function applyCleanupJob(
  txn: LabelmapTransaction,
  axis: Axis,
  input: Pick<CleanupJobInput, 'window' | 'allMembers'>,
  out: CleanupJobOutput,
  pause: Pause,
  progress?: (fraction: number) => void,
): Promise<boolean> {
  const win = input.window;
  for (const [n, c] of out.changes.entries()) {
    const member = input.allMembers[c.member];
    const full: MaskPlane | null = txn.readPlane(member, axis, c.slice);
    if (!full) continue;
    const data = new Uint8Array(full.data);
    for (let y = 0; y < win.height; y++) data.set(c.data.subarray(y * win.width, (y + 1) * win.width), (win.y0 + y) * full.width + win.x0);
    txn.applyPlane(member, axis, c.slice, { ...full, data });
    progress?.((n + 1) / out.changes.length);
    if (!(await pause())) return false;
  }
  return true;
}
