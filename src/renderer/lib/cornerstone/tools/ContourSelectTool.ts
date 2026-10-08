/**
 * Structure "Select": click a contour to select it; click empty image to clear the
 * selection. It never draws and never edits.
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

export default class ContourSelectTool extends BaseTool {
  static toolName = 'ContourSelect';

  constructor(toolProps = {}, defaultToolProps = { supportedInteractionTypes: ['Mouse'], configuration: {} }) {
    super(toolProps, defaultToolProps);
  }

  preMouseDownCallback = (evt: ToolTypes.EventTypes.InteractionEventType): boolean => {
    const { element, currentPoints, viewportId, renderingEngineId, event } = evt.detail as typeof evt.detail & {
      event?: MouseEvent;
    };
    const hit = contourAt(element as HTMLDivElement, currentPoints.canvas, viewportId, renderingEngineId);
    const additive = !!(event?.shiftKey || event?.ctrlKey || event?.metaKey);
    if (hit) csAnnotation.selection.setAnnotationSelected(hit, true, additive);
    else if (!additive) csAnnotation.selection.deselectAnnotation();
    return true; // consumed: selecting is all this tool does
  };
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
