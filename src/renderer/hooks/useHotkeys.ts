/**
 * useHotkeys — React hook that installs/removes the global hotkey listener.
 *
 * Call once at the viewer page level. The hook is intentionally thin:
 * it delegates all logic to hotkeyService.
 */
import { useEffect } from 'react';
import { hotkeyService } from '../lib/hotkeys/hotkeyService';

/**
 * Install the global hotkey listener on mount, remove on unmount.
 */
export function useHotkeys(): void {
  useEffect(() => {
    hotkeyService.install();
    return () => hotkeyService.uninstall();
  }, []);
}
