/**
 * useXnatAutosaveOptIn — the React entry point for the XNAT save path.
 *
 * The transport is composed ONCE on mount so MANUAL save (the review dialog, the
 * close-app dialog, a row's Save) always works — a deliberate Save click is never
 * "accidental", so it isn't gated by the preference. The `xnatAutosaveEnabled`
 * preference (default OFF, CNDA safety) gates only AUTOMATIC background saving:
 *   ON  → segmentationService.setXnatAutosaveEnabled(true)  (edits debounce-save)
 *   OFF → segmentationService.setXnatAutosaveEnabled(false) (edits never auto-save)
 *
 * Composing installs the saveTransport function but fires NO write on its own —
 * writes happen only on an explicit flush (manual Save) or, when the preference is
 * ON, the debounced autosave. So default OFF still means "nothing written to the
 * server unless the user deliberately saves or turns autosave on".
 *
 * Lives in hooks/ (not lib/**) because composing the transport is a service
 * concern but reacting to the preference is a React concern; the §2 layering
 * boundary forbids services importing React, so the hook wraps the service.
 */
import { useEffect, useRef } from 'react';
import { usePreferencesStore } from '../stores/preferencesStore';
import { segmentationService } from '../lib/cornerstone/segmentationService';
import { composeXnatTransport } from '../lib/cornerstone/xnatAutosaveWiring';

export function useXnatAutosaveOptIn(): void {
  const enabled = usePreferencesStore((s) => s.preferences.xnatAutosaveEnabled ?? false);
  const composedOnce = useRef(false);

  // Install the transport once (manual save always available, regardless of the toggle).
  useEffect(() => {
    if (!composedOnce.current) {
      composeXnatTransport();
      composedOnce.current = true;
    }
  }, []);

  // Gate only the AUTOMATIC debounced save on the preference.
  useEffect(() => {
    segmentationService.setXnatAutosaveEnabled(enabled);
  }, [enabled]);
}
