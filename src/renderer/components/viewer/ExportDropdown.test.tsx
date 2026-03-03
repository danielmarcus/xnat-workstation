import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExportDropdown from './ExportDropdown';
import { useViewerStore } from '../../stores/viewerStore';
import { useAnnotationStore } from '../../stores/annotationStore';

const mocks = vi.hoisted(() => ({
  getViewport: vi.fn(),
  dataSetGet: vi.fn(),
}));

vi.mock('../../lib/cornerstone/viewportService', () => ({
  viewportService: {
    getViewport: mocks.getViewport,
  },
}));

vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    dataSetCacheManager: {
      get: mocks.dataSetGet,
    },
  },
}));

function resetStores(): void {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  useAnnotationStore.setState(useAnnotationStore.getInitialState(), true);
}

function makeViewport(overrides: Record<string, unknown> = {}) {
  const canvas = document.createElement('canvas');
  const toDataURL = vi.fn(() => 'data:image/png;base64,AAA');
  Object.defineProperty(canvas, 'toDataURL', { value: toDataURL });
  return {
    canvas,
    viewport: {
      getCanvas: () => canvas,
      getImageIds: () => ['wadouri:https://xnat/1.dcm', 'wadouri:https://xnat/2.dcm'],
      getCurrentImageIdIndex: () => 0,
      setImageIdIndex: vi.fn(async () => {}),
      render: vi.fn(),
      getCurrentImageId: () => 'wadouri:https://xnat/current.dcm',
      ...overrides,
    },
    toDataURL,
  };
}

describe('ExportDropdown', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    document.querySelectorAll('[data-panel-id]').forEach((el) => el.remove());

    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeViewportId: 'panel_0',
    });

    (window as any).electronAPI = {
      export: {
        saveViewportCapture: vi.fn(async () => ({ ok: true })),
        saveScreenshot: vi.fn(async () => ({ ok: true })),
        copyViewportCapture: vi.fn(async () => ({ ok: true })),
        copyToClipboard: vi.fn(async () => ({ ok: true })),
        saveAllSlices: vi.fn(async () => ({ ok: true, count: 2 })),
        saveDicom: vi.fn(async () => ({ ok: true })),
        saveReport: vi.fn(async () => ({ ok: true })),
      },
    };
  });

  it('captures active panel bounds and calls saveViewportCapture', async () => {
    const user = userEvent.setup();
    const { viewport } = makeViewport();
    mocks.getViewport.mockReturnValue(viewport);

    const panel = document.createElement('div');
    panel.setAttribute('data-panel-id', 'panel_0');
    panel.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 300, height: 200, right: 310, bottom: 220 } as DOMRect);
    document.body.appendChild(panel);

    render(<ExportDropdown />);
    await user.click(screen.getByTitle('Export'));
    await user.click(screen.getByRole('button', { name: /Save as Image/i }));

    await waitFor(() => {
      expect(window.electronAPI.export.saveViewportCapture).toHaveBeenCalledWith(
        { x: 10, y: 20, width: 300, height: 200 },
        expect.stringMatching(/^viewport-.*\.png$/),
      );
    });
    expect(screen.getByText('Image saved successfully')).toBeInTheDocument();
  });

  it('falls back to canvas copy when no panel bounds are available', async () => {
    const user = userEvent.setup();
    const { viewport, toDataURL } = makeViewport();
    mocks.getViewport.mockReturnValue(viewport);

    render(<ExportDropdown />);
    await user.click(screen.getByTitle('Export'));
    await user.click(screen.getByRole('button', { name: /Copy to Clipboard/i }));

    await waitFor(() => {
      expect(window.electronAPI.export.copyToClipboard).toHaveBeenCalledWith('data:image/png;base64,AAA');
    });
    expect(toDataURL).toHaveBeenCalled();
    expect(screen.getByText('Copied to clipboard')).toBeInTheDocument();
  });

  it('exports DICOM bytes from wadouri dataset cache', async () => {
    const user = userEvent.setup();
    const { viewport } = makeViewport();
    mocks.getViewport.mockReturnValue(viewport);
    mocks.dataSetGet.mockReturnValue({
      byteArray: new Uint8Array([1, 2, 3, 4]),
    });

    render(<ExportDropdown />);
    await user.click(screen.getByTitle('Export'));
    await user.click(screen.getByRole('button', { name: /Save DICOM File/i }));

    await waitFor(() => {
      expect(window.electronAPI.export.saveDicom).toHaveBeenCalledWith('AQIDBA==');
    });
    expect(screen.getByText('DICOM file saved')).toBeInTheDocument();
  });

  it('exports annotation CSV report and handles empty-list validation', async () => {
    const user = userEvent.setup();
    const { viewport } = makeViewport();
    mocks.getViewport.mockReturnValue(viewport);

    render(<ExportDropdown />);
    await user.click(screen.getByTitle('Export'));
    await user.click(screen.getByRole('button', { name: /Export Annotations/i }));
    expect(screen.getByText('No annotations to export')).toBeInTheDocument();

    useAnnotationStore.setState({
      ...useAnnotationStore.getState(),
      annotations: [
        {
          annotationUID: 'ann-1',
          toolName: 'Length',
          displayName: 'Length',
          displayText: '12,4 mm',
          label: 'Tumor,ROI',
        },
      ],
    });

    await user.click(screen.getByTitle('Export'));
    await user.click(screen.getByRole('button', { name: /Export Annotations/i }));

    await waitFor(() => {
      expect(window.electronAPI.export.saveReport).toHaveBeenCalledWith(
        expect.stringContaining('Tool,Measurement,Label'),
        expect.stringMatching(/^annotations-.*\.csv$/),
      );
    });
    expect(screen.getByText('Exported 1 annotations')).toBeInTheDocument();
  });
});
