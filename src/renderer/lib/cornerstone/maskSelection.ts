/**
 * Selected mask islands (unified selection S4 — docs/unified-selection.md).
 *
 * The Segmentation counterpart of a selected contour: one or more islands (connected
 * painted regions, see maskIslands) of ONE segment, on the current slice of one
 * viewport. Cornerstone has no notion of a selected labelmap region, so the selection is
 * held here and drawn as an outline over the viewport (an SVG overlay, redrawn on every
 * render of that viewport).
 *
 * The rules that clear it (slice change, active-member change) live in
 * componentSelection; the Select tool calls selectMaskIslandAt.
 */
import { Enums as CoreEnums, getEnabledElementByViewportId } from '@cornerstonejs/core';
import { segmentation as csSegmentation } from '@cornerstonejs/tools';
import * as mlg from './multiLayerGroup';
import { readSegmentVoxelGrid, type SegmentVoxelGrid } from './segmentVoxelGrid';
import { worldToIndex } from './segmentationService/voxelClipboard';
import { islandAt, islandOutline, sliceAxisFor } from './maskIslands';
import { SELECTED_EXTRA_WIDTH } from './selectedStyle';
import { useAnnotationSelectionStore } from '../../stores/annotationSelectionStore';

export interface SelectedIsland {
  /** Flat grid indices of the island's voxels. */
  voxels: number[];
  /** World-space outline segments ([x0,y0,z0, x1,y1,z1, …]). */
  outline: number[];
}

export interface MaskSelection {
  viewportId: string;
  /** The container (multi-layer group or flat segmentation) and segment. */
  containerId: string;
  segmentIndex: number;
  /** Grid axis the slice is taken along, and the slice's index on it. */
  axis: 0 | 1 | 2;
  slice: number;
  islands: SelectedIsland[];
}

type Viewport = {
  element: HTMLDivElement;
  getCamera: () => { viewPlaneNormal?: number[] };
  worldToCanvas: (p: number[]) => [number, number];
};

const OUTLINE_TESTID = 'mask-selection-outline';
let current: MaskSelection | null = null;
/** World offset the outline is drawn at while a move is being dragged (a preview). */
let previewDelta: [number, number, number] | null = null;
/** Starts a drag-move of the selected islands (injected by unifiedSegService — S9). */
let islandMoveStarter: ((element: HTMLDivElement, onClickWithoutMove?: () => void) => void) | null = null;

export function setIslandMoveStarter(fn: (element: HTMLDivElement, onClickWithoutMove?: () => void) => void): void {
  islandMoveStarter = fn;
}

/** Draw the selection outline offset by `delta` (null = where the islands are). */
export function setMaskPreviewDelta(delta: [number, number, number] | null): void {
  previewDelta = delta;
  render();
}
let activateMember: ((containerId: string, segmentIndex: number) => void) | null = null;
const listening = new WeakSet<HTMLElement>();

/** How the panel follows a selection made on the image (injected by segmentationService,
 *  which owns activation — a static import would be a cycle). */
export function setMaskMemberActivator(fn: (containerId: string, segmentIndex: number) => void): void {
  activateMember = fn;
}

export function getMaskSelection(): MaskSelection | null {
  return current;
}

export function clearMaskSelection(): void {
  if (!current) return;
  current = null;
  render();
}

function viewportOf(viewportId: string): Viewport | null {
  return ((getEnabledElementByViewportId(viewportId) as unknown as { viewport?: Viewport } | undefined)?.viewport) ?? null;
}

/** Every (container, segment) with a labelmap on this viewport — the active member first. */
function candidatesOn(viewportId: string): Array<{ containerId: string; segmentIndex: number }> {
  const out: Array<{ containerId: string; segmentIndex: number }> = [];
  const shownHere = (segId: string) => csSegmentation.state.getViewportIdsWithSegmentation(segId).includes(viewportId);
  for (const [groupId, slots] of mlg.iterateGroups()) {
    slots.forEach((sub, i) => {
      if (sub && shownHere(sub)) out.push({ containerId: groupId, segmentIndex: i + 1 });
    });
  }
  const reps = (csSegmentation.state.getSegmentationRepresentations(viewportId) ?? []) as Array<{ segmentationId: string; type?: string }>;
  for (const rep of reps) {
    if (rep.type !== 'Labelmap' || mlg.getGroupInfoForSubSeg(rep.segmentationId) || mlg.isMultiLayerGroup(rep.segmentationId)) continue;
    const seg = csSegmentation.state.getSegmentation(rep.segmentationId) as { segments?: Record<string, unknown> } | undefined;
    for (const key of Object.keys(seg?.segments ?? {})) {
      const segmentIndex = Number(key);
      if (segmentIndex > 0) out.push({ containerId: rep.segmentationId, segmentIndex });
    }
  }
  const active = useAnnotationSelectionStore.getState().activeMember;
  return out.sort((a, b) => Number(isActive(b, active)) - Number(isActive(a, active)));
}

function isActive(c: { containerId: string; segmentIndex: number }, active: { containerId: string; memberId: string } | null): boolean {
  return !!active && active.containerId === c.containerId && active.memberId === String(c.segmentIndex);
}

/** The island under a world point on this viewport, or null. */
function islandUnder(viewportId: string, world: number[]) {
  const viewport = viewportOf(viewportId);
  const normal = viewport?.getCamera().viewPlaneNormal;
  if (!viewport || !normal) return null;
  for (const c of candidatesOn(viewportId)) {
    const grid = readSegmentVoxelGrid(c.containerId, c.segmentIndex);
    if (!grid) continue;
    const dims = grid.geometry.dimensions;
    const ijk = worldToIndex(grid.geometry, world as [number, number, number]);
    if (ijk.some((v, a) => v < 0 || v >= dims[a])) continue;
    const seed = ijk[0] + ijk[1] * dims[0] + ijk[2] * dims[0] * dims[1];
    if (grid.data[seed] !== grid.value) continue;
    const axis = sliceAxisFor(grid.geometry.direction, normal);
    const voxels = islandAt(grid, seed, axis);
    return { ...c, grid, axis, slice: ijk[axis], seed, voxels };
  }
  return null;
}

/**
 * The Select tool's mask click. Returns false when there is no island under the point.
 * A plain click selects the island (and makes its segment the active member); Shift adds
 * or removes an island of the same segment on the same slice.
 */
export function selectMaskIslandAt(viewportId: string, world: number[], shift: boolean, element?: HTMLDivElement): boolean {
  const hit = islandUnder(viewportId, world);
  if (!hit) return false;
  const island: SelectedIsland = { voxels: hit.voxels, outline: islandOutline(hit.grid, hit.voxels, hit.axis) };
  const same = current
    && current.viewportId === viewportId
    && current.containerId === hit.containerId
    && current.segmentIndex === hit.segmentIndex
    && current.axis === hit.axis
    && current.slice === hit.slice;
  const at = same ? current!.islands.findIndex((i) => i.voxels.includes(hit.seed)) : -1;
  let narrow: (() => void) | undefined;
  if (shift && same) {
    if (at >= 0) current!.islands.splice(at, 1);
    else current!.islands.push(island);
    if (current!.islands.length === 0) current = null;
  } else if (at >= 0) {
    // A press on one of the selected islands keeps the group so it can be dragged; a
    // click without a drag narrows the selection to this island.
    if (current!.islands.length > 1) {
      const keep = current!.islands[at];
      narrow = () => {
        if (current) {
          current.islands = [keep];
          render();
        }
      };
    }
  } else {
    current = { viewportId, containerId: hit.containerId, segmentIndex: hit.segmentIndex, axis: hit.axis, slice: hit.slice, islands: [island] };
  }
  // Set before activating: the active-member rule keeps a selection of the new member.
  activateMember?.(hit.containerId, hit.segmentIndex);
  render();
  // The press can drag the selection (S9) when it is on a selected island.
  if (element && current?.islands.some((i) => i.voxels.includes(hit.seed))) islandMoveStarter?.(element, narrow);
  return true;
}

/**
 * Select the islands containing these voxels (a paste's result), on a viewport: the
 * pasted region ends up selected, as a pasted contour does.
 */
export function selectIslandsContaining(viewportId: string, containerId: string, segmentIndex: number, voxels: number[]): void {
  const viewport = viewportOf(viewportId);
  const normal = viewport?.getCamera().viewPlaneNormal;
  const grid = readSegmentVoxelGrid(containerId, segmentIndex);
  if (!viewport || !normal || !grid || voxels.length === 0) return;
  const axis = sliceAxisFor(grid.geometry.direction, normal);
  const dims = grid.geometry.dimensions;
  const sliceOf = (flat: number) => {
    const k = Math.floor(flat / (dims[0] * dims[1]));
    const rem = flat - k * dims[0] * dims[1];
    const j = Math.floor(rem / dims[0]);
    return [rem - j * dims[0], j, k][axis];
  };
  const covered = new Set<number>();
  const islands: SelectedIsland[] = [];
  for (const flat of voxels) {
    if (covered.has(flat) || grid.data[flat] !== grid.value) continue;
    const island = islandAt(grid, flat, axis);
    island.forEach((v) => covered.add(v));
    islands.push({ voxels: island, outline: islandOutline(grid, island, axis) });
  }
  if (islands.length === 0) return;
  current = { viewportId, containerId, segmentIndex, axis, slice: sliceOf(islands[0].voxels[0]), islands };
  render();
}

/** The grid of the selected segment (fresh read — the labelmap may have changed). */
export function selectedGrid(): SegmentVoxelGrid | null {
  return current ? readSegmentVoxelGrid(current.containerId, current.segmentIndex) : null;
}

// ─── Outline overlay ──────────────────────────────────────────────────────────

function overlayFor(viewport: Viewport): SVGSVGElement {
  const host = (viewport.element.querySelector('.svg-layer')?.parentElement ?? viewport.element) as HTMLElement;
  let svg = host.querySelector(`svg[data-testid="${OUTLINE_TESTID}"]`) as SVGSVGElement | null;
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-testid', OUTLINE_TESTID);
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;overflow:visible';
    host.appendChild(svg);
  }
  if (!listening.has(viewport.element)) {
    listening.add(viewport.element);
    viewport.element.addEventListener(CoreEnums.Events.IMAGE_RENDERED, () => render());
  }
  return svg;
}

function colorOf(sel: MaskSelection): string {
  const sub = mlg.isMultiLayerGroup(sel.containerId) ? mlg.resolveSubSegId(sel.containerId, sel.segmentIndex) : sel.containerId;
  const value = mlg.isMultiLayerGroup(sel.containerId) ? 1 : sel.segmentIndex;
  try {
    const c = sub ? csSegmentation.config.color.getSegmentIndexColor(sel.viewportId, sub, value) : null;
    if (c) return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  } catch { /* fall through */ }
  return 'rgb(255, 255, 255)';
}

function render(): void {
  for (const svg of Array.from(document.querySelectorAll(`svg[data-testid="${OUTLINE_TESTID}"]`))) {
    svg.replaceChildren();
  }
  if (!current) return;
  const viewport = viewportOf(current.viewportId);
  if (!viewport) return;
  const svg = overlayFor(viewport);
  const color = colorOf(current);
  for (const island of current.islands) {
    const o = island.outline;
    let d = '';
    const [dx, dy, dz] = previewDelta ?? [0, 0, 0];
    for (let s = 0; s < o.length; s += 6) {
      const [x0, y0] = viewport.worldToCanvas([o[s] + dx, o[s + 1] + dy, o[s + 2] + dz]);
      const [x1, y1] = viewport.worldToCanvas([o[s + 3] + dx, o[s + 4] + dy, o[s + 5] + dz]);
      d += `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`;
    }
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(1 + SELECTED_EXTRA_WIDTH));
    path.setAttribute('stroke-linecap', 'square');
    svg.appendChild(path);
  }
}
