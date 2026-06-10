// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * useXnatAutosaveOptIn — the transport is composed on mount so MANUAL save always
 * works, but the CNDA-critical AUTOMATIC save stays OFF unless the preference is
 * explicitly ON (composing installs the function but fires no write on its own).
 * segmentationService + the wiring module are mocked so no Cornerstone / real
 * transport runs (no live calls).
 */
const composeXnatTransport = vi.fn();
vi.mock('../lib/cornerstone/xnatAutosaveWiring', () => ({
  composeXnatTransport: () => composeXnatTransport(),
}));
vi.mock('../lib/cornerstone/segmentationService', () => ({
  segmentationService: { setXnatAutosaveEnabled: vi.fn() },
}));

import { useXnatAutosaveOptIn } from './useXnatAutosaveOptIn';
import { usePreferencesStore } from '../stores/preferencesStore';
import { segmentationService } from '../lib/cornerstone/segmentationService';

describe('useXnatAutosaveOptIn', () => {
  beforeEach(() => {
    usePreferencesStore.setState(usePreferencesStore.getInitialState(), true);
    composeXnatTransport.mockClear();
    vi.mocked(segmentationService.setXnatAutosaveEnabled).mockClear();
  });

  afterEach(() => {
    usePreferencesStore.getState().setXnatAutosaveEnabled(false);
  });

  it('default OFF: composes the transport (manual save) but leaves AUTOMATIC save disabled', () => {
    expect(usePreferencesStore.getState().preferences.xnatAutosaveEnabled).toBe(false);

    renderHook(() => useXnatAutosaveOptIn());

    // Transport is installed on mount (manual save always works)…
    expect(composeXnatTransport).toHaveBeenCalledTimes(1);
    // …but the AUTOMATIC debounced save stays off by default (no accidental writes).
    expect(segmentationService.setXnatAutosaveEnabled).toHaveBeenLastCalledWith(false);
  });

  it('the preference toggles ONLY the automatic save; the transport is composed once', () => {
    const { rerender } = renderHook(() => useXnatAutosaveOptIn());
    expect(composeXnatTransport).toHaveBeenCalledTimes(1); // composed on mount

    usePreferencesStore.getState().setXnatAutosaveEnabled(true);
    rerender();
    expect(segmentationService.setXnatAutosaveEnabled).toHaveBeenLastCalledWith(true);

    usePreferencesStore.getState().setXnatAutosaveEnabled(false);
    rerender();
    expect(segmentationService.setXnatAutosaveEnabled).toHaveBeenLastCalledWith(false);

    // Composed exactly once across all toggles (mount only).
    expect(composeXnatTransport).toHaveBeenCalledTimes(1);
  });
});
