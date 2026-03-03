import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import MPRViewport from './MPRViewport';
import { useViewerStore } from '../../stores/viewerStore';
import { usePreferencesStore } from '../../stores/preferencesStore';

const mocks = vi.hoisted(() => ({
  createViewport: vi.fn(),
  setVolume: vi.fn(async () => undefined),
  resetCamera: vi.fn(),
  getSliceInfo: vi.fn(() => ({ sliceIndex: 5, totalSlices: 30 })),
  getZoom: vi.fn(() => 140),
  getViewport: vi.fn(() => ({ getProperties: () => ({ voiRange: { lower: 10, upper: 210 } }) })),
  destroyViewport: vi.fn(),
  scroll: vi.fn(),
  addViewport: vi.fn(),
  removeViewport: vi.fn(),
  resize: vi.fn(),
  syncFromViewport: vi.fn(),
  wireCrosshairPointerHandlers: vi.fn(),
}));

vi.mock('@cornerstonejs/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cornerstonejs/core')>();
  return {
    ...actual,
    Enums: {
      ...actual.Enums,
      Events: {
        ...actual.Enums.Events,
        VOI_MODIFIED: 'VOI_MODIFIED',
        CAMERA_MODIFIED: 'CAMERA_MODIFIED',
      },
    },
  };
});

vi.mock('../../lib/cornerstone/mprService', () => ({
  mprService: {
    createViewport: mocks.createViewport,
    setVolume: mocks.setVolume,
    resetCamera: mocks.resetCamera,
    getSliceInfo: mocks.getSliceInfo,
    getZoom: mocks.getZoom,
    getViewport: mocks.getViewport,
    destroyViewport: mocks.destroyViewport,
    scroll: mocks.scroll,
  },
}));

vi.mock('../../lib/cornerstone/mprToolService', () => ({
  mprToolService: {
    addViewport: mocks.addViewport,
    removeViewport: mocks.removeViewport,
  },
}));

vi.mock('../../lib/cornerstone/viewportService', () => ({
  viewportService: {
    resize: mocks.resize,
  },
}));

vi.mock('../../lib/cornerstone/crosshairSyncService', () => ({
  crosshairSyncService: {
    syncFromViewport: mocks.syncFromViewport,
  },
}));

vi.mock('../../lib/cornerstone/crosshairGeometry', () => ({
  wireCrosshairPointerHandlers: mocks.wireCrosshairPointerHandlers,
}));

function resetStores(): void {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  usePreferencesStore.setState(usePreferencesStore.getInitialState(), true);
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return 640;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return 480;
    },
  });
});

describe('MPRViewport', () => {
  const panelId = 'mpr_panel_0';

  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    mocks.setVolume.mockResolvedValue(undefined);
    mocks.getSliceInfo.mockReturnValue({ sliceIndex: 5, totalSlices: 30 });
    mocks.getZoom.mockReturnValue(140);
    mocks.getViewport.mockReturnValue({ getProperties: () => ({ voiRange: { lower: 10, upper: 210 } }) });
  });

  it('initializes viewport/tooling and renders orientation markers', async () => {
    render(<MPRViewport panelId={panelId} volumeId="vol-1" plane="AXIAL" />);

    await waitFor(() => {
      expect(mocks.createViewport).toHaveBeenCalledWith(
        panelId,
        expect.any(HTMLDivElement),
        'AXIAL',
      );
    });
    expect(mocks.addViewport).toHaveBeenCalledWith(panelId);
    expect(mocks.setVolume).toHaveBeenCalledWith(panelId, 'vol-1');
    expect(mocks.resetCamera).toHaveBeenCalledWith(panelId);
    expect(mocks.wireCrosshairPointerHandlers).toHaveBeenCalledWith(
      expect.objectContaining({ panelId }),
    );

    const state = useViewerStore.getState();
    expect(state.mprViewports[panelId]).toEqual(
      expect.objectContaining({ sliceIndex: 5, totalSlices: 30 }),
    );
    expect(state.viewports[panelId]).toEqual(
      expect.objectContaining({
        imageIndex: 5,
        totalImages: 30,
        zoomPercent: 140,
        windowWidth: 200,
        windowCenter: 110,
      }),
    );

    expect(screen.getByText('Axial')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('P')).toBeInTheDocument();
    expect(screen.getByText('R')).toBeInTheDocument();
    expect(screen.getByText('L')).toBeInTheDocument();
  });

  it('honors preference toggle for orientation markers', async () => {
    usePreferencesStore.setState({
      ...usePreferencesStore.getState(),
      preferences: {
        ...usePreferencesStore.getState().preferences,
        overlay: {
          ...usePreferencesStore.getState().preferences.overlay,
          showOrientationMarkers: false,
        },
      },
    });

    render(<MPRViewport panelId={panelId} volumeId="vol-1" plane="CORONAL" />);
    await waitFor(() => expect(mocks.createViewport).toHaveBeenCalled());

    expect(screen.queryByText('S')).not.toBeInTheDocument();
    expect(screen.queryByText('I')).not.toBeInTheDocument();
    expect(screen.queryByText('R')).not.toBeInTheDocument();
    expect(screen.queryByText('L')).not.toBeInTheDocument();
  });

  it('wires VOI/camera/wheel events into store and mprService scroll calls', async () => {
    render(<MPRViewport panelId={panelId} volumeId="vol-1" plane="SAGITTAL" />);
    await waitFor(() => expect(mocks.createViewport).toHaveBeenCalled());

    const canvas = screen.getByTestId(`mpr-viewport-canvas:${panelId}`);

    fireEvent(
      canvas,
      new CustomEvent('VOI_MODIFIED', {
        detail: { range: { lower: 40, upper: 240 } },
      }),
    );
    expect(useViewerStore.getState().viewports[panelId]).toEqual(
      expect.objectContaining({
        windowWidth: 200,
        windowCenter: 140,
      }),
    );

    mocks.getSliceInfo.mockReturnValue({ sliceIndex: 11, totalSlices: 33 });
    mocks.getZoom.mockReturnValue(185);
    fireEvent(canvas, new CustomEvent('CAMERA_MODIFIED'));
    expect(useViewerStore.getState().mprViewports[panelId]).toEqual(
      expect.objectContaining({ sliceIndex: 11, totalSlices: 33 }),
    );
    expect(useViewerStore.getState().viewports[panelId]).toEqual(
      expect.objectContaining({ imageIndex: 11, totalImages: 33, zoomPercent: 185 }),
    );

    fireEvent(
      canvas,
      new WheelEvent('wheel', {
        deltaY: 120,
        cancelable: true,
      }),
    );
    expect(mocks.scroll).toHaveBeenCalledWith(panelId, 2);

    fireEvent(
      canvas,
      new WheelEvent('wheel', {
        deltaY: 120,
        ctrlKey: true,
        cancelable: true,
      }),
    );
    expect(mocks.scroll).toHaveBeenCalledTimes(1);
  });

  it('shows MPR error overlay when setup fails and performs cleanup on unmount', async () => {
    const err = new Error('mpr setup failed');
    mocks.setVolume.mockRejectedValueOnce(err);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const view = render(<MPRViewport panelId={panelId} volumeId="vol-1" plane="AXIAL" />);
    await waitFor(() => {
      expect(screen.getByTestId(`mpr-viewport-error:${panelId}`)).toBeInTheDocument();
    });
    expect(screen.getByText('mpr setup failed')).toBeInTheDocument();

    view.unmount();
    expect(mocks.removeViewport).toHaveBeenCalledWith(panelId);
    expect(mocks.destroyViewport).toHaveBeenCalledWith(panelId);
    consoleError.mockRestore();
  });
});
