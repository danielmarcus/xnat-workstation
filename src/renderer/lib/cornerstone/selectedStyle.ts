/**
 * How a selected annotation looks: its outline drawn thicker, in its own colour.
 * Selection never shows as a colour change — measurements keep the colour the user
 * picked, contours keep their segment colour.
 *
 * Measurements: `lineWidthSelected` (annotationService.applyMeasurementColor).
 * Contours: Cornerstone styles a contour segmentation from its segment alone and
 * ignores selection, so the contour tools' `getAnnotationStyle` is patched here.
 */
import { annotation as csAnnotation } from '@cornerstonejs/tools';

/** Extra outline width (px) of a selected annotation. */
export const SELECTED_EXTRA_WIDTH = 2;

const PATCH_FLAG = '__xnatSelectedContourStyle';

interface StyledTool {
  getAnnotationStyle?: (context: { annotation?: { annotationUID?: string } }) => Record<string, unknown>;
  [PATCH_FLAG]?: boolean;
}

/** Draw a selected contour thicker. Patching twice is a no-op. */
export function applySelectedContourStyle(toolInstance: unknown): void {
  const tool = toolInstance as StyledTool | null;
  if (!tool || typeof tool.getAnnotationStyle !== 'function' || tool[PATCH_FLAG]) return;
  tool[PATCH_FLAG] = true;
  const original = tool.getAnnotationStyle.bind(tool);
  tool.getAnnotationStyle = (context) => {
    const style = original(context);
    const uid = context?.annotation?.annotationUID;
    const width = Number(style?.lineWidth);
    if (!uid || !Number.isFinite(width) || !csAnnotation.selection.isAnnotationSelected(uid)) return style;
    return { ...style, lineWidth: width + SELECTED_EXTRA_WIDTH };
  };
}
