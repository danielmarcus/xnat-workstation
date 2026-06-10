/**
 * useXnatAutosaveOptIn — the React entry point for the XNAT-autosave opt-in.
 *
 * Reads the `xnatAutosaveEnabled` preference (default OFF, CNDA safety) and drives
 * the live save path:
 *   ON  → composeXnatTransport() once + segmentationService.setXnatAutosaveEnabled(true)
 *   OFF → segmentationService.setXnatAutosaveEnabled(false)
 *
 * Default OFF ⇒ on mount this does nothing: no transport is composed and the
 * existing in-memory / E2E stub transport stays installed, so no real upload ever
 * fires until the user explicitly opts in via Settings.
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

  useEffect(() => {
    if (enabled) {
      if (!composedOnce.current) {
        composeXnatTransport();
        composedOnce.current = true;
      }
      segmentationService.setXnatAutosaveEnabled(true);
    } else {
      segmentationService.setXnatAutosaveEnabled(false);
    }
  }, [enabled]);
}
