import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HotkeyMap } from '@shared/types/hotkeys';
import { hotkeyService } from '../lib/hotkeys/hotkeyService';
import { dispatchKey } from '../test/hotkeys/keyboard';
import { useViewerStore } from '../stores/viewerStore';
import ViewerPage from './ViewerPage';

const {
  viewportServiceMock,
  mprServiceMock,
  segmentationServiceMock,
  toolServiceMock,
  annotationServiceMock,
} = vi.hoisted(() => ({
  viewportServiceMock: {
    zoomBy: vi.fn(),
    scrollToIndex: vi.fn(),
  },
  mprServiceMock: {
    scrollToIndex: vi.fn(),
    scroll: vi.fn(),
  },
  segmentationServiceMock: {
    initialize: vi.fn(),
    dispose: vi.fn(),
    setBrushSize: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    deleteSelectedContourComponents: vi.fn(),
  },
  toolServiceMock: {
    initialize: vi.fn(),
    destroy: vi.fn(),
  },
  annotationServiceMock: {
    initialize: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock('../components/viewer/Toolbar', () => ({
  default: () => <div data-testid="toolbar" />,
}));

vi.mock('../components/viewer/ViewportGrid', () => ({
  default: () => <div data-testid="viewport-grid" />,
}));

vi.mock('../components/viewer/MPRViewportGrid', () => ({
  default: () => <div data-testid="mpr-grid" />,
}));

vi.mock('../components/viewer/AnnotationListPanel', () => ({
  default: () => <div data-testid="annotation-panel" />,
}));

vi.mock('../components/viewer/SegmentationPanel', () => ({
  default: () => <div data-testid="segmentation-panel" />,
}));

vi.mock('../components/viewer/DicomHeaderPanel', () => ({
  default: () => <div data-testid="dicom-panel" />,
}));

vi.mock('../lib/cornerstone/viewportService', () => ({
  viewportService: viewportServiceMock,
}));

vi.mock('../lib/cornerstone/mprService', () => ({
  mprService: mprServiceMock,
}));

vi.mock('../lib/cornerstone/segmentationService', () => ({
  segmentationService: segmentationServiceMock,
}));

vi.mock('../lib/cornerstone/toolService', () => ({
  toolService: toolServiceMock,
}));

vi.mock('../lib/cornerstone/annotationService', () => ({
  annotationService: annotationServiceMock,
}));

describe('ViewerPage hotkeys integration', () => {
  beforeEach(() => {
    useViewerStore.setState(useViewerStore.getInitialState(), true);
    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeViewportId: 'panel_0',
      layoutConfig: { rows: 1, cols: 1, panelCount: 1 },
      viewports: {
        panel_0: {
          viewportId: 'panel_0',
          totalImages: 12,
          imageIndex: 0,
          requestedImageIndex: null,
          windowWidth: 400,
          windowCenter: 40,
          zoomPercent: 100,
          rotation: 0,
          flipH: false,
          flipV: false,
          invert: false,
          imageWidth: 512,
          imageHeight: 512,
        },
      },
    });

    hotkeyService.uninstall();
    hotkeyService.setHotkeyMap({});
    vi.clearAllMocks();
  });

  it('mount/unmount of ViewerPage balances global keydown listener lifecycle', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const first = render(
      <ViewerPage panelImageIds={{ panel_0: ['img1', 'img2'] }} />,
    );
    first.unmount();

    const second = render(
      <ViewerPage panelImageIds={{ panel_0: ['img1', 'img2'] }} />,
    );
    second.unmount();

    const keydownAdds = addSpy.mock.calls.filter((call) => call[0] === 'keydown');
    const keydownRemoves = removeSpy.mock.calls.filter((call) => call[0] === 'keydown');

    expect(keydownAdds).toHaveLength(2);
    expect(keydownRemoves).toHaveLength(2);
    expect(keydownAdds.every((call) => (call[2] as AddEventListenerOptions).capture === true)).toBe(true);
    expect(keydownRemoves.every((call) => (call[2] as EventListenerOptions).capture === true)).toBe(true);
  });

  it('dispatches configured hotkeys end-to-end through ViewerPage to viewportService', () => {
    const map: HotkeyMap = {
      'viewport.zoomIn': [{ key: 'k' }],
    };
    hotkeyService.setHotkeyMap(map);

    const view = render(
      <ViewerPage panelImageIds={{ panel_0: ['img1', 'img2'] }} />,
    );

    dispatchKey({ key: 'k' });

    expect(viewportServiceMock.zoomBy).toHaveBeenCalledWith('panel_0', 1.2);

    view.unmount();
  });
});
