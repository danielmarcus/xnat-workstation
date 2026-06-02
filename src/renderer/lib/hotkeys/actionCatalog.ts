/**
 * Action labels + categories — the source of truth for the
 * cheatsheet overlay (spec §6.3) and the Settings → Hotkeys tab.
 *
 * `ACTION_LABEL[action]` is the human-readable label shown next to
 * the binding chip. `ACTION_CATEGORY[action]` slots the action under
 * one of the spec's category headings (Tools · Editing tools ·
 * Viewport · Layout · Slice · Brush · Panels · W/L presets · Edit ·
 * App). The order in `CATEGORY_ORDER` is the order the cheatsheet
 * renders sections.
 */
import type { HotkeyAction } from '@shared/types/hotkeys';

export type ActionCategory =
  | 'Tools'
  | 'Editing tools'
  | 'Viewport'
  | 'Layout'
  | 'Slice'
  | 'Brush'
  | 'Panels'
  | 'W/L presets'
  | 'Edit'
  | 'App';

export const CATEGORY_ORDER: ReadonlyArray<ActionCategory> = [
  'Tools',
  'Editing tools',
  'Viewport',
  'Layout',
  'Slice',
  'Brush',
  'Panels',
  'W/L presets',
  'Edit',
  'App',
];

export const ACTION_LABEL: Record<HotkeyAction, string> = {
  // Viewer tools
  'tool.windowLevel':   'Window/Level',
  'tool.pan':           'Pan',
  'tool.zoom':          'Zoom',
  'tool.stackScroll':   'Stack scroll',
  'tool.crosshairs':    'Crosshairs',
  // Measurement tools
  'tool.length':        'Length',
  'tool.angle':         'Angle',
  'tool.bidirectional': 'Bidirectional',
  'tool.ellipticalROI': 'Elliptical ROI',
  'tool.rectangleROI':  'Rectangle ROI',
  'tool.circleROI':     'Circle ROI',
  'tool.probe':         'Probe',
  'tool.arrowAnnotate': 'Arrow annotate',
  'tool.freehandROI':   'Freehand ROI',
  // Editing tools
  'tool.brush':              'Brush',
  'tool.eraser':             'Eraser',
  'tool.thresholdBrush':     'Threshold brush',
  'tool.freehandContour':    'Freehand contour',
  'tool.splineContour':      'Spline contour',
  'tool.livewireContour':    'Livewire contour',
  'tool.circleScissors':     'Circle scissors',
  'tool.rectangleScissors':  'Rectangle scissors',
  'tool.paintFill':          'Paint fill',
  'tool.sculptor':           'Sculptor',
  // Viewport actions
  'viewport.reset':        'Reset viewport',
  'viewport.toggleInvert': 'Toggle invert',
  'viewport.rotate90':     'Rotate 90°',
  'viewport.flipH':        'Flip horizontal',
  'viewport.flipV':        'Flip vertical',
  'viewport.zoomIn':       'Zoom in',
  'viewport.zoomOut':      'Zoom out',
  'viewport.toggleCine':   'Toggle cine',
  // Layout
  'layout.1x1': 'Layout 1×1',
  'layout.1x2': 'Layout 1×2',
  'layout.2x1': 'Layout 2×1',
  'layout.2x2': 'Layout 2×2',
  // Panels
  'panel.toggleAnnotations':  'Toggle annotations panel',
  'panel.toggleSegmentation': 'Toggle segmentation panel',
  'panel.nextViewport':       'Cycle viewports',
  // Brush size
  'brush.decrease': 'Decrease brush size',
  'brush.increase': 'Increase brush size',
  // Slice nav
  'slice.prev':     'Previous slice',
  'slice.next':     'Next slice',
  'slice.prevPage': 'Previous page',
  'slice.nextPage': 'Next page',
  'slice.first':    'First slice',
  'slice.last':     'Last slice',
  // Edit
  'edit.undo':   'Undo',
  'edit.redo':   'Redo',
  'edit.copy':   'Copy',
  'edit.paste':  'Paste',
  'edit.delete': 'Delete',
  // W/L presets
  'preset.wl.0': 'Soft tissue',
  'preset.wl.1': 'Lung',
  'preset.wl.2': 'Bone',
  'preset.wl.3': 'Brain',
  'preset.wl.4': 'Abdomen',
};

export const ACTION_CATEGORY: Record<HotkeyAction, ActionCategory> = {
  // Tools
  'tool.windowLevel':   'Tools',
  'tool.pan':           'Tools',
  'tool.zoom':          'Tools',
  'tool.stackScroll':   'Tools',
  'tool.crosshairs':    'Tools',
  'tool.length':        'Tools',
  'tool.angle':         'Tools',
  'tool.bidirectional': 'Tools',
  'tool.ellipticalROI': 'Tools',
  'tool.rectangleROI':  'Tools',
  'tool.circleROI':     'Tools',
  'tool.probe':         'Tools',
  'tool.arrowAnnotate': 'Tools',
  'tool.freehandROI':   'Tools',
  // Editing tools
  'tool.brush':              'Editing tools',
  'tool.eraser':             'Editing tools',
  'tool.thresholdBrush':     'Editing tools',
  'tool.freehandContour':    'Editing tools',
  'tool.splineContour':      'Editing tools',
  'tool.livewireContour':    'Editing tools',
  'tool.circleScissors':     'Editing tools',
  'tool.rectangleScissors':  'Editing tools',
  'tool.paintFill':          'Editing tools',
  'tool.sculptor':           'Editing tools',
  // Viewport
  'viewport.reset':        'Viewport',
  'viewport.toggleInvert': 'Viewport',
  'viewport.rotate90':     'Viewport',
  'viewport.flipH':        'Viewport',
  'viewport.flipV':        'Viewport',
  'viewport.zoomIn':       'Viewport',
  'viewport.zoomOut':      'Viewport',
  'viewport.toggleCine':   'Viewport',
  // Layout
  'layout.1x1': 'Layout',
  'layout.1x2': 'Layout',
  'layout.2x1': 'Layout',
  'layout.2x2': 'Layout',
  // Slice
  'slice.prev':     'Slice',
  'slice.next':     'Slice',
  'slice.prevPage': 'Slice',
  'slice.nextPage': 'Slice',
  'slice.first':    'Slice',
  'slice.last':     'Slice',
  // Brush size
  'brush.decrease': 'Brush',
  'brush.increase': 'Brush',
  // Panels
  'panel.toggleAnnotations':  'Panels',
  'panel.toggleSegmentation': 'Panels',
  'panel.nextViewport':       'Panels',
  // W/L
  'preset.wl.0': 'W/L presets',
  'preset.wl.1': 'W/L presets',
  'preset.wl.2': 'W/L presets',
  'preset.wl.3': 'W/L presets',
  'preset.wl.4': 'W/L presets',
  // Edit
  'edit.undo':   'Edit',
  'edit.redo':   'Edit',
  'edit.copy':   'Edit',
  'edit.paste':  'Edit',
  'edit.delete': 'Edit',
};

/**
 * Group every `HotkeyAction` under its category, preserving the
 * declaration order from `ACTION_LABEL`. Useful for the cheatsheet's
 * grouped render.
 */
export function actionsByCategory(): Map<ActionCategory, HotkeyAction[]> {
  const out = new Map<ActionCategory, HotkeyAction[]>();
  for (const cat of CATEGORY_ORDER) out.set(cat, []);
  for (const action of Object.keys(ACTION_LABEL) as HotkeyAction[]) {
    const cat = ACTION_CATEGORY[action];
    out.get(cat)!.push(action);
  }
  return out;
}
