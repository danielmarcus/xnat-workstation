/**
 * Unified Tool Service (Phase 1) — the single Cornerstone3D tool group for the
 * new unified-viewport path (the only viewport path).
 *
 * Replaces the old two-group split (toolService's `xnatToolGroup_primary` for
 * stack + mprToolService's `xnatToolGroup_mpr` for volume). One group serves
 * every unified Viewport — stack or volume — and uses Cornerstone's real
 * CrosshairsTool for MPR synchronization (no custom crosshair geometry, no
 * mprToolService). When the panels of an MPR layout share one volume (P1.1),
 * the CrosshairsTool draws reference lines + jumps slices across them natively.
 *
 * A/B-safe: this is a NEW, dedicated group; the old groups are left intact until
 * P1.8 flips the flag and deletes the legacy path. Self-contained singleton-
 * module following the mprToolService pattern.
 *
 * CROSSHAIRS: Cornerstone's native CrosshairsTool is registered but DISABLED and
 * is NOT the default Primary tool. It computes its center as a 3-plane
 * intersection, so it requires ≥2 NON-parallel planes — it crashes on mouse-move
 * in a single viewport and cannot sync same-plane viewports. The default Primary
 * is Window/Level; the plane-agnostic world-point crosshair (reticle + same-plane
 * nearest-slice sync + volume jumpToWorld) replaces it. This matches the prior
 * design, where ToolName.Crosshairs mapped to Window/Level for the Cornerstone
 * slot and a custom service drove the actual crosshair.
 */
import {
  ToolGroupManager,
  CrosshairsTool,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  LengthTool,
  BrushTool,
  PlanarFreehandContourSegmentationTool,
  // R3.8b — full toolbox tool set (all already addTool'd globally in init.ts).
  AngleTool,
  BidirectionalTool,
  EllipticalROITool,
  RectangleROITool,
  CircleROITool,
  ProbeTool,
  ArrowAnnotateTool,
  PlanarFreehandROITool,
  SplineContourSegmentationTool,
  LivewireContourSegmentationTool,
  CircleScissorsTool,
  RectangleScissorsTool,
  SphereScissorsTool,
  SculptorTool,
  SegmentSelectTool,
  RegionSegmentTool,
  RegionSegmentPlusTool,
  SegmentBidirectionalTool,
  TrackballRotateTool,
  RectangleROIThresholdTool,
  LabelMapEditWithContourTool,
  Enums as ToolEnums,
  utilities as csToolUtilities,
} from '@cornerstonejs/tools';
import type { Types as ToolTypes } from '@cornerstonejs/tools';
import { Enums as CoreEnums, eventTarget } from '@cornerstonejs/core';
import SafePaintFillTool from './tools/SafePaintFillTool';
import { arrowAnnotateTextCallback } from './arrowAnnotateTextPrompt';
import { ToolName } from '@shared/types/viewer';
import { viewportService } from './viewportService';
import { ensureContourEditPrereq } from './contourEditPrereq';
import { applyMultiViewportContourPreview } from './contourPreviewMultiViewport';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useSegmentationStore } from '../../stores/segmentationStore';

const UNIFIED_TOOL_GROUP_ID = 'xnatToolGroup_unified';
/** Separate group for the 3D volume-rendering slot (rotate/zoom/pan only). */
const VOLUME_3D_TOOL_GROUP_ID = 'xnatToolGroup_volume3d';

const { Primary, Auxiliary, Secondary, Wheel } = ToolEnums.MouseBindings;
const { Shift: ShiftModifier } = ToolEnums.KeyboardBindings;

/**
 * ToolName → Cornerstone tool class name, for the subset of tools the unified
 * path supports in Phase 1: navigation + crosshairs + the editing tools needed
 * for signals 1/3/6/7 (Length, freehand contour segmentation, brush).
 */
const UNIFIED_TOOL_MAP: Partial<Record<ToolName, string>> = {
  // ToolName.Crosshairs routes to Window/Level on the Cornerstone Primary slot
  // (NOT the native CrosshairsTool, which crashes in single-viewport / same-plane
  // layouts). The world-point crosshair (unifiedCrosshair) reads activeTool ===
  // Crosshairs to enable click-to-set, so a left CLICK sets the crosshair while a
  // left DRAG still does W/L — exactly the deleted design.
  [ToolName.Crosshairs]: WindowLevelTool.toolName,
  [ToolName.WindowLevel]: WindowLevelTool.toolName,
  [ToolName.Pan]: PanTool.toolName,
  [ToolName.Zoom]: ZoomTool.toolName,
  [ToolName.StackScroll]: StackScrollTool.toolName,
  [ToolName.Length]: LengthTool.toolName,
  [ToolName.FreehandContour]: PlanarFreehandContourSegmentationTool.toolName,
  [ToolName.Brush]: BrushTool.toolName,
  // ── R3.8b: full toolbox set ──
  // Brush family share BrushTool; the strategy (fill/erase/threshold) is selected
  // in setActiveTool via BRUSH_STRATEGY below.
  [ToolName.Eraser]: BrushTool.toolName,
  [ToolName.ThresholdBrush]: BrushTool.toolName,
  // Sphere variants — same BrushTool, 3D strategy (see BRUSH_STRATEGY).
  [ToolName.SphereBrush]: BrushTool.toolName,
  [ToolName.SphereEraser]: BrushTool.toolName,
  [ToolName.SphereThreshold]: BrushTool.toolName,
  [ToolName.DynamicThreshold]: BrushTool.toolName,
  // Structure (contour) tools
  [ToolName.SplineContour]: SplineContourSegmentationTool.toolName,
  [ToolName.LivewireContour]: LivewireContourSegmentationTool.toolName,
  [ToolName.Sculptor]: SculptorTool.toolName,
  // Segmentation editing tools
  [ToolName.CircleScissors]: CircleScissorsTool.toolName,
  [ToolName.RectangleScissors]: RectangleScissorsTool.toolName,
  [ToolName.SphereScissors]: SphereScissorsTool.toolName,
  [ToolName.PaintFill]: SafePaintFillTool.toolName,
  [ToolName.RegionSegment]: RegionSegmentTool.toolName,
  [ToolName.RegionSegmentPlus]: RegionSegmentPlusTool.toolName,
  [ToolName.SegmentSelect]: SegmentSelectTool.toolName,
  // SegmentBidirectional is an ACTION, not a drawing mode — the panel runs it against the
  // active segment rather than binding it to the mouse (see useAnnotationsPanel). It is
  // mapped below so the tool resolves; entering it by free-draw is what used to crash,
  // because that path sets no segmentationId and the colour lookup returns null.
  [ToolName.LabelmapEditWithContour]: LabelMapEditWithContourTool.toolName,
  // Measurement (annotation) tools
  [ToolName.Angle]: AngleTool.toolName,
  [ToolName.Bidirectional]: BidirectionalTool.toolName,
  [ToolName.EllipticalROI]: EllipticalROITool.toolName,
  [ToolName.RectangleROI]: RectangleROITool.toolName,
  [ToolName.CircleROI]: CircleROITool.toolName,
  [ToolName.Probe]: ProbeTool.toolName,
  [ToolName.ArrowAnnotate]: ArrowAnnotateTool.toolName,
  [ToolName.PlanarFreehandROI]: PlanarFreehandROITool.toolName,
  [ToolName.RectangleROIThreshold]: RectangleROIThresholdTool.toolName,
  [ToolName.SegmentBidirectional]: SegmentBidirectionalTool.toolName,
};

/**
 * Turn Cornerstone's dynamic-threshold composition on or off for the brush.
 *
 * With it on, the first click samples the voxels around it and sets the threshold range
 * from them, so the user picks the tissue rather than typing a window. With it off the
 * configured range applies.
 *
 * NB the island-removal strategy (THRESHOLD_INSIDE_SPHERE_WITH_ISLAND_REMOVAL) is NOT
 * what this tool is: island removal runs on interaction-end against a previewSegmentIndex
 * and belongs to Cornerstone's preview workflow, which this app does not implement —
 * mapped to it, the tool painted and then erased everything it had just painted.
 */
function setDynamicThreshold(toolGroup: ToolTypes.IToolGroup, isDynamic: boolean): void {
  try {
    const config = toolGroup.getToolConfiguration(BrushTool.toolName) as
      | { threshold?: Record<string, unknown> }
      | undefined;
    toolGroup.setToolConfiguration(BrushTool.toolName, {
      threshold: {
        ...(config?.threshold ?? {}),
        isDynamic,
        // Sampling radius around the click, in voxels. Null range lets the composition
        // compute one; leaving a stale range would suppress the sampling entirely.
        ...(isDynamic
          ? { dynamicRadius: useSegmentationStore.getState().samplingRadius, range: null }
          // Clearing dynamicRadiusInCanvas matters: the circularCursor composition draws
          // its second sampling ring whenever that value is truthy, REGARDLESS of
          // isDynamic. Left set, every brush selected after Dyn. Thresh kept showing two
          // rings.
          : { dynamicRadius: 0, dynamicRadiusInCanvas: 0 }),
      },
    });
  } catch (err) {
    console.warn('[unifiedToolService] setDynamicThreshold failed:', err);
  }
}

/** Brush variants gated on the intensity window. */
const THRESHOLD_BRUSH_TOOLS = new Set<ToolName>([
  ToolName.ThresholdBrush,
  ToolName.SphereThreshold,
  ToolName.DynamicThreshold,
]);

/** Brush-family strategy per ToolName (all share BrushTool). */
/**
 * Scissors strategy. Cornerstone 4.16.1 registers exactly two strategies on each of the
 * three scissors tools — FILL_INSIDE (default) and ERASE_INSIDE. The "outside" variants
 * are not usable: fillOutsideCircle/fillOutsideSphere throw 'Not yet implemented', and
 * eraseOutsideRectangle ignores its own `inside` flag and erases inside. So erase-inside
 * is the whole of the additional behaviour on offer.
 *
 * Which of the two is active comes from the user's preference, inverted while Shift is
 * held. This machinery existed only on the legacy `toolService`, whose `initialize()`
 * the app never calls — so the Settings preference and the Shift modifier were both dead
 * on the path that actually runs. Ported here.
 */
type ScissorStrategyName = 'FILL_INSIDE' | 'ERASE_INSIDE';

const SCISSORS_TOOLS = new Set<ToolName>([
  ToolName.CircleScissors,
  ToolName.RectangleScissors,
  ToolName.SphereScissors,
]);

/** True while Shift is held, which swaps fill↔erase for the duration. */
let scissorShiftPressed = false;
let scissorModifierListenersInstalled = false;

function primaryScissorStrategy(): ScissorStrategyName {
  return usePreferencesStore.getState().preferences.annotation.scissors.defaultStrategy === 'fill'
    ? 'FILL_INSIDE'
    : 'ERASE_INSIDE';
}

function effectiveScissorStrategy(): ScissorStrategyName {
  const primary = primaryScissorStrategy();
  if (!scissorShiftPressed) return primary;
  return primary === 'FILL_INSIDE' ? 'ERASE_INSIDE' : 'FILL_INSIDE';
}

/**
 * Cornerstone's cursor SVGs are named per tool+strategy and do NOT line up with the
 * strategy names: there is a CircleScissor.ERASE_OUTSIDE cursor but no ERASE_INSIDE one,
 * and SphereScissor has no cursor family at all. Map onto what actually ships, or the
 * cursor silently falls back to the previous tool's.
 */
function scissorCursorFor(
  csToolName: string,
  strategy: ScissorStrategyName,
): { cursorToolName: string; cursorStrategy: string } {
  const normalized = csToolName.replace(/Scissors$/, 'Scissor');
  if (normalized === 'SphereScissor') {
    return {
      cursorToolName: 'CircleScissor',
      cursorStrategy: strategy === 'ERASE_INSIDE' ? 'ERASE_OUTSIDE' : 'FILL_INSIDE',
    };
  }
  if (normalized === 'CircleScissor' && strategy === 'ERASE_INSIDE') {
    return { cursorToolName: 'CircleScissor', cursorStrategy: 'ERASE_OUTSIDE' };
  }
  return { cursorToolName: normalized, cursorStrategy: strategy };
}

/** Push the effective strategy (and its cursor) onto the active scissors tool. */
function syncActiveScissorStrategy(): void {
  const toolGroup = getToolGroup();
  if (!toolGroup) return;
  if (activeToolName === null || !SCISSORS_TOOLS.has(activeToolName)) return;
  const csName = UNIFIED_TOOL_MAP[activeToolName];
  if (!csName) return;
  const strategy = effectiveScissorStrategy();
  try {
    toolGroup.setActiveStrategy(csName, strategy);
  } catch {
    /* default strategy */
  }
  const { cursorToolName, cursorStrategy } = scissorCursorFor(csName, strategy);
  (
    toolGroup as unknown as {
      setViewportsCursorByToolName?: (toolName: string, strategy?: string) => void;
    }
  ).setViewportsCursorByToolName?.(cursorToolName, cursorStrategy);
}

function isShiftKeyEvent(evt: Event): boolean {
  const key = (evt as KeyboardEvent).key;
  return key === 'Shift' || key === 'ShiftLeft' || key === 'ShiftRight';
}

function onScissorShiftDown(evt: Event): void {
  if (!isShiftKeyEvent(evt) || scissorShiftPressed) return;
  scissorShiftPressed = true;
  syncActiveScissorStrategy();
}

function onScissorShiftUp(evt: Event): void {
  if (!isShiftKeyEvent(evt) || !scissorShiftPressed) return;
  scissorShiftPressed = false;
  syncActiveScissorStrategy();
}

function installScissorModifierListeners(): void {
  if (scissorModifierListenersInstalled) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  // Capture phase, matching the hotkey listener's convention: the modifier must be
  // observed regardless of what holds focus, and ViewerPage's lifecycle test asserts
  // every keydown listener it installs is a capturing one.
  window.addEventListener('keydown', onScissorShiftDown, { capture: true });
  window.addEventListener('keyup', onScissorShiftUp, { capture: true });
  scissorModifierListenersInstalled = true;
}

function removeScissorModifierListeners(): void {
  if (!scissorModifierListenersInstalled) return;
  scissorModifierListenersInstalled = false;
  scissorShiftPressed = false;
  if (typeof window === 'undefined' || typeof window.removeEventListener !== 'function') return;
  window.removeEventListener('keydown', onScissorShiftDown, { capture: true });
  window.removeEventListener('keyup', onScissorShiftUp, { capture: true });
}

const BRUSH_STRATEGY: Partial<Record<ToolName, string>> = {
  [ToolName.Brush]: 'FILL_INSIDE_CIRCLE',
  [ToolName.Eraser]: 'ERASE_INSIDE_CIRCLE',
  [ToolName.ThresholdBrush]: 'THRESHOLD_INSIDE_CIRCLE',
  // Sphere variants: a 3D kernel, so one stroke writes into neighbouring slices too.
  // Cornerstone ships all of these on BrushTool already; only the mapping was missing.
  [ToolName.SphereBrush]: 'FILL_INSIDE_SPHERE',
  [ToolName.SphereEraser]: 'ERASE_INSIDE_SPHERE',
  [ToolName.SphereThreshold]: 'THRESHOLD_INSIDE_SPHERE',
  [ToolName.DynamicThreshold]: 'THRESHOLD_INSIDE_CIRCLE',
};

/**
 * Contour-segmentation tools that support inter-slice interpolation (signal 13). When
 * `interpolation.enabled` is set on these, drawing contours on non-adjacent slices of
 * the same segment makes Cornerstone auto-generate the in-between contours. The legacy
 * tool group configured this; the unified group must too, or interpolation is silently
 * off on the active path.
 */
const CONTOUR_INTERPOLATION_TOOL_NAMES = [
  PlanarFreehandContourSegmentationTool.toolName,
  SplineContourSegmentationTool.toolName,
  LivewireContourSegmentationTool.toolName,
  LabelMapEditWithContourTool.toolName,
] as const;

/** Apply the interpolation flag to every contour-interpolation tool in the group. */
function applyInterpolation(toolGroup: ToolTypes.IToolGroup, enabled: boolean): void {
  for (const toolName of CONTOUR_INTERPOLATION_TOOL_NAMES) {
    try {
      toolGroup.setToolConfiguration(toolName, { interpolation: { enabled } });
    } catch (err) {
      console.debug(`[unifiedToolService] interpolation config for ${toolName} failed:`, err);
    }
  }
}

/**
 * Fixed, non-Primary mouse binding for the nav tools — always preserved so
 * middle/right/wheel navigation survives Primary-tool swaps. Tools NOT listed
 * (W/L, Length, Freehand, Brush) live only on the Primary slot, so they demote
 * cleanly to passive. The previous PRIMARY_CAPABLE approach left Pan/Zoom's
 * Primary binding stuck (it never demoted them), so a later Zoom collided with a
 * still-Primary Pan and never took the left button.
 */
const NAV_BASE_BINDING: Record<string, number> = {
  [PanTool.toolName]: Auxiliary,
  [ZoomTool.toolName]: Secondary,
  [StackScrollTool.toolName]: Wheel,
};

/**
 * Handle-based annotation tools (measurement + contour-segmentation) whose existing
 * annotations can be GRABBED and dragged whenever the tool is merely Passive. We keep
 * them ENABLED (rendered, view-only) when they're not the active tool, so an existing
 * structure contour / measurement can only be edited when its own tool is active — a
 * measurement tool active no longer lets you drag a structure contour. Brush/scissors/
 * labelmap tools aren't handle-based (no draggable handles), so they demote to Passive
 * as before; nav tools keep their fixed bindings.
 */
const HANDLE_EDITABLE_TOOL_NAMES: ReadonlySet<string> = new Set([
  LengthTool.toolName, AngleTool.toolName, BidirectionalTool.toolName,
  EllipticalROITool.toolName, RectangleROITool.toolName, CircleROITool.toolName,
  ProbeTool.toolName, ArrowAnnotateTool.toolName, PlanarFreehandROITool.toolName,
  PlanarFreehandContourSegmentationTool.toolName, SplineContourSegmentationTool.toolName,
  LivewireContourSegmentationTool.toolName, SculptorTool.toolName,
]);

/** Idle (not-the-active-tool) mode: handle-based annotation tools go view-only
 *  (Enabled) so their annotations can't be grabbed; everything else stays Passive. */
/**
 * Apply a threshold ROI when it is completed, once per app.
 *
 * Listens for ANNOTATION_COMPLETED rather than hooking the tools, so it survives the tool
 * instances being re-created on a tool-group rebuild.
 */
/** The viewport an annotation event came from, via its element. */
function resolveViewportIdFromEvent(evt: Event): string | null {
  const el = ((evt as CustomEvent).detail as { element?: HTMLElement } | undefined)?.element;
  if (!el) return null;
  return el.closest('[data-panel-id]')?.getAttribute('data-panel-id') ?? null;
}

let roiThresholdWired = false;
function wireRoiThresholdFill(): void {
  if (roiThresholdWired) return;
  roiThresholdWired = true;
  eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_COMPLETED, (evt: Event) => {
    const detail = (evt as CustomEvent).detail as
      | { annotation?: { metadata?: { toolName?: string } } }
      | undefined;
    const toolName = detail?.annotation?.metadata?.toolName;
    if (toolName !== RectangleROIThresholdTool.toolName) {
      return;
    }
    // The viewport comes from the event, not from a store: importing viewerStore or
    // unifiedSegService at module scope here drags @cornerstonejs/polymorphic-segmentation
    // into this module's graph, and its top-level code reads Enums.Events at import time —
    // which breaks every test file that partially mocks @cornerstonejs/core. toolService's
    // suite stopped collecting entirely (15 tests silently SKIPPED, not failed) when those
    // imports were added. unifiedSegService is therefore resolved lazily, inside the
    // handler, where the module graph is already live.
    setTimeout(() => {
      void Promise.all([import('./unifiedSegService'), import('../../stores/viewerStore')]).then(
        ([seg, viewer]) => {
          const viewportId =
            (detail as { viewportId?: string } | undefined)?.viewportId ??
            resolveViewportIdFromEvent(evt) ??
            viewer.useViewerStore.getState().activeViewportId;
          if (viewportId) seg.unifiedSegService.applyRoiThresholdFill(viewportId);
        },
      );
    }, 0);
  });
}

/**
 * Tools that must be DISABLED when idle, not merely passive.
 *
 * A passive tool still receives mouse-move events. RegionSegmentPlusTool writes
 * `element.style.cursor = 'not-allowed'` from its move handler whenever its seed
 * heuristic is unsatisfied, so once it had been used every later tool showed a forbidden
 * cursor over a viewport it could edit perfectly well — re-applied on every mouse move,
 * which is why clearing the cursor on tool change was not enough.
 *
 * It has nothing to display when idle (its output is labelmap voxels, and its seeds are
 * transient), so disabling costs nothing.
 */
const DISABLE_WHEN_IDLE = new Set<string>([RegionSegmentPlusTool.toolName]);

function setIdleToolMode(toolGroup: ToolTypes.IToolGroup, toolName: string): void {
  try {
    if (DISABLE_WHEN_IDLE.has(toolName)) toolGroup.setToolDisabled(toolName);
    else if (HANDLE_EDITABLE_TOOL_NAMES.has(toolName)) toolGroup.setToolEnabled(toolName);
    else toolGroup.setToolPassive(toolName);
  } catch {
    /* not all tools support every mode; safe to ignore */
  }
}

// The tool currently bound to Primary; tracked so we demote it (rather than
// re-`setToolActive` everything, which MERGES bindings in CS3D v4) on a switch.
// Default = Window/Level (the native CrosshairsTool is disabled — see header).
let currentPrimary: string = WindowLevelTool.toolName;
// The active ToolName (UI-level), null until an explicit selection.
let activeToolName: ToolName | null = null;

function getToolGroup(): ToolTypes.IToolGroup | undefined {
  return ToolGroupManager.getToolGroup(UNIFIED_TOOL_GROUP_ID);
}

/**
 * Create + configure the unified tool group if it does not already exist.
 * Idempotent: the group is long-lived; viewports come and go via add/remove.
 */
function ensureToolGroup(): ToolTypes.IToolGroup | undefined {
  const existing = getToolGroup();
  if (existing) return existing;

  const toolGroup = ToolGroupManager.createToolGroup(UNIFIED_TOOL_GROUP_ID);
  if (!toolGroup) {
    console.error('[unifiedToolService] Failed to create tool group');
    return undefined;
  }

  // Navigation + crosshairs.
  toolGroup.addTool(CrosshairsTool.toolName);
  toolGroup.addTool(WindowLevelTool.toolName);
  toolGroup.addTool(PanTool.toolName);
  toolGroup.addTool(ZoomTool.toolName);
  toolGroup.addTool(StackScrollTool.toolName);
  // Editing tools (P1.7): measurement, freehand contour segmentation, brush.
  toolGroup.addTool(LengthTool.toolName);
  toolGroup.addTool(PlanarFreehandContourSegmentationTool.toolName);
  toolGroup.addTool(BrushTool.toolName);
  // R3.8b — full toolbox set (each globally addTool'd in init.ts). Added passive;
  // setActiveTool promotes one to Primary on demand.
  const FULL_SET = [
    AngleTool, BidirectionalTool, EllipticalROITool, RectangleROITool, CircleROITool,
    ProbeTool, ArrowAnnotateTool, PlanarFreehandROITool, SplineContourSegmentationTool,
    LivewireContourSegmentationTool, CircleScissorsTool, RectangleScissorsTool,
    SphereScissorsTool, SafePaintFillTool, SculptorTool, SegmentSelectTool,
    RegionSegmentTool, RegionSegmentPlusTool, SegmentBidirectionalTool,
    RectangleROIThresholdTool, LabelMapEditWithContourTool,
  ];
  // Per-tool addTool configuration. Most of FULL_SET needs none, but a tool whose
  // Cornerstone default is unusable in Electron must get its override HERE — the
  // legacy group's config does not carry over, and a missing one fails silently.
  const TOOL_CONFIG: Record<string, Record<string, unknown>> = {
    // Without this, completing an arrow calls Cornerstone's default getTextCallback
    // → window.prompt(), which Electron blocks, so no label prompt ever appears.
    [ArrowAnnotateTool.toolName]: {
      getTextCallback: arrowAnnotateTextCallback,
      changeTextCallback: arrowAnnotateTextCallback,
    },
  };
  for (const Tool of FULL_SET) {
    try {
      toolGroup.addTool(Tool.toolName, TOOL_CONFIG[Tool.toolName]);
    } catch (err) {
      console.warn(`[unifiedToolService] addTool ${Tool.toolName} failed:`, err);
    }
  }

  // Default Primary (left-click) = Window/Level. The native CrosshairsTool is
  // DISABLED: it needs ≥2 non-parallel planes, so it crashes on mouse-move in a
  // single viewport (see header). It stays registered (for hasCrosshairs / future
  // routing) but inert; the world-point crosshair replaces it.
  toolGroup.setToolActive(WindowLevelTool.toolName, { bindings: [{ mouseButton: Primary }] });
  toolGroup.setToolDisabled(CrosshairsTool.toolName);
  // Pan: middle-click · Zoom: right-click · StackScroll: wheel (slice nav).
  // These fixed bindings are set ONCE here and never re-set (CS3D v4
  // setToolActive merges bindings), so setActiveTool only swaps the Primary slot.
  toolGroup.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: Auxiliary }] });
  toolGroup.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: Secondary }] });
  toolGroup.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: Wheel }] });
  // Editing tools start idle (visible, not the active primary). Handle-based
  // annotation tools idle as ENABLED (view-only) so existing structure contours /
  // measurements aren't grabbable until their own tool is active; the rest go Passive.
  setIdleToolMode(toolGroup, LengthTool.toolName);
  setIdleToolMode(toolGroup, PlanarFreehandContourSegmentationTool.toolName);
  for (const Tool of FULL_SET) {
    setIdleToolMode(toolGroup, Tool.toolName);
  }

  // Threshold ROIs are an instruction, not an annotation: when one is finished, fill the
  // active segment inside it and clear the box. Cornerstone applies nothing itself — the
  // tools draw a region and stop, which is why both shipped registered, drawable and
  // completely without effect.
  wireRoiThresholdFill();

  // In-progress contour preview across viewports. Cornerstone draws a contour that is
  // still being drawn from the SOURCE viewport's canvas coordinates and reuses them
  // verbatim everywhere else, so with one scan open twice at different zooms the stroke
  // appears in the wrong anatomy, at the wrong size, until mouse-up snaps it into place.
  for (const toolName of [
    PlanarFreehandContourSegmentationTool.toolName,
    PlanarFreehandROITool.toolName,
  ]) {
    try {
      applyMultiViewportContourPreview(toolGroup.getToolInstance(toolName));
    } catch (err) {
      console.warn(`[unifiedToolService] contour preview patch for ${toolName} failed:`, err);
    }
  }

  // Inter-slice contour interpolation (signal 13): enable per the user's preference so
  // drawing contours on non-adjacent slices auto-generates the in-between contours.
  applyInterpolation(toolGroup, usePreferencesStore.getState().preferences.interpolation.enabled);

  currentPrimary = WindowLevelTool.toolName;
  console.log('[unifiedToolService] Unified tool group initialized');
  return toolGroup;
}


/**
 * Clear the brush hover cursor on the whole brush family.
 *
 * Cornerstone's BrushTool keeps its cursor in `_hoverData` and only clears it when the
 * tool stops being active (onSetToolPassive / Enabled / Disabled). Its `renderAnnotation`
 * checks only that hover data exists and that the viewport is in the render list — never
 * that the CURRENT SLICE is the one the cursor was hovered on. So a single hover left a
 * circle drawn on every slice the user scrolled to, and with the pointer outside the
 * viewport entirely, for as long as a brush was selected. Users read that persistent
 * outline as the segmentation mask appearing on slices they never painted.
 *
 * Cornerstone gives us no hook for "pointer left", "slice changed" or "tool changed", so
 * the lifecycle is wired here: the cursor is dropped on all three, and Cornerstone
 * recreates it on the next mousemove over the viewport.
 *
 * The tool-change case is why switching tools looked erratic. Cornerstone clears the
 * cursor when the BrushTool itself stops being active, but every brush variant IS
 * BrushTool — only the strategy differs — so a Brush→Sph. Brush switch never triggers
 * that, and the old circle stayed on screen beside the new one. Measured: two cursor
 * circles after a sphere switch, one otherwise, depending on what was selected before.
 */
function clearBrushHoverCursor(): void {
  const toolGroup = getToolGroup();
  if (!toolGroup) return;
  try {
    const brush = toolGroup.getToolInstance(BrushTool.toolName) as
      | { disableCursor?: () => void }
      | undefined;
    brush?.disableCursor?.();
  } catch {
    /* tool not registered yet */
  }
}

/**
 * Cancel Region+'s pending seed evaluation when the user leaves the tool.
 *
 * RegionSegmentPlusTool debounces its seed heuristic behind `this.mouseTimer`. The
 * callback has no mode guard, so it routinely fires AFTER the user has switched tools and
 * writes `element.style.cursor = 'not-allowed'` — then re-asserts it from a
 * requestAnimationFrame. Re-applying the correct cursor could not reliably beat it: the
 * timer fires on its own schedule, which is often later than any frame we can wait for.
 *
 * Reaching into the instance is deliberate and narrow. The alternative is a cursor that
 * silently turns "forbidden" some hundreds of milliseconds after the user has moved on to
 * a tool that works.
 */
function cancelRegionPlusPendingCursor(): void {
  const toolGroup = getToolGroup();
  if (!toolGroup) return;
  try {
    const tool = toolGroup.getToolInstance(RegionSegmentPlusTool.toolName) as
      | { mouseTimer?: ReturnType<typeof setTimeout> | null }
      | undefined;
    if (tool?.mouseTimer != null) {
      clearTimeout(tool.mouseTimer);
      tool.mouseTimer = null;
    }
  } catch {
    /* tool not registered */
  }
}

/**
 * The cursor each tool should show. Absent = the browser default.
 *
 * The app OWNS the viewport cursor rather than inheriting whatever the last tool left.
 * That is not tidiness: RegionSegmentPlusTool schedules a DEBOUNCED timer on mouse-move
 * which, when it fires, writes `element.style.cursor = 'not-allowed'` and re-asserts it
 * from a requestAnimationFrame. The timer has no mode guard, so it routinely fires after
 * the user has already switched tools — leaving a "forbidden" cursor over a viewport the
 * new tool can edit perfectly well. Clearing at tool-change time always lost that race.
 *
 * Region+ is deliberately excluded below: while it is ACTIVE its cursor is real feedback
 * (copy / not-allowed / wait) and must not be overwritten.
 */
const CURSOR_FOR_TOOL: Partial<Record<ToolName, string>> = {
  [ToolName.RectangleROIThreshold]: 'crosshair',
  [ToolName.PaintFill]: 'cell',
  [ToolName.RegionSegment]: 'crosshair',
  [ToolName.SegmentSelect]: 'pointer',
  [ToolName.LabelmapEditWithContour]: 'crosshair',
};

/** Tools that manage their own cursor as live feedback while active. */
const OWNS_ITS_CURSOR = new Set<ToolName>([
  ToolName.RegionSegmentPlus,
  // The shape tools' cursor is set by syncActiveScissorStrategy through Cornerstone,
  // and it encodes the active mode (a green + for fill, a red one for erase). Writing a
  // CSS 'crosshair' over it as well meant the crosshair showed on selection and the real
  // cursor only appeared after the first drag re-asserted it.
  ToolName.CircleScissors,
  ToolName.RectangleScissors,
  ToolName.SphereScissors,
]);

/**
 * Put the active tool's cursor on every viewport, replacing anything stale.
 *
 * Re-asserted on mouse-move as well as on tool change, because the stale write can arrive
 * from a timer scheduled before the switch.
 */
function applyToolCursor(): void {
  const toolName = activeToolName;
  if (!toolName || OWNS_ITS_CURSOR.has(toolName)) return;
  const wanted = CURSOR_FOR_TOOL[toolName] ?? '';
  const write = () => {
    if (activeToolName !== toolName) return; // the tool changed again mid-flight
    for (const viewportId of unifiedToolService.getViewportIds()) {
      const el = viewportService.getElement(viewportId) as HTMLElement | null;
      if (el && el.style.cursor !== wanted) el.style.cursor = wanted;
    }
  };
  write();
  // Region+ re-asserts its own cursor from a single requestAnimationFrame after its
  // debounced timer fires, which beats a synchronous write. A deferred second pass lands
  // after that rAF, so the last word is the active tool's.
  requestAnimationFrame(() => requestAnimationFrame(write));
}

/** Attach the brush-cursor lifecycle Cornerstone does not provide. Idempotent per element. */
const BRUSH_CURSOR_WIRED = new WeakSet<HTMLElement>();
function wireBrushCursorLifecycle(viewportId: string): void {
  const element = viewportService.getElement(viewportId) as HTMLElement | null;
  if (!element || BRUSH_CURSOR_WIRED.has(element)) return;
  BRUSH_CURSOR_WIRED.add(element);

  const clear = () => {
    clearBrushHoverCursor();
    cancelRegionPlusPendingCursor();
    try {
      csToolUtilities.triggerAnnotationRenderForViewportIds([viewportId]);
    } catch {
      /* best effort repaint */
    }
  };

  element.addEventListener('mouseleave', clear);
  // A tool the user has LEFT can still write a cursor from a pending timer, so the active
  // tool's cursor is re-asserted as the pointer moves, not only when the tool changes.
  element.addEventListener('mousemove', applyToolCursor);
  // Scrolling to another slice must drop a cursor drawn for the previous one.
  element.addEventListener(CoreEnums.Events.STACK_NEW_IMAGE, clear as EventListener);
  element.addEventListener(CoreEnums.Events.VOLUME_NEW_IMAGE, clear as EventListener);
}

export const unifiedToolService = {
  UNIFIED_TOOL_GROUP_ID,

  /** Tool group id for the unified path. */
  getToolGroupId(): string {
    return UNIFIED_TOOL_GROUP_ID;
  },

  /** Ensure the group exists (configured). Safe to call repeatedly. */
  initialize(): void {
    ensureToolGroup();
    installScissorModifierListeners();
  },

  /** Whether this tool sets its own cursor (the service must not write a CSS one). */
  ownsItsCursor(toolName: ToolName): boolean {
    return OWNS_ITS_CURSOR.has(toolName);
  },

  /**
   * Re-apply the persisted scissor preference to the live tool group. Called by
   * applyPreferences whenever settings change; a no-op unless a scissors tool is the
   * active one, since the strategy is pushed on selection anyway.
   */
  applyScissorPreferences(): void {
    syncActiveScissorStrategy();
  },

  /**
   * Single entry point for the shape tools' add/remove mode: persists the preference
   * AND pushes it at the live tool group. The toolbox toggle and the Settings modal
   * both land here, so neither can set one without the other.
   */
  setScissorMode(mode: 'fill' | 'erase'): void {
    usePreferencesStore.getState().setScissorDefaultStrategy(mode);
    syncActiveScissorStrategy();
  },

  /**
   * Set the active (Primary / left-click) tool. Swaps only the Primary slot: the
   * prior primary is demoted (its Primary binding removed; if it's a nav tool its
   * fixed middle/right/wheel binding is restored), then the new tool takes
   * Primary. Exactly one tool ever holds the Primary binding.
   */
  setActiveTool(toolName: ToolName): void {
    const toolGroup = ensureToolGroup();
    if (!toolGroup) return;
    const csName = UNIFIED_TOOL_MAP[toolName];
    if (!csName) {
      console.warn('[unifiedToolService] Unsupported tool for unified path:', toolName);
      return;
    }
    // Drop any brush cursor the previous tool left behind. Cornerstone clears it when
    // BrushTool stops being active, but every brush variant IS BrushTool — only the
    // strategy differs — so a Brush→Sph. Brush switch never triggers that and the old
    // circle stayed on screen beside the new one. Unconditional because it is free:
    // Cornerstone recreates the cursor on the next mousemove over the viewport.
    clearBrushHoverCursor();
    // Contour Fill (signal 30): the LabelmapEditWithContour tool draws a contour
    // segmentation that it rasterizes into the active labelmap — but it THROWS on
    // draw-start unless the active labelmap already carries a Contour representation.
    // Add it at activation time (the tool's own reactive setup doesn't fire when the
    // viewport + seg already exist). Runs before the early-return so re-selecting the
    // tool after switching the active segment re-establishes the prerequisite.
    if (toolName === ToolName.LabelmapEditWithContour) {
      ensureContourEditPrereq(toolGroup.getViewportIds());
    }
    // Brush family (Brush / Eraser / ThresholdBrush) all share BrushTool — only the
    // active STRATEGY differs (fill / erase / threshold). The strategy must be set on
    // EVERY selection, including switches WITHIN the family: Brush→Eraser keep the same
    // BrushTool primary binding, so they hit the `csName === currentPrimary` early
    // return below — selecting it after the binding swap would never run. Set it here,
    // before the early return, so the eraser actually erases.
    if (csName === BrushTool.toolName) {
      try {
        toolGroup.setActiveStrategy(BrushTool.toolName, BRUSH_STRATEGY[toolName] ?? 'FILL_INSIDE_CIRCLE');
      } catch {
        /* default strategy */
      }
      // The threshold strategy fails OPEN: Cornerstone's threshold composition returns
      // `true` for every voxel when no range is configured, so THRESHOLD_INSIDE_CIRCLE
      // without a range is byte-for-byte the plain fill brush. Push the range on every
      // selection (same reason as the strategy above — re-selection must re-apply it).
      // Every threshold variant needs the intensity window pushed on selection, not just
      // the circle one — the strategy reads it from tool configuration, and a sphere
      // threshold with no window set paints as an ordinary brush.
      if (THRESHOLD_BRUSH_TOOLS.has(toolName)) {
        unifiedToolService.setBrushThreshold(useSegmentationStore.getState().thresholdRange);
      }
      // Dynamic threshold derives its window from the voxel under the initial click
      // instead of using the configured one. Cornerstone's dynamicThreshold composition
      // is present in every threshold strategy but does nothing unless isDynamic is set,
      // so this flag is the whole difference between this tool and Threshold Brush. It is
      // cleared for the other variants, or a previous selection would leave them dynamic.
      setDynamicThreshold(toolGroup, toolName === ToolName.DynamicThreshold);
    }
    // Scissors: same shape of problem as the brush family. The strategy is sticky on the
    // Cornerstone tool instance, and re-selecting a scissors tool (or changing the mode
    // while it is already active) hits the `csName === currentPrimary` early return
    // below — so it has to be applied here, ahead of it, or the mode change never lands.
    // activeToolName is set before syncing so the sync knows which tool to act on.
    if (SCISSORS_TOOLS.has(toolName)) {
      activeToolName = toolName;
      syncActiveScissorStrategy();
    }
    if (csName === currentPrimary) {
      activeToolName = toolName;
      applyToolCursor();
      return;
    }

    // Demote the current primary: clear ALL its bindings (removing the stale
    // Primary binding), then restore its fixed nav binding if it has one
    // (Pan=middle, Zoom=right, StackScroll=wheel). Doing this for every tool —
    // not just a PRIMARY_CAPABLE subset — is what stops Pan/Zoom from getting
    // stuck on the left button and blocking subsequent tool switches. Handle-based
    // annotation tools demote to ENABLED (view-only) so they're not editable while idle.
    setIdleToolMode(toolGroup, currentPrimary);
    const oldBase = NAV_BASE_BINDING[currentPrimary];
    if (oldBase !== undefined) {
      toolGroup.setToolActive(currentPrimary, { bindings: [{ mouseButton: oldBase }] });
    }

    // Promote the new tool to Primary (merges with its own fixed nav binding,
    // which was set in ensureToolGroup and left intact above).
    // Cornerstone's active-tool dispatch requires an EXACT modifier match. The shape
    // tools invert their mode while Shift is held, so without a Shift+Primary binding
    // holding Shift stops preMouseDownCallback ever reaching the tool and nothing is
    // drawn — the mode flips and the drag does nothing.
    const bindings: Array<{ mouseButton: number; modifierKey?: number }> = [
      { mouseButton: Primary },
    ];
    if (SCISSORS_TOOLS.has(toolName)) {
      bindings.push({ mouseButton: Primary, modifierKey: ShiftModifier });
    }
    toolGroup.setToolActive(csName, { bindings });
    currentPrimary = csName;
    activeToolName = toolName;
    applyToolCursor();
    console.log('[unifiedToolService] Active tool:', toolName, '->', csName);
  },

  /** The active (Primary) ToolName, or null before any explicit selection. */
  getActiveToolName(): ToolName | null {
    return activeToolName;
  },

  /** Whether a tool is registered on the unified path (setActiveTool will activate it). */
  isToolSupported(toolName: ToolName): boolean {
    return UNIFIED_TOOL_MAP[toolName] !== undefined;
  },

  /** Cornerstone mode of a tool in the unified group ('Active'/'Passive'/…), or null. */
  getToolMode(csToolName: string): string | null {
    const opts = getToolGroup()?.getToolOptions(csToolName) as { mode?: string } | undefined;
    return opts?.mode ?? null;
  },

  /**
   * Cornerstone tool names that currently hold the Primary (left-click) binding.
   * Invariant: exactly one. More than one means a binding leaked (the Pan/Zoom
   * bug) — used by the tool-switching regression test.
   */
  getToolsWithPrimaryBinding(): string[] {
    const toolGroup = getToolGroup();
    if (!toolGroup) return [];
    const names = [
      WindowLevelTool.toolName,
      PanTool.toolName,
      ZoomTool.toolName,
      StackScrollTool.toolName,
      LengthTool.toolName,
      PlanarFreehandContourSegmentationTool.toolName,
      BrushTool.toolName,
      CrosshairsTool.toolName,
    ];
    return names.filter((name) => {
      const opts = toolGroup.getToolOptions(name) as
        | { bindings?: Array<{ mouseButton?: number }> }
        | undefined;
      return (opts?.bindings ?? []).some((b) => b.mouseButton === Primary);
    });
  },

  /**
   * Set the brush radius — the SINGLE entry point for brush size (Phase-6 cutover).
   * Clamps to [1,100], writes Cornerstone's unified tool group (the only group the
   * brush runs on) AND `segmentationStore.brushSize`, which is the one piece of
   * state the UI (panel slider) and the `[` / `]` hotkeys both read. Callers must
   * not write the store separately.
   */
  setBrushSize(size: number): void {
    const clamped = Math.max(1, Math.min(100, Math.round(size)));
    try {
      csToolUtilities.segmentation.setBrushSizeForToolGroup(UNIFIED_TOOL_GROUP_ID, clamped);
    } catch (err) {
      console.warn('[unifiedToolService] setBrushSize failed:', err);
    }
    useSegmentationStore.getState().setBrushSize(clamped);
  },

  /**
   * Set the intensity range for the threshold-brush family — the SINGLE entry point
   * (same contract as setBrushSize): writes Cornerstone's unified tool group AND
   * `segmentationStore.thresholdRange`, which the panel control reads and which
   * setActiveTool replays on every ThresholdBrush selection. Callers must not write
   * the store separately.
   *
   * Cornerstone applies the range only to tools whose ACTIVE strategy is a threshold
   * strategy; setActiveTool sets THRESHOLD_INSIDE_CIRCLE before calling this.
   * Reversed input is normalised — an inverted window would silently match nothing.
   */
  setBrushThreshold(range: [number, number]): void {
    const ordered: [number, number] = range[0] <= range[1] ? [range[0], range[1]] : [range[1], range[0]];
    try {
      csToolUtilities.segmentation.setBrushThresholdForToolGroup(UNIFIED_TOOL_GROUP_ID, { range: ordered } as never);
    } catch (err) {
      console.warn('[unifiedToolService] setBrushThreshold failed:', err);
    }
    useSegmentationStore.getState().setThresholdRange(ordered);
  },

  /**
   * Sampling radius (voxels) the dynamic-threshold brush reads around the first click.
   * Single entry point, like setBrushSize: writes the tool group AND the store the
   * toolbox slider reads, and re-applies immediately so a change mid-session takes hold
   * without re-selecting the tool.
   */
  setSamplingRadius(radius: number): void {
    useSegmentationStore.getState().setSamplingRadius(radius);
    const toolGroup = getToolGroup();
    if (toolGroup && activeToolName === ToolName.DynamicThreshold) {
      setDynamicThreshold(toolGroup, true);
    }
  },

  /** Enable/disable inter-slice contour interpolation live (signal 13). Idempotent. */
  setInterpolationEnabled(enabled: boolean): void {
    const toolGroup = getToolGroup();
    if (toolGroup) applyInterpolation(toolGroup, enabled);
  },

  /**
   * Add a unified viewport to the tool group (creating the group on first use).
   * Call after viewportService.createUnifiedViewport().
   */
  addViewport(viewportId: string): void {
    const toolGroup = ensureToolGroup();
    if (!toolGroup) return;
    const wasEmpty = toolGroup.getViewportIds().length === 0;
    toolGroup.addViewport(viewportId, viewportService.ENGINE_ID);
    if (wasEmpty) {
      // Seed the configured default brush radius once the group has a viewport
      // (setBrushSizeForToolGroup is a no-op before one exists). Only on the FIRST
      // viewport so later additions (e.g. an MPR layout) keep the user's current size.
      try {
        csToolUtilities.segmentation.setBrushSizeForToolGroup(
          UNIFIED_TOOL_GROUP_ID,
          usePreferencesStore.getState().preferences.annotation.defaultBrushSize,
        );
      } catch {
        /* ignore */
      }
    }
    wireBrushCursorLifecycle(viewportId);
    console.log('[unifiedToolService] Viewport added:', viewportId);
  },

  /**
   * Join a 3D volume-rendering viewport (C5c) to its OWN tool group. It must not
   * join the slice group: brush/contour/crosshair tools assume a slice plane, and a
   * 3D render has none. This group carries rotate (primary drag) plus zoom/pan on
   * the same non-primary buttons the slice group uses, so navigation feels the same.
   */
  add3dViewport(viewportId: string): void {
    try {
      let group = ToolGroupManager.getToolGroup(VOLUME_3D_TOOL_GROUP_ID);
      if (!group) {
        group = ToolGroupManager.createToolGroup(VOLUME_3D_TOOL_GROUP_ID);
        if (!group) return;
        group.addTool(TrackballRotateTool.toolName);
        group.addTool(ZoomTool.toolName);
        group.addTool(PanTool.toolName);
        group.setToolActive(TrackballRotateTool.toolName, { bindings: [{ mouseButton: Primary }] });
        group.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: Secondary }] });
        group.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: Auxiliary }] });
      }
      group.addViewport(viewportId, viewportService.ENGINE_ID);
      console.log('[unifiedToolService] 3D viewport added:', viewportId);
    } catch (err) {
      // A 3D panel without interaction still RENDERS; never break the layout for it.
      console.warn('[unifiedToolService] add3dViewport failed:', err);
    }
  },

  /** Remove a viewport from the 3D group (panel unmount). */
  remove3dViewport(viewportId: string): void {
    try {
      ToolGroupManager.getToolGroup(VOLUME_3D_TOOL_GROUP_ID)?.removeViewports(
        viewportService.ENGINE_ID,
        viewportId,
      );
    } catch (err) {
      console.debug('[unifiedToolService] remove3dViewport:', err);
    }
  },

  /** Current brush radius on the unified tool group (Cornerstone), or null. */
  getBrushSize(): number | null {
    try {
      return (csToolUtilities.segmentation as unknown as {
        getBrushSizeForToolGroup?: (id: string) => number;
      }).getBrushSizeForToolGroup?.(UNIFIED_TOOL_GROUP_ID) ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Remove a unified viewport from the tool group.
   * Call before viewportService.destroyUnifiedViewport().
   */
  removeViewport(viewportId: string): void {
    const toolGroup = getToolGroup();
    if (!toolGroup) return;
    try {
      toolGroup.removeViewports(viewportService.ENGINE_ID, viewportId);
    } catch {
      /* ok — may already be removed */
    }
    console.log('[unifiedToolService] Viewport removed:', viewportId);
  },

  /** Viewport ids currently in the unified group. */
  getViewportIds(): string[] {
    return getToolGroup()?.getViewportIds() ?? [];
  },

  /** Whether CrosshairsTool is registered in the unified group. */
  hasCrosshairs(): boolean {
    return getToolGroup()?.hasTool(CrosshairsTool.toolName) ?? false;
  },

  /** The tool group id a given viewport belongs to (null if none). */
  getViewportToolGroupId(viewportId: string): string | null {
    return ToolGroupManager.getToolGroupForViewport(viewportId, viewportService.ENGINE_ID)?.id ?? null;
  },

  /** Destroy the unified tool group. */
  destroy(): void {
    removeScissorModifierListeners();
    try {
      ToolGroupManager.destroyToolGroup(UNIFIED_TOOL_GROUP_ID);
    } catch {
      /* ok */
    }
    console.log('[unifiedToolService] Tool group destroyed');
  },
};
