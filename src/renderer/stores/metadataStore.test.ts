import { beforeEach, describe, expect, it } from 'vitest';
import type { OverlayMetadata } from '@shared/types/dicom';
import { useMetadataStore } from './metadataStore';

function resetStore(): void {
  useMetadataStore.setState(useMetadataStore.getInitialState(), true);
}

const OVERLAY: OverlayMetadata = {
  patientName: 'Doe^Jane',
  patientId: 'P-100',
  studyDate: '20260303',
  institutionName: 'Embark Medical',
  seriesDescription: 'CT Abdomen',
  seriesNumber: '12',
  sliceLocation: '42.5',
  sliceThickness: '1.0',
  rows: 512,
  columns: 512,
};

describe('useMetadataStore', () => {
  beforeEach(() => {
    resetStore();
  });

  it('starts empty and supports update/reset transitions', () => {
    expect(useMetadataStore.getState().overlays).toEqual({});

    useMetadataStore.getState()._updateOverlay('panel_0', OVERLAY);
    expect(useMetadataStore.getState().overlays.panel_0).toEqual(OVERLAY);

    useMetadataStore.getState()._reset();
    expect(useMetadataStore.getState().overlays).toEqual({});
  });

  it('clears only the targeted panel overlay', () => {
    useMetadataStore.getState()._updateOverlay('panel_0', OVERLAY);
    useMetadataStore.getState()._updateOverlay('panel_1', { ...OVERLAY, patientId: 'P-200' });

    useMetadataStore.getState()._clearOverlay('panel_0');

    expect(useMetadataStore.getState().overlays.panel_0).toBeUndefined();
    expect(useMetadataStore.getState().overlays.panel_1?.patientId).toBe('P-200');
  });
});
