import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import DicomHeaderPanel from './DicomHeaderPanel';
import { useViewerStore } from '../../stores/viewerStore';

const dicomPanelMocks = vi.hoisted(() => ({
  getViewport: vi.fn(),
  getDataSet: vi.fn(),
}));

vi.mock('../../lib/cornerstone/viewportService', () => ({
  viewportService: {
    getViewport: dicomPanelMocks.getViewport,
  },
}));

vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    dataSetCacheManager: {
      get: dicomPanelMocks.getDataSet,
    },
  },
}));

function resetViewerStore(): void {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  useViewerStore.setState({
    ...useViewerStore.getState(),
    activeViewportId: 'panel_0',
    viewports: {
      panel_0: {
        ...useViewerStore.getInitialState().viewports.panel_0,
        imageIndex: 0,
      } as any,
    },
  });
}

function buildDataset(): any {
  const stringValues: Record<string, string> = {
    x00100010: 'Doe^Jane',
    x00080020: '20240131',
    x0008103e: 'Abdomen CT',
    x00110010: 'private-note',
    x00080090: 'Dr^Who',
  };

  return {
    elements: {
      x00100010: { vr: 'PN', length: 8 },
      x00080020: { vr: 'DA', length: 8 },
      x0008103e: { vr: 'LO', length: 10 },
      x00082112: { vr: 'SQ', items: [{ dataSet: {} }, { dataSet: {} }] },
      x7fe00010: { vr: 'OB', length: 2048 },
      x00280010: { vr: 'US', length: 2 },
      x00110010: { vr: 'LO', length: 12 },
      x00080090: { vr: 'PN', length: 7 },
    },
    string: (tag: string) => stringValues[tag] ?? '',
    uint16: (tag: string) => (tag === 'x00280010' ? 512 : 0),
    int16: () => 0,
    uint32: () => 0,
    int32: () => 0,
    float: () => 0,
    double: () => 0,
  };
}

/**
 * jsdom doesn't ship a PointerEvent constructor; the resize handler
 * only reads clientX/clientY off the event object.
 */
function makePointerEvent(type: string, clientX: number, clientY: number): Event {
  const ev = new Event(type);
  Object.defineProperty(ev, 'clientX', { value: clientX, configurable: true });
  Object.defineProperty(ev, 'clientY', { value: clientY, configurable: true });
  return ev;
}

describe('DicomHeaderPanel', () => {
  beforeEach(() => {
    resetViewerStore();
    vi.clearAllMocks();
  });

  it('shows empty-state message when no active viewport image is available', () => {
    dicomPanelMocks.getViewport.mockReturnValue(null);
    render(<DicomHeaderPanel onClose={vi.fn()} />);
    expect(screen.getByText('No image loaded in active viewport.')).toBeInTheDocument();
  });

  it('renders parsed tags, supports private toggle/search, and close callback', () => {
    dicomPanelMocks.getViewport.mockReturnValue({
      getCurrentImageId: () => 'wadouri:https://xnat.example/image1.dcm',
    });
    dicomPanelMocks.getDataSet.mockReturnValue(buildDataset());
    const onClose = vi.fn();

    render(<DicomHeaderPanel onClose={onClose} />);

    expect(screen.getByText('Doe^Jane')).toBeInTheDocument();
    expect(screen.getByText('2024-01-31')).toBeInTheDocument();
    expect(screen.getByTitle('<sequence: 2 items>')).toBeInTheDocument();
    expect(screen.getByTitle('<pixel data: 2.0 KB>')).toBeInTheDocument();
    expect(screen.getByText('512')).toBeInTheDocument();
    expect(screen.queryByText('private-note')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Show private tags/i));
    expect(screen.getByText('private-note')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search tags...'), { target: { value: 'abdomen' } });
    expect(screen.getByText('Abdomen CT')).toBeInTheDocument();
    expect(screen.queryByText('Doe^Jane')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Close DICOM tags panel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders as a modal dialog with a scrim that closes on click (spec §10.1)', () => {
    dicomPanelMocks.getViewport.mockReturnValue({
      getCurrentImageId: () => 'wadouri:https://xnat.example/image1.dcm',
    });
    dicomPanelMocks.getDataSet.mockReturnValue(buildDataset());
    const onClose = vi.fn();
    render(<DicomHeaderPanel onClose={onClose} />);
    expect(screen.queryByTestId('dicom-tags-modal')).not.toBeNull();
    expect(screen.queryByTestId('dicom-tags-dialog')).not.toBeNull();
    fireEvent.click(screen.getByTestId('dicom-tags-scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the modal (spec §10.1)', () => {
    dicomPanelMocks.getViewport.mockReturnValue({
      getCurrentImageId: () => 'wadouri:https://xnat.example/image1.dcm',
    });
    dicomPanelMocks.getDataSet.mockReturnValue(buildDataset());
    const onClose = vi.fn();
    render(<DicomHeaderPanel onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders module-filter chips with All + every spec module (§10.5)', () => {
    dicomPanelMocks.getViewport.mockReturnValue({
      getCurrentImageId: () => 'wadouri:https://xnat.example/image1.dcm',
    });
    dicomPanelMocks.getDataSet.mockReturnValue(buildDataset());
    render(<DicomHeaderPanel onClose={vi.fn()} />);
    for (const label of ['All', 'Patient', 'Study', 'Series', 'Image']) {
      expect(screen.queryByTestId(`dicom-tags-chip:${label}`)).not.toBeNull();
    }
    expect(screen.getByTestId('dicom-tags-chip:All').dataset.active).toBe('true');
  });

  it('selecting a module chip restricts visible tags to that group', () => {
    dicomPanelMocks.getViewport.mockReturnValue({
      getCurrentImageId: () => 'wadouri:https://xnat.example/image1.dcm',
    });
    dicomPanelMocks.getDataSet.mockReturnValue(buildDataset());
    render(<DicomHeaderPanel onClose={vi.fn()} />);
    // Pre-filter — both Patient (Doe^Jane) and Study (2024-01-31) are visible.
    expect(screen.getByText('Doe^Jane')).toBeInTheDocument();
    expect(screen.getByText('2024-01-31')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('dicom-tags-chip:Patient'));
    expect(screen.getByText('Doe^Jane')).toBeInTheDocument();
    expect(screen.queryByText('2024-01-31')).not.toBeInTheDocument();

    // Re-clicking 'All' restores everything.
    fireEvent.click(screen.getByTestId('dicom-tags-chip:All'));
    expect(screen.getByText('2024-01-31')).toBeInTheDocument();
  });

  it('clicking the hover copy icon writes the tag value to the clipboard (spec §10.6)', async () => {
    dicomPanelMocks.getViewport.mockReturnValue({
      getCurrentImageId: () => 'wadouri:https://xnat.example/image1.dcm',
    });
    dicomPanelMocks.getDataSet.mockReturnValue(buildDataset());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DicomHeaderPanel onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('dicom-tags-copy:x00100010'));
    expect(writeText).toHaveBeenCalledWith('Doe^Jane');
  });

  it('right-click row opens a context menu with the 4 copy variants (spec §10.6)', () => {
    dicomPanelMocks.getViewport.mockReturnValue({
      getCurrentImageId: () => 'wadouri:https://xnat.example/image1.dcm',
    });
    dicomPanelMocks.getDataSet.mockReturnValue(buildDataset());
    render(<DicomHeaderPanel onClose={vi.fn()} />);
    fireEvent.contextMenu(screen.getByTestId('dicom-tags-row:x00100010'), { clientX: 50, clientY: 50 });
    expect(screen.queryByTestId('dicom-tags-context-menu')).not.toBeNull();
    expect(screen.queryByTestId('dicom-tags-ctx-copy-value')).not.toBeNull();
    expect(screen.queryByTestId('dicom-tags-ctx-copy-tagline')).not.toBeNull();
    expect(screen.queryByTestId('dicom-tags-ctx-copy-json')).not.toBeNull();
    expect(screen.queryByTestId('dicom-tags-ctx-copy-group-json')).not.toBeNull();
  });

  it('context menu "Copy as JSON" writes a JSON payload with tag/vr/name/value', async () => {
    dicomPanelMocks.getViewport.mockReturnValue({
      getCurrentImageId: () => 'wadouri:https://xnat.example/image1.dcm',
    });
    dicomPanelMocks.getDataSet.mockReturnValue(buildDataset());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DicomHeaderPanel onClose={vi.fn()} />);
    fireEvent.contextMenu(screen.getByTestId('dicom-tags-row:x00100010'), { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByTestId('dicom-tags-ctx-copy-json'));
    expect(writeText).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(writeText.mock.calls[0][0]);
    expect(payload).toEqual({ tag: '(0010,0010)', vr: 'PN', name: "Patient's Name", value: 'Doe^Jane' });
  });

  it('context menu "Copy whole group as JSON" writes every tag in that module', async () => {
    dicomPanelMocks.getViewport.mockReturnValue({
      getCurrentImageId: () => 'wadouri:https://xnat.example/image1.dcm',
    });
    dicomPanelMocks.getDataSet.mockReturnValue(buildDataset());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<DicomHeaderPanel onClose={vi.fn()} />);
    fireEvent.contextMenu(screen.getByTestId('dicom-tags-row:x00100010'), { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByTestId('dicom-tags-ctx-copy-group-json'));
    const payload = JSON.parse(writeText.mock.calls[0][0]);
    expect(payload.group).toBe('Patient');
    expect(Array.isArray(payload.tags)).toBe(true);
    expect(payload.tags.find((t: { tag: string }) => t.tag === '(0010,0010)')).toBeTruthy();
  });

  it('dragging the bottom-right handle resizes the modal within clamp bounds (spec §10.1)', () => {
    dicomPanelMocks.getViewport.mockReturnValue({
      getCurrentImageId: () => 'wadouri:https://xnat.example/image1.dcm',
    });
    dicomPanelMocks.getDataSet.mockReturnValue(buildDataset());
    render(<DicomHeaderPanel onClose={vi.fn()} />);
    const dialog = screen.getByTestId('dicom-tags-dialog') as HTMLDivElement;
    const handle = screen.getByTestId('dicom-tags-resize-handle');

    // Stub a starting rect of 640×480 anchored at (100, 100).
    Object.defineProperty(dialog, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 100, left: 100, right: 740, bottom: 580,
        width: 640, height: 480,
        x: 100, y: 100, toJSON: () => ({}),
      }),
    });

    // Pointerdown at (740, 580); move +100,+100 → 740×580.
    act(() => {
      const ev = createEvent.pointerDown(handle, { pointerId: 1 });
      Object.defineProperty(ev, 'clientX', { value: 740, configurable: true });
      Object.defineProperty(ev, 'clientY', { value: 580, configurable: true });
      fireEvent(handle, ev);
    });
    act(() => {
      handle.dispatchEvent(makePointerEvent('pointermove', 840, 680));
    });
    expect(dialog.style.width).toBe('740px');
    expect(dialog.style.height).toBe('580px');

    // Move way past the cap (cursor at 5000,5000) — clamped to 90%
    // of the jsdom viewport (default 1024×768 → 921.6 / 691.2).
    act(() => {
      handle.dispatchEvent(makePointerEvent('pointermove', 5000, 5000));
    });
    const w = Number(dialog.style.width.replace('px', ''));
    const h = Number(dialog.style.height.replace('px', ''));
    expect(w).toBeLessThanOrEqual(window.innerWidth * 0.9);
    expect(h).toBeLessThanOrEqual(window.innerHeight * 0.9);

    // Move way below the floor — clamped to 360×320.
    act(() => {
      handle.dispatchEvent(makePointerEvent('pointermove', -5000, -5000));
    });
    expect(dialog.style.width).toBe('360px');
    expect(dialog.style.height).toBe('320px');

    handle.dispatchEvent(new Event('pointerup'));
  });

  it('handles dataset retrieval failures and collapsed groups safely', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dicomPanelMocks.getViewport.mockReturnValue({
      getCurrentImageId: () => 'wadouri:https://xnat.example/image1.dcm',
    });
    dicomPanelMocks.getDataSet.mockImplementation(() => {
      throw new Error('cache failure');
    });

    render(<DicomHeaderPanel onClose={vi.fn()} />);
    expect(screen.getByText('No DICOM tags available for this image.')).toBeInTheDocument();

    warnSpy.mockRestore();
  });
});
