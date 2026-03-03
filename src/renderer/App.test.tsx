import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useConnectionStore } from './stores/connectionStore';
import { useViewerStore } from './stores/viewerStore';
import { useSegmentationStore } from './stores/segmentationStore';
import { usePreferencesStore } from './stores/preferencesStore';
import { useSessionDerivedIndexStore } from './stores/sessionDerivedIndexStore';
import { useSegmentationManagerStore } from './stores/segmentationManagerStore';

const mocks = vi.hoisted(() => ({
  initCornerstone: vi.fn(),
  applyPreferences: vi.fn(),
  loadPinnedItems: vi.fn(() => []),
  addPinnedItem: vi.fn(),
  removePinnedItem: vi.fn(),
  isPinned: vi.fn(() => false),
  loadRecentSessions: vi.fn(() => []),
  saveRecentSession: vi.fn(),
  removeRecentSession: vi.fn(),
  migrateOldStorage: vi.fn(),
  showConfirmDialog: vi.fn(async () => true),
  dicomwebLoader: {
    getScanImageIds: vi.fn(async () => []),
    clearScanImageIdsCache: vi.fn(),
  },
  segmentationManager: {
    initialize: vi.fn(),
    dispose: vi.fn(),
    removeSegmentation: vi.fn(),
    removeSegmentationsFromViewport: vi.fn(),
    hasDirtySegmentations: vi.fn(() => false),
    segmentationExists: vi.fn(() => false),
    onPanelImagesChanged: vi.fn(),
    requestShowOverlaysForSourceScan: vi.fn(async () => undefined),
    loadSegFromArrayBuffer: vi.fn(),
    loadRtStructFromArrayBuffer: vi.fn(),
  },
  viewportReadyService: {
    bumpEpoch: vi.fn(() => 1),
    whenReady: vi.fn(async () => undefined),
    getEpoch: vi.fn(() => 0),
  },
}));

vi.mock('./pages/ViewerPage', () => ({
  default: ({ leftSlot, browserSlot }: { leftSlot: ReactNode; browserSlot: ReactNode }) => (
    <div data-testid="viewer-page">
      <div data-testid="left-slot">{leftSlot}</div>
      <div data-testid="panel-drop-target" data-panel-id="panel_1">panel target</div>
      <div data-testid="browser-slot">{browserSlot}</div>
    </div>
  ),
}));

vi.mock('./components/viewer/ExportDropdown', () => ({
  default: () => <div data-testid="export-dropdown" />,
}));

vi.mock('./components/connection/LoginForm', () => ({
  default: () => <div data-testid="login-form" />,
}));

vi.mock('./components/connection/ConnectionStatus', () => ({
  default: () => <div data-testid="connection-status" />,
}));

vi.mock('./components/connection/XnatBrowser', () => ({
  default: ({
    onLoadScan,
    onLoadSession,
    onNavigateComplete,
  }: {
    onLoadScan: (...args: any[]) => void;
    onLoadSession: (...args: any[]) => void;
    onNavigateComplete?: () => void;
  }) => (
    <div data-testid="xnat-browser">
      <button
        onClick={() =>
          onLoadScan(
            'S1',
            '11',
            { id: '11', modality: 'CT', seriesDescription: 'Axial' },
            { projectId: 'P1', subjectId: 'SUB1', sessionLabel: 'Session 1', projectName: 'Proj 1', subjectLabel: 'Subj 1' },
          )}
      >
        Trigger Load Scan
      </button>
      <button
        onClick={() =>
          onLoadSession(
            'S1',
            [{ id: '11', modality: 'CT', seriesDescription: 'Axial' }],
            { projectId: 'P1', subjectId: 'SUB1', sessionLabel: 'Session 1', projectName: 'Proj 1', subjectLabel: 'Subj 1' },
          )}
      >
        Trigger Load Session
      </button>
      <button onClick={onNavigateComplete}>Complete Navigation</button>
    </div>
  ),
}));

vi.mock('./components/dialog/AppDialogHost', () => ({
  default: () => <div data-testid="app-dialog-host" />,
}));

vi.mock('./lib/cornerstone/init', () => ({
  initCornerstone: mocks.initCornerstone,
}));

vi.mock('./lib/preferences/applyPreferences', () => ({
  applyPreferences: mocks.applyPreferences,
}));

vi.mock('./lib/pinnedItems', () => ({
  loadPinnedItems: mocks.loadPinnedItems,
  addPinnedItem: mocks.addPinnedItem,
  removePinnedItem: mocks.removePinnedItem,
  isPinned: mocks.isPinned,
  loadRecentSessions: mocks.loadRecentSessions,
  saveRecentSession: mocks.saveRecentSession,
  removeRecentSession: mocks.removeRecentSession,
  migrateOldStorage: mocks.migrateOldStorage,
}));

vi.mock('./lib/segmentation/segmentationManagerSingleton', () => ({
  segmentationManager: mocks.segmentationManager,
}));

vi.mock('./lib/cornerstone/dicomwebLoader', () => ({
  dicomwebLoader: mocks.dicomwebLoader,
}));

vi.mock('./lib/cornerstone/viewportReadyService', () => ({
  viewportReadyService: mocks.viewportReadyService,
}));

vi.mock('./lib/cornerstone/volumeService', () => ({
  volumeService: {
    generateId: vi.fn(() => 'vol-1'),
    create: vi.fn(async () => undefined),
    load: vi.fn(async () => undefined),
  },
}));

vi.mock('./lib/cornerstone/rtStructService', () => ({
  rtStructService: {
    parseRtStruct: vi.fn(() => ({ rois: [] })),
  },
}));

vi.mock('./lib/cornerstone/viewportService', () => ({
  viewportService: {
    getViewport: vi.fn(() => null),
  },
}));

vi.mock('./lib/hangingProtocolService', () => ({
  matchProtocol: vi.fn(() => ({
    protocol: { id: 'p1', name: 'Default', layout: '1x1' },
    assignments: new Map<string, any>(),
    unmatched: [],
  })),
  applyProtocol: vi.fn(() => ({ panelImageIds: {} })),
}));

vi.mock('./stores/dialogStore', () => ({
  showConfirmDialog: mocks.showConfirmDialog,
}));

vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    fileManager: {
      add: vi.fn((file: File) => `file://${file.name}`),
    },
    dataSetCacheManager: {
      isLoaded: vi.fn(() => true),
      load: vi.fn(async () => undefined),
      get: vi.fn(() => ({ string: vi.fn(() => null) })),
    },
  },
}));

vi.mock('@cornerstonejs/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cornerstonejs/core')>();
  return {
    ...actual,
    imageLoader: {
      ...actual.imageLoader,
      loadAndCacheImage: vi.fn(async () => undefined),
    },
    cache: {
      ...actual.cache,
      getImageLoadObject: vi.fn(() => null),
    },
    metaData: {
      ...actual.metaData,
      get: vi.fn(() => undefined),
    },
  };
});

vi.mock('dicom-parser', () => ({
  parseDicom: vi.fn(() => ({
    string: vi.fn((tag: string) => {
      if (tag === 'x00080016') return '1.2.840.10008.5.1.4.1.1.2';
      return '';
    }),
  })),
}));

function resetStores(): void {
  useConnectionStore.setState(useConnectionStore.getInitialState(), true);
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
  usePreferencesStore.setState(usePreferencesStore.getInitialState(), true);
  useSessionDerivedIndexStore.setState(useSessionDerivedIndexStore.getInitialState(), true);
  useSegmentationManagerStore.setState(useSegmentationManagerStore.getInitialState(), true);
}

function setConnectedConnectionState(): void {
  useConnectionStore.setState({
    ...useConnectionStore.getState(),
    status: 'connected',
    connection: {
      serverUrl: 'https://xnat.example',
      username: 'dan',
      connectedAt: 1700000000000,
    },
  });
}

function setElectronApiMock(): void {
  Object.defineProperty(window, 'electronAPI', {
    value: {
      xnat: {
        listTempFiles: vi.fn(async () => ({ ok: true, files: [] })),
        downloadTempFile: vi.fn(async () => ({ ok: false, error: 'not used' })),
        deleteTempFile: vi.fn(async () => ({ ok: true })),
        downloadScanFile: vi.fn(async () => ({ ok: true, data: '' })),
        getScans: vi.fn(async () => []),
      },
      on: vi.fn(() => () => {}),
    },
    configurable: true,
    writable: true,
  });
}

describe('App', () => {
  beforeEach(() => {
    resetStores();
    setElectronApiMock();
    vi.clearAllMocks();
    mocks.initCornerstone.mockResolvedValue(undefined);
    mocks.loadPinnedItems.mockReturnValue([]);
    mocks.loadRecentSessions.mockReturnValue([]);
    mocks.segmentationManager.hasDirtySegmentations.mockReturnValue(false);
    mocks.showConfirmDialog.mockResolvedValue(true);
  });

  it('shows initialization state while cornerstone startup is pending', () => {
    mocks.initCornerstone.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByText('Initializing Cornerstone3D...')).toBeInTheDocument();
  });

  it('shows initialization error UI when cornerstone startup fails', async () => {
    mocks.initCornerstone.mockRejectedValue(new Error('init exploded'));
    render(<App />);
    expect(await screen.findByText('Cornerstone3D Initialization Failed')).toBeInTheDocument();
    expect(screen.getByText('init exploded')).toBeInTheDocument();
  });

  it('renders login view when disconnected after initialization', async () => {
    render(<App />);
    expect(await screen.findByTestId('login-form')).toBeInTheDocument();
    expect(mocks.migrateOldStorage).toHaveBeenCalledTimes(1);
    expect(mocks.applyPreferences).toHaveBeenCalled();
  });

  it('renders connected viewer shell and bookmark item variants', async () => {
    const user = userEvent.setup();
    mocks.loadPinnedItems.mockReturnValue([
      { type: 'project', serverUrl: 'https://xnat.example', projectId: 'P1', projectName: 'Project Alpha', timestamp: 1 },
      {
        type: 'subject',
        serverUrl: 'https://xnat.example',
        projectId: 'P1',
        projectName: 'Project Alpha',
        subjectId: 'SUBJ1',
        subjectLabel: 'Subject 1',
        timestamp: 2,
      },
      {
        type: 'session',
        serverUrl: 'https://xnat.example',
        projectId: 'P1',
        projectName: 'Project Alpha',
        subjectId: 'SUBJ1',
        subjectLabel: 'Subject 1',
        sessionId: 'SESS1',
        sessionLabel: 'Session 1',
        timestamp: 3,
      },
    ]);
    mocks.loadRecentSessions.mockReturnValue([
      {
        serverUrl: 'https://xnat.example',
        projectId: 'P1',
        projectName: 'Project Alpha',
        subjectId: 'SUBJ1',
        subjectLabel: 'Subject 1',
        sessionId: 'SESS2',
        sessionLabel: 'Session 2',
        timestamp: 4,
      },
    ]);
    setConnectedConnectionState();

    render(<App />);
    expect(await screen.findByTestId('viewer-page')).toBeInTheDocument();
    expect(screen.getByText('Connected to XNAT')).toBeInTheDocument();

    await user.click(screen.getByTitle('Pinned & Recent'));
    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getAllByText('Project Alpha').length).toBeGreaterThan(0);
    expect(screen.getByText('Session 2')).toBeInTheDocument();

    mocks.isPinned.mockReturnValue(true);
    await user.click(screen.getAllByTitle('Unpin')[0]);
    expect(mocks.removePinnedItem).toHaveBeenCalled();

    await user.click(screen.getByTitle('Pin this session'));
    expect(mocks.addPinnedItem).toHaveBeenCalledTimes(1);
  });

  it('shows drag overlay for file drags, but not for xnat scan drags', async () => {
    setConnectedConnectionState();
    render(<App />);
    await screen.findByTestId('viewer-page');

    fireEvent.dragOver(screen.getByTestId('viewer-page'), {
      dataTransfer: { types: ['Files'] },
    });
    expect(screen.getByText('Drop DICOM files here')).toBeInTheDocument();

    fireEvent.dragLeave(screen.getByTestId('viewer-page'), {
      dataTransfer: { types: ['Files'] },
    });
    expect(screen.queryByText('Drop DICOM files here')).not.toBeInTheDocument();

    fireEvent.dragOver(screen.getByTestId('viewer-page'), {
      dataTransfer: { types: ['application/x-xnat-scan'] },
    });
    expect(screen.queryByText('Drop DICOM files here')).not.toBeInTheDocument();
  });

  it('handles XNAT scan drop and activates target panel', async () => {
    setConnectedConnectionState();
    render(<App />);
    await screen.findByTestId('viewer-page');

    const payload = JSON.stringify({
      sessionId: 'S1',
      scanId: '11',
      scan: { id: '11', modality: 'CT', seriesDescription: 'Axial' },
      context: { projectId: 'P1', subjectId: 'SUB1', sessionLabel: 'Session 1' },
    });

    fireEvent.drop(screen.getByTestId('panel-drop-target'), {
      dataTransfer: {
        getData: (type: string) => (type === 'application/x-xnat-scan' ? payload : ''),
        files: [],
      },
    });

    await waitFor(() => {
      expect(mocks.dicomwebLoader.getScanImageIds).toHaveBeenCalledWith(
        'S1',
        '11',
        expect.any(Object),
      );
    });
    expect(useViewerStore.getState().activeViewportId).toBe('panel_1');
  });

  it('supports browser collapse and reopen via resize handle', async () => {
    setConnectedConnectionState();
    render(<App />);
    await screen.findByTestId('viewer-page');

    fireEvent.mouseDown(screen.getByTestId('browser-resize-handle'), { clientX: 220 });
    fireEvent.mouseMove(document, { clientX: 0 });
    fireEvent.mouseUp(document);

    expect(screen.getByTestId('browser-collapsed-strip')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('browser-collapsed-strip'));
    expect(screen.queryByTestId('browser-collapsed-strip')).not.toBeInTheDocument();
    expect(screen.getByTestId('xnat-browser')).toBeInTheDocument();
  });

  it('prompts unsaved annotation dialog and honors cancel/continue decisions', async () => {
    const user = userEvent.setup();
    setConnectedConnectionState();
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      hasUnsavedChanges: true,
    });

    render(<App />);
    await screen.findByTestId('viewer-page');

    await user.click(screen.getByRole('button', { name: 'Trigger Load Scan' }));
    expect(await screen.findByText('Unsaved annotations')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Return to session.' }));
    expect(screen.queryByText('Unsaved annotations')).not.toBeInTheDocument();
    expect(mocks.dicomwebLoader.getScanImageIds).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Trigger Load Scan' }));
    expect(await screen.findByText('Unsaved annotations')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Continue without saving/ }));
    await waitFor(() => expect(mocks.dicomwebLoader.getScanImageIds).toHaveBeenCalled());
  });

  it('shows loading and error browser status tones during scan load', async () => {
    const user = userEvent.setup();
    setConnectedConnectionState();

    let resolveScanIds: ((ids: string[]) => void) | null = null;
    mocks.dicomwebLoader.getScanImageIds.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveScanIds = resolve;
        }),
    );

    render(<App />);
    await screen.findByTestId('viewer-page');

    await user.click(screen.getByRole('button', { name: 'Trigger Load Scan' }));
    expect(
      await screen.findByText((text) => text === 'Loading scan #11...' || text === 'Loading image stack...'),
    ).toBeInTheDocument();
    resolveScanIds?.([]);
    await waitFor(() => expect(screen.getByText('Scan loaded')).toBeInTheDocument());

    mocks.dicomwebLoader.getScanImageIds.mockRejectedValueOnce(new Error('scan failure'));
    await user.click(screen.getByRole('button', { name: 'Trigger Load Scan' }));
    expect(await screen.findByText('Load failed')).toBeInTheDocument();
    expect(screen.getByText('scan failure')).toBeInTheDocument();
  });

  it('sets info browser status for non-dicom local file drops', async () => {
    setConnectedConnectionState();
    render(<App />);
    await screen.findByTestId('viewer-page');

    fireEvent.drop(screen.getByTestId('viewer-page'), {
      dataTransfer: {
        getData: () => '',
        files: [new File(['abc'], 'notes.txt', { type: 'text/plain' })],
      },
    });

    expect(await screen.findByText('No DICOM files found')).toBeInTheDocument();
  });

  it('cleans viewer/session state on disconnect transition', async () => {
    setConnectedConnectionState();
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      segmentations: [{ segmentationId: 'seg-1' }, { segmentationId: 'seg-2' }] as any,
      hasUnsavedChanges: true,
    });
    useViewerStore.setState({
      ...useViewerStore.getState(),
      sessionId: 'S1',
      sessionScans: [{ id: '11' } as any],
      panelScanMap: { panel_0: '11' },
      panelSessionLabelMap: { panel_0: 'Session 1' },
      panelSubjectLabelMap: { panel_0: 'Subject 1' },
      panelXnatContextMap: {
        panel_0: { projectId: 'P1', subjectId: 'SUB1', sessionId: 'S1', sessionLabel: 'Session 1', scanId: '11' },
      },
      currentProtocol: { id: 'p1', name: 'Protocol', layout: '1x1' } as any,
    });
    useSessionDerivedIndexStore.setState({
      ...useSessionDerivedIndexStore.getState(),
      derivedIndex: { '11': { segScans: [{ id: '12' } as any], rtStructScans: [] } },
    });
    useSegmentationManagerStore.setState({
      ...useSegmentationManagerStore.getState(),
      loadedBySourceScan: { 'P1/S1/11': { '12': { segmentationId: 'seg-1' } as any } },
    });

    render(<App />);
    await screen.findByTestId('viewer-page');

    act(() => {
      useConnectionStore.setState({
        ...useConnectionStore.getState(),
        status: 'disconnected',
        connection: null,
      });
    });

    expect(await screen.findByTestId('login-form')).toBeInTheDocument();
    expect(mocks.segmentationManager.removeSegmentation).toHaveBeenCalledWith('seg-1');
    expect(mocks.segmentationManager.removeSegmentation).toHaveBeenCalledWith('seg-2');
    expect(mocks.dicomwebLoader.clearScanImageIdsCache).toHaveBeenCalled();
    expect(useViewerStore.getState().sessionId).toBeNull();
    expect(useViewerStore.getState().panelScanMap).toEqual({});
    expect(useSessionDerivedIndexStore.getState().derivedIndex).toEqual({});
    expect(useSegmentationManagerStore.getState().loadedBySourceScan).toEqual({});
  });

  it('registers beforeunload guard when unsaved segmentation changes exist', async () => {
    setConnectedConnectionState();
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      hasUnsavedChanges: true,
    });

    render(<App />);
    await screen.findByTestId('viewer-page');

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    Object.defineProperty(event, 'returnValue', { writable: true, value: '' });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(typeof event.returnValue).toBe('string');
    });
  });
});
