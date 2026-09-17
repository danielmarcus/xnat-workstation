/**
 * useHotkeys — React hook that installs/removes the global hotkey listener.
 *
 * Call once at the viewer page level. The hook is intentionally thin:
 * it delegates all logic to hotkeyService.
 */
import { useEffect } from 'react';
import { hotkeyService } from '../lib/hotkeys/hotkeyService';
import { installKeepFocusInViewports } from '../lib/hotkeys/keepFocusInViewports';

/**
 * Install the global hotkey listener on mount, remove on unmount.
 */
export function useHotkeys(): void {
  useEffect(() => {
    hotkeyService.install();
    // Shortcuts are viewport-only, so the keyboard has to stay in the viewports: release
    // focus that a click leaves stranded on a side-panel control.
    const releaseFocus = installKeepFocusInViewports();
    return () => {
      hotkeyService.uninstall();
      releaseFocus();
    };
  }, []);
}
