import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
