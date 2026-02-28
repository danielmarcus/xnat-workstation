/**
 * Hotkey system types — keyboard shortcut configuration and action definitions.
 */

/**
 * All possible hotkey actions. String union ensures compile-time safety
 * when defining the default map and the action registry.
 */
export type HotkeyAction =
  // Tool switching
  | 'tool.windowLevel'
  | 'tool.pan'
  | 'tool.zoom'
  | 'tool.length'
  | 'tool.angle'
  | 'tool.bidirectional'
  | 'tool.ellipticalROI'
  | 'tool.rectangleROI'
  | 'tool.circleROI'
  | 'tool.probe'
  | 'tool.arrowAnnotate'
  | 'tool.freehandROI'
  | 'tool.crosshairs'
  | 'tool.brush'
  | 'tool.eraser'
  | 'tool.thresholdBrush'
  | 'tool.freehandContour'
  | 'tool.splineContour'
  | 'tool.livewireContour'
  | 'tool.circleScissors'
  | 'tool.rectangleScissors'
  | 'tool.paintFill'
  | 'tool.sculptor'
  | 'tool.stackScroll'
  // Viewport actions
  | 'viewport.reset'
  | 'viewport.toggleInvert'
  | 'viewport.rotate90'
  | 'viewport.flipH'
  | 'viewport.flipV'
  | 'viewport.zoomIn'
  | 'viewport.zoomOut'
  // Cine
  | 'viewport.toggleCine'
  // Layout
  | 'layout.1x1'
  | 'layout.1x2'
  | 'layout.2x1'
  | 'layout.2x2'
  // Panel toggles
  | 'panel.toggleAnnotations'
  | 'panel.toggleSegmentation'
  | 'panel.nextViewport'
  // Brush size
  | 'brush.decrease'
  | 'brush.increase'
  // Slice navigation
  | 'slice.prev'
  | 'slice.next'
  | 'slice.prevPage'
  | 'slice.nextPage'
  | 'slice.first'
  | 'slice.last'
  // Edit actions
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.delete'
  // W/L presets (by index)
  | 'preset.wl.0'
  | 'preset.wl.1'
  | 'preset.wl.2'
  | 'preset.wl.3'
  | 'preset.wl.4';

/**
 * Modifier keys for a hotkey binding.
 * All default to false if omitted.
 */
export interface HotkeyModifiers {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/**
 * A single hotkey binding: a key code + optional modifiers.
 *
 * `key` uses KeyboardEvent.key values (case-sensitive):
 * - Letters: 'w', 'p', 'z' (lowercase for unshifted)
 * - Numbers: '1', '2', '3', '4'
 * - Special: 'Escape', 'ArrowUp', 'ArrowDown', ' ' (space), '[', ']'
 * - Function keys: 'F1', 'F2', etc.
 */
export interface HotkeyBinding {
  key: string;
  modifiers?: HotkeyModifiers;
}

/**
 * The hotkey map: a Record from action identifier to one or more bindings.
 * Multiple bindings per action allow aliases (e.g., ArrowUp and ArrowLeft
 * both map to 'slice.prev').
 */
export type HotkeyMap = Partial<Record<HotkeyAction, HotkeyBinding[]>>;
