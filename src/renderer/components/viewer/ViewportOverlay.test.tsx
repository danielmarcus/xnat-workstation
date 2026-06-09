import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_OVERLAY } from '@shared/types/dicom';
import type { OverlayCornerId, OverlayFieldKey } from '@shared/types/preferences';
import ViewportOverlay from './ViewportOverlay';
import { useViewerStore } from '../../stores/viewerStore';
import { useMetadataStore } from '../../stores/metadataStore';
import { usePreferencesStore } from '../../stores/preferencesStore';

function setCorners(corners: Partial<Record<OverlayCornerId, OverlayFieldKey[]>>, show = true): void {
  usePreferencesStore.setState((s) => ({
    preferences: {
      ...s.preferences,
      overlay: {
        ...s.preferences.overlay,
        showViewportContextOverlay: show,
        corners: { topLeft: [], topRight: [], bottomLeft: [], bottomRight: [], ...corners },
      },
    },
  }));
}

describe('ViewportOverlay (preference-driven)', () => {
  beforeEach(() => {
    useViewerStore.setState(useViewerStore.getInitialState(), true);
    useMetadataStore.getState()._reset();
    const store = useViewerStore.getState();
    store._initPanel('panel_0');
    store._updateImageIndex('panel_0', 2, 16);
    store._updateVOI('panel_0', 400, 40);
    store._updateZoom('panel_0', 150);
    useMetadataStore.getState()._updateOverlay('panel_0', {
      ...EMPTY_OVERLAY,
      patientName: 'DOE^JANE',
      seriesDescription: 'AX T1',
    });
  });

  it('renders ONLY the fields configured for each corner, in that corner', () => {
    setCorners({ topLeft: ['patientName'], bottomLeft: ['imageIndex', 'windowLevel'], bottomRight: ['zoom'] });
    render(<ViewportOverlay panelId="panel_0" />);

    expect(
      within(screen.getByTestId('overlay-corner-topLeft:panel_0')).getByTestId('overlay-field-patientName:panel_0'),
    ).toHaveTextContent('DOE^JANE');
    const bl = within(screen.getByTestId('overlay-corner-bottomLeft:panel_0'));
    expect(bl.getByTestId('overlay-field-imageIndex:panel_0')).toHaveTextContent('3 / 16');
    expect(bl.getByTestId('overlay-field-windowLevel:panel_0')).toHaveTextContent('W: 400 L: 40');
    expect(
      within(screen.getByTestId('overlay-corner-bottomRight:panel_0')).getByTestId('overlay-field-zoom:panel_0'),
    ).toHaveTextContent('Zoom: 150%');

    // A field configured in NO corner must not render at all...
    expect(screen.queryByTestId('overlay-field-seriesDescription:panel_0')).toBeNull();
    // ...and zoom (bottomRight) must NOT leak into bottomLeft.
    expect(bl.queryByTestId('overlay-field-zoom:panel_0')).toBeNull();
  });

  it('moving a field to a different corner moves where it renders', () => {
    setCorners({ topRight: ['imageIndex'] });
    render(<ViewportOverlay panelId="panel_0" />);
    expect(
      within(screen.getByTestId('overlay-corner-topRight:panel_0')).getByTestId('overlay-field-imageIndex:panel_0'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('overlay-corner-bottomLeft:panel_0')).queryByTestId('overlay-field-imageIndex:panel_0'),
    ).toBeNull();
  });

  it('respects the master showViewportContextOverlay toggle', () => {
    setCorners({ bottomLeft: ['imageIndex'] }, false);
    render(<ViewportOverlay panelId="panel_0" />);
    expect(screen.queryByTestId('viewport-overlay:panel_0')).toBeNull();
  });

  it('renders orientationSelector as an interactive dropdown wired to setPanelOrientation', () => {
    useViewerStore.getState().setPanelNativeOrientation('panel_0', 'AXIAL');
    setCorners({ topLeft: ['orientationSelector'] });
    render(<ViewportOverlay panelId="panel_0" />);
    const select = screen.getByTestId('orientation-select:panel_0') as HTMLSelectElement;
    // Shows the native plane initially (no per-panel override yet).
    expect(select.value).toBe('AXIAL');
    // Choosing a new plane updates the per-panel orientation (which the viewport reads).
    fireEvent.change(select, { target: { value: 'SAGITTAL' } });
    expect(useViewerStore.getState().panelOrientationMap['panel_0']).toBe('SAGITTAL');
  });
});
