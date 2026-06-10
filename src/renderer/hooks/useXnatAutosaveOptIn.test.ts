// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * useXnatAutosaveOptIn — proves the CNDA-critical default-OFF behavior at the
 * React entry point: nothing is composed and the queue is NOT enabled unless the
 * preference is explicitly ON. segmentationService + the wiring module are mocked
 * so no Cornerstone / real transport runs (no live calls).
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

  it('default OFF: does NOT compose the transport and disables the queue', () => {
    expect(usePreferencesStore.getState().preferences.xnatAutosaveEnabled).toBe(false);

    renderHook(() => useXnatAutosaveOptIn());

    expect(composeXnatTransport).not.toHaveBeenCalled();
    expect(segmentationService.setXnatAutosaveEnabled).toHaveBeenLastCalledWith(false);
  });

  it('opting ON composes once and enables the queue; OFF disables it again', () => {
    const { rerender } = renderHook(() => useXnatAutosaveOptIn());
    expect(composeXnatTransport).not.toHaveBeenCalled();

    usePreferencesStore.getState().setXnatAutosaveEnabled(true);
    rerender();
    expect(composeXnatTransport).toHaveBeenCalledTimes(1);
    expect(segmentationService.setXnatAutosaveEnabled).toHaveBeenLastCalledWith(true);

    // Toggling OFF disables the queue but does not re-compose.
    usePreferencesStore.getState().setXnatAutosaveEnabled(false);
    rerender();
    expect(segmentationService.setXnatAutosaveEnabled).toHaveBeenLastCalledWith(false);
    expect(composeXnatTransport).toHaveBeenCalledTimes(1);
  });
});
