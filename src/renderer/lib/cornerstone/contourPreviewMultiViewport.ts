/**
 * Multi-viewport correction for the IN-PROGRESS contour preview.
 *
 * Cornerstone renders a contour that is still being drawn from canvas coordinates
 * captured on the viewport the gesture started in, and re-uses them verbatim on every
 * other viewport the annotation renders on
 * (`tools/annotation/planarFreehandROITool/renderMethods.js`):
 *
 *     function renderContourBeingDrawn(enabledElement, svgDrawingHelper, annotation) {
 *       const { canvasPoints } = this.drawData;
 *       drawPolylineSvg(svgDrawingHelper, annotation.annotationUID, '1', canvasPoints, options);
 *     }
 *
 * `enabledElement.viewport` is never consulted — there is no worldToCanvas anywhere in
 * that path. The assumption is that an in-progress annotation is only ever on screen in
 * the viewport being drawn in, which holds for a single viewport and breaks the moment
 * the same series is open twice.
 *
 * Measured with two viewports on one scan at different zooms, drawing an open stroke:
 * mid-drag both render the polyline at canvas centre (0.300, 0.350) and 136px wide; on
 * mouse-up they become (0.303, 0.352) at 133px and (0.414, 0.435) at 58px. The stroke is
 * in the wrong anatomy, at the wrong size, until it is committed — then it snaps.
 *
 * The fix maps the points through world space for any viewport that is not the one being
 * drawn in: source.canvasToWorld → target.worldToCanvas, the same round trip the
 * committed render does. World points are not an option to read directly — during the
 * drag Cornerstone maintains only `drawData.canvasPoints`, and writes the annotation's
 * world polyline on mouse-up.
 *
 * Applied by wrapping the tool INSTANCE's own bound methods rather than by subclassing:
 * `registerDrawLoop` assigns `activateDraw` and `renderContourBeingDrawn` as own
 * properties in the constructor, so a subclass would have to re-register the tool under
 * the same name across init and every tool group. Wrapping is reversible and touches
 * nothing else.
 */
import { getEnabledElement } from '@cornerstonejs/core';
import { viewportService } from './viewportService';

/** Tools whose preview comes from PlanarFreehandROITool's draw loop. */
const PATCH_FLAG = '__xnatMultiViewportPreview';

interface PatchableToolInstance {
  drawData?: { canvasPoints?: [number, number][] };
  activateDraw?: (...args: unknown[]) => unknown;
  renderContourBeingDrawn?: (...args: unknown[]) => unknown;
  [PATCH_FLAG]?: boolean;
  __xnatDrawSourceViewportId?: string | null;
}

/**
 * Make `toolInstance`'s in-progress preview render correctly on viewports other than the
 * one being drawn in. A tool without the draw loop (no `renderContourBeingDrawn`) is left
 * alone, and patching twice is a no-op.
 */
export function applyMultiViewportContourPreview(toolInstance: unknown): void {
  const tool = toolInstance as PatchableToolInstance | null;
  if (!tool || typeof tool.renderContourBeingDrawn !== 'function') return;
  if (tool[PATCH_FLAG]) return;
  tool[PATCH_FLAG] = true;

  // Record which viewport the gesture started in. Cornerstone keeps `viewportIdsToRender`
  // (every viewport to repaint) but not the source, and the source is exactly what the
  // canvas points are expressed in.
  const baseActivateDraw = tool.activateDraw?.bind(tool);
  if (baseActivateDraw) {
    tool.activateDraw = (...args: unknown[]) => {
      const evt = args[0] as { detail?: { element?: HTMLDivElement } } | undefined;
      try {
        const el = evt?.detail?.element;
        tool.__xnatDrawSourceViewportId = el ? getEnabledElement(el)?.viewport?.id ?? null : null;
      } catch {
        tool.__xnatDrawSourceViewportId = null;
      }
      return baseActivateDraw(...args);
    };
  }

  const baseRender = tool.renderContourBeingDrawn.bind(tool);
  tool.renderContourBeingDrawn = (...args: unknown[]) => {
    const enabledElement = args[0] as { viewport?: { id?: string; worldToCanvas?: (p: number[]) => [number, number] } } | undefined;
    const target = enabledElement?.viewport;
    const sourceId = tool.__xnatDrawSourceViewportId;
    const points = tool.drawData?.canvasPoints;

    // Nothing to correct: same viewport, unknown source, or no points yet.
    if (!target?.id || !sourceId || sourceId === target.id || !points?.length) {
      return baseRender(...args);
    }

    const source = viewportService.getViewport(sourceId) as
      | { canvasToWorld?: (p: [number, number]) => number[] }
      | undefined;
    if (!source?.canvasToWorld || !target.worldToCanvas) return baseRender(...args);

    // Swap the points for the duration of the base render, so all of Cornerstone's own
    // styling, close-proximity handling and handle drawing still apply.
    const original = points;
    try {
      const mapped = original.map((p) => target.worldToCanvas!(source.canvasToWorld!(p)));
      tool.drawData!.canvasPoints = mapped;
      return baseRender(...args);
    } catch {
      // A projection failure must never abort the render of the viewport being drawn in.
      tool.drawData!.canvasPoints = original;
      return baseRender(...args);
    } finally {
      tool.drawData!.canvasPoints = original;
    }
  };
}
