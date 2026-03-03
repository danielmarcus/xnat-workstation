import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipcChannels';
import { createIpcMainMock } from '../../test/ipc/ipcMocks';

const ipcMainMock = createIpcMainMock();

const mockClient = {
  serverUrl: 'https://xnat.example.org',
  authenticatedFetch: vi.fn(),
  getProjects: vi.fn(),
  getSubjects: vi.fn(),
  getSessions: vi.fn(),
  getProjectSessions: vi.fn(),
  getScans: vi.fn(),
  getScanFiles: vi.fn(),
};

const sessionManagerMock = {
  getClient: vi.fn(),
  handleAuthFailure: vi.fn(),
};

let registerProxyHandlers: (typeof import('./proxyHandlers'))['registerProxyHandlers'];

beforeAll(async () => {
  vi.doMock('electron', () => ({
    ipcMain: ipcMainMock.ipcMain,
  }));

  vi.doMock('../xnat/sessionManager', () => sessionManagerMock);

  ({ registerProxyHandlers } = await import('./proxyHandlers'));
});

describe('registerProxyHandlers', () => {
  beforeEach(() => {
    ipcMainMock.handlers.clear();
    ipcMainMock.listeners.clear();
    ipcMainMock.ipcMain.handle.mockClear();
    vi.clearAllMocks();
    sessionManagerMock.getClient.mockReturnValue(mockClient);
  });

  it('registers all expected proxy channels', () => {
    registerProxyHandlers();

    const channels = ipcMainMock.ipcMain.handle.mock.calls.map((call) => call[0]);
    expect(channels).toEqual([
      IPC.XNAT_DICOMWEB_FETCH,
      IPC.XNAT_GET_PROJECTS,
      IPC.XNAT_GET_SUBJECTS,
      IPC.XNAT_GET_SESSIONS,
      IPC.XNAT_GET_PROJECT_SESSIONS,
      IPC.XNAT_GET_SCANS,
      IPC.XNAT_GET_SCAN_FILES,
    ]);
  });

  it('returns proxied DICOMweb response with expected endpoint and accept header', async () => {
    mockClient.authenticatedFetch.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue([{ StudyInstanceUID: '1.2.3' }]),
    });
    registerProxyHandlers();

    await expect(
      ipcMainMock.invoke(IPC.XNAT_DICOMWEB_FETCH, '/studies?PatientID=P123', {
        accept: 'application/dicom+json',
      }),
    ).resolves.toEqual({
      ok: true,
      status: 200,
      data: [{ StudyInstanceUID: '1.2.3' }],
    });

    expect(mockClient.authenticatedFetch).toHaveBeenCalledWith('/xapi/dicomweb/studies?PatientID=P123', {
      headers: { Accept: 'application/dicom+json' },
    });
  });

  it('rejects invalid dicomweb payloads before calling dependencies', async () => {
    registerProxyHandlers();

    await expect(ipcMainMock.invoke(IPC.XNAT_DICOMWEB_FETCH, 'relative/path')).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Invalid payload: path must be a non-empty absolute path',
    });

    expect(sessionManagerMock.getClient).not.toHaveBeenCalled();
  });

  it('handles unauthenticated and failure paths deterministically', async () => {
    registerProxyHandlers();

    sessionManagerMock.getClient.mockReturnValueOnce(null);
    await expect(ipcMainMock.invoke(IPC.XNAT_DICOMWEB_FETCH, '/studies')).resolves.toEqual({
      ok: false,
      status: 401,
      error: 'Not connected to XNAT',
    });

    sessionManagerMock.getClient.mockReturnValue(mockClient);
    const fetchError = new Error('upstream timeout');
    mockClient.authenticatedFetch.mockRejectedValueOnce(fetchError);

    await expect(ipcMainMock.invoke(IPC.XNAT_DICOMWEB_FETCH, '/studies')).resolves.toEqual({
      ok: false,
      status: 500,
      error: 'upstream timeout',
    });
    expect(sessionManagerMock.handleAuthFailure).toHaveBeenCalledWith(fetchError);
  });

  it('dispatches browse channels to matching XNAT client methods', async () => {
    registerProxyHandlers();

    mockClient.getProjects.mockResolvedValue([{ id: 'P1' }]);
    mockClient.getSubjects.mockResolvedValue([{ id: 'S1' }]);
    mockClient.getSessions.mockResolvedValue([{ id: 'E1' }]);
    mockClient.getProjectSessions.mockResolvedValue([{ subjectId: 'S1', modality: 'MR' }]);
    mockClient.getScans.mockResolvedValue([{ id: '3' }]);
    mockClient.getScanFiles.mockResolvedValue(['/archive/uri/dcm']);

    await expect(ipcMainMock.invoke(IPC.XNAT_GET_PROJECTS)).resolves.toEqual([{ id: 'P1' }]);
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_SUBJECTS, 'P1')).resolves.toEqual([{ id: 'S1' }]);
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_SESSIONS, 'P1', 'S1')).resolves.toEqual([{ id: 'E1' }]);
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_PROJECT_SESSIONS, 'P1')).resolves.toEqual([
      { subjectId: 'S1', modality: 'MR' },
    ]);
    await expect(
      ipcMainMock.invoke(IPC.XNAT_GET_SCANS, 'E1', { includeSopClassUID: true }),
    ).resolves.toEqual([{ id: '3' }]);
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_SCAN_FILES, 'E1', '3')).resolves.toEqual({
      ok: true,
      files: ['/archive/uri/dcm'],
      serverUrl: 'https://xnat.example.org',
    });

    expect(mockClient.getSubjects).toHaveBeenCalledWith('P1');
    expect(mockClient.getSessions).toHaveBeenCalledWith('P1', 'S1');
    expect(mockClient.getProjectSessions).toHaveBeenCalledWith('P1');
    expect(mockClient.getScans).toHaveBeenCalledWith('E1', { includeSopClassUID: true });
    expect(mockClient.getScanFiles).toHaveBeenCalledWith('E1', '3');
  });

  it('returns safe fallback payloads when browse calls fail', async () => {
    registerProxyHandlers();

    const listError = new Error('auth expired');
    mockClient.getProjects.mockRejectedValueOnce(listError);
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_PROJECTS)).resolves.toEqual([]);

    mockClient.getScanFiles.mockRejectedValueOnce(new Error('boom'));
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_SCAN_FILES, 'E1', '3')).resolves.toEqual({
      ok: false,
      error: 'boom',
      files: [],
    });

    expect(sessionManagerMock.handleAuthFailure).toHaveBeenCalled();
  });

  it('rejects invalid option shapes for dicomweb fetch', async () => {
    registerProxyHandlers();

    await expect(
      ipcMainMock.invoke(IPC.XNAT_DICOMWEB_FETCH, '/studies', { accept: 123 as unknown as string }),
    ).resolves.toEqual({
      ok: false,
      status: 400,
      error: 'Invalid payload: options.accept must be a string',
    });
  });

  it('returns safe defaults when browse handlers run without a client', async () => {
    registerProxyHandlers();
    sessionManagerMock.getClient.mockReturnValue(null);

    await expect(ipcMainMock.invoke(IPC.XNAT_GET_PROJECTS)).resolves.toEqual([]);
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_SUBJECTS, 'P1')).resolves.toEqual([]);
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_SESSIONS, 'P1', 'S1')).resolves.toEqual([]);
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_PROJECT_SESSIONS, 'P1')).resolves.toEqual([]);
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_SCANS, 'E1')).resolves.toEqual([]);
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_SCAN_FILES, 'E1', '3')).resolves.toEqual({
      ok: false,
      error: 'Not connected',
      files: [],
    });
  });

  it('handles browse failures for each proxied method and triggers auth-failure hook', async () => {
    registerProxyHandlers();

    mockClient.getSubjects.mockRejectedValueOnce(new Error('subjects failed'));
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_SUBJECTS, 'P1')).resolves.toEqual([]);

    mockClient.getSessions.mockRejectedValueOnce(new Error('sessions failed'));
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_SESSIONS, 'P1', 'S1')).resolves.toEqual([]);

    mockClient.getProjectSessions.mockRejectedValueOnce(new Error('project sessions failed'));
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_PROJECT_SESSIONS, 'P1')).resolves.toEqual([]);

    mockClient.getScans.mockRejectedValueOnce(new Error('scans failed'));
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_SCANS, 'E1')).resolves.toEqual([]);

    expect(sessionManagerMock.handleAuthFailure).toHaveBeenCalledTimes(4);
  });
});
