/**
 * Pure helpers for the contour-clipboard subsystem.
 *
 * Extracted into a standalone module so unit tests can import them without
 * pulling in `contourClipboard.ts`'s transitive Cornerstone tools imports
 * (toolService → SafePaintFillTool → @cornerstonejs/tools → …).
 */

export function arraysStrictEqual(value: unknown, expected: readonly number[]): boolean {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (value[i] !== expected[i]) return false;
  }
  return true;
}

/**
 * Find or mint an `interpolationUID` for the contour chain a pasted annotation
 * is about to join, and backfill it onto any chain members that lack one.
 *
 * A "chain" mirrors Cornerstone's own interpolation grouping:
 * `(segmentationId, segmentIndex, viewPlaneNormal, viewUp)`. Comparison uses
 * strict element equality on the orientation vectors — the same operator
 * Cornerstone uses inside `getInterpolationData`.
 *
 * If `viewPlaneNormal`/`viewUp` are missing on the new annotation, we cannot
 * safely identify the chain, so we mint a fresh UID without backfilling.
 *
 * `getAllAnnotations` and `mintUID` are injected as deps so the helper can
 * be unit-tested without pulling in Cornerstone's tools module (and its
 * transitive imports).
 */
export function resolveContourChainInterpolationUIDWithDeps(
  params: {
    segmentationId: string;
    segmentIndex: number;
    viewPlaneNormal: readonly number[] | undefined;
    viewUp: readonly number[] | undefined;
  },
  deps: {
    getAllAnnotations: () => unknown[];
    mintUID: () => string;
  },
): string {
  const { segmentationId, segmentIndex, viewPlaneNormal, viewUp } = params;
  const candidates: Array<{ interpolationUID?: string }> = [];
  if (viewPlaneNormal && viewUp) {
    for (const raw of deps.getAllAnnotations()) {
      const a = raw as
        | {
            data?: { segmentation?: { segmentationId?: string; segmentIndex?: number } };
            metadata?: { viewPlaneNormal?: unknown; viewUp?: unknown };
            interpolationUID?: string;
          }
        | undefined;
      const seg = a?.data?.segmentation;
      if (!seg) continue;
      if (seg.segmentationId !== segmentationId) continue;
      if (seg.segmentIndex !== segmentIndex) continue;
      if (!arraysStrictEqual(a.metadata?.viewPlaneNormal, viewPlaneNormal)) continue;
      if (!arraysStrictEqual(a.metadata?.viewUp, viewUp)) continue;
      candidates.push(a as { interpolationUID?: string });
    }
  }

  let chainUID = '';
  for (const cand of candidates) {
    if (cand.interpolationUID) {
      chainUID = cand.interpolationUID;
      break;
    }
  }
  if (!chainUID) {
    chainUID = deps.mintUID();
  }
  for (const cand of candidates) {
    if (!cand.interpolationUID) {
      cand.interpolationUID = chainUID;
    }
  }
  return chainUID;
}
