/**
 * Undo/redo history-memo helpers for segmentationService.
 *
 * Extracted verbatim from segmentationService.ts (P1.8e decomposition, pure
 * extraction — no logic change). Wraps Cornerstone3D's DefaultHistoryMemo ring
 * buffer: inspecting the top undo/redo entries, enriching pushed memos with
 * segmentation/segment identity + display labels, and surfacing a blocked
 * dialog when an undo/redo would touch a locked segment.
 *
 * Runtime dependencies that vary with the service's other state
 * (segment label lookup, lock query, annotation lookup, alert dialog) are
 * injected via {@link createUndoHistory}, matching the dependency-injection
 * convention used by the other segmentationService/* modules. The service
 * imports the returned helpers back so its public API is unchanged.
 */
import { utilities as csUtilities } from '@cornerstonejs/core';

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

/** Minimal shape of an annotation as returned by csAnnotation.state.getAnnotation. */
type AnnotationLike = {
  data?: { segmentation?: { segmentationId?: string; segmentIndex?: number } };
};

export interface UndoHistoryDeps {
  /** Resolve a segment's display label (multi-layer group aware). */
  getSegmentDisplayLabel(segmentationId: string, segmentIndex: number): string;
  /** Whether the given segment is locked (multi-layer group aware). */
  isSegmentLocked(segmentationId: string, segmentIndex: number): boolean;
  /** Look up an annotation by id (csAnnotation.state.getAnnotation). */
  getAnnotation(id: string): AnnotationLike | undefined;
  /** Show a blocking alert dialog. */
  showAlertDialog(opts: { title: string; message: string; confirmLabel: string }): void;
}

export interface UndoHistory {
  getTopUndoHistoryEntry(): HistoryMemoEntry;
  getTopRedoHistoryEntry(): HistoryMemoEntry;
  getLockedHistoryTargets(entry: HistoryMemoEntry): LockableHistoryTarget[];
  showHistoryBlockedDialog(action: 'undo' | 'redo', targets: LockableHistoryTarget[]): void;
  installHistoryMemoTracking(): void;
  uninstallHistoryMemoTracking(): void;
}

/**
 * Build the undo-history helper set bound to the given runtime dependencies.
 * Holds the private push-hook state (originalHistoryPush / historyTrackingInstalled).
 */
export function createUndoHistory(deps: UndoHistoryDeps): UndoHistory {
  /**
   * Cornerstone3D's built-in undo/redo ring buffer.
   * All segmentation/contour tools automatically push memos here via BaseTool.doneEditMemo().
   */
  const { DefaultHistoryMemo } = (csUtilities as any).HistoryMemo;

  let originalHistoryPush: ((item: unknown) => HistoryMemoRecord | undefined) | null = null;
  let historyTrackingInstalled = false;

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

  function getTopUndoHistoryEntry(): HistoryMemoEntry {
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

  function getTopRedoHistoryEntry(): HistoryMemoEntry {
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
      record.label = record.label || deps.getSegmentDisplayLabel(record.segmentationId, Number(record.segmentIndex));
      return;
    }

    if (record.operationType !== 'annotation' || typeof record.id !== 'string') {
      return;
    }

    const annotation = deps.getAnnotation(record.id);
    const segmentationId = annotation?.data?.segmentation?.segmentationId;
    const segmentIndex = Number(annotation?.data?.segmentation?.segmentIndex);
    if (typeof segmentationId !== 'string' || !Number.isInteger(segmentIndex) || segmentIndex <= 0) {
      return;
    }

    record.segmentationId = segmentationId;
    record.segmentIndex = segmentIndex;
    record.label = deps.getSegmentDisplayLabel(segmentationId, segmentIndex);
  }

  function getLockedHistoryTargets(entry: HistoryMemoEntry): LockableHistoryTarget[] {
    const deduped = new Map<string, LockableHistoryTarget>();

    for (const memo of toHistoryMemoRecords(entry)) {
      enrichHistoryMemoRecord(memo);
      const segmentationId = memo.segmentationId;
      const segmentIndex = Number(memo.segmentIndex);
      if (typeof segmentationId !== 'string' || !Number.isInteger(segmentIndex) || segmentIndex <= 0) {
        continue;
      }
      if (!deps.isSegmentLocked(segmentationId, segmentIndex)) {
        continue;
      }

      const key = `${segmentationId}|${segmentIndex}`;
      deduped.set(key, {
        segmentationId,
        segmentIndex,
        label: memo.label || deps.getSegmentDisplayLabel(segmentationId, segmentIndex),
      });
    }

    return Array.from(deduped.values());
  }

  function showHistoryBlockedDialog(action: 'undo' | 'redo', targets: LockableHistoryTarget[]): void {
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

    void deps.showAlertDialog({
      title,
      message,
      confirmLabel: 'OK',
    });
  }

  function installHistoryMemoTracking(): void {
    if (historyTrackingInstalled || !DefaultHistoryMemo || typeof DefaultHistoryMemo.push !== 'function') {
      return;
    }

    originalHistoryPush = DefaultHistoryMemo.push.bind(DefaultHistoryMemo);
    DefaultHistoryMemo.push = ((item: unknown) => {
      const memo = originalHistoryPush?.(item);
      enrichHistoryMemoRecord(memo);
      return memo;
    }) as typeof DefaultHistoryMemo.push;
    historyTrackingInstalled = true;
  }

  function uninstallHistoryMemoTracking(): void {
    if (!historyTrackingInstalled || !DefaultHistoryMemo || !originalHistoryPush) {
      return;
    }

    DefaultHistoryMemo.push = originalHistoryPush as typeof DefaultHistoryMemo.push;
    originalHistoryPush = null;
    historyTrackingInstalled = false;
  }

  return {
    getTopUndoHistoryEntry,
    getTopRedoHistoryEntry,
    getLockedHistoryTargets,
    showHistoryBlockedDialog,
    installHistoryMemoTracking,
    uninstallHistoryMemoTracking,
  };
}
