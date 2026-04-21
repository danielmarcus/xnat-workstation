/**
 * Contour Representation Facade — single typed entry point for every access
 * to `segmentation.representationData.Contour` (Cornerstone3D's contour
 * segmentation data, a.k.a. the `annotationUIDsMap`).
 *
 * Purpose: eliminate the `(seg.representationData as any)?.Contour` pattern
 * that was duplicated across 40+ sites. Callers now go through this module;
 * shape assumptions live in exactly one place.
 *
 * Behavioral contract (preserves prior call-site behavior):
 *   - Read operations return `null` / empty when the segmentation has no
 *     contour representation — they never throw for "missing rep".
 *   - Write/ensure operations are no-ops when the segmentation cannot be
 *     resolved (same as the pre-facade fallback paths that silently returned).
 *   - `addAnnotation`/`removeAnnotation` prefer Cornerstone's
 *     `utilities.contourSegmentation.*` helpers when present and fall back
 *     to direct Map mutation otherwise (preserves pre-facade optional-chain
 *     semantics at segmentationService.ts:977 and :1006).
 *
 * Notes:
 *   - The `as any` cast around `representationData.Contour` is intentional
 *     and confined to this module; Cornerstone's public type for
 *     `representationData` does not expose the contour subtree cleanly.
 *   - This facade does NOT trigger Cornerstone events; callers still own
 *     `syncSegmentations()` / render triggers.
 */
import {
  segmentation as csSegmentation,
  utilities as csToolUtilities,
} from '@cornerstonejs/tools';

/** Shape of the `Contour` subtree of a Cornerstone segmentation's representationData. */
export interface ContourRepresentationData {
  annotationUIDsMap: Map<number, Set<string>>;
}

/** Minimal shape of a contour segmentation annotation used by add/remove. */
export interface ContourSegmentationAnnotationLike {
  annotationUID?: string;
  metadata?: {
    toolName?: string;
  };
  data?: {
    segmentation?: {
      segmentationId?: string;
      segmentIndex?: number;
    };
  };
}

/**
 * Cornerstone tool class names that produce contour-segmentation annotations
 * (annotations that live in a segmentation's `annotationUIDsMap`).
 *
 * Intentionally excludes `LabelMapEditWithContourTool` — that tool uses a
 * contour gesture as input but writes to the labelmap representation, so
 * its annotations should NOT be treated as contour-seg annotations.
 *
 * Kept as plain strings (not imported from `@cornerstonejs/tools` class
 * `.toolName` statics) to keep the facade's import surface small. The
 * strings match Cornerstone's conventions; if Cornerstone renames a tool
 * class, this set must be updated in lock-step.
 */
export const CONTOUR_SEG_TOOL_CLASS_NAMES: ReadonlySet<string> = new Set<string>([
  'PlanarFreehandContourSegmentationTool',
  'SplineContourSegmentationTool',
  'LivewireContourSegmentationTool',
]);

/**
 * Identity check: does this annotation belong to a contour-segmentation?
 *
 * Returns true iff:
 *   - `metadata.toolName` is a known contour-seg tool class name, AND
 *   - `data.segmentation.segmentationId` is a non-empty string, AND
 *   - `data.segmentation.segmentIndex` is a positive integer.
 *
 * DOES NOT check polyline completeness (in-progress contours with <3
 * points are still contour-seg annotations by identity — completeness is
 * a separate question for callers that need a drawable/copyable shape).
 */
export function isContourSegmentationAnnotation(
  annotation: unknown,
): annotation is Required<Pick<ContourSegmentationAnnotationLike, 'annotationUID' | 'metadata' | 'data'>> {
  const ann = annotation as ContourSegmentationAnnotationLike | undefined;
  if (!ann) return false;

  const toolName = ann.metadata?.toolName;
  if (typeof toolName !== 'string' || !CONTOUR_SEG_TOOL_CLASS_NAMES.has(toolName)) return false;

  if (typeof ann.annotationUID !== 'string' || ann.annotationUID.length === 0) return false;

  const segmentationId = ann.data?.segmentation?.segmentationId;
  if (typeof segmentationId !== 'string' || segmentationId.length === 0) return false;

  const segmentIndex = Number(ann.data?.segmentation?.segmentIndex);
  if (!Number.isInteger(segmentIndex) || segmentIndex <= 0) return false;

  return true;
}

// ─── Internal helpers ─────────────────────────────────────────────

function resolveSegmentation(segmentationId: string): any | null {
  if (!segmentationId) return null;
  return csSegmentation.state.getSegmentation(segmentationId) ?? null;
}

function readContourData(segmentation: any): ContourRepresentationData | null {
  const contourData = (segmentation?.representationData as any)?.Contour;
  if (!contourData) return null;
  // Guard: annotationUIDsMap should always be a Map once the rep is created,
  // but Cornerstone version skew can produce plain-object shapes. Guard here
  // so every caller doesn't have to.
  if (!(contourData.annotationUIDsMap instanceof Map)) return null;
  return contourData as ContourRepresentationData;
}

// ─── Read API ─────────────────────────────────────────────────────

/**
 * Get the contour representation data for a segmentation, or null if it has
 * no contour representation (or the representation exists but its
 * `annotationUIDsMap` is not a Map).
 */
export function getContourData(segmentationId: string): ContourRepresentationData | null {
  return readContourData(resolveSegmentation(segmentationId));
}

/**
 * Whether the segmentation has a contour representation with a valid
 * `annotationUIDsMap`. Equivalent to `getContourData(id) !== null`.
 */
export function hasContourRepresentation(segmentationId: string): boolean {
  return readContourData(resolveSegmentation(segmentationId)) !== null;
}

/**
 * Lighter-weight existence check — returns true if the segmentation has a
 * `.Contour` key on `representationData`, even if `annotationUIDsMap` is
 * missing or not yet a Map. Matches the pre-facade check at
 * segmentationService.ts:1343 used by `getSegmentationType`.
 */
export function hasContourRepresentationKey(segmentationId: string): boolean {
  const seg = resolveSegmentation(segmentationId);
  return (seg?.representationData as any)?.Contour != null;
}

/**
 * Get the set of annotation UIDs for a specific segment index, or null if
 * there is no contour rep or no entry for that index.
 */
export function getAnnotationUIDs(
  segmentationId: string,
  segmentIndex: number,
): ReadonlySet<string> | null {
  const data = getContourData(segmentationId);
  if (!data) return null;
  return data.annotationUIDsMap.get(segmentIndex) ?? null;
}

/**
 * Iterate every annotation-UID set (one per segment index) for the given
 * segmentation. Empty iterable when the segmentation has no contour rep.
 */
export function* iterateAnnotationUIDSets(
  segmentationId: string,
): Iterable<ReadonlySet<string>> {
  const data = getContourData(segmentationId);
  if (!data) return;
  for (const set of data.annotationUIDsMap.values()) {
    yield set;
  }
}

/** True when the segmentation has at least one annotation UID tracked. */
export function hasAnyAnnotations(segmentationId: string): boolean {
  for (const set of iterateAnnotationUIDSets(segmentationId)) {
    if (set.size > 0) return true;
  }
  return false;
}

// ─── Construction API ─────────────────────────────────────────────

/**
 * Build the initial `data` object for a new contour segmentation. Pass the
 * initial segment indices to pre-populate empty UID sets.
 *
 * Usage:
 *   csSegmentation.addSegmentations([{
 *     segmentationId,
 *     representation: {
 *       type: ToolEnums.SegmentationRepresentations.Contour,
 *       data: buildInitialContourData([1, 2, 3]),
 *     },
 *   }]);
 */
export function buildInitialContourData(
  initialSegmentIndices: Iterable<number> = [],
): ContourRepresentationData {
  const annotationUIDsMap = new Map<number, Set<string>>();
  for (const idx of initialSegmentIndices) {
    if (Number.isInteger(idx) && idx > 0) {
      annotationUIDsMap.set(idx, new Set<string>());
    }
  }
  return { annotationUIDsMap };
}

// ─── Mutation API ─────────────────────────────────────────────────

/**
 * Attribute an annotation UID to a segment WITHOUT going through
 * Cornerstone's `contourSegmentation.addContourSegmentationAnnotation`
 * helper. Pure map mutation.
 *
 * Use this only from bulk-load paths that construct annotations directly
 * (e.g. RTSTRUCT import) and want to preserve the pre-facade behavior of
 * map-only attribution. New code should prefer `addAnnotation()`, which
 * routes through Cornerstone's helper when available.
 *
 * NOTE: This exists to preserve a known pre-facade divergence and is a
 * candidate for unification once RTSTRUCT-load semantics are tested
 * against the helper path.
 *
 * Returns true if the UID was attached, false if the segmentation has no
 * contour representation or inputs are invalid.
 */
export function attachAnnotationUID(
  segmentationId: string,
  segmentIndex: number,
  annotationUID: string,
): boolean {
  if (!Number.isInteger(segmentIndex) || segmentIndex <= 0 || !annotationUID) return false;
  const data = getContourData(segmentationId);
  if (!data) return false;
  if (!data.annotationUIDsMap.has(segmentIndex)) {
    data.annotationUIDsMap.set(segmentIndex, new Set<string>());
  }
  data.annotationUIDsMap.get(segmentIndex)!.add(annotationUID);
  return true;
}

/**
 * Ensure the segmentation has a contour representation. Creates an empty
 * `{ annotationUIDsMap: new Map() }` if missing. Returns the contour data,
 * or null if the segmentation itself cannot be resolved.
 *
 * Matches pre-facade behavior at segmentationService.ts:4172-4176.
 */
export function ensureContourRepresentation(
  segmentationId: string,
): ContourRepresentationData | null {
  const seg = resolveSegmentation(segmentationId);
  if (!seg) return null;

  const existing = readContourData(seg);
  if (existing) return existing;

  const repData = (seg.representationData as any) ?? ((seg as any).representationData = {});
  const fresh: ContourRepresentationData = { annotationUIDsMap: new Map() };
  repData.Contour = fresh;
  return fresh;
}

/**
 * Ensure the annotation-UID map has an entry (possibly empty) for the given
 * segment index. No-op if the segmentation has no contour representation.
 *
 * Matches pre-facade behavior at segmentationService.ts:2153-2158.
 */
export function ensureSegmentEntry(
  segmentationId: string,
  segmentIndex: number,
): void {
  if (!Number.isInteger(segmentIndex) || segmentIndex <= 0) return;
  const data = getContourData(segmentationId);
  if (!data) return;
  if (!data.annotationUIDsMap.has(segmentIndex)) {
    data.annotationUIDsMap.set(segmentIndex, new Set<string>());
  }
}

/**
 * Clear every annotation UID tracked by this segmentation's contour
 * representation. No-op if no contour rep exists.
 *
 * NOTE: This only clears the Cornerstone-side UID map. It does NOT remove
 * the underlying annotations from `csAnnotation.state`. Callers that want a
 * full reset must remove those separately. Matches pre-facade behavior at
 * segmentationService.ts:2096-2099.
 */
export function clearAllAnnotationUIDs(segmentationId: string): void {
  const data = getContourData(segmentationId);
  if (!data) return;
  data.annotationUIDsMap.clear();
}

/**
 * Register a contour annotation with its segmentation.
 *
 * Prefers `csToolUtilities.contourSegmentation.addContourSegmentationAnnotation`
 * when the helper is available (Cornerstone may do additional bookkeeping
 * there — e.g. segment-rendering caches). Falls back to direct map mutation
 * otherwise. Returns true if the annotation was successfully attributed.
 *
 * Matches pre-facade behavior at segmentationService.ts:977-1004.
 */
export function addAnnotation(annotation: ContourSegmentationAnnotationLike): boolean {
  const helper = csToolUtilities.contourSegmentation?.addContourSegmentationAnnotation;
  if (helper) {
    try {
      helper(annotation as any);
      return true;
    } catch (err) {
      console.debug('[contourRepresentation] addContourSegmentationAnnotation failed:', err);
      // Fall through to manual attribution
    }
  }

  const segmentationId = annotation?.data?.segmentation?.segmentationId;
  const segmentIndex = Number(annotation?.data?.segmentation?.segmentIndex);
  const annotationUID = annotation?.annotationUID;
  if (!segmentationId || !Number.isInteger(segmentIndex) || segmentIndex <= 0 || !annotationUID) {
    return false;
  }

  const data = getContourData(segmentationId);
  if (!data) return false;

  if (!data.annotationUIDsMap.has(segmentIndex)) {
    data.annotationUIDsMap.set(segmentIndex, new Set<string>());
  }
  data.annotationUIDsMap.get(segmentIndex)!.add(annotationUID);
  return true;
}

/**
 * Deregister a contour annotation from its segmentation.
 *
 * Prefers `csToolUtilities.contourSegmentation.removeContourSegmentationAnnotation`
 * when the helper is available. Falls back to direct map mutation and
 * cleans up empty segment entries. Returns true if the annotation was
 * successfully deregistered.
 *
 * Matches pre-facade behavior at segmentationService.ts:1006-1034.
 */
export function removeAnnotation(annotation: ContourSegmentationAnnotationLike): boolean {
  const helper = csToolUtilities.contourSegmentation?.removeContourSegmentationAnnotation;
  if (helper) {
    try {
      helper(annotation as any);
      return true;
    } catch (err) {
      console.debug('[contourRepresentation] removeContourSegmentationAnnotation failed:', err);
      // Fall through to manual deregistration
    }
  }

  const segmentationId = annotation?.data?.segmentation?.segmentationId;
  const segmentIndex = Number(annotation?.data?.segmentation?.segmentIndex);
  const annotationUID = annotation?.annotationUID;
  if (!segmentationId || !Number.isInteger(segmentIndex) || segmentIndex <= 0 || !annotationUID) {
    return false;
  }

  const data = getContourData(segmentationId);
  if (!data) return false;

  const set = data.annotationUIDsMap.get(segmentIndex);
  if (!set) return false;

  set.delete(annotationUID);
  if (set.size === 0) {
    data.annotationUIDsMap.delete(segmentIndex);
  }
  return true;
}
