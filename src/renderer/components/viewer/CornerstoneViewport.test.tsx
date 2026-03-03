import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import CornerstoneViewport from './CornerstoneViewport';
import { useViewerStore } from '../../stores/viewerStore';
import { useMetadataStore } from '../../stores/metadataStore';

const mocks = vi.hoisted(() => ({
  createViewport: vi.fn(),
  destroyViewport: vi.fn(),
  loadStack: vi.fn(async () => undefined),
  resize: vi.fn(),
  getViewport: vi.fn(),
  scrollToIndex: vi.fn(),
  getZoom: vi.fn(() => 150),
  addViewport: vi.fn(),
  removeViewport: vi.fn(),
  getOverlayData: vi.fn(() => ({ patientName: 'Pat', studyDate: '20240101' })),
  getNativeOrientation: vi.fn(() => 'AXIAL'),
  getEpoch: vi.fn(() => 7),
  markReady: vi.fn(),
  syncCrosshair: vi.fn(),
  wireCrosshairPointerHandlers: vi.fn(),
  removeSegsFromViewport: vi.fn(),
  attachVisibleSegsToViewport: vi.fn(async () => undefined),
  cacheIsLoaded: vi.fn(() => true),
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
        STACK_NEW_IMAGE: 'STACK_NEW_IMAGE',
        CAMERA_MODIFIED: 'CAMERA_MODIFIED',
      },
    },
    cache: {
      ...actual.cache,
      isLoaded: mocks.cacheIsLoaded,
    },
  };
});

vi.mock('../../lib/cornerstone/viewportService', () => ({
  viewportService: {
    createViewport: mocks.createViewport,
    destroyViewport: mocks.destroyViewport,
    loadStack: mocks.loadStack,
    resize: mocks.resize,
    getViewport: mocks.getViewport,
    scrollToIndex: mocks.scrollToIndex,
    getZoom: mocks.getZoom,
  },
}));

vi.mock('../../lib/cornerstone/toolService', () => ({
  toolService: {
    addViewport: mocks.addViewport,
    removeViewport: mocks.removeViewport,
  },
}));

vi.mock('../../lib/cornerstone/metadataService', () => ({
  metadataService: {
    getOverlayData: mocks.getOverlayData,
    getNativeOrientation: mocks.getNativeOrientation,
  },
}));

vi.mock('../../lib/cornerstone/viewportReadyService', () => ({
  viewportReadyService: {
    getEpoch: mocks.getEpoch,
    markReady: mocks.markReady,
  },
}));

vi.mock('../../lib/cornerstone/crosshairSyncService', () => ({
  crosshairSyncService: {
    syncFromViewport: mocks.syncCrosshair,
  },
}));

vi.mock('../../lib/cornerstone/crosshairGeometry', () => ({
  wireCrosshairPointerHandlers: mocks.wireCrosshairPointerHandlers,
}));

vi.mock('../../lib/segmentation/segmentationManagerSingleton', () => ({
  segmentationManager: {
    removeSegmentationsFromViewport: mocks.removeSegsFromViewport,
    attachVisibleSegmentationsToViewport: mocks.attachVisibleSegsToViewport,
  },
}));

function resetStores(): void {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  useMetadataStore.setState(useMetadataStore.getInitialState(), true);
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

describe('CornerstoneViewport', () => {
  const panelId = 'panel_0';

  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    mocks.loadStack.mockResolvedValue(undefined);
    mocks.attachVisibleSegsToViewport.mockResolvedValue(undefined);
    mocks.getZoom.mockReturnValue(150);
    mocks.cacheIsLoaded.mockReturnValue(true);
    mocks.getViewport.mockReturnValue({
      getCurrentImageIdIndex: () => 1,
      getImageIds: () => ['img-1', 'img-2'],
      getCurrentImageId: () => 'img-2',
      getImageData: () => ({ dimensions: [512, 256] }),
      getProperties: () => ({ voiRange: { lower: 10, upper: 110 } }),
      resetCamera: vi.fn(),
      render: vi.fn(),
    });
  });

  it('sets up viewport services, syncs stores, and cleans up on unmount', async () => {
    const stopCine = vi.fn();
    useViewerStore.setState({ ...useViewerStore.getState(), stopCine });

    const view = render(<CornerstoneViewport panelId={panelId} imageIds={['img-1', 'img-2']} />);

    await waitFor(() => {
      expect(mocks.createViewport).toHaveBeenCalledWith(
        panelId,
        expect.any(HTMLDivElement),
      );
    });
    expect(mocks.addViewport).toHaveBeenCalledWith(panelId);
    expect(mocks.loadStack).toHaveBeenCalledWith(panelId, ['img-1', 'img-2']);
    expect(mocks.markReady).toHaveBeenCalledWith(panelId, 7);
    expect(mocks.removeSegsFromViewport).toHaveBeenCalledWith(panelId);
    expect(mocks.attachVisibleSegsToViewport).toHaveBeenCalledWith(panelId);
    expect(mocks.wireCrosshairPointerHandlers).toHaveBeenCalledWith(
      expect.objectContaining({
        panelId,
        element: expect.any(HTMLDivElement),
      }),
    );

    const viewer = useViewerStore.getState();
    expect(viewer.viewports[panelId]).toEqual(
      expect.objectContaining({
        imageIndex: 1,
        totalImages: 2,
        windowWidth: 100,
        windowCenter: 60,
        zoomPercent: 150,
        imageWidth: 512,
        imageHeight: 256,
      }),
    );
    expect(viewer.panelNativeOrientationMap[panelId]).toBe('AXIAL');
    expect(useMetadataStore.getState().overlays[panelId]).toEqual(
      expect.objectContaining({ patientName: 'Pat' }),
    );

    view.unmount();
    expect(stopCine).toHaveBeenCalledWith(panelId);
    expect(mocks.removeViewport).toHaveBeenCalledWith(panelId);
    expect(mocks.destroyViewport).toHaveBeenCalledWith(panelId);
    expect(useMetadataStore.getState().overlays[panelId]).toBeUndefined();
  });

  it('wires cornerstone events into viewer store updates and wheel navigation', async () => {
    mocks.getViewport.mockReturnValue({
      getCurrentImageIdIndex: () => 0,
      getImageIds: () => ['img-1', 'img-2', 'img-3'],
      getCurrentImageId: () => 'img-1',
      getImageData: () => ({ dimensions: [320, 240] }),
      getProperties: () => ({ voiRange: { lower: 20, upper: 120 } }),
      resetCamera: vi.fn(),
      render: vi.fn(),
    });
    mocks.getZoom.mockReturnValue(175);

    render(<CornerstoneViewport panelId={panelId} imageIds={['img-1', 'img-2', 'img-3']} />);
    await waitFor(() => expect(mocks.createViewport).toHaveBeenCalled());

    const canvas = screen.getByTestId(`cornerstone-viewport-canvas:${panelId}`);

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

    fireEvent(
      canvas,
      new CustomEvent('STACK_NEW_IMAGE', {
        detail: { imageIdIndex: 2, imageId: 'img-3' },
      }),
    );
    expect(useViewerStore.getState().viewports[panelId]).toEqual(
      expect.objectContaining({
        imageIndex: 2,
        totalImages: 3,
      }),
    );

    fireEvent(canvas, new CustomEvent('CAMERA_MODIFIED'));
    expect(useViewerStore.getState().viewports[panelId].zoomPercent).toBe(175);

    fireEvent(
      canvas,
      new WheelEvent('wheel', {
        deltaY: -120,
        cancelable: true,
      }),
    );
    expect(mocks.scrollToIndex).toHaveBeenCalledWith(panelId, 0);
    expect(useViewerStore.getState().viewports[panelId].requestedImageIndex).toBe(0);
  });

  it('shows error UI when setup fails and skips ready signaling', async () => {
    const err = new Error('load exploded');
    mocks.loadStack.mockRejectedValueOnce(err);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<CornerstoneViewport panelId={panelId} imageIds={['img-1']} />);

    await waitFor(() => {
      expect(screen.getByTestId(`cornerstone-viewport-error:${panelId}`)).toBeInTheDocument();
    });
    expect(screen.getByText('load exploded')).toBeInTheDocument();
    expect(mocks.markReady).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('shows pending-slice status when requested stack image is not loaded yet', async () => {
    mocks.getViewport.mockReturnValue({
      getCurrentImageIdIndex: () => 0,
      getImageIds: () => ['img-1', 'img-2'],
      getCurrentImageId: () => 'img-1',
      getImageData: () => ({ dimensions: [320, 240] }),
      getProperties: () => ({ voiRange: { lower: 20, upper: 120 } }),
      resetCamera: vi.fn(),
      render: vi.fn(),
    });
    mocks.cacheIsLoaded.mockReturnValue(false);

    render(<CornerstoneViewport panelId={panelId} imageIds={['img-1', 'img-2']} />);
    await waitFor(() => expect(mocks.createViewport).toHaveBeenCalled());

    act(() => {
      useViewerStore.getState()._requestImageIndex(panelId, 1, 2);
    });

    expect(screen.getByTestId(`cornerstone-viewport-pending:${panelId}`)).toHaveTextContent('Slice loading...');
  });
});
