import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AddAnnotationButtons from './AddAnnotationButtons';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useViewerStore } from '../../stores/viewerStore';

const mocks = vi.hoisted(() => ({
  segmentationManager: {
    createNewStructure: vi.fn(async () => 'rt-new'),
    createNewSegmentation: vi.fn(async () => 'seg-new'),
  },
}));

vi.mock('../../lib/segmentation/segmentationManagerSingleton', () => ({
  segmentationManager: mocks.segmentationManager,
}));

function resetStores(): void {
  useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  vi.clearAllMocks();
}

describe('AddAnnotationButtons', () => {
  beforeEach(() => {
    resetStores();
  });

  it('disables both buttons when the active panel has no source images', () => {
    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeViewportId: 'panel_0',
      panelImageIdsMap: { panel_0: [] },
    });

    render(<AddAnnotationButtons />);
    expect(screen.getByRole('button', { name: 'Add segmentation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add structure' })).toBeDisabled();
  });

  it('creates a SEG via the naming dialog with createDefaultSegment=true and records the XNAT origin', async () => {
    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeViewportId: 'panel_0',
      panelImageIdsMap: { panel_0: ['wadouri:scan-1'] },
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

    render(<AddAnnotationButtons />);
    fireEvent.click(screen.getByRole('button', { name: 'Add segmentation' }));
    fireEvent.change(screen.getByPlaceholderText('Enter segmentation name...'), { target: { value: 'My Seg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      // createDefaultSegment=true is the load-bearing fourth arg —
      // without it, the multi-layer-group SEG has zero sub-segments and
      // brush / paint-fill / scissors fire SEGMENTATION_DATA_MODIFIED
      // events but write no labelmap pixels (G7 / Phase 2.7 surface).
      expect(mocks.segmentationManager.createNewSegmentation).toHaveBeenCalledWith(
        'panel_0',
        ['wadouri:scan-1'],
        'My Seg',
        true,
      );
    });

    expect(useSegmentationStore.getState().dicomTypeBySegmentationId['seg-new']).toBe('SEG');
    expect(useSegmentationStore.getState().xnatOriginMap['seg-new']).toEqual({
      scanId: '',
      sourceScanId: '11',
      projectId: 'P1',
      sessionId: 'SESS1',
    });
  });

  it('creates an RTSTRUCT via the naming dialog without the createDefaultSegment flag', async () => {
    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeViewportId: 'panel_0',
      panelImageIdsMap: { panel_0: ['wadouri:scan-1'] },
    });

    render(<AddAnnotationButtons />);
    fireEvent.click(screen.getByRole('button', { name: 'Add structure' }));
    fireEvent.change(screen.getByPlaceholderText('Enter structure name...'), { target: { value: 'My RT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mocks.segmentationManager.createNewStructure).toHaveBeenCalledWith(
        'panel_0',
        ['wadouri:scan-1'],
        'My RT',
      );
    });
    expect(useSegmentationStore.getState().dicomTypeBySegmentationId['rt-new']).toBe('RTSTRUCT');
  });
});
