import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App, {
  checkForAutoSaveRecovery,
  preloadImages,
  jumpViewportToReferencedImage,
  downloadSegArrayBuffer,
} from './App';
import { useConnectionStore } from './stores/connectionStore';
import { useViewerStore } from './stores/viewerStore';
import { useSegmentationStore } from './stores/segmentationStore';
import { usePreferencesStore } from './stores/preferencesStore';
import { useSessionDerivedIndexStore } from './stores/sessionDerivedIndexStore';
import { useSegmentationManagerStore } from './stores/segmentationManagerStore';
import { clearRecoveredSessions } from './lib/app/appHelpers';
import { cache, imageLoader, metaData } from '@cornerstonejs/core';
import { BUILT_IN_PROTOCOLS } from '@shared/types/hangingProtocol';
import type { UpdateStatus } from '@shared/types';

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
    orderImageIdsByDicomMetadata: vi.fn(async (ids: string[]) => ids),
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
    userSelectedSegmentation: vi.fn(),
  },
  viewportReadyService: {
    bumpEpoch: vi.fn(() => 1),
    whenReady: vi.fn(async () => undefined),
    getEpoch: vi.fn(() => 0),
    markReady: vi.fn(),
  },
  volumeService: {
    generateId: vi.fn(() => 'vol-1'),
    create: vi.fn(async () => undefined),
    load: vi.fn(async () => undefined),
  },
  rtStructService: {
    parseRtStruct: vi.fn(() => ({ rois: [] })),
  },
  viewportService: {
    getViewport: vi.fn(() => null),
  },
  hangingProtocol: {
    matchProtocol: vi.fn(() => ({
      protocol: { id: 'p1', name: 'Default', layout: '1x1' },
      assignments: new Map<number, any>(),
      unmatched: [],
    })),
    applyProtocol: vi.fn(() => ({ assignments: new Map<number, any>(), unmatched: [] })),
  },
  getSegReferenceInfo: vi.fn(() => ({
    referencedSeriesUID: null,
    referencedSOPInstanceUIDs: [],
  })),
  updater: {
    getState: vi.fn(),
    configure: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    onStatus: vi.fn(),
  },
  updaterStatusCallback: null as ((status: UpdateStatus) => void) | null,
}));

vi.mock('./pages/ViewerPage', () => ({
  default: ({
    leftSlot,
    browserSlot,
    onApplyProtocol,
    onToggleMPR,
    settingsInitialTabRequest,
  }: {
    leftSlot: ReactNode;
    browserSlot: ReactNode;
    onApplyProtocol?: (protocolId: string) => void;
    onToggleMPR?: () => void;
    settingsInitialTabRequest?: string;
  }) => (
    <div data-testid="viewer-page">
      <div data-testid="left-slot">{leftSlot}</div>
      <div data-testid="settings-tab-request">{settingsInitialTabRequest ?? ''}</div>
      <div data-testid="panel-drop-target" data-panel-id="panel_1">panel target</div>
      <button onClick={() => onApplyProtocol?.(BUILT_IN_PROTOCOLS[0]?.id ?? 'default')}>Trigger Apply Protocol</button>
      <button onClick={() => onToggleMPR?.()}>Trigger Toggle MPR</button>
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
          onLoadScan(
            'S1',
            '3001',
            { id: '3001', type: 'SEG', seriesDescription: 'Liver SEG' },
            { projectId: 'P1', subjectId: 'SUB1', sessionLabel: 'Session 1', projectName: 'Proj 1', subjectLabel: 'Subj 1' },
          )}
      >
        Trigger Load SEG
      </button>
      <button
        onClick={() =>
          onLoadScan(
            'S1',
            '4001',
            { id: '4001', type: 'RTSTRUCT', seriesDescription: 'Liver RT' },
            { projectId: 'P1', subjectId: 'SUB1', sessionLabel: 'Session 1', projectName: 'Proj 1', subjectLabel: 'Subj 1' },
          )}
      >
        Trigger Load RTSTRUCT
      </button>
      <button
        onClick={() =>
          onLoadScan(
            'S1',
            '11',
            { id: '11', modality: 'CT', seriesDescription: 'Axial' },
            { projectId: 'P1', subjectId: 'SUB1', sessionLabel: 'Session 1', projectName: 'Proj 1', subjectLabel: 'Subj 1' },
            { openInMpr: true },
          )}
      >
        Trigger Load Scan MPR
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
      <button
        onClick={() =>
          onLoadSession(
            'S1',
            [
              { id: '11', modality: 'CT', seriesDescription: 'Axial' },
              { id: '3001', type: 'SEG', seriesDescription: 'Liver SEG' },
              { id: '4001', type: 'RTSTRUCT', seriesDescription: 'Liver RT' },
            ],
            { projectId: 'P1', subjectId: 'SUB1', sessionLabel: 'Session 1', projectName: 'Proj 1', subjectLabel: 'Subj 1' },
          )}
      >
        Trigger Load Session With Derived
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
  volumeService: mocks.volumeService,
}));

vi.mock('./lib/cornerstone/rtStructService', () => ({
  rtStructService: mocks.rtStructService,
}));

vi.mock('./lib/cornerstone/viewportService', () => ({
  viewportService: mocks.viewportService,
}));

vi.mock('./lib/hangingProtocolService', () => ({
  matchProtocol: mocks.hangingProtocol.matchProtocol,
  applyProtocol: mocks.hangingProtocol.applyProtocol,
}));

vi.mock('./lib/dicom/segReferencedSeriesUid', () => ({
  getSegReferenceInfo: mocks.getSegReferenceInfo,
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
  mocks.updaterStatusCallback = null;
  mocks.updater.getState.mockResolvedValue({
    phase: 'idle',
    currentVersion: '0.5.4',
    enabled: true,
    autoDownload: true,
    isPackaged: true,
    availableVersion: null,
    downloadedVersion: null,
    downloadProgressPercent: null,
    lastCheckedAt: null,
    message: 'Automatic update checks are enabled.',
    error: null,
  } satisfies UpdateStatus);
  mocks.updater.configure.mockResolvedValue({ ok: true });
  mocks.updater.checkForUpdates.mockResolvedValue({ ok: true });
  mocks.updater.quitAndInstall.mockResolvedValue({ ok: true });
  mocks.updater.onStatus.mockImplementation((callback: (status: UpdateStatus) => void) => {
    mocks.updaterStatusCallback = callback;
    return () => {
      if (mocks.updaterStatusCallback === callback) {
        mocks.updaterStatusCallback = null;
      }
    };
  });

  Object.defineProperty(window, 'electronAPI', {
    value: {
      xnat: {
        listTempFiles: vi.fn(async () => ({ ok: true, files: [] })),
        downloadTempFile: vi.fn(async () => ({ ok: false, error: 'not used' })),
        deleteTempFile: vi.fn(async () => ({ ok: true })),
        downloadScanFile: vi.fn(async () => ({ ok: true, data: '' })),
        getScans: vi.fn(async () => []),
      },
      updater: mocks.updater,
      on: vi.fn(() => () => {}),
    },
    configurable: true,
    writable: true,
  });
}

function createDicomFile(contents: string, name: string): File {
  const file = new File([contents], name, { type: 'application/dicom' });
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: async () => new TextEncoder().encode(contents).buffer,
  });
  return file;
}

function emitUpdaterStatus(status: UpdateStatus): void {
  act(() => {
    mocks.updaterStatusCallback?.(status);
  });
}

describe('App', () => {
  beforeEach(async () => {
    resetStores();
    clearRecoveredSessions();
    setElectronApiMock();
    vi.clearAllMocks();
    const parseDicom = (await import('dicom-parser')).parseDicom as any;
    parseDicom.mockReset();
    parseDicom.mockImplementation(() => ({
      string: (tag: string) => {
        if (tag === 'x00080016') return '1.2.840.10008.5.1.4.1.1.2';
        return '';
      },
    }));
    mocks.initCornerstone.mockResolvedValue(undefined);
    mocks.loadPinnedItems.mockReturnValue([]);
    mocks.loadRecentSessions.mockReturnValue([]);
    mocks.segmentationManager.hasDirtySegmentations.mockReturnValue(false);
    mocks.segmentationManager.segmentationExists.mockReturnValue(false);
    mocks.segmentationManager.loadSegFromArrayBuffer.mockResolvedValue({
      segmentationId: 'seg-loaded',
      firstNonZeroReferencedImageId: null,
    });
    mocks.segmentationManager.loadRtStructFromArrayBuffer.mockResolvedValue({
      segmentationId: 'rt-loaded',
      firstReferencedImageId: null,
    });
    mocks.showConfirmDialog.mockResolvedValue(true);
    mocks.getSegReferenceInfo.mockReturnValue({
      referencedSeriesUID: null,
      referencedSOPInstanceUIDs: [],
    });
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

  it('shows an update banner and routes to the Updates settings tab when an update is downloading', async () => {
    const user = userEvent.setup();
    setConnectedConnectionState();

    render(<App />);
    expect(await screen.findByTestId('viewer-page')).toBeInTheDocument();

    emitUpdaterStatus({
      phase: 'downloading',
      currentVersion: '0.5.4',
      enabled: true,
      autoDownload: true,
      isPackaged: true,
      availableVersion: '0.5.5',
      downloadedVersion: null,
      downloadProgressPercent: 42,
      lastCheckedAt: new Date().toISOString(),
      message: 'Downloading update... 42%',
      error: null,
    });

    expect(
      screen.getByText('Update 0.5.5 is downloading in the background (42%).'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review in Settings' }));

    expect(screen.getByTestId('settings-tab-request')).toHaveTextContent('updates');
  });

  it('shows a restart-and-install banner action when an update is downloaded', async () => {
    const user = userEvent.setup();
    setConnectedConnectionState();

    render(<App />);
    expect(await screen.findByTestId('viewer-page')).toBeInTheDocument();

    emitUpdaterStatus({
      phase: 'downloaded',
      currentVersion: '0.5.4',
      enabled: true,
      autoDownload: true,
      isPackaged: true,
      availableVersion: '0.5.5',
      downloadedVersion: '0.5.5',
      downloadProgressPercent: 100,
      lastCheckedAt: new Date().toISOString(),
      message: 'Update downloaded.',
      error: null,
    });

    expect(screen.getByText(/Update 0\.5\.5 is ready to install\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restart and Install' }));

    expect(mocks.updater.quitAndInstall).toHaveBeenCalledTimes(1);
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
      segmentations: [{ segmentationId: 'seg-unsaved' } as any],
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
      segmentations: [{ segmentationId: 'seg-beforeunload' } as any],
      hasUnsavedChanges: true,
    });
    mocks.segmentationManager.hasDirtySegmentations.mockReturnValue(true);

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

  it('preloadImages skips cached IDs and tolerates load failures', async () => {
    (cache.getImageLoadObject as any).mockImplementation((id: string) => (
      id === 'cached://1' ? ({ imageId: id }) : null
    ));
    (imageLoader.loadAndCacheImage as any).mockImplementation((id: string) => {
      if (id === 'throws://1') throw new Error('sync fail');
      if (id === 'reject://1') return Promise.reject(new Error('async fail'));
      return Promise.resolve({ imageId: id });
    });

    await expect(preloadImages(['cached://1', 'ok://1', 'reject://1', 'throws://1'])).resolves.toBeUndefined();
    expect(imageLoader.loadAndCacheImage).toHaveBeenCalledTimes(3);
  });

  it('jumpViewportToReferencedImage supports setImageIdIndex and scroll fallback', async () => {
    const vpWithSetter = {
      getImageIds: vi.fn(() => ['img-0', 'img-1']),
      setImageIdIndex: vi.fn(),
      getCurrentImageIdIndex: vi.fn(() => 0),
      scroll: vi.fn(),
      render: vi.fn(),
    };
    mocks.viewportService.getViewport.mockReturnValueOnce(vpWithSetter as any);
    await jumpViewportToReferencedImage('panel_0', 'img-1');
    expect(vpWithSetter.setImageIdIndex).toHaveBeenCalledWith(1);
    expect(vpWithSetter.render).toHaveBeenCalled();

    const vpWithScroll = {
      getImageIds: vi.fn(() => ['img-0', 'img-1', 'img-2']),
      getCurrentImageIdIndex: vi.fn(() => 2),
      scroll: vi.fn(),
      render: vi.fn(),
    };
    mocks.viewportService.getViewport.mockReturnValueOnce(vpWithScroll as any);
    await jumpViewportToReferencedImage('panel_0', 'img-0');
    expect(vpWithScroll.scroll).toHaveBeenCalledWith(-2);
    expect(vpWithScroll.render).toHaveBeenCalled();
  });

  it('downloadSegArrayBuffer decodes base64 and throws on failed download', async () => {
    (window.electronAPI.xnat.downloadScanFile as any).mockResolvedValueOnce({
      ok: true,
      data: btoa('ABC'),
    });
    const buffer = await downloadSegArrayBuffer('S1', '11');
    expect(Array.from(new Uint8Array(buffer))).toEqual([65, 66, 67]);

    (window.electronAPI.xnat.downloadScanFile as any).mockResolvedValueOnce({
      ok: false,
      error: 'scan missing',
    });
    await expect(downloadSegArrayBuffer('S1', '12')).rejects.toThrow('scan missing');
  });

  it('checkForAutoSaveRecovery recovers SEG autosave files and removes temp resources', async () => {
    const panelMap = new Map<string, { pid: string; ids: string[] }>([
      ['11', { pid: 'panel_0', ids: ['src-1'] }],
    ]);
    (metaData.get as any).mockImplementation((type: string, imageId: string) => {
      if (type === 'generalSeriesModule' && imageId === 'src-1') {
        return { seriesInstanceUID: 'SER-1' };
      }
      return undefined;
    });
    mocks.getSegReferenceInfo.mockReturnValue({
      referencedSeriesUID: 'SER-1',
      referencedSOPInstanceUIDs: [],
    });
    mocks.segmentationManager.loadSegFromArrayBuffer.mockResolvedValueOnce({
      segmentationId: 'seg-recovered',
      firstNonZeroReferencedImageId: 'src-1',
    });
    mocks.viewportService.getViewport.mockReturnValue({
      getImageIds: () => ['src-1'],
      setImageIdIndex: vi.fn(),
      getCurrentImageIdIndex: () => 0,
      scroll: vi.fn(),
      render: vi.fn(),
    } as any);
    (window.electronAPI.xnat.listTempFiles as any).mockResolvedValueOnce({
      ok: true,
      files: [{ name: 'autosave_seg_11_20260301120000.dcm' }],
    });
    (window.electronAPI.xnat.downloadTempFile as any).mockResolvedValueOnce({
      ok: true,
      data: btoa('SEGDATA'),
    });
    mocks.showConfirmDialog.mockResolvedValueOnce(true);

    await checkForAutoSaveRecovery('S1', panelMap);

    expect(mocks.segmentationManager.loadSegFromArrayBuffer).toHaveBeenCalledWith(
      'panel_0',
      expect.any(ArrayBuffer),
      ['src-1'],
    );
    expect(window.electronAPI.xnat.deleteTempFile).toHaveBeenCalledWith(
      'S1',
      'autosave_seg_11_20260301120000.dcm',
    );
  });

  it('checkForAutoSaveRecovery supports skip + delete flow', async () => {
    const panelMap = new Map<string, { pid: string; ids: string[] }>([
      ['11', { pid: 'panel_0', ids: ['src-1'] }],
    ]);
    (metaData.get as any).mockImplementation((type: string, imageId: string) => {
      if (type === 'generalSeriesModule' && imageId === 'src-1') {
        return { seriesInstanceUID: 'SER-1' };
      }
      return undefined;
    });
    mocks.getSegReferenceInfo.mockReturnValue({
      referencedSeriesUID: 'SER-1',
      referencedSOPInstanceUIDs: [],
    });
    (window.electronAPI.xnat.listTempFiles as any).mockResolvedValueOnce({
      ok: true,
      files: [{ name: 'autosave_seg_11_20260301120000.dcm' }],
    });
    (window.electronAPI.xnat.downloadTempFile as any).mockResolvedValueOnce({
      ok: true,
      data: btoa('SEGDATA'),
    });
    mocks.showConfirmDialog.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await checkForAutoSaveRecovery('S1', panelMap);

    expect(mocks.segmentationManager.loadSegFromArrayBuffer).not.toHaveBeenCalled();
    expect(window.electronAPI.xnat.deleteTempFile).toHaveBeenCalledWith(
      'S1',
      'autosave_seg_11_20260301120000.dcm',
    );
  });

  it('checkForAutoSaveRecovery skips broken downloads and marks session as already checked', async () => {
    const panelMap = new Map<string, { pid: string; ids: string[] }>([
      ['11', { pid: 'panel_0', ids: ['src-1'] }],
    ]);
    (window.electronAPI.xnat.listTempFiles as any).mockResolvedValueOnce({
      ok: true,
      files: [
        { name: 'autosave_seg_11_20260301120000.dcm' },
        { name: 'autosave_rtstruct_11_20260301120001.dcm' },
      ],
    });
    (window.electronAPI.xnat.downloadTempFile as any)
      .mockResolvedValueOnce({ ok: false, error: 'missing' })
      .mockRejectedValueOnce(new Error('network broken'));

    await checkForAutoSaveRecovery('S-recover-skip', panelMap);
    await checkForAutoSaveRecovery('S-recover-skip', panelMap);

    expect(window.electronAPI.xnat.listTempFiles).toHaveBeenCalledTimes(1);
    expect(mocks.segmentationManager.loadSegFromArrayBuffer).not.toHaveBeenCalled();
    expect(mocks.segmentationManager.loadRtStructFromArrayBuffer).not.toHaveBeenCalled();
    expect(mocks.showConfirmDialog).not.toHaveBeenCalled();
  });

  it('checkForAutoSaveRecovery resolves RTSTRUCT panel via SOP fallback and recovers contours', async () => {
    const refImageId = 'wadouri:https://xnat/image?objectUID=sop-rt-1';
    const panelMap = new Map<string, { pid: string; ids: string[] }>([
      ['11', { pid: 'panel_0', ids: [refImageId] }],
    ]);
    mocks.rtStructService.parseRtStruct.mockReturnValueOnce({
      referencedSeriesUID: null,
      rois: [{ contours: [{ referencedSOPInstanceUID: 'sop-rt-1' }] }],
    } as any);
    mocks.segmentationManager.loadRtStructFromArrayBuffer.mockResolvedValueOnce({
      segmentationId: 'rt-recovered',
      firstReferencedImageId: refImageId,
    });
    mocks.viewportService.getViewport.mockReturnValue({
      getImageIds: () => [refImageId],
      setImageIdIndex: vi.fn(),
      getCurrentImageIdIndex: () => 0,
      scroll: vi.fn(),
      render: vi.fn(),
    } as any);
    (window.electronAPI.xnat.listTempFiles as any).mockResolvedValueOnce({
      ok: true,
      files: [{ name: 'autosave_rtstruct_11_20260301120000.dcm' }],
    });
    (window.electronAPI.xnat.downloadTempFile as any).mockResolvedValueOnce({
      ok: true,
      data: btoa('RTSTRUCT'),
    });
    mocks.showConfirmDialog.mockResolvedValueOnce(true);

    await checkForAutoSaveRecovery('S-rt', panelMap);

    expect(mocks.segmentationManager.loadRtStructFromArrayBuffer).toHaveBeenCalledWith(
      'panel_0',
      expect.any(ArrayBuffer),
      [refImageId],
    );
    expect(window.electronAPI.xnat.deleteTempFile).toHaveBeenCalledWith(
      'S-rt',
      'autosave_rtstruct_11_20260301120000.dcm',
    );
  });

  it('checkForAutoSaveRecovery resolves RTSTRUCT panel via referenced series UID', async () => {
    const imageId = 'src-rt-series';
    const panelMap = new Map<string, { pid: string; ids: string[] }>([
      ['11', { pid: 'panel_0', ids: [imageId] }],
    ]);
    (metaData.get as any).mockImplementation((type: string, id: string) => {
      if (type === 'generalSeriesModule' && id === imageId) {
        return { seriesInstanceUID: 'SER-RT-MATCH' };
      }
      return undefined;
    });
    mocks.rtStructService.parseRtStruct.mockReturnValueOnce({
      referencedSeriesUID: 'SER-RT-MATCH',
      rois: [],
    } as any);
    mocks.segmentationManager.loadRtStructFromArrayBuffer.mockResolvedValueOnce({
      segmentationId: 'rt-series',
      firstReferencedImageId: null,
    });
    (window.electronAPI.xnat.listTempFiles as any).mockResolvedValueOnce({
      ok: true,
      files: [{ name: 'autosave_rtstruct_11_20260301120000.dcm' }],
    });
    (window.electronAPI.xnat.downloadTempFile as any).mockResolvedValueOnce({
      ok: true,
      data: btoa('RTSTRUCT'),
    });
    mocks.showConfirmDialog.mockResolvedValueOnce(true);

    await checkForAutoSaveRecovery('S-rt-series', panelMap);

    expect(mocks.segmentationManager.loadRtStructFromArrayBuffer).toHaveBeenCalledWith(
      'panel_0',
      expect.any(ArrayBuffer),
      [imageId],
    );
  });

  it('checkForAutoSaveRecovery resolves SEG panel via referenced SOP fallback', async () => {
    const imageId = 'wadouri:https://xnat/image?objectUID=sop-seg-1';
    const panelMap = new Map<string, { pid: string; ids: string[] }>([
      ['11', { pid: 'panel_0', ids: [imageId] }],
    ]);
    mocks.getSegReferenceInfo.mockReturnValueOnce({
      referencedSeriesUID: null,
      referencedSOPInstanceUIDs: ['sop-seg-1'],
    });
    mocks.segmentationManager.loadSegFromArrayBuffer.mockResolvedValueOnce({
      segmentationId: 'seg-sop-fallback',
      firstNonZeroReferencedImageId: imageId,
    });
    mocks.viewportService.getViewport.mockReturnValue({
      getImageIds: () => [imageId],
      setImageIdIndex: vi.fn(),
      getCurrentImageIdIndex: () => 0,
      scroll: vi.fn(),
      render: vi.fn(),
    } as any);
    (window.electronAPI.xnat.listTempFiles as any).mockResolvedValueOnce({
      ok: true,
      files: [{ name: 'autosave_seg_11_20260301120000.dcm' }],
    });
    (window.electronAPI.xnat.downloadTempFile as any).mockResolvedValueOnce({
      ok: true,
      data: btoa('SEGDATA'),
    });
    mocks.showConfirmDialog.mockResolvedValueOnce(true);

    await checkForAutoSaveRecovery('S-seg-sop', panelMap);

    expect(mocks.segmentationManager.loadSegFromArrayBuffer).toHaveBeenCalledWith(
      'panel_0',
      expect.any(ArrayBuffer),
      [imageId],
    );
  });

  it('checkForAutoSaveRecovery tolerates parse failures and unresolved references', async () => {
    const panelMap = new Map<string, { pid: string; ids: string[] }>([
      ['11', { pid: 'panel_0', ids: ['src-1'] }],
    ]);
    (window.electronAPI.xnat.listTempFiles as any).mockResolvedValueOnce({
      ok: true,
      files: [{ name: 'autosave_seg_11_20260301120000.dcm' }],
    });
    (window.electronAPI.xnat.downloadTempFile as any).mockResolvedValueOnce({
      ok: true,
      data: btoa('SEGDATA'),
    });
    mocks.getSegReferenceInfo.mockImplementationOnce(() => {
      throw new Error('cannot parse seg');
    });

    await checkForAutoSaveRecovery('S-parse', panelMap);

    expect(mocks.showConfirmDialog).not.toHaveBeenCalled();
    expect(mocks.segmentationManager.loadSegFromArrayBuffer).not.toHaveBeenCalled();
  });

  it('checkForAutoSaveRecovery handles loader failure after user confirms recovery', async () => {
    const panelMap = new Map<string, { pid: string; ids: string[] }>([
      ['11', { pid: 'panel_0', ids: ['src-1'] }],
    ]);
    (metaData.get as any).mockImplementation((type: string, imageId: string) => {
      if (type === 'generalSeriesModule' && imageId === 'src-1') {
        return { seriesInstanceUID: 'SER-1' };
      }
      return undefined;
    });
    mocks.getSegReferenceInfo.mockReturnValueOnce({
      referencedSeriesUID: 'SER-1',
      referencedSOPInstanceUIDs: [],
    });
    mocks.showConfirmDialog.mockResolvedValueOnce(true);
    mocks.segmentationManager.loadSegFromArrayBuffer.mockRejectedValueOnce(new Error('apply failed'));
    (window.electronAPI.xnat.listTempFiles as any).mockResolvedValueOnce({
      ok: true,
      files: [{ name: 'autosave_seg_11_20260301120000.dcm' }],
    });
    (window.electronAPI.xnat.downloadTempFile as any).mockResolvedValueOnce({
      ok: true,
      data: btoa('SEGDATA'),
    });

    await checkForAutoSaveRecovery('S-load-fail', panelMap);

    expect(mocks.segmentationManager.loadSegFromArrayBuffer).toHaveBeenCalled();
    expect(window.electronAPI.xnat.deleteTempFile).not.toHaveBeenCalled();
  });

  it('checkForAutoSaveRecovery marks sessions as recovered even when listTempFiles fails', async () => {
    const panelMap = new Map<string, { pid: string; ids: string[] }>([
      ['11', { pid: 'panel_0', ids: ['src-1'] }],
    ]);
    (window.electronAPI.xnat.listTempFiles as any).mockRejectedValueOnce(new Error('xnat down'));

    await checkForAutoSaveRecovery('S-list-fail', panelMap);
    await checkForAutoSaveRecovery('S-list-fail', panelMap);

    expect(window.electronAPI.xnat.listTempFiles).toHaveBeenCalledTimes(1);
  });

  it('jumpViewportToReferencedImage no-ops when viewport or referenced image is missing', async () => {
    mocks.viewportService.getViewport.mockReturnValueOnce(null);
    await expect(jumpViewportToReferencedImage('panel_0', 'img-1')).resolves.toBeUndefined();

    const missingImageViewport = {
      getImageIds: vi.fn(() => ['img-0']),
      setImageIdIndex: vi.fn(),
      getCurrentImageIdIndex: vi.fn(() => 0),
      scroll: vi.fn(),
      render: vi.fn(),
    };
    mocks.viewportService.getViewport.mockReturnValueOnce(missingImageViewport as any);
    await jumpViewportToReferencedImage('panel_0', 'img-2');
    expect(missingImageViewport.render).not.toHaveBeenCalled();
    expect(missingImageViewport.scroll).not.toHaveBeenCalled();
    expect(missingImageViewport.setImageIdIndex).not.toHaveBeenCalled();
  });

  it('reuses existing SEG/RTSTRUCT overlays by XNAT origin without re-download', async () => {
    const user = userEvent.setup();
    setConnectedConnectionState();
    useViewerStore.setState({
      ...useViewerStore.getState(),
      panelScanMap: { panel_0: '11' },
      activeViewportId: 'panel_0',
    });
    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      xnatOriginMap: {
        segExisting: { scanId: '3001', sourceScanId: '11', projectId: 'P1', sessionId: 'S1' },
        rtExisting: { scanId: '4001', sourceScanId: '11', projectId: 'P1', sessionId: 'S1' },
      },
    });
    mocks.segmentationManager.segmentationExists.mockReturnValue(true);

    render(<App />);
    await screen.findByTestId('viewer-page');

    await user.click(screen.getByRole('button', { name: 'Trigger Load SEG' }));
    await user.click(screen.getByRole('button', { name: 'Trigger Load RTSTRUCT' }));

    expect(mocks.segmentationManager.userSelectedSegmentation).toHaveBeenCalledWith(
      'panel_0',
      'segExisting',
      1,
    );
    expect(mocks.segmentationManager.userSelectedSegmentation).toHaveBeenCalledWith(
      'panel_0',
      'rtExisting',
      1,
    );
    expect(window.electronAPI.xnat.downloadScanFile).not.toHaveBeenCalled();
  });

  it('opens scan in 2x2 orientation layout when requested', async () => {
    const user = userEvent.setup();
    setConnectedConnectionState();
    mocks.dicomwebLoader.getScanImageIds.mockResolvedValue(['img-1', 'img-2', 'img-3']);

    render(<App />);
    await screen.findByTestId('viewer-page');

    await user.click(screen.getByRole('button', { name: 'Trigger Load Scan MPR' }));

    await waitFor(() => {
      expect(useViewerStore.getState().layout).toBe('2x2');
    });
    expect(useViewerStore.getState().panelScanMap.panel_1).toBe('11');
    expect(useViewerStore.getState().panelScanMap.panel_2).toBe('11');
    expect(useViewerStore.getState().panelScanMap.panel_3).toBe('11');
  });

  it('loads a session with derived overlays and records xnat origins', async () => {
    const user = userEvent.setup();
    setConnectedConnectionState();
    mocks.hangingProtocol.matchProtocol.mockReturnValue({
      protocol: { id: 'p-derived', name: 'Derived Protocol', layout: '1x1' },
      assignments: new Map<number, any>([[0, { id: '11', modality: 'CT', seriesDescription: 'Axial' }]]),
      unmatched: [],
    });
    mocks.dicomwebLoader.getScanImageIds.mockResolvedValue(['img-1', 'img-2']);
    mocks.segmentationManager.requestShowOverlaysForSourceScan.mockImplementation(async () => {
      useSegmentationManagerStore.setState({
        ...useSegmentationManagerStore.getState(),
        loadedBySourceScan: {
          'P1/S1/11': {
            '3001': { segmentationId: 'seg-overlay' } as any,
          },
        },
      });
    });
    useSessionDerivedIndexStore.setState({
      ...useSessionDerivedIndexStore.getState(),
      resolveAssociationsForSession: vi.fn(async () => undefined),
      getForSource: vi.fn(() => ({
        segScans: [{ id: '3001', type: 'SEG', seriesDescription: 'Liver SEG' }] as any,
        rtStructScans: [] as any,
      })),
    } as any);
    (window.electronAPI.xnat.listTempFiles as any).mockResolvedValue({
      ok: true,
      files: [],
    });

    render(<App />);
    await screen.findByTestId('viewer-page');
    await user.click(screen.getByRole('button', { name: 'Trigger Load Session With Derived' }));

    await waitFor(() => {
      expect(mocks.segmentationManager.requestShowOverlaysForSourceScan).toHaveBeenCalledWith(
        'panel_0',
        '11',
        expect.arrayContaining([
          expect.objectContaining({ type: 'SEG', scanId: '3001' }),
        ]),
        expect.any(Object),
      );
    });
    expect(useSegmentationStore.getState().xnatOriginMap['seg-overlay']).toMatchObject({
      scanId: '3001',
      sourceScanId: '11',
      projectId: 'P1',
      sessionId: 'S1',
    });
  });

  it('imports local regular/SEG/RTSTRUCT files and routes to segmentation manager loaders', async () => {
    setConnectedConnectionState();
    const parseDicom = (await import('dicom-parser')).parseDicom as any;
    parseDicom.mockImplementation((byteArray: Uint8Array) => {
      const marker = String.fromCharCode(byteArray[0] ?? 0).toLowerCase();
      const sopClassUid =
        marker === 's' ? '1.2.840.10008.5.1.4.1.1.66.4'
        : marker === 'r' ? '1.2.840.10008.5.1.4.1.1.481.3'
        : '1.2.840.10008.5.1.4.1.1.2';
      return {
        string: (tag: string) => (tag === 'x00080016' ? sopClassUid : ''),
      };
    });
    mocks.getSegReferenceInfo.mockReturnValue({
      referencedSeriesUID: null,
      referencedSOPInstanceUIDs: [],
    });

    render(<App />);
    await screen.findByTestId('viewer-page');

    fireEvent.drop(screen.getByTestId('viewer-page'), {
      dataTransfer: {
        getData: () => '',
        files: [
          createDicomFile('img', 'img-1.dcm'),
          createDicomFile('seg', 'seg-1.dcm'),
          createDicomFile('rt', 'rt-1.dcm'),
        ],
      },
    });

    await waitFor(() => {
      expect(mocks.segmentationManager.loadSegFromArrayBuffer).toHaveBeenCalled();
      expect(mocks.segmentationManager.loadRtStructFromArrayBuffer).toHaveBeenCalled();
    });
  });

  it('shows error status when local SEG references do not match any loaded source images', async () => {
    setConnectedConnectionState();
    const parseDicom = (await import('dicom-parser')).parseDicom as any;
    parseDicom.mockImplementation(() => ({
      string: (tag: string) => (tag === 'x00080016' ? '1.2.840.10008.5.1.4.1.1.66.4' : ''),
    }));
    mocks.getSegReferenceInfo.mockReturnValue({
      referencedSeriesUID: 'SERIES-NOT-LOADED',
      referencedSOPInstanceUIDs: [],
    });

    render(<App />);
    await screen.findByTestId('viewer-page');

    fireEvent.drop(screen.getByTestId('viewer-page'), {
      dataTransfer: {
        getData: () => '',
        files: [createDicomFile('seg', 'seg-unmatched.dcm')],
      },
    });

    expect(await screen.findByText('Cannot display local SEG')).toBeInTheDocument();
    expect(mocks.segmentationManager.loadSegFromArrayBuffer).not.toHaveBeenCalled();
  });

  it('applies protocol assignments from toolbar callback and updates panel stacks', async () => {
    const user = userEvent.setup();
    setConnectedConnectionState();
    useViewerStore.setState({
      ...useViewerStore.getState(),
      sessionId: 'S1',
      sessionScans: [{ id: '11', modality: 'CT', seriesDescription: 'Axial' } as any],
    });
    mocks.hangingProtocol.applyProtocol.mockReturnValue({
      assignments: new Map<number, any>([[0, { id: '11', modality: 'CT', seriesDescription: 'Axial' }]]),
      unmatched: [],
    });
    mocks.dicomwebLoader.getScanImageIds.mockResolvedValue(['img-1', 'img-2']);

    render(<App />);
    await screen.findByTestId('viewer-page');
    await user.click(screen.getByRole('button', { name: 'Trigger Apply Protocol' }));

    await waitFor(() => {
      expect(mocks.segmentationManager.removeSegmentationsFromViewport).toHaveBeenCalledWith('panel_0');
    });
    expect(screen.getByText('Protocol applied')).toBeInTheDocument();
  });

  it('toggles MPR mode from toolbar callback and invokes volume service', async () => {
    const user = userEvent.setup();
    setConnectedConnectionState();
    mocks.dicomwebLoader.getScanImageIds.mockResolvedValue(['img-1', 'img-2', 'img-3']);

    render(<App />);
    await screen.findByTestId('viewer-page');
    await user.click(screen.getByRole('button', { name: 'Trigger Load Scan' }));
    await waitFor(() => {
      expect(screen.getByText('Scan loaded')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Trigger Toggle MPR' }));
    await waitFor(() => {
      expect(mocks.volumeService.create).toHaveBeenCalled();
      expect(mocks.volumeService.load).toHaveBeenCalled();
    });
  });
});
