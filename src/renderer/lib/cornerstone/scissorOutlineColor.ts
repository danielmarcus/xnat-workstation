/**
 * The scissors "preview colour" preference (Settings → Annotation → Scissors).
 *
 * While a scissors shape is being dragged Cornerstone draws its outline in the active
 * segment's colour, read ONCE in `preMouseDownCallback` into
 * `editData.annotation.metadata.segmentColor` (`renderAnnotation` strokes
 * `rgb(${segmentColor})`). There is no configuration hook for it, so the preference is
 * applied by overwriting that colour right after the tool's own mouse-down has set it.
 * The colour is only the outline's — the voxels still go to the active segment.
 *
 * This used to live on the legacy `toolService`, whose tool group the app never
 * creates, so the Settings control changed nothing in the running app.
 *
 * Applied by wrapping the tool INSTANCE's `preMouseDownCallback`, which Cornerstone
 * assigns as an own property in the constructor. Patching twice is a no-op.
 */
import { usePreferencesStore } from '../../stores/preferencesStore';

const PATCH_FLAG = '__xnatScissorOutlineColor';

type Rgba = [number, number, number, number];

interface ScissorToolInstance {
  preMouseDownCallback?: (evt: unknown) => unknown;
  editData?: {
    annotation?: { metadata?: { segmentColor?: Rgba } };
    segmentColor?: Rgba;
  };
  [PATCH_FLAG]?: boolean;
}

function hexToRgba(hex: string): Rgba | null {
  const match = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) return null;
  const raw = match[1];
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16),
    255,
  ];
}

/** The configured outline colour, or null to keep Cornerstone's segment colour. */
function configuredOutlineColor(): Rgba | null {
  const prefs = usePreferencesStore.getState().preferences.annotation.scissors;
  if (!prefs.previewEnabled) return null;
  return hexToRgba(prefs.previewColor);
}

export function applyScissorOutlineColor(toolInstance: unknown): void {
  const tool = toolInstance as ScissorToolInstance | null;
  if (!tool || typeof tool.preMouseDownCallback !== 'function') return;
  if (tool[PATCH_FLAG]) return;
  tool[PATCH_FLAG] = true;

  const original = tool.preMouseDownCallback.bind(tool);
  tool.preMouseDownCallback = (evt: unknown) => {
    const result = original(evt);
    // Read per gesture, so a Settings change applies to the next drag.
    const color = configuredOutlineColor();
    if (color && tool.editData) {
      if (tool.editData.annotation?.metadata) tool.editData.annotation.metadata.segmentColor = color;
      tool.editData.segmentColor = color;
    }
    return result;
  };
}
