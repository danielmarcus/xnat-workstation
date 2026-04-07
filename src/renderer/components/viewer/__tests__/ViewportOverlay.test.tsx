import { act, fireEvent, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreferencesStore } from '../../../stores/preferencesStore';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import { useMetadataStore } from '../../../stores/metadataStore';
import { useViewerStore } from '../../../stores/viewerStore';
import { ToolName } from '@shared/types/viewer';
import ViewportOverlay, {
  getCcMammographyOrientationMarkers,
  getOrientationMarkersFromPatientOrientation,
} from '../ViewportOverlay';
import {
  OVERLAY_METADATA_FIXTURE,
  OVERLAY_PREFS_ALL_OFF,
  OVERLAY_PREFS_ALL_ON,
  OVERLAY_TEST_PANEL_ID,
} from '../../../test/overlay/overlayFixtures';
import { expectOverlayContains, expectOverlayHidden, expectOverlayVisible } from '../../../test/overlay/overlayAsserts';
import { renderWithOverlayStores } from '../../../test/overlay/renderWithStores';

const overlayCoreMocks = vi.hoisted(() => ({
  get: vi.fn((module: string) => {
    if (module === 'instance') return {};
    return { rowPixelSpacing: 0.8, columnPixelSpacing: 0.8 };
  }),
}));

const overlayDicomMocks = vi.hoisted(() => ({
  getDataSet: vi.fn(() => undefined),
}));

vi.mock('@cornerstonejs/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cornerstonejs/core')>();
  return {
    ...actual,
    metaData: {
      ...actual.metaData,
      get: overlayCoreMocks.get,
    },
  };
});

vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    dataSetCacheManager: {
      get: overlayDicomMocks.getDataSet,
    },
  },
}));

vi.mock('../../../lib/cornerstone/crosshairGeometry', () => ({
  getPanelDisplayPointForWorld: vi.fn(() => ({ x: 100, y: 80, width: 400, height: 320 })),
}));

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return 400;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return 320;
    },
  });
});

describe('ViewportOverlay', () => {
  beforeEach(() => {
    usePreferencesStore.setState(usePreferencesStore.getInitialState(), true);
    useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
    overlayCoreMocks.get.mockReset();
    overlayCoreMocks.get.mockImplementation((module: string) => {
      if (module === 'instance') return {};
      return { rowPixelSpacing: 0.8, columnPixelSpacing: 0.8 };
    });
    overlayDicomMocks.getDataSet.mockReset();
    overlayDicomMocks.getDataSet.mockReturnValue(undefined);
  });

  it('does not render when overlay and marker/ruler flags are off', () => {
    renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: OVERLAY_METADATA_FIXTURE,
        overlayPrefs: OVERLAY_PREFS_ALL_OFF,
        legacyShowOverlay: false,
      },
    );

    expectOverlayHidden(OVERLAY_TEST_PANEL_ID);
  });

  it('reacts to store toggles for context overlay visibility', () => {
    renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: OVERLAY_METADATA_FIXTURE,
        overlayPrefs: {
          ...OVERLAY_PREFS_ALL_ON,
          showViewportContextOverlay: false,
          showOrientationMarkers: false,
          showHorizontalRuler: false,
          showVerticalRuler: false,
        },
        legacyShowOverlay: false,
      },
    );

    expectOverlayHidden(OVERLAY_TEST_PANEL_ID);

    act(() => {
      useSegmentationStore.getState().setShowViewportContextOverlay(true);
      usePreferencesStore.getState().setShowViewportContextOverlay(true);
    });

    expectOverlayVisible(OVERLAY_TEST_PANEL_ID);
    expect(screen.getByTestId(`viewport-overlay-context:${OVERLAY_TEST_PANEL_ID}`)).toBeInTheDocument();

    act(() => {
      usePreferencesStore.getState().setShowViewportContextOverlay(false);
    });

    expect(screen.queryByTestId(`viewport-overlay-context:${OVERLAY_TEST_PANEL_ID}`)).not.toBeInTheDocument();
  });

  it('renders predictable metadata and viewport-derived content', () => {
    renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: OVERLAY_METADATA_FIXTURE,
        overlayPrefs: {
          ...OVERLAY_PREFS_ALL_ON,
          showHorizontalRuler: false,
          showVerticalRuler: false,
        },
        viewport: {
          imageIndex: 2,
          totalImages: 10,
          windowWidth: 350,
          windowCenter: 60,
          zoomPercent: 125,
        },
      },
    );

    expectOverlayVisible(OVERLAY_TEST_PANEL_ID);
    expectOverlayContains('SUBJ-001');
    expectOverlayContains('SESSION-1');
    expectOverlayContains('Embark Imaging');
    expectOverlayContains('Image: 3 / 10');
    expectOverlayContains('W: 350 L: 60');
    expectOverlayContains('Zoom: 125%');

    expect(screen.getByTestId(`viewport-overlay-corner:topLeft:${OVERLAY_TEST_PANEL_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`viewport-overlay-corner:topRight:${OVERLAY_TEST_PANEL_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`viewport-overlay-corner:bottomLeft:${OVERLAY_TEST_PANEL_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`viewport-overlay-corner:bottomRight:${OVERLAY_TEST_PANEL_ID}`)).toBeInTheDocument();
  });

  it('handles missing metadata safely and still renders long strings', () => {
    const veryLongSeriesDescription = 'SERIES '.repeat(40).trim();

    renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: {
          ...OVERLAY_METADATA_FIXTURE,
          patientName: '',
          patientId: '',
          studyDate: '',
          seriesDescription: veryLongSeriesDescription,
          institutionName: '',
        },
        overlayPrefs: {
          ...OVERLAY_PREFS_ALL_ON,
          showHorizontalRuler: false,
          showVerticalRuler: false,
        },
      },
    );

    expectOverlayVisible(OVERLAY_TEST_PANEL_ID);
    expect(screen.queryByText(/^ID:/)).not.toBeInTheDocument();
    expectOverlayContains(veryLongSeriesDescription);
  });

  it('updates context content when metadata store changes after render', () => {
    renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: {
          ...OVERLAY_METADATA_FIXTURE,
          institutionName: 'Embark Imaging',
        },
        overlayPrefs: OVERLAY_PREFS_ALL_ON,
      },
    );

    expectOverlayContains('Embark Imaging');

    act(() => {
      useMetadataStore.setState({
        ...useMetadataStore.getState(),
        overlays: {
          ...useMetadataStore.getState().overlays,
          [OVERLAY_TEST_PANEL_ID]: {
            ...useMetadataStore.getState().overlays[OVERLAY_TEST_PANEL_ID],
            institutionName: 'Updated Institute Name',
          },
        },
      });
    });

    expectOverlayContains('Updated Institute Name');
  });

  it('toggles orientation markers and rulers independently', () => {
    renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: OVERLAY_METADATA_FIXTURE,
        overlayPrefs: OVERLAY_PREFS_ALL_ON,
        panelImageIds: ['wadouri:https://example.org/mammo/tomo.dcm&frame=1'],
      },
    );

    expect(screen.getByTestId(`viewport-overlay-orientation:${OVERLAY_TEST_PANEL_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`viewport-overlay-horizontal-ruler:${OVERLAY_TEST_PANEL_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId(`viewport-overlay-vertical-ruler:${OVERLAY_TEST_PANEL_ID}`)).toBeInTheDocument();

    act(() => {
      usePreferencesStore.getState().setShowOverlayHorizontalRuler(false);
      usePreferencesStore.getState().setShowOverlayVerticalRuler(false);
      usePreferencesStore.getState().setShowOverlayOrientationMarkers(false);
    });

    expect(screen.queryByTestId(`viewport-overlay-horizontal-ruler:${OVERLAY_TEST_PANEL_ID}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`viewport-overlay-vertical-ruler:${OVERLAY_TEST_PANEL_ID}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`viewport-overlay-orientation:${OVERLAY_TEST_PANEL_ID}`)).not.toBeInTheDocument();
  });

  it('maps patient-orientation strings to overlay edge markers for projection images', () => {
    expect(getOrientationMarkersFromPatientOrientation('P\\L')).toEqual({
      top: 'P',
      bottom: 'A',
      left: 'L',
      right: 'R',
    });
    expect(getOrientationMarkersFromPatientOrientation('A\\R')).toEqual({
      top: 'A',
      bottom: 'P',
      left: 'R',
      right: 'L',
    });
  });

  it('uses head-foot markers for cranio-caudal mammography views', () => {
    expect(getCcMammographyOrientationMarkers({
      top: 'P',
      bottom: 'A',
      left: 'L',
      right: 'R',
    })).toEqual({
      top: 'H',
      bottom: 'F',
      left: 'L',
      right: 'R',
    });
  });

  it('hides orientation markers for mammography stacks', () => {
    overlayDicomMocks.getDataSet.mockReturnValue({
      string: (tag: string) => {
        if (tag === 'x00080060') return 'MG';
        if (tag === 'x00185101') return 'CC';
        return undefined;
      },
    });

    renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: OVERLAY_METADATA_FIXTURE,
        overlayPrefs: OVERLAY_PREFS_ALL_ON,
      },
    );

    expect(screen.queryByTestId(`viewport-overlay-orientation:${OVERLAY_TEST_PANEL_ID}`)).not.toBeInTheDocument();
  });

  it('hides the orientation selector for mammography stacks', () => {
    overlayDicomMocks.getDataSet.mockReturnValue({
      string: (tag: string) => (tag === 'x00080060' ? 'MG' : undefined),
    });

    renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: OVERLAY_METADATA_FIXTURE,
        overlayPrefs: {
          ...OVERLAY_PREFS_ALL_ON,
          corners: {
            topLeft: ['orientationSelector'],
            topRight: [],
            bottomLeft: [],
            bottomRight: [],
          },
        } as any,
        viewport: {
          totalImages: 5,
        },
      },
    );

    expect(screen.queryByTitle('Viewport orientation')).not.toBeInTheDocument();
  });

  it('renders horizontal and vertical rulers independently when enabled one at a time', () => {
    const first = renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: OVERLAY_METADATA_FIXTURE,
        overlayPrefs: {
          ...OVERLAY_PREFS_ALL_ON,
          showViewportContextOverlay: false,
          showOrientationMarkers: false,
          showHorizontalRuler: true,
          showVerticalRuler: false,
        },
      },
    );

    expect(screen.getByTestId(`viewport-overlay-horizontal-ruler:${OVERLAY_TEST_PANEL_ID}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`viewport-overlay-vertical-ruler:${OVERLAY_TEST_PANEL_ID}`)).not.toBeInTheDocument();

    first.unmount();

    renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: OVERLAY_METADATA_FIXTURE,
        overlayPrefs: {
          ...OVERLAY_PREFS_ALL_ON,
          showViewportContextOverlay: false,
          showOrientationMarkers: false,
          showHorizontalRuler: false,
          showVerticalRuler: true,
        },
      },
    );

    expect(screen.queryByTestId(`viewport-overlay-horizontal-ruler:${OVERLAY_TEST_PANEL_ID}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`viewport-overlay-vertical-ruler:${OVERLAY_TEST_PANEL_ID}`)).toBeInTheDocument();
  });

  it('applies corner field configuration changes to the expected overlay block', () => {
    renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: OVERLAY_METADATA_FIXTURE,
        overlayPrefs: OVERLAY_PREFS_ALL_ON,
      },
    );

    expect(screen.queryByText('ID: P12345')).not.toBeInTheDocument();

    act(() => {
      usePreferencesStore.getState().setOverlayCornerField('topLeft', 'patientId', true);
    });

    expectOverlayContains('ID: P12345');
    expect(screen.getByTestId(`viewport-overlay-corner:topLeft:${OVERLAY_TEST_PANEL_ID}`)).toHaveTextContent('ID: P12345');

    act(() => {
      usePreferencesStore.getState().setOverlayCornerField('topLeft', 'patientId', false);
    });

    expect(screen.queryByText('ID: P12345')).not.toBeInTheDocument();
  });

  it('renders crosshair guides when context overlay is off but crosshair tool is active', () => {
    renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: OVERLAY_METADATA_FIXTURE,
        overlayPrefs: {
          ...OVERLAY_PREFS_ALL_OFF,
          showViewportContextOverlay: false,
          showHorizontalRuler: false,
          showVerticalRuler: false,
          showOrientationMarkers: false,
        },
      },
    );

    act(() => {
      useViewerStore.setState({
        ...useViewerStore.getState(),
        activeTool: ToolName.Crosshairs,
        crosshairWorldPoint: [12.34, 56.78, 9.1],
      });
    });

    expectOverlayVisible(OVERLAY_TEST_PANEL_ID);
    expect(screen.queryByTestId(`viewport-overlay-context:${OVERLAY_TEST_PANEL_ID}`)).not.toBeInTheDocument();
  });

  it('renders configured optional fields when the corresponding viewport/metadata values exist', () => {
    renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: OVERLAY_METADATA_FIXTURE,
        overlayPrefs: OVERLAY_PREFS_ALL_ON,
      },
    );

    act(() => {
      useViewerStore.setState({
        ...useViewerStore.getState(),
        activeTool: ToolName.Crosshairs,
        crosshairWorldPoint: [1.2, 3.4, 5.6],
        viewports: {
          ...useViewerStore.getState().viewports,
          [OVERLAY_TEST_PANEL_ID]: {
            ...useViewerStore.getState().viewports[OVERLAY_TEST_PANEL_ID],
            rotation: 90,
            flipH: true,
            flipV: true,
            invert: true,
          },
        },
      });
      usePreferencesStore.getState().setOverlayCornerField('topLeft', 'patientName', true);
      usePreferencesStore.getState().setOverlayCornerField('topLeft', 'patientId', true);
      usePreferencesStore.getState().setOverlayCornerField('topLeft', 'sliceLocation', true);
      usePreferencesStore.getState().setOverlayCornerField('topLeft', 'sliceThickness', true);
      usePreferencesStore.getState().setOverlayCornerField('topLeft', 'rotation', true);
      usePreferencesStore.getState().setOverlayCornerField('topLeft', 'flip', true);
      usePreferencesStore.getState().setOverlayCornerField('topLeft', 'invert', true);
      usePreferencesStore.getState().setOverlayCornerField('topLeft', 'crosshair', true);
    });

    expectOverlayContains('DOE^JANE');
    expectOverlayContains('ID: P12345');
    expect(screen.getAllByText('Loc: 42.5 mm').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Thick: 1.0 mm').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rot: 90°').length).toBeGreaterThan(0);
    expect(screen.getAllByText('FlipH / FlipV').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inverted').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.2, 3.4, 5.6').length).toBeGreaterThan(0);
  });

  it('updates panel orientation from selector changes and maps native orientation back to STACK', () => {
    renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: OVERLAY_METADATA_FIXTURE,
        overlayPrefs: OVERLAY_PREFS_ALL_ON,
        viewport: {
          totalImages: 5,
        },
      },
    );

    const selector = screen.getByTitle('Viewport orientation');
    fireEvent.change(selector, { target: { value: 'SAGITTAL' } });
    expect(useViewerStore.getState().panelOrientationMap[OVERLAY_TEST_PANEL_ID]).toBe('SAGITTAL');

    fireEvent.change(selector, { target: { value: 'AXIAL' } });
    expect(useViewerStore.getState().panelOrientationMap[OVERLAY_TEST_PANEL_ID]).toBe('STACK');
  });

  it('safely ignores unknown corner field entries and omits dimensions without data', () => {
    renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: {
          ...OVERLAY_METADATA_FIXTURE,
          rows: 0,
          columns: 0,
        },
        viewport: {
          imageWidth: 0,
          imageHeight: 0,
        },
        overlayPrefs: {
          ...OVERLAY_PREFS_ALL_ON,
          corners: {
            topLeft: ['orientationSelector', 'dimensions', 'notAField' as any],
            topRight: [],
            bottomLeft: [],
            bottomRight: [],
          },
        } as any,
      },
    );

    expectOverlayVisible(OVERLAY_TEST_PANEL_ID);
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
  });

  it('falls back to panel XNAT context scanId and skips rulers when zoom scale is non-finite', () => {
    renderWithOverlayStores(
      <ViewportOverlay panelId={OVERLAY_TEST_PANEL_ID} />,
      {
        panelId: OVERLAY_TEST_PANEL_ID,
        metadata: {
          ...OVERLAY_METADATA_FIXTURE,
          seriesNumber: '',
        },
        overlayPrefs: {
          ...OVERLAY_PREFS_ALL_ON,
          showHorizontalRuler: true,
          showVerticalRuler: true,
        },
        viewport: {
          zoomPercent: Number.POSITIVE_INFINITY,
        },
      },
    );

    act(() => {
      useViewerStore.setState({
        ...useViewerStore.getState(),
        panelScanMap: {},
        panelXnatContextMap: {
          [OVERLAY_TEST_PANEL_ID]: {
            projectId: 'P1',
            subjectId: 'S1',
            sessionId: 'E1',
            sessionLabel: 'SESSION-1',
            scanId: '99',
          },
        } as any,
      });
    });

    expectOverlayContains('Scan: 99');
    expect(screen.queryByTestId(`viewport-overlay-horizontal-ruler:${OVERLAY_TEST_PANEL_ID}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`viewport-overlay-vertical-ruler:${OVERLAY_TEST_PANEL_ID}`)).not.toBeInTheDocument();
  });
});
