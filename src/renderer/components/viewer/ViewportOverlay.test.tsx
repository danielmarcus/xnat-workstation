import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_OVERLAY } from '@shared/types/dicom';
import ViewportOverlay from './ViewportOverlay';
import { useViewerStore } from '../../stores/viewerStore';
import { useMetadataStore } from '../../stores/metadataStore';

describe('ViewportOverlay', () => {
  beforeEach(() => {
    useViewerStore.setState(useViewerStore.getInitialState(), true);
    useMetadataStore.getState()._reset();
  });

  it('renders live slice index / W-L / zoom (driven through the store methods useViewport calls)', () => {
    const store = useViewerStore.getState();
    store._initPanel('panel_0');
    store._updateImageIndex('panel_0', 2, 16);
    store._updateVOI('panel_0', 400, 40);
    store._updateZoom('panel_0', 150);

    render(<ViewportOverlay panelId="panel_0" />);

    expect(screen.getByTestId('overlay-image-index:panel_0')).toHaveTextContent('3 / 16');
    expect(screen.getByTestId('overlay-wl:panel_0')).toHaveTextContent('W: 400 L: 40');
    expect(screen.getByTestId('overlay-zoom:panel_0')).toHaveTextContent('Zoom: 150%');
  });

  it('renders DICOM metadata corners from metadataStore', () => {
    useViewerStore.getState()._initPanel('panel_0');
    useMetadataStore.getState()._updateOverlay('panel_0', {
      ...EMPTY_OVERLAY,
      patientName: 'DOE^JANE',
      patientId: 'P123',
      seriesDescription: 'AX T1',
    });

    render(<ViewportOverlay panelId="panel_0" />);

    expect(screen.getByTestId('overlay-patient-name:panel_0')).toHaveTextContent('DOE^JANE');
    expect(screen.getByTestId('overlay-patient-id:panel_0')).toHaveTextContent('ID: P123');
    expect(screen.getByTestId('overlay-series-desc:panel_0')).toHaveTextContent('AX T1');
  });

  it('shows no image counter before any images are loaded', () => {
    render(<ViewportOverlay panelId="panel_0" />);
    expect(screen.queryByTestId('overlay-image-index:panel_0')).toBeNull();
  });
});
