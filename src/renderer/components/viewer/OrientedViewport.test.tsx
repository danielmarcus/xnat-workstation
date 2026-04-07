import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import OrientedViewport from './OrientedViewport';
import { useViewerStore } from '../../stores/viewerStore';

const mocks = vi.hoisted(() => ({
  mprCreateViewport: vi.fn(),
  mprSetVolume: vi.fn(async () => undefined),
  mprResetCamera: vi.fn(),
  mprGetSliceInfo: vi.fn(() => ({ sliceIndex: 3, totalSlices: 25 })),
  mprGetZoom: vi.fn(() => 125),
  mprGetViewport: vi.fn(() => ({ getImageData: () => ({ dimensions: [320, 240] }) })),
  mprDestroyViewport: vi.fn(),
  mprScroll: vi.fn(),
  volumeGenerateId: vi.fn(() => 'vol-generated'),
  volumeCreate: vi.fn(async () => undefined),
  volumeLoad: vi.fn(async () => undefined),
  volumeDestroy: vi.fn(),
  viewportResize: vi.fn(),
  toolAddViewport: vi.fn(),
  toolRemoveViewport: vi.fn(),
  getEpoch: vi.fn(() => 11),
  markReady: vi.fn(),
  removeSegsFromViewport: vi.fn(),
  attachVisibleSegsToViewport: vi.fn(async () => undefined),
  wireCrosshairPointerHandlers: vi.fn(),
  syncFromViewport: vi.fn(),
  syncFromClientPoint: vi.fn(),
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
    createViewport: mocks.mprCreateViewport,
    setVolume: mocks.mprSetVolume,
    resetCamera: mocks.mprResetCamera,
    getSliceInfo: mocks.mprGetSliceInfo,
    getZoom: mocks.mprGetZoom,
    getViewport: mocks.mprGetViewport,
    destroyViewport: mocks.mprDestroyViewport,
    scroll: mocks.mprScroll,
  },
}));

vi.mock('../../lib/cornerstone/volumeService', () => ({
  volumeService: {
    generateId: mocks.volumeGenerateId,
    create: mocks.volumeCreate,
    load: mocks.volumeLoad,
    destroy: mocks.volumeDestroy,
  },
}));

vi.mock('../../lib/cornerstone/viewportService', () => ({
  viewportService: {
    resize: mocks.viewportResize,
  },
}));

vi.mock('../../lib/cornerstone/toolService', () => ({
  toolService: {
    addViewport: mocks.toolAddViewport,
    removeViewport: mocks.toolRemoveViewport,
  },
}));

vi.mock('../../lib/cornerstone/viewportReadyService', () => ({
  viewportReadyService: {
    getEpoch: mocks.getEpoch,
    markReady: mocks.markReady,
  },
}));

vi.mock('../../lib/segmentation/segmentationManagerSingleton', () => ({
  segmentationManager: {
    removeSegmentationsFromViewport: mocks.removeSegsFromViewport,
    attachVisibleSegmentationsToViewport: mocks.attachVisibleSegsToViewport,
  },
}));

vi.mock('../../lib/cornerstone/crosshairGeometry', () => ({
  wireCrosshairPointerHandlers: mocks.wireCrosshairPointerHandlers,
}));

vi.mock('../../lib/cornerstone/crosshairSyncService', () => ({
  crosshairSyncService: {
    syncFromViewport: mocks.syncFromViewport,
    syncFromClientPoint: mocks.syncFromClientPoint,
  },
}));

function resetStore(): void {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
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

describe('OrientedViewport', () => {
  const panelId = 'panel_0';

  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    mocks.mprSetVolume.mockResolvedValue(undefined);
    mocks.volumeCreate.mockResolvedValue(undefined);
    mocks.volumeLoad.mockResolvedValue(undefined);
    mocks.attachVisibleSegsToViewport.mockResolvedValue(undefined);
    mocks.mprGetSliceInfo.mockReturnValue({ sliceIndex: 3, totalSlices: 25 });
    mocks.mprGetZoom.mockReturnValue(125);
    mocks.mprGetViewport.mockReturnValue({ getImageData: () => ({ dimensions: [320, 240] }) });
  });

  it('renders status for empty image sets without creating a viewport', () => {
    render(<OrientedViewport panelId={panelId} imageIds={[]} plane="AXIAL" />);
    expect(screen.getByTestId(`oriented-viewport-status:${panelId}`)).toHaveTextContent('Initializing...');
    expect(mocks.volumeCreate).not.toHaveBeenCalled();
    expect(mocks.mprCreateViewport).not.toHaveBeenCalled();
  });

  it('initializes oriented viewport/volume stack and tears down cleanly', async () => {
    const stopCine = vi.fn();
    useViewerStore.setState({ ...useViewerStore.getState(), stopCine });

    const view = render(
      <OrientedViewport panelId={panelId} imageIds={['img-1', 'img-2', 'img-3']} plane="CORONAL" />,
    );

    await waitFor(() => {
      expect(mocks.volumeCreate).toHaveBeenCalledWith('vol-generated', ['img-1', 'img-2', 'img-3']);
    });
    expect(mocks.mprCreateViewport).toHaveBeenCalledWith(
      panelId,
      expect.any(HTMLDivElement),
      'CORONAL',
    );
    expect(mocks.mprSetVolume).toHaveBeenCalledWith(panelId, 'vol-generated');
    expect(mocks.volumeLoad).toHaveBeenCalledWith('vol-generated');
    expect(mocks.markReady).toHaveBeenCalledWith(panelId, 11);
    expect(mocks.removeSegsFromViewport).toHaveBeenCalledWith(panelId);
    expect(mocks.attachVisibleSegsToViewport).toHaveBeenCalledWith(panelId);

    expect(useViewerStore.getState().viewports[panelId]).toEqual(
      expect.objectContaining({
        imageIndex: 3,
        totalImages: 25,
        zoomPercent: 125,
        imageWidth: 320,
        imageHeight: 240,
      }),
    );
    expect(useViewerStore.getState().mprViewports[panelId]).toEqual(
      expect.objectContaining({ sliceIndex: 3, totalSlices: 25 }),
    );

    view.unmount();
    expect(stopCine).toHaveBeenCalledWith(panelId);
    expect(mocks.toolRemoveViewport).toHaveBeenCalledWith(panelId);
    expect(mocks.mprDestroyViewport).toHaveBeenCalledWith(panelId);
    expect(mocks.volumeDestroy).toHaveBeenCalledWith('vol-generated');
  });

  it('wires VOI/camera/wheel events to store synchronization and mpr scrolling', async () => {
    render(<OrientedViewport panelId={panelId} imageIds={['img-1', 'img-2']} plane="SAGITTAL" />);
    await waitFor(() => expect(mocks.mprCreateViewport).toHaveBeenCalled());

    const canvas = screen.getByTestId(`oriented-viewport-canvas:${panelId}`);

    fireEvent(
      canvas,
      new CustomEvent('VOI_MODIFIED', {
        detail: { range: { lower: 30, upper: 230 } },
      }),
    );
    expect(useViewerStore.getState().viewports[panelId]).toEqual(
      expect.objectContaining({
        windowWidth: 200,
        windowCenter: 130,
      }),
    );

    mocks.mprGetSliceInfo.mockReturnValue({ sliceIndex: 7, totalSlices: 28 });
    mocks.mprGetZoom.mockReturnValue(180);
    fireEvent(canvas, new CustomEvent('CAMERA_MODIFIED'));
    expect(useViewerStore.getState().viewports[panelId]).toEqual(
      expect.objectContaining({
        imageIndex: 7,
        totalImages: 28,
        zoomPercent: 180,
      }),
    );

    fireEvent(
      canvas,
      new WheelEvent('wheel', {
        deltaY: 130,
        cancelable: true,
      }),
    );
    expect(mocks.mprScroll).toHaveBeenCalledWith(panelId, 2);

    fireEvent(
      canvas,
      new WheelEvent('wheel', {
        deltaY: 130,
        metaKey: true,
        cancelable: true,
      }),
    );
    expect(mocks.mprScroll).toHaveBeenCalledTimes(1);
  });

  it('syncs compatible viewports after the shifted oriented scroll updates the slice', async () => {
    render(<OrientedViewport panelId={panelId} imageIds={['img-1', 'img-2']} plane="SAGITTAL" />);
    await waitFor(() => expect(mocks.mprCreateViewport).toHaveBeenCalled());

    const canvas = screen.getByTestId(`oriented-viewport-canvas:${panelId}`);

    fireEvent(
      canvas,
      new WheelEvent('wheel', {
        deltaY: 130,
        shiftKey: true,
        cancelable: true,
      }),
    );
    expect(mocks.syncFromClientPoint).not.toHaveBeenCalled();

    fireEvent(canvas, new CustomEvent('CAMERA_MODIFIED'));

    expect(mocks.syncFromClientPoint).toHaveBeenCalledWith(panelId, 0, 0);
  });

  it('uses horizontal wheel deltas for shift-scroll oriented trackpad gestures', async () => {
    render(<OrientedViewport panelId={panelId} imageIds={['img-1', 'img-2']} plane="SAGITTAL" />);
    await waitFor(() => expect(mocks.mprCreateViewport).toHaveBeenCalled());

    const canvas = screen.getByTestId(`oriented-viewport-canvas:${panelId}`);

    fireEvent(
      canvas,
      new WheelEvent('wheel', {
        deltaX: 130,
        deltaY: 0,
        shiftKey: true,
        cancelable: true,
      }),
    );

    expect(mocks.mprScroll).toHaveBeenCalledWith(panelId, 2);
    fireEvent(canvas, new CustomEvent('CAMERA_MODIFIED'));
    expect(mocks.syncFromClientPoint).toHaveBeenCalledWith(panelId, 0, 0);
  });

  it('shows error overlay when setup fails', async () => {
    const err = new Error('oriented setup failed');
    mocks.volumeCreate.mockRejectedValueOnce(err);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<OrientedViewport panelId={panelId} imageIds={['img-1']} plane="AXIAL" />);
    await waitFor(() => {
      expect(screen.getByTestId(`oriented-viewport-error:${panelId}`)).toBeInTheDocument();
    });
    expect(screen.getByText('oriented setup failed')).toBeInTheDocument();
    expect(mocks.markReady).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
