/**
 * Multi-Layer Group — state ownership for "group" segmentations.
 *
 * A "multi-layer group" is a logical segmentation that the UI treats as a
 * single row but which internally consists of multiple Cornerstone
 * segmentations (sub-segs), each storing one segment's labelmap. This lets
 * segments overlap — each segment lives in its own labelmap image — which
 * Cornerstone's single-labelmap segmentation model cannot express.
 *
 * The group ID is purely internal (not a Cornerstone-backed segmentation);
 * the sub-seg IDs are real Cornerstone segmentations. Callers use
 * `isMultiLayerGroup` to switch between group-aware code paths and
 * flat-segmentation code paths.
 *
 * Scope: this module OWNS the state (7 maps + helpers) but does NOT
 * eliminate the `if (isMultiLayerGroup(...))` branching in callers; those
 * branches express legitimate behavioral differences (group → iterate
 * sub-segs; flat → direct op) and unifying them is a separate design
 * task. The goal of extracting here is:
 *   - encapsulate the state behind a typed API;
 *   - give the group-lifecycle one owner (one `clearAll()` call on
 *     service dispose instead of 7 separate `.clear()` calls);
 *   - make the multi-layer subsystem independently reasonable-about and
 *     testable in future sessions.
 *
 * Intentionally exposes granular accessors that mirror the prior direct-
 * Map operations 1:1 so migration is mechanical and low-risk. Opinionated
 * consolidation (e.g. a single `createGroup` that initializes all per-
 * group state atomically) is deferred until the existing call sites are
 * understood well enough to guarantee no semantic regression.
 */

/** Per-segment metadata stored at the group level. */
export interface SegmentMeta {
  label: string;
  color: [number, number, number, number];
  locked: boolean;
}

/** Image dimensions + source IDs for creating new sub-seg labelmap images. */
export interface GroupDimensions {
  rows: number;
  columns: number;
  rowPixelSpacing: number;
  columnPixelSpacing: number;
  sourceImageIds: string[];
}

// ─── Private state ────────────────────────────────────────────────

/**
 * groupId → ordered sub-seg IDs. Array index + 1 = logical segment index.
 * Null entries mean removed segments (index is preserved to avoid shifting
 * remaining segment indices).
 */
const subSegGroupMap = new Map<string, (string | null)[]>();

/** subSegId → { groupId, segmentIndex }. Reverse lookup. */
const subSegToGroupMap = new Map<string, { groupId: string; segmentIndex: number }>();

/** groupId → (segmentIndex → meta). */
const segmentMetaMap = new Map<string, Map<number, SegmentMeta>>();

/** groupId → image dimensions for creating new sub-seg labelmap images on demand. */
const groupDimensionsMap = new Map<string, GroupDimensions>();

/** groupId → user-facing label. Separate from per-segment labels. */
const groupLabelMap = new Map<string, string>();

/**
 * groupId → viewport IDs. Records which viewports a group was added to via
 * addToViewport, even before any sub-segs exist. Without this, the first
 * addSegment cannot discover the target viewports because findViewportsWithGroup
 * iterates sub-segs — which are empty until the first segment is created.
 */
const groupViewportAttachments = new Map<string, Set<string>>();

/**
 * groupId → background metadata pre-load promise. Started in
 * createStackSegmentation and awaited lazily in addSegment so the UI
 * doesn't block on first creation.
 */
const metadataPreloadPromises = new Map<string, Promise<void>>();

// ─── Core predicates & lookups ────────────────────────────────────

/** True if this ID names a multi-layer group (not a flat segmentation). */
export function isMultiLayerGroup(segmentationId: string): boolean {
  return subSegGroupMap.has(segmentationId);
}

/** Non-null sub-seg IDs for a group, in logical segment-index order. */
export function getActiveSubSegIds(groupId: string): string[] {
  const arr = subSegGroupMap.get(groupId);
  if (!arr) return [];
  return arr.filter((id): id is string => id !== null);
}

/**
 * Resolve a group ID + logical (1-based) segment index to the underlying
 * sub-seg ID. Returns null if the group doesn't exist or the slot is empty.
 */
export function resolveSubSegId(groupId: string, segmentIndex: number): string | null {
  const arr = subSegGroupMap.get(groupId);
  if (!arr) return null;
  return arr[segmentIndex - 1] ?? null;
}

/**
 * Viewport IDs that have any sub-seg of a group attached OR have a
 * recorded attachment from `attachGroupToViewport`. Falls back to
 * recorded attachments for groups that have been added to viewports
 * before any sub-segs exist.
 */
export function findViewportsWithGroup(
  groupId: string,
  getViewportIdsWithSegmentation: (subSegId: string) => string[],
): string[] {
  const subSegIds = getActiveSubSegIds(groupId);
  const vpSet = new Set<string>();
  for (const subSegId of subSegIds) {
    for (const vpId of getViewportIdsWithSegmentation(subSegId)) {
      vpSet.add(vpId);
    }
  }
  if (vpSet.size === 0) {
    const recorded = groupViewportAttachments.get(groupId);
    if (recorded) {
      for (const vpId of recorded) vpSet.add(vpId);
    }
  }
  return Array.from(vpSet);
}

// ─── Sub-seg slot accessors (subSegGroupMap) ──────────────────────

/** Initialize an empty slot array for a new group. */
export function initGroupSlots(groupId: string): void {
  subSegGroupMap.set(groupId, []);
}

/** Return the raw slot array for a group (mutable). Null if no such group. */
export function getGroupSlots(groupId: string): (string | null)[] | null {
  return subSegGroupMap.get(groupId) ?? null;
}

/** Remove all sub-seg slots for a group. */
export function removeGroupSlots(groupId: string): void {
  subSegGroupMap.delete(groupId);
}

/**
 * Iterate all groups with their slot arrays. Used by the segmentation sync
 * pass that needs to iterate every group and its sub-segs. Returns a live
 * iterator over the private Map — callers must not retain the returned
 * iterator across module-state mutations.
 */
export function iterateGroups(): IterableIterator<[string, (string | null)[]]> {
  return subSegGroupMap.entries();
}

// ─── Reverse lookup (subSegToGroupMap) ────────────────────────────

export function getGroupInfoForSubSeg(
  subSegId: string,
): { groupId: string; segmentIndex: number } | null {
  return subSegToGroupMap.get(subSegId) ?? null;
}

export function setGroupInfoForSubSeg(
  subSegId: string,
  info: { groupId: string; segmentIndex: number },
): void {
  subSegToGroupMap.set(subSegId, info);
}

export function removeGroupInfoForSubSeg(subSegId: string): void {
  subSegToGroupMap.delete(subSegId);
}

// ─── Segment metadata (segmentMetaMap) ────────────────────────────

export function initSegmentMetaMap(groupId: string): void {
  segmentMetaMap.set(groupId, new Map());
}

/**
 * The per-group segment-meta Map. Callers use this to both read and
 * mutate per-segment meta (e.g. `.set(index, meta)`, `.delete(index)`).
 * Returns null if the group has no meta map (i.e. it's not a group or
 * was never initialized).
 */
export function getSegmentMetaMap(groupId: string): Map<number, SegmentMeta> | null {
  return segmentMetaMap.get(groupId) ?? null;
}

/** Convenience: fetch a single segment's meta. */
export function getSegmentMeta(groupId: string, segmentIndex: number): SegmentMeta | null {
  return segmentMetaMap.get(groupId)?.get(segmentIndex) ?? null;
}

export function removeSegmentMetaMap(groupId: string): void {
  segmentMetaMap.delete(groupId);
}

// ─── Group dimensions (groupDimensionsMap) ────────────────────────

export function getGroupDimensions(groupId: string): GroupDimensions | null {
  return groupDimensionsMap.get(groupId) ?? null;
}

export function setGroupDimensions(groupId: string, dimensions: GroupDimensions): void {
  groupDimensionsMap.set(groupId, dimensions);
}

export function removeGroupDimensions(groupId: string): void {
  groupDimensionsMap.delete(groupId);
}

// ─── Group label (groupLabelMap) ──────────────────────────────────

export function getGroupLabel(groupId: string): string | null {
  return groupLabelMap.get(groupId) ?? null;
}

export function setGroupLabel(groupId: string, label: string): void {
  groupLabelMap.set(groupId, label);
}

export function removeGroupLabel(groupId: string): void {
  groupLabelMap.delete(groupId);
}

// ─── Viewport attachments (groupViewportAttachments) ──────────────

/**
 * Record that a group has been added to a viewport (used before sub-segs
 * exist so the first addSegment can find the target viewport).
 */
export function attachGroupToViewport(groupId: string, viewportId: string): void {
  let set = groupViewportAttachments.get(groupId);
  if (!set) {
    set = new Set();
    groupViewportAttachments.set(groupId, set);
  }
  set.add(viewportId);
}

export function removeGroupViewportAttachments(groupId: string): void {
  groupViewportAttachments.delete(groupId);
}

// ─── Metadata pre-load promises (metadataPreloadPromises) ─────────

export function getPreloadPromise(groupId: string): Promise<void> | null {
  return metadataPreloadPromises.get(groupId) ?? null;
}

export function setPreloadPromise(groupId: string, promise: Promise<void>): void {
  metadataPreloadPromises.set(groupId, promise);
}

export function removePreloadPromise(groupId: string): void {
  metadataPreloadPromises.delete(groupId);
}

// ─── Teardown ─────────────────────────────────────────────────────

/**
 * Drop all group state. Called from segmentationService.dispose() in
 * place of the seven `.clear()` calls on the individual Maps.
 */
export function clearAll(): void {
  subSegGroupMap.clear();
  subSegToGroupMap.clear();
  segmentMetaMap.clear();
  groupDimensionsMap.clear();
  groupLabelMap.clear();
  groupViewportAttachments.clear();
  metadataPreloadPromises.clear();
}
