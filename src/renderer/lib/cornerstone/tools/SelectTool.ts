/**
 * "Select" — the one selection tool of both the Structure and the Segmentation toolbox
 * (unified selection, docs/unified-selection.md). Click a contour of the active member to
 * select it; Shift-click adds or removes one; a contour of another member selects it and
 * makes that member active; click empty image to clear; drag a selected contour to move
 * the selection (contourMove). It never draws and never reshapes.
 *
 * Selecting a contour otherwise meant clicking within a few pixels of its outline with a
 * DRAWING tool — miss, and the same click started a new contour; hold, and it reshaped
 * the one you hit. The selection is what Ctrl+C / delete act on, and the selected
 * contour is drawn thicker (selectedContourStyle).
 *
 * Hit-testing uses each contour tool's own `filterInteractableAnnotationsForElement` and
 * `isPointNearTool`, so "on the contour" means exactly what it means to Cornerstone.
 * The press is consumed in `preMouseDownCallback`, so no other tool acts on it.
 */
import {
  BaseTool,
  ToolGroupManager,
  annotation as csAnnotation,
  PlanarFreehandContourSegmentationTool,
  SplineContourSegmentationTool,
  LivewireContourSegmentationTool,
} from '@cornerstonejs/tools';
import type { Types as ToolTypes } from '@cornerstonejs/tools';
import { clearMaskSelection, selectMaskIslandAt } from '../maskSelection';
import { beginContourMove } from '../contourMove';

const CONTOUR_TOOL_NAMES = [
  PlanarFreehandContourSegmentationTool.toolName,
  SplineContourSegmentationTool.toolName,
  LivewireContourSegmentationTool.toolName,
];
/** Cornerstone's mouse hit-test proximity (canvas px), as its own mouse-down uses. */
const PROXIMITY = 6;

interface HitTool {
  filterInteractableAnnotationsForElement?: (el: HTMLDivElement, a: unknown[]) => unknown[] | undefined;
  isPointNearTool?: (el: HTMLDivElement, a: unknown, canvas: number[], proximity: number, type: string) => boolean;
}

export default class SelectTool extends BaseTool {
  static toolName = 'XnatSelect';

  constructor(toolProps = {}, defaultToolProps = { supportedInteractionTypes: ['Mouse'], configuration: {} }) {
    super(toolProps, defaultToolProps);
  }

  preMouseDownCallback = (evt: ToolTypes.EventTypes.InteractionEventType): boolean => {
    const { element, currentPoints, viewportId, renderingEngineId, event } = evt.detail as typeof evt.detail & {
      event?: MouseEvent;
    };
    const hit = contourAt(element as HTMLDivElement, currentPoints.canvas, viewportId, renderingEngineId);
    const shift = !!(event?.shiftKey || event?.ctrlKey || event?.metaKey);
    if (!hit) {
      // Not on a contour: a mask island of a segment shown here?
      if (selectMaskIslandAt(viewportId, currentPoints.world as number[], shift, element as HTMLDivElement)) {
        if (!shift) csAnnotation.selection.deselectAnnotation();
        return true;
      }
      if (!shift) {
        csAnnotation.selection.deselectAnnotation();
        clearMaskSelection();
      }
      return true;
    }
    clearMaskSelection(); // a contour selection replaces any island selection
    const selected = csAnnotation.selection.getAnnotationsSelected() ?? [];
    // A selection lives inside one member: Shift only adds a contour of the member the
    // selection already belongs to. Another member's contour starts a new selection
    // (and the selection change makes that member the active one).
    const sameMember = selected.length > 0 && selected.every((uid) => sameSegment(uid, hit));
    const wasSelected = selected.includes(hit);
    if (shift && sameMember) {
      if (wasSelected) csAnnotation.selection.deselectAnnotation(hit);
      else csAnnotation.selection.setAnnotationSelected(hit, true, true);
    } else if (!wasSelected) {
      csAnnotation.selection.setAnnotationSelected(hit, true, false);
    }
    // A press on a selected contour can drag the whole selection (S8). A press on one of
    // several selected contours keeps the group so it can be dragged; released without a
    // drag, it is a plain click and narrows the selection to that contour.
    const now = csAnnotation.selection.getAnnotationsSelected() ?? [];
    if (now.includes(hit)) {
      const narrow = !shift && wasSelected && now.length > 1
        ? () => csAnnotation.selection.setAnnotationSelected(hit, true, false)
        : undefined;
      beginContourMove(element as HTMLDivElement, now, narrow);
    }
    return true; // consumed: selecting is all this tool does
  };
}

function sameSegment(a: string, b: string): boolean {
  const seg = (uid: string) =>
    (csAnnotation.state.getAnnotation(uid) as { data?: { segmentation?: { segmentationId?: string; segmentIndex?: number } } } | undefined)
      ?.data?.segmentation;
  const sa = seg(a);
  const sb = seg(b);
  return !!sa && !!sb && sa.segmentationId === sb.segmentationId && Number(sa.segmentIndex) === Number(sb.segmentIndex);
}

function contourAt(element: HTMLDivElement, canvas: number[], viewportId: string, renderingEngineId: string): string | null {
  const toolGroup = ToolGroupManager.getToolGroupForViewport(viewportId, renderingEngineId);
  if (!toolGroup) return null;
  for (const toolName of CONTOUR_TOOL_NAMES) {
    const tool = toolGroup.getToolInstance(toolName) as unknown as HitTool | undefined;
    if (!tool?.isPointNearTool || !tool.filterInteractableAnnotationsForElement) continue;
    const annotations = csAnnotation.state.getAnnotations(toolName, element) ?? [];
    const interactable = tool.filterInteractableAnnotationsForElement(element, annotations) ?? [];
    for (const raw of interactable) {
      const a = raw as { annotationUID?: string; isVisible?: boolean; parentAnnotationUID?: string };
      if (!a.annotationUID || a.isVisible === false || a.parentAnnotationUID) continue;
      if (tool.isPointNearTool(element, a, canvas, PROXIMITY, 'mouse')) return a.annotationUID;
    }
  }
  return null;
}
