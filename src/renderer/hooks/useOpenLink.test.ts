// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { OpenLinkRequest } from '@shared/openLink';

const mocks = vi.hoisted(() => ({
  showConfirmDialog: vi.fn(async (_options: { title: string; message: string; confirmLabel?: string }) => true),
  showToast: vi.fn(),
  openSession: vi.fn(async (..._args: unknown[]) => ({ outcome: 'opened' as const })),
  openScan: vi.fn(async (..._args: unknown[]) => ({ outcome: 'opened' as const })),
  confirmDisconnect: vi.fn(async () => true),
  viewer: { sessionId: null as string | null },
}));

vi.mock('../stores/dialogStore', () => ({ showConfirmDialog: mocks.showConfirmDialog }));
vi.mock('../stores/toastStore', () => ({ showToast: mocks.showToast }));
vi.mock('../lib/app/appNavigation', () => ({ openSession: mocks.openSession, openScan: mocks.openScan }));
vi.mock('./confirmDisconnect', () => ({ confirmDisconnect: mocks.confirmDisconnect }));
vi.mock('../stores/viewerStore', () => ({ useViewerStore: { getState: () => mocks.viewer } }));
vi.mock('../lib/app/appHelpers', () => ({
  isPrimaryImageScan: (scan: { type?: string }) => scan.type !== 'SEG',
}));

import { handleOpenLink, useOpenLink } from './useOpenLink';
import { useConnectionStore } from '../stores/connectionStore';
import { useOpenLinkStore } from '../stores/openLinkStore';
import { saveRecentConnection, loadRecentConnections } from '../lib/xnat/recentConnections';

const SERVER = 'https://xnat.example.org';
const OTHER = 'https://other.example.org';
const LINK: OpenLinkRequest = { server: SERVER, project: 'P1', session: 'XNAT_E1', scan: '4' };
const REF = { projectId: 'P1', subjectId: 'XNAT_S1', subjectLabel: 'Subj1', sessionId: 'XNAT_E1', sessionLabel: 'MR1' };

const xnat = {
  getSession: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({ ok: true, session: REF })),
  getScans: vi.fn(async (..._args: unknown[]): Promise<unknown[]> => [{ id: '4', type: 'T1' }, { id: '3004', type: 'SEG' }]),
};
const browserLogin = vi.fn(async (_server: string) => true);
let linkQueue: OpenLinkRequest[] = [];
let receivedCb: (() => void) | null = null;

function signedIn(serverUrl: string | null): void {
  useConnectionStore.setState({
    status: serverUrl ? 'connected' : 'disconnected',
    connection: serverUrl ? { serverUrl, username: 'dan', connectedAt: 1 } : null,
    browserLogin,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.viewer.sessionId = null;
  linkQueue = [];
  receivedCb = null;
  useOpenLinkStore.setState({ pending: null });
  signedIn(null);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    xnat,
    openLink: {
      take: vi.fn(async () => linkQueue.shift() ?? null),
      onReceived: (cb: () => void) => { receivedCb = cb; return () => { receivedCb = null; }; },
    },
  };
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('handleOpenLink — signed in to the link\'s server', () => {
  it('opens the session at the scan, with no dialog', async () => {
    signedIn(`${SERVER}/`);
    await handleOpenLink(LINK);

    expect(mocks.showConfirmDialog).not.toHaveBeenCalled();
    expect(xnat.getSession).toHaveBeenCalledWith('P1', 'XNAT_E1');
    expect(mocks.openSession).toHaveBeenCalledWith(REF, { scanId: '4' });
  });

  it('a scan that is not an image scan of the session: the session opens, and a toast says why', async () => {
    signedIn(SERVER);
    await handleOpenLink({ ...LINK, scan: '3004' });
    expect(mocks.openSession).toHaveBeenCalledWith(REF, { scanId: undefined });
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('Scan 3004'), 'warning', 5000);
  });

  it('the session already open: only the scan is opened, through the guarded single-scan path', async () => {
    signedIn(SERVER);
    mocks.viewer.sessionId = 'XNAT_E1';
    await handleOpenLink(LINK);
    expect(mocks.openSession).not.toHaveBeenCalled();
    expect(mocks.openScan).toHaveBeenCalledWith(REF, '4');

    mocks.openScan.mockClear();
    await handleOpenLink({ ...LINK, scan: undefined });
    expect(mocks.openScan).not.toHaveBeenCalled();
    expect(mocks.openSession).not.toHaveBeenCalled();
  });

  it('a session XNAT does not have (or the user cannot see) is a toast, nothing opens', async () => {
    signedIn(SERVER);
    xnat.getSession.mockResolvedValueOnce({ ok: false, error: 'XNAT API error: 404' });
    await handleOpenLink(LINK);
    expect(mocks.openSession).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringContaining('XNAT_E1'), 'error', 5000);
  });

  it('a failed open is reported', async () => {
    signedIn(SERVER);
    mocks.openSession.mockResolvedValueOnce({ outcome: 'failed', reason: 'The session has no scans' } as never);
    await handleOpenLink(LINK);
    expect(mocks.showToast).toHaveBeenCalledWith('Could not open the linked session: The session has no scans', 'error', 5000);
  });
});

describe('handleOpenLink — not signed in to the link\'s server', () => {
  it('a server connected to before: sign-in starts at once, the link waits for it', async () => {
    saveRecentConnection(SERVER);
    await handleOpenLink(LINK);

    expect(mocks.showConfirmDialog).not.toHaveBeenCalled();
    expect(useOpenLinkStore.getState().pending).toEqual(LINK);
    expect(browserLogin).toHaveBeenCalledWith(SERVER);
  });

  it('an unknown server asks first, naming it; Cancel does nothing', async () => {
    mocks.showConfirmDialog.mockResolvedValueOnce(false);
    await handleOpenLink(LINK);

    expect(mocks.showConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: `Open a session from ${SERVER}?`,
      confirmLabel: 'Open',
    }));
    expect(browserLogin).not.toHaveBeenCalled();
    expect(useOpenLinkStore.getState().pending).toBeNull();
    expect(loadRecentConnections()).toEqual([]);
  });

  it('an unknown server, Open: sign-in starts, and once it succeeds the server is remembered', async () => {
    await handleOpenLink(LINK);
    expect(browserLogin).toHaveBeenCalledWith(SERVER);
    expect(loadRecentConnections().map((r) => r.serverUrl)).toEqual([SERVER]);
  });

  it('a cancelled sign-in keeps the link waiting (the login form prefills it) and remembers nothing', async () => {
    browserLogin.mockResolvedValueOnce(false);
    await handleOpenLink(LINK);
    expect(useOpenLinkStore.getState().pending).toEqual(LINK);
    expect(loadRecentConnections()).toEqual([]);
  });

  it('signed in elsewhere, to a known server: asks before switching, then guards unsaved annotations', async () => {
    saveRecentConnection(SERVER);
    signedIn(OTHER);
    await handleOpenLink(LINK);

    expect(mocks.showConfirmDialog).toHaveBeenCalledTimes(1);
    const [options] = mocks.showConfirmDialog.mock.calls[0];
    expect(options.title).toBe(`Switch to ${SERVER}?`);
    expect(options.message).toContain(`signs you out of ${OTHER}`);
    expect(mocks.confirmDisconnect).toHaveBeenCalled();
    expect(browserLogin).toHaveBeenCalledWith(SERVER);
  });

  it('signed in elsewhere: Cancel on the switch, or Stay Connected on unsaved work, keeps the session', async () => {
    saveRecentConnection(SERVER);
    signedIn(OTHER);
    mocks.showConfirmDialog.mockResolvedValueOnce(false);
    await handleOpenLink(LINK);
    expect(mocks.confirmDisconnect).not.toHaveBeenCalled();

    mocks.confirmDisconnect.mockResolvedValueOnce(false);
    await handleOpenLink(LINK);
    expect(browserLogin).not.toHaveBeenCalled();
    expect(useOpenLinkStore.getState().pending).toBeNull();
  });

  it('signed in elsewhere, to an unknown server: one dialog, the phishing one, which also says the user will be signed out', async () => {
    signedIn(OTHER);
    await handleOpenLink(LINK);
    expect(mocks.showConfirmDialog).toHaveBeenCalledTimes(1);
    const [options] = mocks.showConfirmDialog.mock.calls[0];
    expect(options.title).toBe(`Open a session from ${SERVER}?`);
    expect(options.message).toContain(`signs you out of ${OTHER}`);
  });

  it('a link during a sign-in already under way is ignored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useConnectionStore.setState({ status: 'connecting', connection: null, browserLogin });
    await handleOpenLink(LINK);
    expect(mocks.showConfirmDialog).not.toHaveBeenCalled();
    expect(browserLogin).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('useOpenLink', () => {
  it('takes nothing until the viewer is ready, then takes the waiting link — and the next one when told', async () => {
    signedIn(SERVER);
    linkQueue = [LINK];
    const { rerender } = renderHook(({ ready }) => useOpenLink(ready), { initialProps: { ready: false } });
    expect(window.electronAPI.openLink?.take).not.toHaveBeenCalled();

    rerender({ ready: true });
    await waitFor(() => expect(mocks.openSession).toHaveBeenCalledWith(REF, { scanId: '4' }));

    linkQueue = [{ ...LINK, session: 'XNAT_E2', scan: undefined }];
    act(() => receivedCb?.());
    await waitFor(() => expect(xnat.getSession).toHaveBeenLastCalledWith('P1', 'XNAT_E2'));
  });

  it('opens the waiting link once a sign-in to its server succeeds (from the link or the login form)', async () => {
    useOpenLinkStore.setState({ pending: LINK });
    renderHook(() => useOpenLink(true));
    expect(mocks.openSession).not.toHaveBeenCalled();

    act(() => signedIn(SERVER));
    await waitFor(() => expect(mocks.openSession).toHaveBeenCalledWith(REF, { scanId: '4' }));
    expect(useOpenLinkStore.getState().pending).toBeNull();
  });

  it('a sign-in to another server drops the waiting link', async () => {
    useOpenLinkStore.setState({ pending: LINK });
    renderHook(() => useOpenLink(true));
    act(() => signedIn(OTHER));
    await waitFor(() => expect(useOpenLinkStore.getState().pending).toBeNull());
    expect(xnat.getSession).not.toHaveBeenCalled();
  });
});
