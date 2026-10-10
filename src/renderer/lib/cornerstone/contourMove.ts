/**
 * Drag to move selected contours (unified selection S8 — docs/unified-selection.md).
 *
 * Cornerstone moves a whole contour only on its spline / livewire tools
 * (ContourBaseTool.moveAnnotation shifts control points, which a freehand contour's
 * polyline does not follow), and v5 turns every finished contour into a freehand one. So
 * the Select tool moves contours itself: every point of the polyline, the control points
 * (a spline's outline is rebuilt from them) and any holes, by Cornerstone's in-plane
 * world delta of each drag event. The move is one undo step, and ends with an
 * annotation-modified event so autosave, interpolation and the dirty state follow.
 *
 * A locked member's contours never move: a real drag is refused with the lock warning (a
 * plain click on them still just selects).
 */
import { utilities as csUtilities } from '@cornerstonejs/core';
import {
  annotation as csAnnotation,
  segmentation as csSegmentation,
  Enums as ToolEnums,
  utilities as csToolUtilities,
} from '@cornerstonejs/tools';
import { warnMemberLocked } from '../annotations/lockWarning';

type Vec = [number, number, number];

interface MovableContour {
  annotationUID: string;
  isLocked?: boolean;
  childAnnotationUIDs?: string[];
  data?: {
    contour?: { polyline?: number[][] };
    handles?: { points?: number[][] };
    segmentation?: { segmentationId?: string; segmentIndex?: number };
  };
}

const get = (uid: string) => csAnnotation.state.getAnnotation(uid) as unknown as MovableContour | undefined;

function shift(points: number[][] | undefined, d: Vec): void {
  for (const p of points ?? []) {
    p[0] += d[0];
    p[1] += d[1];
    p[2] += d[2];
  }
}

/** Translate a contour (and its holes) by a world delta. */
function translate(a: MovableContour, d: Vec): void {
  shift(a.data?.contour?.polyline, d);
  shift(a.data?.handles?.points, d);
  (a as { invalidated?: boolean }).invalidated = true;
  for (const child of a.childAnnotationUIDs ?? []) {
    const c = get(child);
    if (c) translate(c, d);
  }
}

function lockedMember(a: MovableContour): { segmentationId: string; segmentIndex: number } | null {
  const seg = a.data?.segmentation;
  const segmentIndex = Number(seg?.segmentIndex);
  if (!seg?.segmentationId || !Number.isInteger(segmentIndex)) return null;
  const locked = !!a.isLocked || csSegmentation.segmentLocking.isSegmentIndexLocked(seg.segmentationId, segmentIndex);
  return locked ? { segmentationId: seg.segmentationId, segmentIndex } : null;
}

function render(element: HTMLDivElement): void {
  const viewportIds = (csToolUtilities as unknown as {
    viewportFilters?: { getViewportIdsWithToolToRender?: (el: HTMLDivElement, tool: string) => string[] };
  }).viewportFilters?.getViewportIdsWithToolToRender?.(element, 'PlanarFreehandContourSegmentationTool');
  const trigger = (csToolUtilities as unknown as { triggerAnnotationRenderForViewportIds?: (ids: string[]) => void })
    .triggerAnnotationRenderForViewportIds;
  const ids = viewportIds?.length ? viewportIds : csSegmentationViewportIds();
  if (trigger && ids.length) trigger(ids);
}

function csSegmentationViewportIds(): string[] {
  const out = new Set<string>();
  for (const uid of csAnnotation.selection.getAnnotationsSelected() ?? []) {
    const segId = get(uid)?.data?.segmentation?.segmentationId;
    if (segId) for (const vp of csSegmentation.state.getViewportIdsWithSegmentation(segId)) out.add(vp);
  }
  return Array.from(out);
}

function modified(uids: string[], element: HTMLDivElement): void {
  const trigger = (csAnnotation.state as unknown as {
    triggerAnnotationModified?: (a: unknown, el?: HTMLDivElement) => void;
  }).triggerAnnotationModified;
  for (const uid of uids) {
    const a = get(uid);
    if (a && trigger) trigger(a, element);
  }
}

/**
 * Start a move of `uids` from a press on `element`. Drag events move them; the release
 * ends it. `onClickWithoutMove` runs when the press is released without a drag (e.g. to
 * narrow a multi-selection to the one clicked).
 */
export function beginContourMove(element: HTMLDivElement, uids: string[], onClickWithoutMove?: () => void): void {
  const contours = uids.map(get).filter((a): a is MovableContour => !!a);
  if (contours.length === 0) return;
  const locked = contours.map(lockedMember).find((m) => m !== null) ?? null;
  const total: Vec = [0, 0, 0];
  let moved = false;
  let refused = false;

  const onDrag = (evt: Event) => {
    const d = (evt as CustomEvent<{ deltaPoints?: { world?: number[] } }>).detail?.deltaPoints?.world;
    if (!d) return;
    if (locked) {
      if (!refused) warnMemberLocked(locked.segmentationId, locked.segmentIndex, 'move it');
      refused = true;
      return;
    }
    const delta: Vec = [d[0], d[1], d[2]];
    for (const a of contours) translate(a, delta);
    total[0] += delta[0];
    total[1] += delta[1];
    total[2] += delta[2];
    moved = true;
    render(element);
  };

  const onUp = () => {
    element.removeEventListener(ToolEnums.Events.MOUSE_DRAG, onDrag);
    element.removeEventListener(ToolEnums.Events.MOUSE_UP, onUp);
    element.removeEventListener(ToolEnums.Events.MOUSE_CLICK, onUp);
    if (!moved) {
      if (!refused) onClickWithoutMove?.();
      return;
    }
    const ids = contours.map((a) => a.annotationUID);
    pushMoveMemo(ids, [...total] as Vec, element);
    modified(ids, element);
  };

  element.addEventListener(ToolEnums.Events.MOUSE_DRAG, onDrag);
  element.addEventListener(ToolEnums.Events.MOUSE_UP, onUp);
  element.addEventListener(ToolEnums.Events.MOUSE_CLICK, onUp);
}

/** One undo step: undo moves back by the total, redo moves forward again. */
function pushMoveMemo(uids: string[], total: Vec, element: HTMLDivElement): void {
  const first = get(uids[0])?.data?.segmentation;
  const ring = (csUtilities as unknown as { HistoryMemo?: { DefaultHistoryMemo?: { push?: (m: unknown) => void } } })
    .HistoryMemo?.DefaultHistoryMemo;
  ring?.push?.({
    id: `move-${uids[0]}-${Date.now()}`,
    operationType: 'annotation',
    segmentationId: first?.segmentationId,
    segmentIndex: Number(first?.segmentIndex),
    restoreMemo: (isUndo = true) => {
      const d: Vec = isUndo ? [-total[0], -total[1], -total[2]] : [...total] as Vec;
      for (const uid of uids) {
        const a = get(uid);
        if (a) translate(a, d);
      }
      render(element);
      modified(uids, element);
    },
  });
}
