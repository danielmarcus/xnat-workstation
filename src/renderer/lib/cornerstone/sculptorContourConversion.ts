/**
 * Let the Sculptor reach spline and livewire structure contours.
 *
 * Cornerstone's SculptorTool only discovers annotations of its `referencedToolNames`
 * (PlanarFreehandROI + PlanarFreehandContourSegmentationTool by default), so on a
 * spline or livewire contour it silently did nothing. It also cannot sculpt them
 * as they are: both regenerate their polyline from control points, which would undo
 * any push/pull on the next edit.
 *
 * So the two tool names are added to its discovery list, and a mouse-down that picks
 * one of them is cancelled and replaced by a confirmation: sculpting converts the
 * contour to freehand for good (`convertContourSegmentationAnnotation`), after which
 * the next drag sculpts it normally.
 *
 * This used to live on the legacy `toolService`, whose tool group the app never
 * creates, so the running app lost it. Patching twice is a no-op.
 */
import {
  annotation as csAnnotation,
  utilities as csToolsUtilities,
  LivewireContourSegmentationTool,
  SplineContourSegmentationTool,
} from '@cornerstonejs/tools';
import { showConfirmDialog } from '../../stores/dialogStore';

const PATCH_FLAG = '__xnatSculptorAllContours';

const CONVERTIBLE_TOOL_NAMES: readonly string[] = [
  SplineContourSegmentationTool.toolName,
  LivewireContourSegmentationTool.toolName,
];

interface SculptorToolInstance {
  configuration?: { referencedToolNames?: string[] };
  commonData?: { activeAnnotationUID?: string | null };
  isActive?: boolean;
  preMouseDownCallback?: (evt: unknown) => unknown;
  [PATCH_FLAG]?: boolean;
}

export function applySculptorContourConversion(toolInstance: unknown): void {
  const tool = toolInstance as SculptorToolInstance | null;
  const referenced = tool?.configuration?.referencedToolNames;
  if (!tool || !referenced || typeof tool.preMouseDownCallback !== 'function') return;
  if (tool[PATCH_FLAG]) return;
  tool[PATCH_FLAG] = true;

  for (const name of CONVERTIBLE_TOOL_NAMES) {
    if (!referenced.includes(name)) referenced.push(name);
  }

  const original = tool.preMouseDownCallback.bind(tool);
  tool.preMouseDownCallback = (evt: unknown) => {
    const result = original(evt);

    const activeUID = tool.commonData?.activeAnnotationUID;
    if (!activeUID) return result;
    const target = csAnnotation.state.getAnnotation(activeUID);
    const toolName = target?.metadata?.toolName;
    if (!toolName || !CONVERTIBLE_TOOL_NAMES.includes(toolName)) return result;

    // Cancel the sculpt this mouse-down started: the conversion needs an answer first.
    if (tool.commonData) tool.commonData.activeAnnotationUID = null;
    tool.isActive = false;

    const kind = toolName === SplineContourSegmentationTool.toolName ? 'spline' : 'livewire';
    void showConfirmDialog({
      title: 'Convert contour for sculpting',
      message:
        `Sculpting will permanently convert this ${kind} contour to freehand. ` +
        `You will no longer be able to edit it as a ${kind}.\n\nContinue?`,
      confirmLabel: 'Convert & Sculpt',
      cancelLabel: 'Cancel',
    }).then((confirmed) => {
      if (!confirmed) return;
      csToolsUtilities.contourSegmentation.convertContourSegmentationAnnotation(
        target as Parameters<
          typeof csToolsUtilities.contourSegmentation.convertContourSegmentationAnnotation
        >[0],
      );
    });

    // Consume the event so this press does not sculpt.
    return true;
  };
}
