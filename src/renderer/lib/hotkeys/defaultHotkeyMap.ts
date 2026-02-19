/**
 * Default hotkey map — sensible radiology viewer shortcuts.
 *
 * Conventions:
 * - Single lowercase letters for frequent tools (OHIF-inspired)
 * - Ctrl+Z / Ctrl+Shift+Z reserved for undo/redo
 * - Other Ctrl combos that conflict with Electron/OS defaults avoided
 *   (Ctrl+C/V/X/A/S/W/Q)
 * - Arrow keys + PageUp/Down for slice navigation (standard DICOM viewer)
 * - Numbers 1-4 for layout switching
 * - Ctrl+1..5 for W/L presets (avoids conflict with layout keys)
 */
import type { HotkeyMap } from '@shared/types/hotkeys';

export const DEFAULT_HOTKEY_MAP: HotkeyMap = {
  // ─── Tool Switching ──────────────────────────────────────────
  'tool.windowLevel': [{ key: 'w' }, { key: 'Escape' }],
  'tool.pan':         [{ key: 'p' }],
  'tool.zoom':        [{ key: 'z' }],
  'tool.length':      [{ key: 'l' }],
  'tool.angle':       [{ key: 'a' }],
  'tool.brush':       [{ key: 'b' }],
  'tool.eraser':      [{ key: 'e' }],
  'tool.crosshairs':  [{ key: 'c' }],
  'tool.probe':       [{ key: 'd' }],   // D for density probe
  'tool.arrowAnnotate': [{ key: 't' }], // T for text annotation
  'tool.stackScroll': [{ key: 's' }],

  // ─── Viewport Actions ────────────────────────────────────────
  'viewport.reset':         [{ key: 'r' }],
  'viewport.rotate90':      [{ key: 'r', modifiers: { shift: true } }],
  'viewport.toggleInvert':  [{ key: 'i' }],
  'viewport.flipH':         [{ key: 'h' }],
  'viewport.flipV':         [{ key: 'v' }],

  // ─── Zoom ─────────────────────────────────────────────────────
  'viewport.zoomIn':  [{ key: '=' }, { key: '+' }],  // = is unshifted + on US keyboards
  'viewport.zoomOut': [{ key: '-' }],

  // ─── Cine ────────────────────────────────────────────────────
  'viewport.toggleCine': [{ key: ' ' }], // Spacebar

  // ─── Layout ──────────────────────────────────────────────────
  'layout.1x1': [{ key: '1' }],
  'layout.1x2': [{ key: '2' }],
  'layout.2x1': [{ key: '3' }],
  'layout.2x2': [{ key: '4' }],

  // ─── Panel Toggles ──────────────────────────────────────────
  'panel.toggleAnnotations':  [{ key: 'o' }], // O for list/overview
  'panel.toggleSegmentation': [{ key: 'g' }], // G for seGmentation

  // ─── Brush Size ──────────────────────────────────────────────
  'brush.decrease': [{ key: '[' }],
  'brush.increase': [{ key: ']' }],

  // ─── Slice Navigation ───────────────────────────────────────
  'slice.prev':     [{ key: 'ArrowUp' }, { key: 'ArrowLeft' }],
  'slice.next':     [{ key: 'ArrowDown' }, { key: 'ArrowRight' }],
  'slice.prevPage': [{ key: 'PageUp' }],
  'slice.nextPage': [{ key: 'PageDown' }],
  'slice.first':    [{ key: 'Home' }],
  'slice.last':     [{ key: 'End' }],

  // ─── Edit Actions ──────────────────────────────────────────
  'edit.undo': [{ key: 'z', modifiers: { ctrl: true } }],
  'edit.redo': [{ key: 'z', modifiers: { ctrl: true, shift: true } }],
  'edit.delete': [{ key: 'Delete' }, { key: 'Backspace' }],

  // ─── W/L Presets (Ctrl+number) ──────────────────────────────
  'preset.wl.0': [{ key: '1', modifiers: { ctrl: true } }], // CT Soft Tissue
  'preset.wl.1': [{ key: '2', modifiers: { ctrl: true } }], // CT Lung
  'preset.wl.2': [{ key: '3', modifiers: { ctrl: true } }], // CT Bone
  'preset.wl.3': [{ key: '4', modifiers: { ctrl: true } }], // CT Brain
  'preset.wl.4': [{ key: '5', modifiers: { ctrl: true } }], // CT Abdomen
};
