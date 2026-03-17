import { DEFAULT_PREFERENCES, type PreferencesV1 } from '@shared/types/preferences';
import { segmentationService } from '../cornerstone/segmentationService';
import { toolService } from '../cornerstone/toolService';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { DEFAULT_HOTKEY_MAP } from '../hotkeys/defaultHotkeyMap';
import { hotkeyService } from '../hotkeys/hotkeyService';

function hexToRgba(hex: string): [number, number, number, number] | null {
  const match = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) return null;
  const raw = match[1];
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return [r, g, b, 255];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function applyPreferences(preferences: PreferencesV1): void {
  const showViewportContextOverlay =
    preferences.overlay?.showViewportContextOverlay
    ?? DEFAULT_PREFERENCES.overlay.showViewportContextOverlay;
  const hotkeyOverrides = preferences.hotkeys?.overrides ?? {};
  const annotationPrefs = preferences.annotation ?? DEFAULT_PREFERENCES.annotation;
  const brushSize = clamp(Math.round(annotationPrefs.defaultBrushSize), 1, 100);
  const contourThickness = clamp(Math.round(annotationPrefs.defaultContourThickness), 1, 8);
  const segmentOpacity = clamp(annotationPrefs.defaultSegmentOpacity, 0, 1);
  const autoDisplayAnnotations =
    typeof annotationPrefs.autoDisplayAnnotations === 'boolean'
      ? annotationPrefs.autoDisplayAnnotations
      : DEFAULT_PREFERENCES.annotation.autoDisplayAnnotations;
  const colorSequence = (annotationPrefs.defaultColorSequence ?? DEFAULT_PREFERENCES.annotation.defaultColorSequence)
    .map((hex) => hexToRgba(hex))
    .filter((color): color is [number, number, number, number] => color !== null);

  hotkeyService.setHotkeyMap(DEFAULT_HOTKEY_MAP);
  hotkeyService.mergeOverrides(hotkeyOverrides);

  const segmentationState = useSegmentationStore.getState();
  segmentationState.setShowViewportContextOverlay(showViewportContextOverlay);
  segmentationState.setBrushSize(brushSize);
  segmentationState.setContourLineWidth(contourThickness);
  segmentationState.setRenderOutline(annotationPrefs.defaultMaskOutlines);
  segmentationState.setAutoLoadSegOnScanClick(autoDisplayAnnotations);
  segmentationState.setFillAlpha(segmentOpacity);

  segmentationService.setDefaultColorSequence(colorSequence);
  segmentationService.setBrushSize(brushSize);
  segmentationService.updateStyle(segmentOpacity, annotationPrefs.defaultMaskOutlines);
  segmentationService.updateContourStyle(contourThickness);
  toolService.applyScissorPreferences();
}
