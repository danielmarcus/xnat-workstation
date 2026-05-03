/**
 * Container Store Sync — keeps `useContainerStore` in agreement with
 * `containerBridge` (Phase 3.2a) and Cornerstone segmentation events that
 * drive Member auto-population (Phase 3.2b).
 *
 * Phase 3.2a wires the bridge → store sync. Phase 3.2b adds the
 * Cornerstone event hookup that re-derives `Container.members[]` from
 * `csSegmentation.state.getSegmentation(segId).segments` on every
 * SEGMENTATION_ADDED / SEGMENTATION_MODIFIED event, so the list panel can
 * render rows for each cs segment without the bridge having to know
 * about Cornerstone segment internals.
 *
 * Lifecycle (mirrors the existing service modules):
 *   - `initialize()` subscribes once at service init.
 *   - `dispose()` unsubscribes and clears the store.
 *   - Idempotent — calling initialize() twice is safe; the second call
 *     is a no-op.
 *
 * Wired from `segmentationService.initialize()` / `.dispose()` alongside
 * the existing containerBridge.initialize() / .dispose() so the sync
 * starts in lockstep with bridge auto-track.
 */
import { eventTarget } from '@cornerstonejs/core';
import {
  Enums as ToolEnums,
  segmentation as csSegmentation,
} from '@cornerstonejs/tools';
import * as containerBridge from './containerBridge';
import { useContainerStore } from '../../stores/containerStore';
import type {
  ContainerKind,
  Member,
  Provenance,
  RGB,
  VisibilityMode,
} from '../../types/annotation';

let initialized = false;
let bridgeUnsubscribe: (() => void) | null = null;
let onSegmentationLifecycle: EventListener | null = null;

// ─── Member synthesis ────────────────────────────────────────────

/**
 * Compute the deterministic Member id for a (csSegmentationId, segmentIndex)
 * pair. Exported so sibling modules (e.g., `segmentationService/provenance.ts`)
 * can resolve from a Cornerstone segment back to a Member without repeating
 * the format string.
 */
export function memberIdFor(csSegId: string, segmentIndex: number): string {
  return `member_${csSegId}_${segmentIndex}`;
}

function defaultColorForIndex(index: number): RGB {
  // Deterministic fallback if cs hasn't published a color yet.
  // Mirrors the rotation segmentationService uses when bootstrapping.
  const palette: RGB[] = [
    [220, 50, 50],
    [50, 200, 50],
    [50, 100, 220],
    [230, 200, 40],
    [200, 50, 200],
    [50, 200, 200],
    [240, 140, 40],
    [150, 80, 200],
    [50, 220, 130],
    [255, 130, 130],
  ];
  return palette[(index - 1 + palette.length) % palette.length];
}

function defaultVisibilityForKind(kind: ContainerKind): VisibilityMode {
  // Per design §D7.3: SEG defaults to 'filled', RTSTRUCT to 'outlined'.
  return kind === 'RTSTRUCT' ? 'outlined' : 'filled';
}

function isLocked(csSegId: string, segmentIndex: number): boolean {
  try {
    return csSegmentation.segmentLocking.isSegmentIndexLocked(csSegId, segmentIndex);
  } catch {
    return false;
  }
}

function readColorFromCs(csSegId: string, segmentIndex: number, fallback: RGB): RGB {
  try {
    const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(csSegId);
    if (viewportIds.length === 0) return fallback;
    const c = csSegmentation.config.color.getSegmentIndexColor(
      viewportIds[0],
      csSegId,
      segmentIndex,
    ) as number[] | undefined;
    if (Array.isArray(c) && c.length >= 3 && c.every((n) => Number.isFinite(n))) {
      return [c[0], c[1], c[2]] as RGB;
    }
  } catch {
    // Fallthrough to fallback.
  }
  return fallback;
}

/**
 * Phase 4.5: gate that returns `true` while a SEG / RTSTRUCT load is in
 * flight. Wired by `segmentationService.initialize()` to read
 * `autoSave.isSegLoadInProgress()`. The setter-based DI keeps this
 * module from importing autoSave directly (autoSave's import graph
 * pulls in Cornerstone tool modules that the lightweight tests here
 * don't mock).
 */
let loadInProgressGate: () => boolean = () => false;

/**
 * Wire the load-in-progress gate. Production calls this once with
 * `() => isSegLoadInProgress()`; tests can pass their own gate to
 * exercise the load-default branch without touching autoSave.
 */
export function setLoadInProgressGate(gate: () => boolean): void {
  loadInProgressGate = gate;
}

/** Restore the default no-load gate. Used by test teardown. */
export function resetLoadInProgressGate(): void {
  loadInProgressGate = () => false;
}

/**
 * Choose the default provenance for a freshly synthesized member.
 * Returns `'imported'` while a SEG / RTSTRUCT load is in flight (per
 * §D7.2); otherwise `'manual'` (user-created).
 */
function defaultProvenance(): Provenance {
  try {
    return loadInProgressGate() ? 'imported' : 'manual';
  } catch {
    return 'manual';
  }
}

function buildMember(
  csSegId: string,
  segmentIndex: number,
  csSegment: { label?: string } | undefined,
  kind: ContainerKind,
  now: number,
): Member {
  const fallbackColor = defaultColorForIndex(segmentIndex);
  return {
    id: memberIdFor(csSegId, segmentIndex),
    name: csSegment?.label ?? `Segment ${segmentIndex}`,
    color: readColorFromCs(csSegId, segmentIndex, fallbackColor),
    visibility: defaultVisibilityForKind(kind),
    locked: isLocked(csSegId, segmentIndex),
    provenance: defaultProvenance(),
    roiType: null,
    roiNumber: kind === 'RTSTRUCT' ? segmentIndex : null,
    interpolationState: null,
    segmentIndex,
    segmentDescription: null,
    segmentedPropertyCategory: null,
    segmentedPropertyType: null,
    poiPoints: null,
    algebra: null,
    algebraSources: null,
    algebraOutOfDate: false,
    algebraManualOverride: false,
    csAnnotationUIDs: null,
    csSegmentationId: csSegId,
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * Re-derive `Container.members[]` from Cornerstone segment state for a
 * given containerId. The bridge owns the live Container reference; we
 * mutate `members` in place and call `containerBridge.notifyChange` so
 * the store snapshot updates.
 *
 * Preserves stable Member identity across rebuilds by reusing the
 * existing Member object when its segmentIndex matches — only mutates
 * fields that may have changed (name, color, locked). New segments get
 * fresh Member objects; removed segments are dropped.
 */
export function rebuildMembersFromCs(containerId: string): void {
  const container = containerBridge.getContainer(containerId);
  if (!container) return;
  const csSegId = containerBridge.getCsSegmentationId(containerId);
  if (!csSegId) return;

  let csSeg: { segments?: Record<number, { label?: string }> } | undefined;
  try {
    csSeg = csSegmentation.state.getSegmentation(csSegId) as typeof csSeg;
  } catch {
    csSeg = undefined;
  }
  const segments = csSeg?.segments ?? {};
  const now = Date.now();
  const existingByIndex = new Map<number, Member>();
  for (const m of container.members) {
    if (Number.isInteger(m.segmentIndex) && m.segmentIndex! > 0) {
      existingByIndex.set(m.segmentIndex!, m);
    }
  }

  const next: Member[] = [];
  const seen = new Set<number>();
  for (const idxStr of Object.keys(segments)) {
    const idx = Number(idxStr);
    if (!Number.isInteger(idx) || idx <= 0) continue;
    if (seen.has(idx)) continue;
    seen.add(idx);
    const csSegment = segments[idx];
    if (!csSegment) continue;
    const fresh = buildMember(csSegId, idx, csSegment, container.kind, now);

    const existing = existingByIndex.get(idx);
    if (existing) {
      // Preserve identity + createdAt; update mutable fields.
      next.push({
        ...existing,
        name: fresh.name,
        color: fresh.color,
        locked: fresh.locked,
        modifiedAt: now,
      });
    } else {
      next.push(fresh);
    }
  }

  // Default order is by segmentIndex (= ROI Number / SegmentNumber per §2.2).
  next.sort((a, b) => (a.segmentIndex ?? 0) - (b.segmentIndex ?? 0));

  container.members = next;
  containerBridge.notifyChange(containerId);
}

/**
 * Re-derive the snapshot for one container from the bridge and push to
 * the store. If the container no longer exists in the bridge, drop the
 * store entry.
 */
function syncOne(containerId: string): void {
  const container = containerBridge.getContainer(containerId);
  const store = useContainerStore.getState();
  if (container) {
    store._setContainer(containerId, container);
  } else {
    store._removeContainer(containerId);
  }
}

/**
 * Re-derive the full snapshot from every bridge entry. Used on bulk
 * events (clearAll) and at initialize() to seed the store with whatever
 * the bridge already knows about.
 */
function syncAll(): void {
  const next = new Map();
  for (const { containerId } of containerBridge.listAll()) {
    const container = containerBridge.getContainer(containerId);
    if (container) {
      // Defensive shallow-copy so the store's snapshot is independent of
      // future bridge mutations.
      next.set(containerId, { ...container });
    }
  }
  useContainerStore.getState()._replaceAll(next);
}

export function initialize(): void {
  if (initialized) return;

  // Subscribe FIRST so any notifyChange() calls during the seeding pass
  // below propagate to the store. (The reverse order would fire
  // notifyChange before the listener is registered, leaving the store
  // with empty-member snapshots.)
  bridgeUnsubscribe = containerBridge.subscribe((containerId) => {
    if (containerId === null) {
      syncAll();
    } else {
      syncOne(containerId);
    }
  });

  // Seed the store with whatever the bridge already has — covers the case
  // where bridge.initialize() fired SEGMENTATION_ADDED events before this
  // sync was wired up. Then rebuild members for each pre-existing
  // container so the initial snapshot includes them.
  syncAll();
  for (const { containerId } of containerBridge.listAll()) {
    rebuildMembersFromCs(containerId);
  }

  // Phase 3.2b: rebuild members on cs segmentation lifecycle events. The
  // bridge listens to ADDED / REMOVED for register/unregister; we listen
  // to the same events plus MODIFIED to re-derive Container.members[]
  // whenever segments are added, removed, renamed, or recolored.
  onSegmentationLifecycle = (evt: Event) => {
    const detail = (evt as CustomEvent<{ segmentationId?: string }>).detail;
    const csSegId = detail?.segmentationId;
    if (typeof csSegId !== 'string' || csSegId.length === 0) return;
    const containerId = containerBridge.getContainerId(csSegId);
    if (!containerId) return;
    rebuildMembersFromCs(containerId);
  };
  eventTarget.addEventListener(
    ToolEnums.Events.SEGMENTATION_ADDED,
    onSegmentationLifecycle,
  );
  eventTarget.addEventListener(
    ToolEnums.Events.SEGMENTATION_MODIFIED,
    onSegmentationLifecycle,
  );

  initialized = true;
}

export function dispose(): void {
  if (!initialized) return;
  if (bridgeUnsubscribe) {
    bridgeUnsubscribe();
    bridgeUnsubscribe = null;
  }
  if (onSegmentationLifecycle) {
    eventTarget.removeEventListener(
      ToolEnums.Events.SEGMENTATION_ADDED,
      onSegmentationLifecycle,
    );
    eventTarget.removeEventListener(
      ToolEnums.Events.SEGMENTATION_MODIFIED,
      onSegmentationLifecycle,
    );
    onSegmentationLifecycle = null;
  }
  useContainerStore.getState()._replaceAll(new Map());
  initialized = false;
}
