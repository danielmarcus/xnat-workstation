import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SegmentationPanel from './SegmentationPanel';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useViewerStore } from '../../stores/viewerStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useSegmentationManagerStore } from '../../stores/segmentationManagerStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useSessionDerivedIndexStore } from '../../stores/sessionDerivedIndexStore';

const segPanelMocks = vi.hoisted(() => ({
  metaDataGet: vi.fn(),
  updateContourStyle: vi.fn(),
  getPreferredDicomType: vi.fn(() => 'SEG'),
  updateStyle: vi.fn(),
  setBrushSize: vi.fn(),
  hasExportableContent: vi.fn(() => true),
  exportToRtStruct: vi.fn(async () => 'RT_BASE64'),
  getScanImageIds: vi.fn(async () => []),
  segmentationManager: {
    createNewStructure: vi.fn(async () => 'rt-new'),
    createNewSegmentation: vi.fn(async () => 'seg-new'),
    addSegment: vi.fn(async () => undefined),
    removeSegmentation: vi.fn(),
    userSelectedSegmentation: vi.fn(),
    userChangedSegmentColor: vi.fn(),
    renameSegmentation: vi.fn(),
    renameSegment: vi.fn(),
    exportToDicomSeg: vi.fn(async () => 'SEG_BASE64'),
    requestShowOverlaysForSourceScan: vi.fn(async () => undefined),
    removeSelectedContourComponents: vi.fn(() => false),
    removeSegment: vi.fn(),
    userToggledVisibility: vi.fn(),
    userToggledLock: vi.fn(),
    beginManualSave: vi.fn(),
    endManualSave: vi.fn(),
  },
}));

vi.mock('@cornerstonejs/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cornerstonejs/core')>();
  return {
    ...actual,
    metaData: {
      ...actual.metaData,
      get: segPanelMocks.metaDataGet,
    },
  };
});

vi.mock('../../lib/cornerstone/segmentationService', () => ({
  segmentationService: {
    updateContourStyle: segPanelMocks.updateContourStyle,
    getPreferredDicomType: segPanelMocks.getPreferredDicomType,
    updateStyle: segPanelMocks.updateStyle,
    setBrushSize: segPanelMocks.setBrushSize,
    hasExportableContent: segPanelMocks.hasExportableContent,
  },
}));

vi.mock('../../lib/cornerstone/rtStructService', () => ({
  rtStructService: {
    exportToRtStruct: segPanelMocks.exportToRtStruct,
  },
}));

vi.mock('../../lib/segmentation/segmentationManagerSingleton', () => ({
  segmentationManager: segPanelMocks.segmentationManager,
}));

vi.mock('../../lib/cornerstone/dicomwebLoader', () => ({
  dicomwebLoader: {
    getScanImageIds: segPanelMocks.getScanImageIds,
  },
}));

function resetStores(): void {
  useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  useConnectionStore.setState(useConnectionStore.getInitialState(), true);
  useSegmentationManagerStore.setState(useSegmentationManagerStore.getInitialState(), true);
  usePreferencesStore.setState(usePreferencesStore.getInitialState(), true);
  useSessionDerivedIndexStore.setState(useSessionDerivedIndexStore.getInitialState(), true);
}

function installElectronApiMock(): void {
  Object.defineProperty(window, 'electronAPI', {
    value: {
      xnat: {
        downloadScanFile: vi.fn(async () => ({ ok: false, error: 'unused' })),
        getScans: vi.fn(async () => []),
        uploadDicomSeg: vi.fn(async () => ({ ok: true, scanId: '3011', url: '/scan/3011' })),
        uploadDicomRtStruct: vi.fn(async () => ({ ok: true, scanId: '4011', url: '/scan/4011' })),
        overwriteDicomSeg: vi.fn(async () => ({ ok: true, scanId: '3011', url: '/scan/3011' })),
        overwriteDicomRtStruct: vi.fn(async () => ({ ok: true, scanId: '4011', url: '/scan/4011' })),
        listTempFiles: vi.fn(async () => ({ ok: true, files: [] })),
        deleteTempFile: vi.fn(async () => ({ ok: true })),
      },
      export: {
        saveDicomSeg: vi.fn(async () => ({ ok: true, path: '/tmp/segmentation.dcm' })),
        saveDicomRtStruct: vi.fn(async () => ({ ok: true, path: '/tmp/rtstruct.dcm' })),
      },
    },
    configurable: true,
    writable: true,
  });
}

describe('SegmentationPanel', () => {
  beforeEach(() => {
    resetStores();
    installElectronApiMock();
    vi.clearAllMocks();
    segPanelMocks.getPreferredDicomType.mockReturnValue('SEG');
    segPanelMocks.hasExportableContent.mockReturnValue(true);
    segPanelMocks.segmentationManager.userSelectedSegmentation.mockImplementation(
      (_viewportId: string, segmentationId: string, segmentIndex: number) => {
        const segStore = useSegmentationStore.getState();
        segStore.setActiveSegmentation(segmentationId);
        segStore.setActiveSegmentIndex(segmentIndex);
      },
    );
  });

  it('renders empty panel state and disables add actions without source images', () => {
    render(<SegmentationPanel sourceImageIds={[]} />);

    expect(screen.getByText('No annotations yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add segmentation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add structure' })).toBeDisabled();
    expect(screen.getByText('Select an annotation row to enable tools.')).toBeInTheDocument();
  });

  it('creates segmentation/structure annotations and stores per-row dicom types', async () => {
    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeViewportId: 'panel_0',
      panelScanMap: { panel_0: '11' },
      panelXnatContextMap: {
        panel_0: {
          projectId: 'P1',
          subjectId: 'SUB1',
          sessionId: 'SESS1',
          sessionLabel: 'Session 1',
          scanId: '11',
        },
      },
    });

    const { rerender } = render(<SegmentationPanel sourceImageIds={['wadouri:scan-1']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add segmentation' }));
    fireEvent.change(screen.getByPlaceholderText('Enter segmentation name...'), { target: { value: 'My Seg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(segPanelMocks.segmentationManager.createNewSegmentation).toHaveBeenCalledWith(
        'panel_0',
        ['wadouri:scan-1'],
        'My Seg',
      );
    });

    expect(useSegmentationStore.getState().dicomTypeBySegmentationId['seg-new']).toBe('SEG');
    expect(useSegmentationStore.getState().xnatOriginMap['seg-new']).toEqual({
      scanId: '',
      sourceScanId: '11',
      projectId: 'P1',
      sessionId: 'SESS1',
    });

    rerender(<SegmentationPanel sourceImageIds={['wadouri:scan-1']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add structure' }));
    fireEvent.change(screen.getByPlaceholderText('Enter structure name...'), { target: { value: 'My RT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(segPanelMocks.segmentationManager.createNewStructure).toHaveBeenCalledWith(
        'panel_0',
        ['wadouri:scan-1'],
        'My RT',
      );
    });
    expect(useSegmentationStore.getState().dicomTypeBySegmentationId['rt-new']).toBe('RTSTRUCT');
  });

  it('handles row interactions, style controls, and segment actions', async () => {
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      segmentations: [
        {
          segmentationId: 'seg-1',
          label: 'Lung Mask',
          isActive: true,
          segments: [
            {
              segmentIndex: 1,
              label: 'Left Lung',
              color: [255, 0, 0, 255],
              visible: true,
              locked: false,
            },
            {
              segmentIndex: 2,
              label: 'Right Lung',
              color: [0, 255, 0, 255],
              visible: true,
              locked: false,
            },
          ],
        },
      ],
      activeSegmentationId: 'seg-1',
      activeSegmentIndex: 1,
      activeSegTool: 'ThresholdBrush',
      dicomTypeBySegmentationId: { 'seg-1': 'SEG' },
      xnatOriginMap: {
        'seg-1': {
          scanId: '',
          sourceScanId: '11',
          projectId: 'P1',
          sessionId: 'SESS1',
        },
      },
    });
    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeViewportId: 'panel_0',
      panelScanMap: { panel_0: '11' },
      panelXnatContextMap: {
        panel_0: {
          projectId: 'P1',
          subjectId: 'SUB1',
          sessionId: 'SESS1',
          sessionLabel: 'Session 1',
          scanId: '11',
        },
      },
    });
    useSegmentationManagerStore.setState({
      ...useSegmentationManagerStore.getState(),
      presentation: {
        'seg-1': {
          color: { 1: [255, 0, 0, 255], 2: [0, 255, 0, 255] },
          visibility: { 1: true, 2: true },
          locked: { 1: false, 2: false },
        },
      },
    });

    const { container } = render(<SegmentationPanel sourceImageIds={['wadouri:scan-1']} />);

    fireEvent.click(screen.getByText('Lung Mask'));
    expect(segPanelMocks.segmentationManager.userSelectedSegmentation).toHaveBeenCalledWith('panel_0', 'seg-1', 1);

    fireEvent.click(screen.getAllByTitle('Hide segment')[0]);
    fireEvent.click(screen.getAllByTitle('Lock segment')[0]);
    fireEvent.click(screen.getAllByTitle('Delete segment')[0]);
    expect(segPanelMocks.segmentationManager.userToggledVisibility).toHaveBeenCalled();
    expect(segPanelMocks.segmentationManager.userToggledLock).toHaveBeenCalled();
    expect(segPanelMocks.segmentationManager.removeSegment).toHaveBeenCalledWith('seg-1', 1);

    fireEvent.click(screen.getAllByTitle('Change color')[0]);
    fireEvent.click(screen.getAllByTitle('Color 1')[0]);
    expect(segPanelMocks.segmentationManager.userChangedSegmentColor).toHaveBeenCalledWith(
      'seg-1',
      1,
      expect.any(Array),
    );

    const brushSlider = container.querySelector('input[type="range"][max="50"]') as HTMLInputElement;
    fireEvent.change(brushSlider, { target: { value: '12' } });
    expect(segPanelMocks.setBrushSize).toHaveBeenCalledWith(12);

    const opacitySlider = container.querySelector('input[type="range"][max="1"]') as HTMLInputElement;
    fireEvent.change(opacitySlider, { target: { value: '0.7' } });
    expect(segPanelMocks.updateStyle).toHaveBeenCalled();
    expect(screen.queryByLabelText('Show Outline')).not.toBeInTheDocument();

  });

  it('saves locally and uploads to XNAT from the row save menu', async () => {
    useConnectionStore.setState({
      ...useConnectionStore.getState(),
      status: 'connected',
      connection: { serverUrl: 'https://xnat.example', username: 'dan', connectedAt: 1 },
    });
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      segmentations: [
        {
          segmentationId: 'seg-1',
          label: 'Upload Test',
          isActive: true,
          segments: [
            {
              segmentIndex: 1,
              label: 'Segment 1',
              color: [100, 100, 255, 255],
              visible: true,
              locked: false,
            },
          ],
        },
      ],
      activeSegmentationId: 'seg-1',
      dicomTypeBySegmentationId: { 'seg-1': 'SEG' },
      xnatOriginMap: {
        'seg-1': {
          scanId: '',
          sourceScanId: '11',
          projectId: 'P1',
          sessionId: 'SESS1',
        },
      },
    });
    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeViewportId: 'panel_0',
      panelScanMap: { panel_0: '11' },
      panelXnatContextMap: {
        panel_0: {
          projectId: 'P1',
          subjectId: 'SUB1',
          sessionId: 'SESS1',
          sessionLabel: 'Session 1',
          scanId: '11',
        },
      },
    });

    render(<SegmentationPanel sourceImageIds={['wadouri:scan-1']} />);

    fireEvent.click(screen.getByText('Upload Test'));
    fireEvent.click(screen.getByTitle('Save segmentation'));
    fireEvent.click(screen.getByText('Save file'));

    await waitFor(() => {
      expect(segPanelMocks.segmentationManager.exportToDicomSeg).toHaveBeenCalledWith('seg-1');
      expect(window.electronAPI.export.saveDicomSeg).toHaveBeenCalledWith('SEG_BASE64', 'segmentation.dcm');
    });

    fireEvent.click(screen.getByTitle('Save segmentation'));
    fireEvent.click(screen.getByText('Upload to XNAT'));

    await waitFor(() => {
      expect(segPanelMocks.segmentationManager.beginManualSave).toHaveBeenCalled();
      expect(window.electronAPI.xnat.uploadDicomSeg).toHaveBeenCalledWith(
        'P1',
        'SUB1',
        'SESS1',
        'Session 1',
        '11',
        'SEG_BASE64',
        'Upload Test',
      );
      expect(segPanelMocks.segmentationManager.endManualSave).toHaveBeenCalled();
    });

    expect(await screen.findByText(/Uploaded SEG as scan 3011/)).toBeInTheDocument();
  });
});
