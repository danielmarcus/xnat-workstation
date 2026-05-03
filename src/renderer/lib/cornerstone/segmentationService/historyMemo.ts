/**
 * History-memo subsystem for the segmentation service.
 *
 * Wraps Cornerstone3D's `DefaultHistoryMemo` ring buffer with:
 *   - install/uninstall hooks that intercept every `push` to enrich entries
 *     with segmentation-id / segment-index / human-readable label fields
 *     (so they survive even when the originating tool didn't supply them)
 *   - peek functions for the top undo / redo entries
 *   - a "blocked by lock" check for entries whose target segment is locked,
 *     plus the dialog that surfaces the block to the user
 *
 * Extracted from segmentationService.ts (Phase 0.5.A). No logic changes.
 *
 * The orchestrator imports the install/uninstall + peek + lock-check
 * functions; bodies live here. `DefaultHistoryMemo` is re-derived locally
 * in this module rather than passed in — it's a Cornerstone singleton,
 * so deriving it twice is equivalent to passing it.
 */
import { utilities as csUtilities } from '@cornerstonejs/core';
import { annotation as csAnnotation, segmentation as csSegmentation } from '@cornerstonejs/tools';
import { showAlertDialog } from '../../../stores/dialogStore';
import * as mlg from '../multiLayerGroup';
import * as containerBridge from '../containerBridge';
import { undoService } from '../undoService';
import { usePreferencesStore } from '../../../stores/preferencesStore';
import type { HistoryEntry } from '../../../types/annotation';

/**
 * Cornerstone3D's built-in undo/redo ring buffer.
 * All segmentation/contour tools automatically push memos here via BaseTool.doneEditMemo().
 */
const { DefaultHistoryMemo } = (csUtilities as any).HistoryMemo;

// ─── Types ───────────────────────────────────────────────────────

export type HistoryMemoRecord = {
  restoreMemo?: (undo?: boolean) => void;
  id?: string;
  operationType?: string;
  segmentationId?: string;
  segmentIndex?: number;
  label?: string;
  createMemo?: () => HistoryMemoRecord | undefined;
};

export type HistoryMemoEntry = HistoryMemoRecord | HistoryMemoRecord[] | undefined;

export type LockableHistoryTarget = {
  segmentationId: string;
  segmentIndex: number;
  label: string;
};

// ─── Module-state ────────────────────────────────────────────────

let originalHistoryPush: ((item: unknown) => HistoryMemoRecord | undefined) | null = null;
let historyTrackingInstalled = false;

// ─── Helpers ─────────────────────────────────────────────────────

export function getSegmentDisplayLabel(segmentationId: string, segmentIndex: number): string {
  if (mlg.isMultiLayerGroup(segmentationId)) {
    return mlg.getSegmentMetaMap(segmentationId)?.get(segmentIndex)?.label ?? `Segment ${segmentIndex}`;
  }

  const segmentation = csSegmentation.state.getSegmentation(segmentationId) as
    | { segments?: Record<number, { label?: string }> }
    | undefined;
  return segmentation?.segments?.[segmentIndex]?.label ?? `Segment ${segmentIndex}`;
}

export function isSegmentLockedInternal(segmentationId: string, segmentIndex: number): boolean {
  if (mlg.isMultiLayerGroup(segmentationId)) {
    const subSegId = mlg.resolveSubSegId(segmentationId, segmentIndex);
    if (!subSegId) return false;
    try {
      return csSegmentation.segmentLocking.isSegmentIndexLocked(subSegId, 1);
    } catch {
      return false;
    }
  }

  try {
    return csSegmentation.segmentLocking.isSegmentIndexLocked(segmentationId, segmentIndex);
  } catch {
    return false;
  }
}

function toHistoryMemoRecords(entry: HistoryMemoEntry): HistoryMemoRecord[] {
  if (!entry) return [];
  if (Array.isArray(entry)) {
    return entry.filter((memo): memo is HistoryMemoRecord => !!memo && typeof memo === 'object');
  }
  return typeof entry === 'object' ? [entry] : [];
}

function getHistoryRingSize(): number {
  const explicitSize = Number(DefaultHistoryMemo?.size);
  if (Number.isInteger(explicitSize) && explicitSize > 0) {
    return explicitSize;
  }
  const ringLength = Array.isArray(DefaultHistoryMemo?.ring) ? DefaultHistoryMemo.ring.length : 0;
  return ringLength > 0 ? ringLength : 0;
}

export function getTopUndoHistoryEntry(): HistoryMemoEntry {
  if (!DefaultHistoryMemo?.canUndo || !Array.isArray(DefaultHistoryMemo?.ring)) {
    return undefined;
  }

  const size = getHistoryRingSize();
  const position = Number(DefaultHistoryMemo.position);
  if (!Number.isInteger(position) || size <= 0) {
    return undefined;
  }

  const normalizedPosition = ((position % size) + size) % size;
  return DefaultHistoryMemo.ring[normalizedPosition] as HistoryMemoEntry;
}

export function getTopRedoHistoryEntry(): HistoryMemoEntry {
  if (!DefaultHistoryMemo?.canRedo || !Array.isArray(DefaultHistoryMemo?.ring)) {
    return undefined;
  }

  const size = getHistoryRingSize();
  const position = Number(DefaultHistoryMemo.position);
  if (!Number.isInteger(position) || size <= 0) {
    return undefined;
  }

  const nextPosition = (position + 1 + size) % size;
  return DefaultHistoryMemo.ring[nextPosition] as HistoryMemoEntry;
}

function enrichHistoryMemoRecord(memo: unknown): void {
  if (!memo || typeof memo !== 'object') return;

  const record = memo as HistoryMemoRecord;
  if (
    typeof record.segmentationId === 'string'
    && Number.isInteger(record.segmentIndex)
    && Number(record.segmentIndex) > 0
  ) {
    record.label = record.label || getSegmentDisplayLabel(record.segmentationId, Number(record.segmentIndex));
    return;
  }

  if (record.operationType !== 'annotation' || typeof record.id !== 'string') {
    return;
  }

  const annotation = csAnnotation.state.getAnnotation?.(record.id) as
    | { data?: { segmentation?: { segmentationId?: string; segmentIndex?: number } } }
    | undefined;
  const segmentationId = annotation?.data?.segmentation?.segmentationId;
  const segmentIndex = Number(annotation?.data?.segmentation?.segmentIndex);
  if (typeof segmentationId !== 'string' || !Number.isInteger(segmentIndex) || segmentIndex <= 0) {
    return;
  }

  record.segmentationId = segmentationId;
  record.segmentIndex = segmentIndex;
  record.label = getSegmentDisplayLabel(segmentationId, segmentIndex);
}

export function getLockedHistoryTargets(entry: HistoryMemoEntry): LockableHistoryTarget[] {
  const deduped = new Map<string, LockableHistoryTarget>();

  for (const memo of toHistoryMemoRecords(entry)) {
    enrichHistoryMemoRecord(memo);
    const segmentationId = memo.segmentationId;
    const segmentIndex = Number(memo.segmentIndex);
    if (typeof segmentationId !== 'string' || !Number.isInteger(segmentIndex) || segmentIndex <= 0) {
      continue;
    }
    if (!isSegmentLockedInternal(segmentationId, segmentIndex)) {
      continue;
    }

    const key = `${segmentationId}|${segmentIndex}`;
    deduped.set(key, {
      segmentationId,
      segmentIndex,
      label: memo.label || getSegmentDisplayLabel(segmentationId, segmentIndex),
    });
  }

  return Array.from(deduped.values());
}

export function showHistoryBlockedDialog(action: 'undo' | 'redo', targets: LockableHistoryTarget[]): void {
  if (targets.length === 0) return;

  const title = action === 'undo' ? 'Undo blocked' : 'Redo blocked';
  const names = targets.map((target) => target.label);
  const uniqueNames = Array.from(new Set(names));
  const message = action === 'undo'
    ? (
      uniqueNames.length === 1
        ? `Unlock ${uniqueNames[0]} before applying undo.`
        : `Unlock these annotations before applying undo:\n${uniqueNames.map((name) => `- ${name}`).join('\n')}`
    )
    : `Unlock the locked annotations before applying redo:\n${uniqueNames.map((name) => `- ${name}`).join('\n')}`;

  void showAlertDialog({
    title,
    message,
    confirmLabel: 'OK',
  });
}

export function installHistoryMemoTracking(): void {
  if (historyTrackingInstalled || !DefaultHistoryMemo || typeof DefaultHistoryMemo.push !== 'function') {
    return;
  }

  originalHistoryPush = DefaultHistoryMemo.push.bind(DefaultHistoryMemo);
  DefaultHistoryMemo.push = ((item: unknown) => {
    const memo = originalHistoryPush?.(item);
    enrichHistoryMemoRecord(memo);
    // Phase 2.7a: mirror the memo into the per-container undoService when
    // it resolves to a known container. Loose memos (no segmentationId)
    // stay in DefaultHistoryMemo only — the dispatch swap in 2.7b keeps
    // a fallback path for them.
    routeMemoToUndoService(memo);
    return memo;
  }) as typeof DefaultHistoryMemo.push;
  historyTrackingInstalled = true;
}

/**
 * Build a `HistoryEntry` from an enriched memo and record it on the
 * memo's container. The entry's apply/invert wrap `memo.restoreMemo()` so
 * the undo path mirrors what `DefaultHistoryMemo.undo()` would do.
 *
 * Phase 2.7a is record-only — undoService doesn't dispatch yet (the public
 * `segmentationService.undo()/.redo()` still call DefaultHistoryMemo).
 * Phase 2.7b swaps dispatch.
 *
 * Phase 4.3: under `multiViewport.enabled`, memos for `autoGenerated`
 * annotations (= contours produced by inter-slice interpolation) are
 * diverted into the auto-generated buffer rather than recorded as
 * individual entries. The interpolationUndo handler drains the buffer
 * into a single batched HistoryEntry on
 * `ANNOTATION_INTERPOLATION_PROCESS_COMPLETED`, so an N-contour
 * interpolation collapses into one undo step (per design §B5,
 * requirement A8).
 */
function routeMemoToUndoService(memo: unknown): void {
  if (!memo || typeof memo !== 'object') return;
  const records = Array.isArray(memo)
    ? (memo.filter((m): m is HistoryMemoRecord => !!m && typeof m === 'object'))
    : [memo as HistoryMemoRecord];

  const mvEnabled = usePreferencesStore.getState().preferences.multiViewport.enabled;

  for (const record of records) {
    const segId = record.segmentationId;
    if (typeof segId !== 'string' || segId.length === 0) continue;
    const containerId = containerBridge.getContainerId(segId);
    if (!containerId) continue;

    const entry = buildEntryFromRecord(record, segId);

    if (mvEnabled && isAutoGeneratedMemo(record)) {
      // Phase 4.3: divert into the per-container batch buffer. Drained
      // by `interpolationUndo.ts` on the completion event.
      const buf = autoGeneratedMemoBuffer.get(containerId) ?? [];
      buf.push(entry);
      autoGeneratedMemoBuffer.set(containerId, buf);
      continue;
    }

    undoService.record(containerId, entry);
  }
}

function buildEntryFromRecord(record: HistoryMemoRecord, segId: string): HistoryEntry {
  return {
    description:
      record.label
      ?? (record.operationType
        ? `${record.operationType}${record.id ? ` ${record.id}` : ''}`
        : `Edit on ${segId}`),
    apply: () => record.restoreMemo?.(false),
    invert: () => record.restoreMemo?.(true),
    // Phase 3 will populate scopeMemberIds from segmentIndex once members
    // exist as first-class objects; for now leave empty (no consumers).
    scopeMemberIds: [],
    at: Date.now(),
  };
}

/**
 * Determine whether a memo's annotation is auto-generated (= came from
 * interpolation). Reads the flag from Cornerstone's annotation state at
 * memo-push time, when the flag is still set (`autoAcceptInterpolated`
 * may flip it to false later in the same dispatch).
 */
function isAutoGeneratedMemo(record: HistoryMemoRecord): boolean {
  if (record.operationType !== 'annotation' || typeof record.id !== 'string') return false;
  const ann = csAnnotation.state.getAnnotation?.(record.id) as
    | { autoGenerated?: boolean }
    | undefined;
  return ann?.autoGenerated === true;
}

// ─── Auto-generated buffer (Phase 4.3) ─────────────────────────────

const autoGeneratedMemoBuffer = new Map<string, HistoryEntry[]>();

/**
 * Drain and return all buffered auto-generated entries for a container.
 * Called by `interpolationUndo.ts` on
 * `ANNOTATION_INTERPOLATION_PROCESS_COMPLETED`. Returns an empty array
 * if no entries are buffered.
 */
export function takeAutoGeneratedBuffer(containerId: string): HistoryEntry[] {
  const out = autoGeneratedMemoBuffer.get(containerId) ?? [];
  autoGeneratedMemoBuffer.delete(containerId);
  return out;
}

/**
 * Drop all buffered entries across all containers. Used by service
 * dispose() and by tests; also a defensive backstop for the unlikely
 * case where Cornerstone added auto-generated annotations but never
 * fired the completion event (Cornerstone's interpolate.js only fires
 * the event when `interpolationList.length > 0`, so this path is
 * theoretical).
 */
export function clearAutoGeneratedBuffer(): void {
  autoGeneratedMemoBuffer.clear();
}

export function uninstallHistoryMemoTracking(): void {
  if (!historyTrackingInstalled || !DefaultHistoryMemo || !originalHistoryPush) {
    return;
  }

  DefaultHistoryMemo.push = originalHistoryPush as typeof DefaultHistoryMemo.push;
  originalHistoryPush = null;
  historyTrackingInstalled = false;
}
