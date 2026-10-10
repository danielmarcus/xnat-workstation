/**
 * Mask-operation preview (SegWorks parity D4; docs/mockup/segworks-wireframes.html §6).
 *
 * An operation stages its result in a LabelmapTransaction and hands it here. Nothing is
 * written until the user commits: the live labelmap keeps rendering as it is, and the
 * staged difference is drawn OVER it on every viewport showing the segment — voxels the
 * operation would ADD hatched in the segment's colour, voxels it would REMOVE dimmed,
 * both outlined dashed. Never blue (blue is selection) and never solid (solid is
 * committed). ⏎ commits as one undo step, ⎋ discards, and holding `\` hides the overlay
 * to compare against the current mask.
 *
 * A preview is a snapshot of one moment: if the labelmap changes underneath it (a brush
 * stroke, an undo) it is discarded rather than committed onto a state it was not
 * computed from.
 */
import { Enums as CoreEnums, eventTarget, getEnabledElementByViewportId } from '@cornerstonejs/core';
import { Enums as ToolEnums, segmentation as csSegmentation } from '@cornerstonejs/tools';
import * as mlg from './multiLayerGroup';
import type { LabelmapTransaction, MemberRef } from './labelmapTransaction';
import { warnMemberLocked } from '../annotations/lockWarning';
import type { SegmentVoxelGrid } from './segmentVoxelGrid';
import { sliceAxisFor } from './maskIslands';
import { indexToWorld, worldToIndex, type Vec3 } from './segmentationService/voxelClipboard';
import { type Axis, planeAxes } from '../segmentation/maskOps/planeIO';
import { hotkeyService } from '../hotkeys/hotkeyService';
import { useMaskPreviewStore } from '../../stores/maskPreviewStore';

const OVERLAY_TESTID = 'mask-preview-overlay';

interface Pending {
  txn: LabelmapTransaction;
  /** A locked member's preview: shown, never written. */
  lockedMember: MemberRef | null;
  csSegmentationIds: Set<string>;
  removeKeyLayer: () => void;
  onDone?: (committed: boolean) => void;
}

let pending: Pending | null = null;
let committing = false;
/** Per change: writes bucketed by axis → slice, built lazily (a volume op can stage a lot). */
const bucketCache = new WeakMap<ReadonlyMap<number, number>, Map<Axis, Map<number, number[]>>>();

export interface StartPreviewOptions {
  txn: LabelmapTransaction;
  label: string;
  summary: string;
  viewportId: string;
  /** Called once when the preview ends: true if committed, false if discarded. */
  onDone?: (committed: boolean) => void;
  /** The target is locked: the preview is read-only and commit is refused with the lock warning. */
  lockedMember?: MemberRef | null;
  /**
   * A live stroke (Smart Brush): the change is drawn as it grows, but there is no preview
   * bar and no ⏎ / ⎋ keys — the tool commits on release.
   */
  silent?: boolean;
}

/** Show a staged transaction as a preview. Replaces (discards) any preview already open. */
export function startPreview(o: StartPreviewOptions): void {
  if (pending) discardPreview();
  if (o.txn.isEmpty) {
    o.txn.discard();
    o.onDone?.(false);
    return;
  }
  const removeKeyLayer = o.silent ? () => {} : hotkeyService.pushKeyLayer({
    onKeyDown: (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (e.key === 'Enter') { commitPreview(); return true; }
      if (e.key === 'Escape') { discardPreview(); return true; }
      if (e.key === '\\') { setComparing(true); return true; }
      return false;
    },
    onKeyUp: (e) => {
      if (e.key !== '\\') return false;
      setComparing(false);
      return true;
    },
  });
  pending = {
    txn: o.txn,
    lockedMember: o.lockedMember ?? null,
    csSegmentationIds: new Set(o.txn.changes().map((c) => c.grid.csSegmentationId)),
    removeKeyLayer,
    onDone: o.onDone,
  };
  installDataWatch();
  if (!o.silent) {
    useMaskPreviewStore.setState({
      active: true, label: o.label, summary: o.summary, viewportId: o.viewportId, comparing: false, readOnly: !!o.lockedMember,
    });
  }
  render();
}

/** Redraw the pending preview after its transaction grew (a live stroke). */
export function refreshPreview(): void {
  if (!pending) return;
  for (const c of pending.txn.changes()) pending.csSegmentationIds.add(c.grid.csSegmentationId);
  render();
}

export function hasPreview(): boolean {
  return pending !== null;
}

/** Write the previewed edit (one undo step). Returns false if there was no preview. */
export function commitPreview(): boolean {
  const p = pending;
  if (!p) return false;
  if (p.lockedMember) {
    warnMemberLocked(p.lockedMember.containerId, p.lockedMember.segmentIndex, 'change it');
    return false;
  }
  end();
  committing = true;
  try {
    p.txn.commit();
  } finally {
    committing = false;
  }
  p.onDone?.(true);
  return true;
}

export function discardPreview(): void {
  const p = pending;
  if (!p) return;
  end();
  p.txn.discard();
  p.onDone?.(false);
}

export function setComparing(comparing: boolean): void {
  if (!pending || useMaskPreviewStore.getState().comparing === comparing) return;
  useMaskPreviewStore.setState({ comparing });
  render();
}

function end(): void {
  pending?.removeKeyLayer();
  pending = null;
  useMaskPreviewStore.setState({ active: false, label: '', summary: '', viewportId: null, comparing: false, readOnly: false });
  render();
}

// ─── Stale-preview guard ─────────────────────────────────────────────────────

let watching = false;
function installDataWatch(): void {
  if (watching) return;
  watching = true;
  eventTarget.addEventListener(ToolEnums.Events.SEGMENTATION_DATA_MODIFIED, ((evt: CustomEvent) => {
    if (!pending || committing) return;
    const id = (evt.detail as { segmentationId?: string } | undefined)?.segmentationId;
    if (id && pending.csSegmentationIds.has(id)) {
      console.warn('[maskPreview] labelmap changed under the preview; discarding it');
      discardPreview();
    }
  }) as EventListener);
}

// ─── Overlay ─────────────────────────────────────────────────────────────────

type Viewport = {
  element: HTMLDivElement;
  getCamera: () => { viewPlaneNormal?: number[]; focalPoint?: number[] };
  worldToCanvas: (p: number[]) => [number, number];
};

const listening = new WeakSet<HTMLElement>();

function viewportOf(id: string): Viewport | null {
  try {
    return (getEnabledElementByViewportId(id)?.viewport as unknown as Viewport) ?? null;
  } catch {
    return null;
  }
}

function overlayFor(viewport: Viewport): SVGSVGElement {
  const host = (viewport.element.querySelector('.svg-layer')?.parentElement ?? viewport.element) as HTMLElement;
  let svg = host.querySelector(`svg[data-testid="${OVERLAY_TESTID}"]`) as SVGSVGElement | null;
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-testid', OVERLAY_TESTID);
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;overflow:visible';
    host.appendChild(svg);
  }
  if (!listening.has(viewport.element)) {
    listening.add(viewport.element);
    viewport.element.addEventListener(CoreEnums.Events.IMAGE_RENDERED, () => render());
  }
  return svg;
}

function colorOf(viewportId: string, containerId: string, segmentIndex: number): [number, number, number] {
  const sub = mlg.isMultiLayerGroup(containerId) ? mlg.resolveSubSegId(containerId, segmentIndex) : containerId;
  const value = mlg.isMultiLayerGroup(containerId) ? 1 : segmentIndex;
  try {
    const c = sub ? csSegmentation.config.color.getSegmentIndexColor(viewportId, sub, value) : null;
    if (c) return [c[0], c[1], c[2]];
  } catch { /* fall through */ }
  return [255, 255, 255];
}

function bucketsFor(writes: ReadonlyMap<number, number>, dims: ArrayLike<number>, axis: Axis): Map<number, number[]> {
  let byAxis = bucketCache.get(writes);
  if (!byAxis) {
    byAxis = new Map();
    bucketCache.set(writes, byAxis);
  }
  let buckets = byAxis.get(axis);
  if (buckets) return buckets;
  buckets = new Map();
  const nx = dims[0];
  const nxy = dims[0] * dims[1];
  for (const flat of writes.keys()) {
    const k = Math.floor(flat / nxy);
    const j = Math.floor((flat - k * nxy) / nx);
    const i = flat - k * nxy - j * nx;
    const slice = axis === 0 ? i : axis === 1 ? j : k;
    let list = buckets.get(slice);
    if (!list) buckets.set(slice, (list = []));
    list.push(flat);
  }
  byAxis.set(axis, buckets);
  return buckets;
}

/** Plane coordinates of a flat index on a slice along `axis`. */
function planeXY(flat: number, dims: ArrayLike<number>, axis: Axis): [number, number] {
  const nx = dims[0];
  const nxy = dims[0] * dims[1];
  const k = Math.floor(flat / nxy);
  const j = Math.floor((flat - k * nxy) / nx);
  const i = flat - k * nxy - j * nx;
  const ijk = [i, j, k];
  const [ax, ay] = planeAxes(axis);
  return [ijk[ax], ijk[ay]];
}

/**
 * SVG path for a set of plane pixels on one slice: filled runs (one quad per horizontal
 * run) and the boundary edges, both mapped through world space so rotated and oblique
 * views draw correctly.
 */
function pathsFor(
  pixels: Array<[number, number]>,
  grid: SegmentVoxelGrid,
  axis: Axis,
  slice: number,
  vp: Viewport,
): { fill: string; outline: string } {
  const [ax, ay] = planeAxes(axis);
  const toCanvas = (x: number, y: number): string => {
    const ijk: Vec3 = [0, 0, 0];
    ijk[axis] = slice;
    ijk[ax] = x;
    ijk[ay] = y;
    const [cx, cy] = vp.worldToCanvas(indexToWorld(grid.geometry, ijk));
    return `${cx.toFixed(1)} ${cy.toFixed(1)}`;
  };
  const set = new Set(pixels.map(([x, y]) => `${x},${y}`));
  const rows = new Map<number, number[]>();
  for (const [x, y] of pixels) {
    let r = rows.get(y);
    if (!r) rows.set(y, (r = []));
    r.push(x);
  }
  let fill = '';
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    let start = xs[0];
    let prev = xs[0];
    const flush = () => {
      fill += `M${toCanvas(start - 0.5, y - 0.5)}L${toCanvas(prev + 0.5, y - 0.5)}L${toCanvas(prev + 0.5, y + 0.5)}L${toCanvas(start - 0.5, y + 0.5)}Z`;
    };
    for (let n = 1; n < xs.length; n++) {
      if (xs[n] === prev + 1) { prev = xs[n]; continue; }
      flush();
      start = prev = xs[n];
    }
    flush();
  }
  let outline = '';
  for (const [x, y] of pixels) {
    if (!set.has(`${x - 1},${y}`)) outline += `M${toCanvas(x - 0.5, y - 0.5)}L${toCanvas(x - 0.5, y + 0.5)}`;
    if (!set.has(`${x + 1},${y}`)) outline += `M${toCanvas(x + 0.5, y - 0.5)}L${toCanvas(x + 0.5, y + 0.5)}`;
    if (!set.has(`${x},${y - 1}`)) outline += `M${toCanvas(x - 0.5, y - 0.5)}L${toCanvas(x + 0.5, y - 0.5)}`;
    if (!set.has(`${x},${y + 1}`)) outline += `M${toCanvas(x - 0.5, y + 0.5)}L${toCanvas(x + 0.5, y + 0.5)}`;
  }
  return { fill, outline };
}

function hatchPattern(svg: SVGSVGElement, rgb: [number, number, number]): string {
  const id = `mask-preview-hatch-${rgb.join('-')}`;
  if (!svg.querySelector(`#${id}`)) {
    let defs = svg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svg.prepend(defs);
    }
    const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
    pattern.setAttribute('id', id);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('width', '6');
    pattern.setAttribute('height', '6');
    pattern.setAttribute('patternTransform', 'rotate(45)');
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '6');
    bg.setAttribute('height', '6');
    bg.setAttribute('fill', `rgba(${rgb.join(',')},0.12)`);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    line.setAttribute('width', '3');
    line.setAttribute('height', '6');
    line.setAttribute('fill', `rgba(${rgb.join(',')},0.55)`);
    pattern.append(bg, line);
    defs.appendChild(pattern);
  }
  return `url(#${id})`;
}

function render(): void {
  for (const svg of Array.from(document.querySelectorAll(`svg[data-testid="${OVERLAY_TESTID}"]`))) {
    svg.replaceChildren();
    svg.removeAttribute('data-added');
    svg.removeAttribute('data-removed');
  }
  if (!pending || useMaskPreviewStore.getState().comparing) return;

  for (const { grid, member, writes } of pending.txn.changes()) {
    const flatStorage = !mlg.isMultiLayerGroup(member.containerId);
    for (const viewportId of csSegmentation.state.getViewportIdsWithSegmentation(grid.csSegmentationId)) {
      const vp = viewportOf(viewportId);
      const cam = vp?.getCamera();
      if (!vp || !cam?.viewPlaneNormal || !cam.focalPoint) continue;
      const axis = sliceAxisFor(grid.geometry.direction, cam.viewPlaneNormal) as Axis;
      const slice = worldToIndex(grid.geometry, cam.focalPoint as Vec3)[axis];
      const flats = bucketsFor(writes, grid.geometry.dimensions, axis).get(slice);
      const svg = overlayFor(vp);
      if (!flats?.length) continue;

      // Group by (segment, added/removed): each group is one coloured path pair.
      const groups = new Map<string, { seg: number; added: boolean; px: Array<[number, number]> }>();
      for (const flat of flats) {
        const next = writes.get(flat)!;
        const added = next !== 0;
        const seg = flatStorage ? (added ? next : grid.data[flat]) : member.segmentIndex;
        const key = `${seg}|${added}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { seg, added, px: [] }));
        g.px.push(planeXY(flat, grid.geometry.dimensions, axis));
      }
      let addedCount = Number(svg.getAttribute('data-added') ?? 0);
      let removedCount = Number(svg.getAttribute('data-removed') ?? 0);
      for (const g of groups.values()) {
        const rgb = colorOf(viewportId, member.containerId, g.seg);
        const { fill, outline } = pathsFor(g.px, grid, axis, slice, vp);
        const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        area.setAttribute('d', fill);
        area.setAttribute('fill', g.added ? hatchPattern(svg, rgb) : 'rgba(0,0,0,0.55)');
        area.setAttribute('data-preview', g.added ? 'added' : 'removed');
        const edge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        edge.setAttribute('d', outline);
        edge.setAttribute('fill', 'none');
        edge.setAttribute('stroke', `rgb(${rgb.join(',')})`);
        edge.setAttribute('stroke-width', '1.5');
        edge.setAttribute('stroke-dasharray', '4 3');
        svg.append(area, edge);
        if (g.added) addedCount += g.px.length;
        else removedCount += g.px.length;
      }
      svg.setAttribute('data-added', String(addedCount));
      svg.setAttribute('data-removed', String(removedCount));
    }
  }
}
