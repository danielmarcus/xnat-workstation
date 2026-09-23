import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_OVERLAY } from '@shared/types/dicom';
import type { OverlayCornerId, OverlayFieldKey } from '@shared/types/preferences';
import ViewportOverlay from './ViewportOverlay';
import { useViewerStore } from '../../stores/viewerStore';
import { useMetadataStore } from '../../stores/metadataStore';
import { usePreferencesStore } from '../../stores/preferencesStore';

// The crosshair intensity readout is sampled from Cornerstone via the lib seam
// (getIntensityAtWorld); mock it so the overlay's gating + formatting can be driven
// without a real viewport (canvasToWorld/voxelManager are DPR-sensitive and headless-unsafe).
const getIntensityAtWorld = vi.fn();
vi.mock('../../lib/cornerstone/unifiedCrosshair', () => ({
  getIntensityAtWorld: (...a: unknown[]) => getIntensityAtWorld(...a),
}));

function setCorners(corners: Partial<Record<OverlayCornerId, OverlayFieldKey[]>>, show = true): void {
  usePreferencesStore.setState((s) => ({
    preferences: {
      ...s.preferences,
      overlay: {
        ...s.preferences.overlay,
        showViewportContextOverlay: show,
        // Isolate the corner tests from the marker / ruler layers (their own tests).
        showOrientationMarkers: false,
        showHorizontalRuler: false,
        showVerticalRuler: false,
        corners: { topLeft: [], topRight: [], bottomLeft: [], bottomRight: [], ...corners },
      },
    },
  }));
}

describe('ViewportOverlay (preference-driven)', () => {
  beforeEach(() => {
    getIntensityAtWorld.mockReset();
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

  it('renders patient-orientation edge-markers for the current plane (independent of the context toggle)', () => {
    // Context corners OFF, markers ON — markers still render. Use the non-default
    // SAGITTAL plane to prove the markers track the plane (not a hardcoded axial).
    usePreferencesStore.setState((s) => ({
      preferences: {
        ...s.preferences,
        overlay: { ...s.preferences.overlay, showViewportContextOverlay: false, showOrientationMarkers: true },
      },
    }));
    useViewerStore.getState().setPanelOrientation('panel_0', 'SAGITTAL');
    render(<ViewportOverlay panelId="panel_0" />);
    // Sagittal: top S, bottom I, left A, right P.
    expect(screen.getByTestId('orientation-marker-top:panel_0')).toHaveTextContent('S');
    expect(screen.getByTestId('orientation-marker-bottom:panel_0')).toHaveTextContent('I');
    expect(screen.getByTestId('orientation-marker-left:panel_0')).toHaveTextContent('A');
    expect(screen.getByTestId('orientation-marker-right:panel_0')).toHaveTextContent('P');
    // The context corners are off ⇒ no field stacks rendered.
    expect(screen.queryByTestId('overlay-field-imageIndex:panel_0')).toBeNull();
  });

  it('moves focus from the dropdown back to the viewport after a selection', () => {
    useViewerStore.getState().setPanelNativeOrientation('panel_0', 'AXIAL');
    setCorners({ topLeft: ['orientationSelector'] });
    // Render inside a focusable panel container, mirroring the real Viewport shell.
    render(
      <div data-panel-id="panel_0" tabIndex={-1}>
        <ViewportOverlay panelId="panel_0" />
      </div>,
    );
    const select = screen.getByTestId('orientation-select:panel_0') as HTMLSelectElement;
    select.focus();
    expect(document.activeElement).toBe(select);
    fireEvent.change(select, { target: { value: 'CORONAL' } });
    // Focus leaves the dropdown and lands on the viewport panel (so the wheel/keys
    // navigate the image, not the select).
    expect(document.activeElement).not.toBe(select);
    expect(document.activeElement).toBe(document.querySelector('[data-panel-id="panel_0"]'));
    expect(useViewerStore.getState().activeViewportId).toBe('panel_0');
  });

  /** Merge partial display state onto panel_0's viewport (rotation/flip/invert). */
  function setViewport(patch: Record<string, unknown>): void {
    useViewerStore.setState((s) => ({
      viewports: { ...s.viewports, panel_0: { ...s.viewports.panel_0, ...patch } },
    }));
  }

  it('renders rotation / flip / invert at their DEFAULT state when enabled (not blank)', () => {
    // Regression: these were the only fields that rendered null at the default state,
    // so an enabled field looked unwired on an untransformed image.
    setCorners({ bottomRight: ['rotation', 'flip', 'invert'] });
    render(<ViewportOverlay panelId="panel_0" />);
    const corner = within(screen.getByTestId('overlay-corner-bottomRight:panel_0'));
    expect(corner.getByTestId('overlay-field-rotation:panel_0')).toHaveTextContent('Rot: 0°');
    expect(corner.getByTestId('overlay-field-flip:panel_0')).toHaveTextContent('Flip: None');
    expect(corner.getByTestId('overlay-field-invert:panel_0')).toHaveTextContent('Invert: Off');
  });

  it('reflects the current rotation / flip / invert state', () => {
    setViewport({ rotation: 90, flipH: true, flipV: true, invert: true });
    setCorners({ bottomRight: ['rotation', 'flip', 'invert'] });
    render(<ViewportOverlay panelId="panel_0" />);
    const corner = within(screen.getByTestId('overlay-corner-bottomRight:panel_0'));
    expect(corner.getByTestId('overlay-field-rotation:panel_0')).toHaveTextContent('Rot: 90°');
    expect(corner.getByTestId('overlay-field-flip:panel_0')).toHaveTextContent('Flip: H+V');
    expect(corner.getByTestId('overlay-field-invert:panel_0')).toHaveTextContent('Invert: On');
  });

  it('suppresses the in-plane transforms on a 3D volume render', () => {
    setViewport({ rotation: 90, flipH: true, invert: true });
    setCorners({ bottomRight: ['rotation', 'flip', 'invert', 'zoom'] });
    render(<ViewportOverlay panelId="panel_0" render3d />);
    // Slice-transform fields drop out on a 3D render; a non-slice field (zoom) stays.
    expect(screen.queryByTestId('overlay-field-rotation:panel_0')).toBeNull();
    expect(screen.queryByTestId('overlay-field-flip:panel_0')).toBeNull();
    expect(screen.queryByTestId('overlay-field-invert:panel_0')).toBeNull();
    expect(screen.getByTestId('overlay-field-zoom:panel_0')).toBeInTheDocument();
  });

  it('renders the crosshair intensity readout above the coordinates, labelled HU for CT', () => {
    getIntensityAtWorld.mockReturnValue({ value: 137, modality: 'CT' });
    useViewerStore.getState().setCrosshairWorldPoint([12.3, -4.5, 6.7], 'panel_0');
    setCorners({ bottomRight: ['crosshairIntensity', 'crosshair'] });
    render(<ViewportOverlay panelId="panel_0" />);

    const corner = within(screen.getByTestId('overlay-corner-bottomRight:panel_0'));
    expect(corner.getByTestId('overlay-field-crosshairIntensity:panel_0')).toHaveTextContent('Intensity: 137 HU');
    expect(corner.getByTestId('overlay-field-crosshair:panel_0')).toHaveTextContent('12.3, -4.5, 6.7');

    // "Above the cross coordinates": intensity comes first in the corner's DOM order.
    const fields = corner.getAllByTestId(/^overlay-field-/);
    const keys = fields.map((el) => el.getAttribute('data-testid'));
    expect(keys).toEqual(['overlay-field-crosshairIntensity:panel_0', 'overlay-field-crosshair:panel_0']);
  });

  it('omits the HU unit for a non-CT modality and formats a fractional value', () => {
    getIntensityAtWorld.mockReturnValue({ value: 512.5, modality: 'MR' });
    useViewerStore.getState().setCrosshairWorldPoint([0, 0, 0], 'panel_0');
    setCorners({ bottomRight: ['crosshairIntensity'] });
    render(<ViewportOverlay panelId="panel_0" />);
    expect(screen.getByTestId('overlay-field-crosshairIntensity:panel_0')).toHaveTextContent('Intensity: 512.5');
    expect(screen.getByTestId('overlay-field-crosshairIntensity:panel_0')).not.toHaveTextContent('HU');
  });

  it('does not render intensity when the crosshair belongs to another panel', () => {
    getIntensityAtWorld.mockReturnValue({ value: 100, modality: 'CT' });
    useViewerStore.getState().setCrosshairWorldPoint([1, 2, 3], 'panel_9');
    setCorners({ bottomRight: ['crosshairIntensity'] });
    render(<ViewportOverlay panelId="panel_0" />);
    expect(screen.queryByTestId('overlay-field-crosshairIntensity:panel_0')).toBeNull();
  });

  it('does not render intensity when the sample is unavailable (off-image / empty panel)', () => {
    getIntensityAtWorld.mockReturnValue(null);
    useViewerStore.getState().setCrosshairWorldPoint([1, 2, 3], 'panel_0');
    setCorners({ bottomRight: ['crosshairIntensity'] });
    render(<ViewportOverlay panelId="panel_0" />);
    expect(screen.queryByTestId('overlay-field-crosshairIntensity:panel_0')).toBeNull();
  });
});
