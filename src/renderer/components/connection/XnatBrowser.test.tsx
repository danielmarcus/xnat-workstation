import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import XnatBrowser from './XnatBrowser';
import { useConnectionStore } from '../../stores/connectionStore';
import { useSessionDerivedIndexStore } from '../../stores/sessionDerivedIndexStore';
import type { ElectronAPI } from '@shared/types';

const mocks = vi.hoisted(() => ({
  getScanImageIds: vi.fn(async () => ['wadouri:https://xnat.example/dicom/1']),
  loadAndCacheImage: vi.fn(async () => ({
    getCanvas: () => {
      const c = document.createElement('canvas');
      c.width = 24;
      c.height = 24;
      return c;
    },
  })),
}));

vi.mock('../../lib/cornerstone/dicomwebLoader', () => ({
  dicomwebLoader: {
    getScanImageIds: mocks.getScanImageIds,
  },
}));

vi.mock('@cornerstonejs/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cornerstonejs/core')>();
  return {
    ...actual,
    imageLoader: {
      ...actual.imageLoader,
      loadAndCacheImage: mocks.loadAndCacheImage,
    },
  };
});

function setElectronApiMock(overrides?: Partial<ElectronAPI['xnat']>): ElectronAPI {
  const xnat = {
    browserLogin: vi.fn(),
    logout: vi.fn(),
    validateSession: vi.fn(async () => ({ valid: true })),
    getConnection: vi.fn(async () => null),
    dicomwebFetch: vi.fn(),
    getProjects: vi.fn(async () => []),
    getSubjects: vi.fn(async () => []),
    getSessions: vi.fn(async () => []),
    getScans: vi.fn(async () => []),
    getScanFiles: vi.fn(),
    getProjectSessions: vi.fn(async () => []),
    downloadScanFile: vi.fn(async () => ({ ok: true, data: '' })),
    uploadDicomSeg: vi.fn(),
    uploadDicomRtStruct: vi.fn(),
    overwriteDicomSeg: vi.fn(),
    overwriteDicomRtStruct: vi.fn(),
    prepareDicomForUpload: vi.fn(),
    autoSaveTemp: vi.fn(),
    listTempFiles: vi.fn(),
    deleteScan: vi.fn(),
    deleteTempFile: vi.fn(),
    downloadTempFile: vi.fn(),
    ...overrides,
  } as unknown as ElectronAPI['xnat'];

  const shell = {
    openExternal: vi.fn(async () => ({ ok: true })),
  };

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      xnat,
      export: {},
      shell,
      platform: 'darwin',
      on: vi.fn(() => () => undefined),
    },
  });

  return window.electronAPI;
}

function resetStores(): void {
  useConnectionStore.setState(useConnectionStore.getInitialState(), true);
  useSessionDerivedIndexStore.setState(useSessionDerivedIndexStore.getInitialState(), true);
}

beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({
      fillStyle: '',
      fillRect: () => undefined,
      drawImage: () => undefined,
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
      putImageData: () => undefined,
    }),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    value: () => 'data:image/jpeg;base64,mock',
  });

  class MockIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin = '0px';
    readonly thresholds = [0];
    constructor(private readonly cb: IntersectionObserverCallback) {}
    disconnect(): void {}
    observe(target: Element): void {
      this.cb(
        [{ target, isIntersecting: true } as IntersectionObserverEntry],
        this,
      );
    }
    takeRecords(): IntersectionObserverEntry[] { return []; }
    unobserve(): void {}
  }

  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: MockIntersectionObserver,
  });
});

describe('XnatBrowser', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    useConnectionStore.setState({
      ...useConnectionStore.getState(),
      status: 'connected',
      connection: {
        serverUrl: 'https://xnat.example',
        username: 'dan',
        connectedAt: Date.now(),
      },
    });
    useSessionDerivedIndexStore.setState({
      ...useSessionDerivedIndexStore.getState(),
      resolveAssociationsForSession: vi.fn(async () => undefined),
      derivedIndex: {},
      sourceSeriesUidByScanId: {},
      derivedRefSeriesUidByScanId: {},
      resolvedSessionIds: new Set(),
    });
  });

  function getClickableContaining(text: RegExp): HTMLElement {
    const label = screen.getByText(text);
    const clickable = label.closest('button, [role="button"]');
    if (!clickable) {
      throw new Error(`Could not find clickable row for label: ${text.toString()}`);
    }
    return clickable as HTMLElement;
  }

  it('drills down project -> subject -> session and loads source scans with context', async () => {
    const onLoadScan = vi.fn();
    const electronApi = setElectronApiMock({
      getProjects: vi.fn(async () => [{ id: 'P1', name: 'Project One', subjectCount: 1, sessionCount: 1 }]),
      getSubjects: vi.fn(async () => [{ id: 'SUB1', label: 'Subject-001', projectId: 'P1' }]),
      getSessions: vi.fn(async () => [{ id: 'SESS1', label: 'Session-1', projectId: 'P1', subjectId: 'SUB1', scanCount: 2 }]),
      getScans: vi.fn(async () => [
        { id: '11', type: 'CT', modality: 'CT', seriesDescription: 'Axial' },
        { id: '3001', type: 'SEG', modality: 'SEG', xsiType: 'xnat:segScanData', seriesDescription: 'Seg Overlay' },
      ]),
      getProjectSessions: vi.fn(async () => [{ subjectId: 'SUB1', modality: 'CT' }]),
    });

    const user = userEvent.setup();
    render(<XnatBrowser onLoadScan={onLoadScan} />);

    await user.click(await screen.findByTitle('Open project in XNAT'));
    expect(electronApi.shell.openExternal).toHaveBeenCalledWith('https://xnat.example/data/projects/P1?format=html');

    await user.click(await screen.findByText('Project One'));

    await user.click(await screen.findByTitle('Open subject in XNAT'));
    expect(electronApi.shell.openExternal).toHaveBeenCalledWith('https://xnat.example/data/projects/P1/subjects/SUB1?format=html');

    await user.click(await screen.findByText('Subject-001'));

    await user.click(await screen.findByTitle('Open session in XNAT'));
    expect(electronApi.shell.openExternal).toHaveBeenCalledWith('https://xnat.example/data/experiments/SESS1?format=html');

    await user.click(await screen.findByText('Session-1'));

    await waitFor(() => {
      expect(electronApi.xnat.getScans).toHaveBeenCalledWith('SESS1');
    });
    expect(screen.getByText('Axial')).toBeInTheDocument();
    expect(screen.queryByText('#3001 Seg Overlay')).not.toBeInTheDocument();

    await user.click(getClickableContaining(/Axial/));
    expect(onLoadScan).toHaveBeenCalledWith(
      'SESS1',
      '11',
      expect.objectContaining({ id: '11' }),
      expect.objectContaining({
        projectId: 'P1',
        subjectId: 'SUB1',
        sessionLabel: 'Session-1',
      }),
      { openInMpr: false },
    );
  });

  it('honors navigateTo session targets, auto-loads session, and shows expanded session at sessions level', async () => {
    const onLoadScan = vi.fn();
    const onLoadSession = vi.fn();
    const onNavigateComplete = vi.fn();
    const electronApi = setElectronApiMock({
      getProjects: vi.fn(async () => []),
      getSessions: vi.fn(async () => [
        { id: 'SESS9', label: 'Pinned Session', projectId: 'P9', subjectId: 'SUB9', scanCount: 2 },
      ]),
      getScans: vi.fn(async () => [
        { id: '21', type: 'MR', modality: 'MR', seriesDescription: 'T1' },
        { id: '4001', type: 'RTSTRUCT', modality: 'RTSTRUCT', xsiType: 'xnat:otherDicomScanData', seriesDescription: 'RTSTRUCT' },
      ]),
    });

    const user = userEvent.setup();
    render(
      <XnatBrowser
        onLoadScan={onLoadScan}
        onLoadSession={onLoadSession}
        onNavigateComplete={onNavigateComplete}
        navigateTo={{
          type: 'session',
          serverUrl: 'https://xnat.example',
          projectId: 'P9',
          projectName: 'Pinned Project',
          subjectId: 'SUB9',
          subjectLabel: 'Pinned Subject',
          sessionId: 'SESS9',
          sessionLabel: 'Pinned Session',
          timestamp: Date.now(),
        }}
      />,
    );

    await waitFor(() => expect(onNavigateComplete).toHaveBeenCalledTimes(1));

    // Should auto-load the session
    expect(onLoadSession).toHaveBeenCalledWith(
      'SESS9',
      expect.arrayContaining([expect.objectContaining({ id: '21' })]),
      expect.objectContaining({
        projectId: 'P9',
        subjectId: 'SUB9',
        sessionLabel: 'Pinned Session',
      }),
    );

    // Should be at sessions level (not scans) with the session expanded showing its scans
    expect(electronApi.xnat.getSessions).toHaveBeenCalledWith('P9', 'SUB9');
    expect(screen.getByText('Pinned Session')).toBeInTheDocument();
    expect(screen.getByText('T1')).toBeInTheDocument();
    expect(screen.queryByText('#4001 RTSTRUCT')).not.toBeInTheDocument();

    // Refresh at sessions level
    await user.click(screen.getByTitle('Refresh sessions'));
    await waitFor(() => expect(electronApi.xnat.getSessions).toHaveBeenCalledTimes(2));

    // Clicking a scan in the expanded session still works
    fireEvent.click(getClickableContaining(/T1/), { shiftKey: true });
    expect(onLoadScan).toHaveBeenLastCalledWith(
      'SESS9',
      '21',
      expect.objectContaining({ id: '21' }),
      expect.objectContaining({ projectId: 'P9', subjectId: 'SUB9' }),
      { openInMpr: true },
    );
  });

  it('supports pinning, search filtering, grid thumbnails, and scan drag payload contracts', async () => {
    const onLoadScan = vi.fn();
    const onTogglePin = vi.fn();
    const electronApi = setElectronApiMock({
      getProjects: vi.fn(async () => [{ id: 'P1', name: 'Project One', subjectCount: 1, sessionCount: 1 }]),
      getSubjects: vi.fn(async () => [{ id: 'SUB1', label: 'Subject-001', projectId: 'P1' }]),
      getSessions: vi.fn(async () => [{ id: 'SESS1', label: 'Session-1', projectId: 'P1', subjectId: 'SUB1', scanCount: 1 }]),
      getScans: vi.fn(async () => [{ id: '11', type: 'CT', modality: 'CT', seriesDescription: 'Axial' }]),
      getProjectSessions: vi.fn(async () => [{ subjectId: 'SUB1', modality: 'CT' }]),
    });

    const user = userEvent.setup();
    render(<XnatBrowser onLoadScan={onLoadScan} onTogglePin={onTogglePin} />);

    await screen.findByText('Project One');
    await user.click(screen.getByTitle('Pin'));
    expect(onTogglePin).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'project',
        projectId: 'P1',
        serverUrl: 'https://xnat.example',
      }),
    );

    await user.type(screen.getByPlaceholderText('Filter projects...'), 'no-match');
    expect(screen.getByText('No projects matching "no-match"')).toBeInTheDocument();
    await user.click(screen.getByTitle('Clear search'));
    const projectRow = await screen.findByText('Project One');

    await user.click(projectRow);
    await user.click(await screen.findByText('Subject-001'));
    await user.click(screen.getByTitle('Grid view'));
    await user.click(await screen.findByText('Session-1'));

    await waitFor(() => {
      expect(mocks.getScanImageIds).toHaveBeenCalledWith('SESS1', '11');
      expect(mocks.loadAndCacheImage).toHaveBeenCalled();
    });

    const gridScanButton = screen.getByTitle('Axial (#11)');
    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: '',
    };
    fireEvent.dragStart(gridScanButton, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-xnat-scan', expect.any(String));
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/x-xnat-scan', expect.any(String));

    const payloadJson = dataTransfer.setData.mock.calls.find((c: unknown[]) => c[0] === 'application/x-xnat-scan')?.[1];
    expect(JSON.parse(String(payloadJson))).toEqual(
      expect.objectContaining({
        sessionId: 'SESS1',
        scanId: '11',
        context: expect.objectContaining({ projectId: 'P1', subjectId: 'SUB1' }),
      }),
    );

    fireEvent.click(gridScanButton, { shiftKey: true });
    expect(onLoadScan).toHaveBeenCalledWith(
      'SESS1',
      '11',
      expect.objectContaining({ id: '11' }),
      expect.objectContaining({ projectId: 'P1' }),
      { openInMpr: true },
    );

    await user.click(screen.getByTitle('Refresh sessions'));
    expect(electronApi.xnat.getSessions).toHaveBeenCalledWith('P1', 'SUB1');
  });

  it('breadcrumb navigation fetches correct data after navigateTo switches session', async () => {
    const onLoadSession = vi.fn();
    const onNavigateComplete = vi.fn();

    // First render: drill down into Project A / Subject A / Session A normally
    const electronApi = setElectronApiMock({
      getProjects: vi.fn(async () => [{ id: 'PA', name: 'Project A', subjectCount: 1, sessionCount: 1 }]),
      getSubjects: vi.fn(async () => [{ id: 'SUBA', label: 'Subject-A', projectId: 'PA' }]),
      getSessions: vi.fn(async () => [{ id: 'SESSA', label: 'Session-A', projectId: 'PA', subjectId: 'SUBA', scanCount: 1 }]),
      getScans: vi.fn(async () => [{ id: '1', type: 'CT', modality: 'CT', seriesDescription: 'CT-A' }]),
      getProjectSessions: vi.fn(async () => []),
    });

    const user = userEvent.setup();
    const { rerender } = render(
      <XnatBrowser onLoadSession={onLoadSession} onNavigateComplete={onNavigateComplete} />,
    );

    // Drill down: Project A -> Subject A (sessions level)
    await user.click(await screen.findByText('Project A'));
    await user.click(await screen.findByText('Subject-A'));
    await screen.findByText('Session-A');

    // Now simulate pinned navigation to a different session in a different project/subject
    electronApi.xnat.getScans = vi.fn(async () => [
      { id: '2', type: 'MR', modality: 'MR', seriesDescription: 'MR-B' },
    ]) as unknown as ElectronAPI['xnat']['getScans'];
    electronApi.xnat.getSessions = vi.fn(async () => [
      { id: 'SESSB', label: 'Session-B', projectId: 'PB', subjectId: 'SUBB', scanCount: 1 },
    ]) as unknown as ElectronAPI['xnat']['getSessions'];
    electronApi.xnat.getSubjects = vi.fn(async () => [
      { id: 'SUBB', label: 'Subject-B', projectId: 'PB' },
    ]) as unknown as ElectronAPI['xnat']['getSubjects'];

    rerender(
      <XnatBrowser
        onLoadSession={onLoadSession}
        onNavigateComplete={onNavigateComplete}
        navigateTo={{
          type: 'session',
          serverUrl: 'https://xnat.example',
          projectId: 'PB',
          projectName: 'Project B',
          subjectId: 'SUBB',
          subjectLabel: 'Subject-B',
          sessionId: 'SESSB',
          sessionLabel: 'Session-B',
          timestamp: Date.now(),
        }}
      />,
    );

    // Wait for pinned navigation to complete - now at sessions level with Session-B expanded
    await waitFor(() => expect(onNavigateComplete).toHaveBeenCalled());

    // navigateTo should have fetched sessions for the new subject (not stale Subject A)
    expect(electronApi.xnat.getSessions).toHaveBeenCalledWith('PB', 'SUBB');
    expect(screen.getByText('Session-B')).toBeInTheDocument();
    // Expanded session should show its scans
    expect(screen.getByText('MR-B')).toBeInTheDocument();

    // Click project breadcrumb to navigate up to subjects level
    await user.click(screen.getByText('Project B'));

    // Verify that getSubjects was called with Project B (not stale Project A)
    await waitFor(() => {
      expect(electronApi.xnat.getSubjects).toHaveBeenCalledWith('PB');
    });
    expect(await screen.findByText('Subject-B')).toBeInTheDocument();
  });
});
