import { DEFAULT_PREFERENCES, type PreferencesV1 } from '@shared/types/preferences';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { DEFAULT_HOTKEY_MAP } from '../hotkeys/defaultHotkeyMap';
import { hotkeyService } from '../hotkeys/hotkeyService';

export function applyPreferences(preferences: PreferencesV1): void {
  const showViewportContextOverlay =
    preferences.overlay?.showViewportContextOverlay
    ?? DEFAULT_PREFERENCES.overlay.showViewportContextOverlay;
  const hotkeyOverrides = preferences.hotkeys?.overrides ?? {};

  hotkeyService.setHotkeyMap(DEFAULT_HOTKEY_MAP);
  hotkeyService.mergeOverrides(hotkeyOverrides);

  useSegmentationStore
    .getState()
    .setShowViewportContextOverlay(showViewportContextOverlay);
}
