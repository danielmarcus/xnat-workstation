/**
 * Hide a hidden contour segment even when its segmentation is not the viewport's active one.
 *
 * Cornerstone 5 draws contour-segmentation annotations with the style from
 * `getSVGStyleForSegment`, whose visibility is
 *
 *     isActive ? segmentationVisible && segmentVisible : renderInactiveSegmentations
 *
 * so for any segmentation but the active one, per-segment visibility (and the
 * representation's own visibility) is ignored: a Structure's eye stopped hiding its contour
 * as soon as another annotation was active (reported 2026-10-28). Every contour-segmentation
 * tool — Freehand, Spline, Live Wire, Sculptor, and our Contour Fill outlines — takes its
 * style from `ContourSegmentationBaseTool._getContourSegmentationStyle`, so the rule is
 * applied there, once: whatever Cornerstone decided, a segment that is hidden on the viewport,
 * or a representation that is hidden, is not drawn.
 */
import {
  PlanarFreehandContourSegmentationTool,
  segmentation as csSegmentation,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';

interface StyleContext {
  annotation?: { data?: { segmentation?: { segmentationId?: string; segmentIndex?: number } } };
  styleSpecifier?: { viewportId?: string };
}
type StyleFn = (this: unknown, context: StyleContext) => Record<string, unknown>;

export interface ContourVisibilityLookups {
  /** Segment indices hidden on the viewport for the segmentation's Contour representation. */
  hiddenSegments(viewportId: string, segmentationId: string): Set<number>;
  /** Whether the segmentation's Contour representation is visible on the viewport. */
  representationVisible(viewportId: string, segmentationId: string): boolean;
}

// Read at call time, not import time: nothing here runs until a contour is drawn.
const DEFAULT_LOOKUPS: ContourVisibilityLookups = {
  hiddenSegments: (viewportId, segmentationId) =>
    csSegmentation.config.visibility.getHiddenSegmentIndices(viewportId, { segmentationId, type: ToolEnums.SegmentationRepresentations.Contour }) ?? new Set(),
  representationVisible: (viewportId, segmentationId) =>
    csSegmentation.config.visibility.getSegmentationRepresentationVisibility(viewportId, { segmentationId, type: ToolEnums.SegmentationRepresentations.Contour }) !== false,
};

const PATCHED = Symbol.for('xnat.inactiveContourVisibility');

/**
 * Wrap the contour-segmentation style once. `toolClass` is any tool class that inherits it
 * (the base class itself is not exported); the lookups are a test seam.
 */
export function installInactiveContourVisibility(
  toolClass: { prototype: object } = PlanarFreehandContourSegmentationTool,
  lookups: ContourVisibilityLookups = DEFAULT_LOOKUPS,
): boolean {
  let owner: object | null = toolClass.prototype;
  while (owner && !Object.prototype.hasOwnProperty.call(owner, '_getContourSegmentationStyle')) owner = Object.getPrototypeOf(owner);
  if (!owner) {
    console.warn('[inactiveContourVisibility] _getContourSegmentationStyle not found — hidden contours of an inactive segmentation will still draw.');
    return false;
  }
  const target = owner as { _getContourSegmentationStyle: StyleFn & { [PATCHED]?: true } };
  if (target._getContourSegmentationStyle[PATCHED]) return true;
  const original = target._getContourSegmentationStyle;
  const patched: StyleFn & { [PATCHED]?: true } = function (this: unknown, context: StyleContext) {
    const style = original.call(this, context);
    const seg = context?.annotation?.data?.segmentation;
    const viewportId = context?.styleSpecifier?.viewportId;
    if (!seg?.segmentationId || seg.segmentIndex == null || !viewportId || style?.visibility === false) return style;
    try {
      const hidden = !lookups.representationVisible(viewportId, seg.segmentationId)
        || lookups.hiddenSegments(viewportId, seg.segmentationId).has(seg.segmentIndex);
      return hidden ? { ...style, visibility: false } : style;
    } catch {
      return style;
    }
  };
  patched[PATCHED] = true;
  target._getContourSegmentationStyle = patched;
  return true;
}
