/**
 * A module as an operation (SegWorks parity branch 9, M4 — docs/segworks-parity.md §12).
 *
 * The host does everything a built-in operation does, and the module only computes: the box
 * (the slice on screen, a range, the volume, or the ROI limit's rectangle through the volume —
 * as the manifest allows) in the grid's index space; the input API 1.0 posts (only what the
 * manifest declares it reads); the run in the module's sandbox, with progress and Cancel in the
 * progress bar; the result checked; the manifest's post steps (built-in Cleanup operations);
 * then the mask staged in a LabelmapTransaction and previewed like any operation — written
 * members gain (or, for `replace`, become) the mask, other members keep their voxels unless the
 * module claims, a locked member previews read-only — and ⏎ commits one undo step.
 *
 * API 1.0 input:  { api, dims, spacing, modality, scope, currentSlice, params, image?,
 *                   members?: [{ segmentIndex, name, active, mask }], seeds?: [{ cls, points, radius }],
 *                   roi?: { x0, y0, x1, y1 } }   (box coordinates; masks 1 = in, x fastest)
 * API 1.0 result: { mask: Uint8Array (one value per box voxel: 0 / 1, or for new members the
 *                   label 1…k of the k-th), table?: { columns, rows } }
 */
import { eventTarget, metaData } from '@cornerstonejs/core';
import { Enums as ToolEnums } from '@cornerstonejs/tools';
import * as mlg from './multiLayerGroup';
import { viewportService } from './viewportService';
import { beginTransaction, type MemberRef } from './labelmapTransaction';
import { sliceAxisFor } from './maskIslands';
import { forEachBoxVoxel, makeBox, toPlane, type Box } from './gridBox';
import { sliceNumbering } from './sliceNumbering';
import { getSourceImageIds } from './sourceImageTracking';
import { commitPreview, discardPreview, startPreview } from './maskPreview';
import { segmentationService } from './segmentationService';
import { segmentationManager } from '../segmentation/segmentationManagerSingleton';
import { CLEANUP_OPS } from '../segmentation/maskOps/catalog';
import { type Axis, planeAxes } from '../segmentation/maskOps/planeIO';
import { voxelCount } from '../segmentation/solvers/volume';
import { estimateFromBytesPerVoxel, type MemoryEstimate } from '../segmentation/solvers/memory';
import { runModule, ModuleRunCancelled, type ModuleLogLine, type ModuleRun } from '../modules/moduleRunner';
import { MODULE_API_VERSION, type ModuleManifest, type ModuleScope } from '@shared/modules/manifest';
import { useComputeStore } from '../../stores/computeStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useSemiAutoStore } from '../../stores/semiAutoStore';
import { BACKGROUND, useSeedStore } from '../../stores/seedStore';

/** Peak bytes per voxel assumed when a manifest does not say: image 4, masks, result, copies. */
const DEFAULT_BYTES_PER_VOXEL = 16;

export interface ModuleScopeChoice {
  kind: ModuleScope;
  /** Range ends as the viewport displays them (1-based). */
  from?: number;
  to?: number;
}

export type ModuleDomain =
  | { ok: true; box: Box; voxels: number; estimate: MemoryEstimate; currentSlice: number }
  | { ok: false; reason: 'no-target' | 'no-viewport' | 'no-roi' | 'no-range' | 'scope' };

interface Target {
  containerId: string;
  active: number;
  members: Array<{ segmentIndex: number; label: string; locked: boolean }>;
}

function activeTarget(): Target | null {
  const seg = useSegmentationStore.getState();
  const summary = seg.segmentations.find((s) => s.segmentationId === seg.activeSegmentationId);
  if (!summary || !(seg.activeSegmentIndex > 0)) return null;
  return {
    containerId: summary.segmentationId,
    active: seg.activeSegmentIndex,
    members: summary.segments.map((m) => ({ segmentIndex: m.segmentIndex, label: m.label, locked: !!m.locked })),
  };
}

function gridOf(member: MemberRef) {
  const begun = beginTransaction([member], undefined, { allowLocked: true });
  if (!begun.ok) return null;
  const grid = begun.txn.grid(member);
  begun.txn.discard();
  return grid;
}

/** The box a run would use, with its memory estimate (the operation's estimate line). */
export function moduleDomain(manifest: ModuleManifest, scope: ModuleScopeChoice, viewportId: string): ModuleDomain {
  if (!manifest.scopes.includes(scope.kind)) return { ok: false, reason: 'scope' };
  const t = activeTarget();
  if (!t) return { ok: false, reason: 'no-target' };
  const grid = gridOf({ containerId: t.containerId, segmentIndex: t.active });
  const cam = (viewportService.getViewport(viewportId) as { getCamera?: () => { viewPlaneNormal?: number[]; focalPoint?: number[] } } | undefined)?.getCamera?.();
  if (!grid || !cam?.viewPlaneNormal || !cam.focalPoint) return { ok: false, reason: 'no-viewport' };
  const geometry = grid.geometry;
  const axis = sliceAxisFor(geometry.direction, cam.viewPlaneNormal) as Axis;
  const [ax, ay] = planeAxes(axis);
  const size = [geometry.dimensions[ax], geometry.dimensions[ay], geometry.dimensions[axis]];
  const cur = Math.round(toPlane(geometry, axis, cam.focalPoint)[2]);
  let lo = [0, 0, 0], hi = [size[0] - 1, size[1] - 1, size[2] - 1];
  if (scope.kind === 'slice') { lo[2] = hi[2] = cur; }
  else if (scope.kind === 'range') {
    const n = sliceNumbering(viewportId, geometry, axis);
    if (!n || scope.from === undefined || scope.to === undefined) return { ok: false, reason: 'no-range' };
    const a = n.toGrid(scope.from), b = n.toGrid(scope.to);
    lo[2] = Math.min(a, b); hi[2] = Math.max(a, b);
  } else if (scope.kind === 'roi') {
    const roi = useSemiAutoStore.getState().roi;
    if (!roi || roi.viewportId !== viewportId) return { ok: false, reason: 'no-roi' };
    const pts = roi.corners.map((c) => toPlane(geometry, axis, c));
    lo = [Math.floor(Math.min(...pts.map((p) => p[0]))), Math.floor(Math.min(...pts.map((p) => p[1]))), 0];
    hi = [Math.ceil(Math.max(...pts.map((p) => p[0]))), Math.ceil(Math.max(...pts.map((p) => p[1]))), size[2] - 1];
  }
  for (let k = 0; k < 3; k++) { lo[k] = Math.max(0, lo[k]); hi[k] = Math.min(size[k] - 1, hi[k]); }
  if (lo.some((v, k) => v > hi[k])) return { ok: false, reason: 'no-range' };
  const box = makeBox(geometry, axis, lo, hi);
  const voxels = voxelCount(box.dims);
  return {
    ok: true, box, voxels,
    estimate: estimateFromBytesPerVoxel(manifest.bytesPerVoxel ?? DEFAULT_BYTES_PER_VOXEL, voxels),
    currentSlice: cur >= lo[2] && cur <= hi[2] ? cur - lo[2] : -1,
  };
}

function modalityOf(containerId: string): string {
  const img = getSourceImageIds(containerId)?.[0];
  return (img ? (metaData.get('generalSeriesModule', img) as { modality?: string } | undefined)?.modality : undefined) ?? '';
}

export type ModuleOperationResult =
  | { ok: true; added: number; removed: number; readOnly: boolean; table?: { columns: string[]; rows: unknown[][] } }
  | { ok: false; reason: 'no-target' | 'no-viewport' | 'no-roi' | 'no-range' | 'scope' | 'no-image' | 'too-large' | 'cancelled' | 'failed' | 'bad-result' | 'no-change'; detail?: string };

let running: ModuleRun<unknown> | null = null;

export function cancelModuleOperation(): void {
  running?.cancel();
}

/** Apply the manifest's post steps — built-in Cleanup operations — to the mask, slice by slice. */
function postProcess(mask: Uint8Array, box: Box, manifest: ModuleManifest, member: MemberRef): void {
  const [nx, ny, nz] = box.dims;
  for (const step of manifest.postSteps ?? []) {
    const op = CLEANUP_OPS.find((o) => o.id === step.op && o.run && !o.usesImage);
    if (!op?.run) continue;
    const params = Object.fromEntries(op.params.map((p) => [p.key, step.params?.[p.key] ?? p.default]));
    for (let z = 0; z < nz; z++) {
      const plane = { width: nx, height: ny, data: mask.slice(z * nx * ny, (z + 1) * nx * ny) };
      const out = op.run(plane, { member, slice: z, spacing: { x: box.spacing[0], y: box.spacing[1] } }, params);
      mask.set(('plane' in out ? out.plane : out).data, z * nx * ny);
    }
  }
}

export async function runModuleOperation(o: {
  manifest: ModuleManifest;
  params: Record<string, number | string | boolean>;
  scope: ModuleScopeChoice;
  viewportId: string;
  commit?: boolean;
  onLog?: (line: ModuleLogLine) => void;
}): Promise<ModuleOperationResult> {
  const { manifest } = o;
  const t = activeTarget();
  if (!t) return { ok: false, reason: 'no-target' };
  const dom = moduleDomain(manifest, o.scope, o.viewportId);
  if (!dom.ok) return { ok: false, reason: dom.reason };
  if (dom.estimate.level === 'block') return { ok: false, reason: 'too-large', detail: dom.estimate.reason ?? undefined };
  const { box } = dom;
  const n = dom.voxels;
  const everyone: MemberRef[] = t.members.map((m) => ({ containerId: t.containerId, segmentIndex: m.segmentIndex }));
  const read = beginTransaction(everyone, undefined, { allowLocked: true });
  if (!read.ok) return { ok: false, reason: 'no-target' };

  // The input: only what the manifest declares it reads.
  const input: Record<string, unknown> = {
    api: MODULE_API_VERSION, dims: [...box.dims], spacing: [...box.spacing], modality: modalityOf(t.containerId),
    scope: o.scope.kind, currentSlice: dom.currentSlice, params: o.params,
  };
  const transfer: Transferable[] = [];
  if (manifest.reads.image) {
    const source = read.txn.grid(everyone.find((m) => m.segmentIndex === t.active)!)?.sourceReader?.() ?? null;
    if (!source) { read.txn.discard(); return { ok: false, reason: 'no-image' }; }
    const image = new Float32Array(n);
    forEachBoxVoxel(box, (i, flat) => { image[i] = source(flat); });
    input.image = image;
    transfer.push(image.buffer);
  }
  if (manifest.reads.members !== 'none') {
    const wanted = manifest.reads.members === 'all' ? t.members : t.members.filter((m) => m.segmentIndex === t.active);
    input.members = wanted.map((m) => {
      const mask = new Uint8Array(n);
      const ref = { containerId: t.containerId, segmentIndex: m.segmentIndex };
      forEachBoxVoxel(box, (i, flat) => { if (read.txn.has(ref, flat)) mask[i] = 1; });
      transfer.push(mask.buffer);
      return { segmentIndex: m.segmentIndex, name: m.label, active: m.segmentIndex === t.active, mask };
    });
  }
  read.txn.discard();
  if (manifest.reads.seeds) {
    input.seeds = useSeedStore.getState().strokes.filter((s) => s.containerId === t.containerId).map((s) => ({
      cls: s.cls === BACKGROUND ? 'background' : s.cls === t.active ? 'active' : s.cls,
      radius: s.radiusPx,
      points: s.points.map((w) => { const p = toPlane(box.geometry, box.axis, w); return [p[0] - box.lo[0], p[1] - box.lo[1], Math.round(p[2]) - box.lo[2]]; }),
    }));
  }
  if (manifest.reads.roi) {
    const roi = useSemiAutoStore.getState().roi;
    if (roi && roi.viewportId === o.viewportId) {
      const pts = roi.corners.map((c) => toPlane(box.geometry, box.axis, c));
      input.roi = {
        x0: Math.floor(Math.min(...pts.map((p) => p[0]))) - box.lo[0], y0: Math.floor(Math.min(...pts.map((p) => p[1]))) - box.lo[1],
        x1: Math.ceil(Math.max(...pts.map((p) => p[0]))) - box.lo[0], y1: Math.ceil(Math.max(...pts.map((p) => p[1]))) - box.lo[1],
      };
    }
  }

  // The run: progress and Cancel in the progress bar.
  discardPreview();
  const run = runModule<{ mask?: unknown; table?: { columns: string[]; rows: unknown[][] } }>(manifest.id, input, {
    transfer,
    onLog: o.onLog,
    onProgress: (f) => useComputeStore.getState().progress(f),
  });
  running = run as ModuleRun<unknown>;
  useComputeStore.getState().start(manifest.name, o.viewportId, () => run.cancel());
  let result: Awaited<typeof run.result>;
  try {
    result = await run.result;
  } catch (e) {
    if (e instanceof ModuleRunCancelled) return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: 'failed', detail: e instanceof Error ? e.message : String(e) };
  } finally {
    if (running === run) { running = null; useComputeStore.getState().end(); }
  }
  const mask = result?.mask;
  if (!(mask instanceof Uint8Array) || mask.length !== n) {
    const got = ArrayBuffer.isView(mask) ? `${(mask as ArrayBufferView & { length?: number }).length ?? '?'} values` : typeof mask;
    return { ok: false, reason: 'bad-result', detail: `it returned ${got} — expected a Uint8Array of ${n} values (one per voxel of the box)` };
  }

  // What it writes: label 1 → the active member; or label k → the k-th new member, created
  // now (only those that receive voxels; removed again if the preview is discarded).
  const newMembers = manifest.writes.target === 'new' ? manifest.writes.newMembers ?? [] : [];
  const labels = manifest.writes.target === 'new' ? newMembers.length : 1;
  let over = 0;
  for (let i = 0; i < n; i++) if (mask[i] > labels) { over = mask[i]; break; }
  if (over) return { ok: false, reason: 'bad-result', detail: `its mask holds the value ${over} — expected 0${labels > 1 ? `–${labels}` : ' or 1'}` };
  const planes = Array.from({ length: labels }, (_, k) => Uint8Array.from(mask, (v) => (v === k + 1 ? 1 : 0)));

  const before = t.active;
  const outputs: Array<{ ref: MemberRef; mask: Uint8Array }> = [];
  const created: number[] = [];
  if (manifest.writes.target === 'new') {
    for (let k = 0; k < labels; k++) {
      postProcess(planes[k], box, manifest, { containerId: t.containerId, segmentIndex: -1 - k });
      if (!planes[k].includes(1)) continue;
      const idx = await segmentationManager.addSegment(t.containerId, newMembers[k].name);
      const [r, g, b] = newMembers[k].color;
      segmentationService.setSegmentColor(t.containerId, idx, [r, g, b, 255]);
      created.push(idx);
      outputs.push({ ref: { containerId: t.containerId, segmentIndex: idx }, mask: planes[k] });
      // Cornerstone's first render of a new member reports its labelmap as modified; staged
      // before that, the preview would take it for an edit under it and discard itself.
      await firstRender(t.containerId, idx, o.viewportId);
    }
  } else {
    const ref = { containerId: t.containerId, segmentIndex: t.active };
    postProcess(planes[0], box, manifest, ref);
    outputs.push({ ref, mask: planes[0] });
  }
  const undoNew = () => {
    if (!created.length) return;
    for (const idx of created) segmentationManager.removeSegment(t.containerId, idx);
    segmentationService.setActiveSegmentIndex(t.containerId, before);
  };
  if (!outputs.length) return { ok: false, reason: 'no-change' };

  const targets = new Set(outputs.map((x) => x.ref.segmentIndex));
  const locked = t.members.some((m) => targets.has(m.segmentIndex) && m.locked);
  const others = t.members.filter((m) => !targets.has(m.segmentIndex));
  const claimable = manifest.writes.claims ? others.filter((m) => !m.locked).map((m) => ({ containerId: t.containerId, segmentIndex: m.segmentIndex })) : [];
  const writers = [...outputs.map((x) => x.ref), ...claimable];
  let begun = beginTransaction(writers);
  let lockedMember: MemberRef | null = null;
  if (!begun.ok && begun.reason === 'locked') {
    lockedMember = begun.member;
    begun = beginTransaction(writers, undefined, { allowLocked: true });
  }
  if (!begun.ok) { undoNew(); return { ok: false, reason: 'no-target' }; }
  const { txn } = begun;
  const otherRefs = others.map((m) => ({ containerId: t.containerId, segmentIndex: m.segmentIndex }));
  let added = 0, removed = 0;
  for (const { ref: target, mask: m } of outputs) {
    forEachBoxVoxel(box, (i, flat) => {
      const on = m[i] === 1;
      const has = txn.has(target, flat);
      if (on && !has) {
        const owner = otherRefs.find((r) => txn.has(r, flat));
        if (owner) {
          if (!claimable.some((c) => c.segmentIndex === owner.segmentIndex)) return; // other members keep theirs
          txn.set(owner, flat, false);
        }
        txn.set(target, flat, true); added++;
      } else if (!on && has && manifest.writes.mode === 'replace') {
        txn.set(target, flat, false); removed++;
      }
    });
  }
  if (!added && !removed) { txn.discard(); undoNew(); return { ok: false, reason: 'no-change' }; }
  startPreview({
    txn, label: manifest.name, viewportId: o.viewportId, lockedMember: lockedMember ?? (locked ? outputs[0].ref : null),
    summary: `${added ? `+${added.toLocaleString('en-US')}` : ''}${added && removed ? ' ' : ''}${removed ? `−${removed.toLocaleString('en-US')}` : ''} voxels`,
    onDone: (committed) => { if (!committed) undoNew(); },
  });
  if (o.commit && !locked && !lockedMember) commitPreview();
  return { ok: true, added, removed, readOnly: locked || !!lockedMember, table: result.table };
}

/** Resolves once a just-created member has been rendered on the viewport (or after a while, regardless). */
function firstRender(containerId: string, segmentIndex: number, viewportId: string, timeoutMs = 2000): Promise<void> {
  const id = mlg.isMultiLayerGroup(containerId) ? mlg.resolveSubSegId(containerId, segmentIndex) : containerId;
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); eventTarget.removeEventListener(ToolEnums.Events.SEGMENTATION_RENDERED, onRendered); resolve(); };
    const onRendered = ((evt: CustomEvent<{ segmentationId?: string; viewportId?: string }>) => {
      if (evt.detail?.segmentationId === id && evt.detail?.viewportId === viewportId) done();
    }) as EventListener;
    const timer = setTimeout(() => { console.warn(`[moduleOperationService] ${id} was not rendered within ${timeoutMs} ms; staging anyway`); done(); }, timeoutMs);
    eventTarget.addEventListener(ToolEnums.Events.SEGMENTATION_RENDERED, onRendered);
  });
}

/** What a module operation tells the user, in its status line. */
export function describeModuleResult(r: ModuleOperationResult): string | null {
  if (r.ok) return r.readOnly ? 'The segment is locked — preview only' : null;
  switch (r.reason) {
    case 'no-target': return 'Select a segment first';
    case 'no-viewport': return 'Open the segment’s scan in this viewport';
    case 'no-roi': return 'Draw an ROI limit on this viewport, or pick another scope';
    case 'no-range': return 'Set the range of slices';
    case 'scope': return 'This module does not support that scope';
    case 'no-image': return 'The image under the segment is not available';
    case 'too-large': return r.detail ?? 'Too large — narrow the scope';
    case 'failed': return `The module failed: ${r.detail ?? 'see the log'}`;
    case 'bad-result': return `The module's result is not usable: ${r.detail}`;
    case 'no-change': return 'Nothing to change';
    default: return null;
  }
}
