import type { XnatConnectionInfo } from '@shared/types/xnat';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectionStore } from './connectionStore';

type MockElectronApi = {
  xnat: {
    browserLogin: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    validateSession: ReturnType<typeof vi.fn>;
  };
  on: ReturnType<typeof vi.fn>;
};

function makeConnection(): XnatConnectionInfo {
  return {
    serverUrl: 'https://xnat.example.com',
    username: 'dan',
    connectedAt: 1700000000000,
  };
}

function installElectronApiMocks(): MockElectronApi {
  const api: MockElectronApi = {
    xnat: {
      browserLogin: vi.fn(),
      logout: vi.fn(),
      validateSession: vi.fn(),
    },
    on: vi.fn(),
  };
  (window as Window & { electronAPI?: MockElectronApi }).electronAPI = api;
  return api;
}

function resetStore(): void {
  useConnectionStore.setState(useConnectionStore.getInitialState(), true);
}

describe('useConnectionStore', () => {
  beforeEach(() => {
    installElectronApiMocks();
    resetStore();
  });

  it('transitions through connecting to connected on successful login', async () => {
    const api = installElectronApiMocks();
    let resolveLogin: ((value: unknown) => void) | null = null;
    api.xnat.browserLogin.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLogin = resolve;
        }),
    );

    const pending = useConnectionStore.getState().browserLogin('https://xnat.example.com');
    expect(useConnectionStore.getState().status).toBe('connecting');
    expect(useConnectionStore.getState().error).toBeNull();

    resolveLogin?.({
      success: true,
      connection: makeConnection(),
    });

    await expect(pending).resolves.toBe(true);
    expect(useConnectionStore.getState().status).toBe('connected');
    expect(useConnectionStore.getState().connection).toEqual(makeConnection());
    expect(useConnectionStore.getState().error).toBeNull();
  });

  it('handles cancelled login as disconnected without error', async () => {
    const api = installElectronApiMocks();
    api.xnat.browserLogin.mockResolvedValue({
      success: false,
      error: 'Login cancelled',
    });

    await expect(
      useConnectionStore.getState().browserLogin('https://xnat.example.com'),
    ).resolves.toBe(false);

    expect(useConnectionStore.getState().status).toBe('disconnected');
    expect(useConnectionStore.getState().connection).toBeNull();
    expect(useConnectionStore.getState().error).toBeNull();
  });

  it('stores explicit login failures as error state', async () => {
    const api = installElectronApiMocks();
    api.xnat.browserLogin.mockResolvedValue({
      success: false,
      error: 'Invalid credentials',
    });

    await expect(
      useConnectionStore.getState().browserLogin('https://xnat.example.com'),
    ).resolves.toBe(false);

    expect(useConnectionStore.getState().status).toBe('error');
    expect(useConnectionStore.getState().connection).toBeNull();
    expect(useConnectionStore.getState().error).toBe('Invalid credentials');
  });

  it('maps browser login exceptions into error status', async () => {
    const api = installElectronApiMocks();
    api.xnat.browserLogin.mockRejectedValue(new Error('login transport failed'));

    await expect(
      useConnectionStore.getState().browserLogin('https://xnat.example.com'),
    ).resolves.toBe(false);

    expect(useConnectionStore.getState().status).toBe('error');
    expect(useConnectionStore.getState().connection).toBeNull();
    expect(useConnectionStore.getState().error).toBe('login transport failed');
  });

  it('logout always ends disconnected even if IPC throws', async () => {
    const api = installElectronApiMocks();
    useConnectionStore.setState({
      ...useConnectionStore.getState(),
      status: 'connected',
      connection: makeConnection(),
      error: 'old',
    });
    api.xnat.logout.mockRejectedValue(new Error('network issue'));

    await useConnectionStore.getState().logout();

    expect(useConnectionStore.getState().status).toBe('disconnected');
    expect(useConnectionStore.getState().connection).toBeNull();
    expect(useConnectionStore.getState().error).toBeNull();
  });

  it('checkSession only sets expiration/loss errors when previously connected', async () => {
    const api = installElectronApiMocks();

    api.xnat.validateSession.mockResolvedValue({ valid: false });
    await useConnectionStore.getState().checkSession();
    expect(useConnectionStore.getState().status).toBe('disconnected');
    expect(useConnectionStore.getState().error).toBeNull();

    useConnectionStore.setState({
      ...useConnectionStore.getState(),
      status: 'connected',
      connection: makeConnection(),
    });
    api.xnat.validateSession.mockResolvedValue({ valid: false });
    await useConnectionStore.getState().checkSession();
    expect(useConnectionStore.getState().status).toBe('disconnected');
    expect(useConnectionStore.getState().error).toBe('Session expired');

    useConnectionStore.setState({
      ...useConnectionStore.getState(),
      status: 'connected',
      connection: makeConnection(),
      error: null,
    });
    api.xnat.validateSession.mockRejectedValue(new Error('timeout'));
    await useConnectionStore.getState().checkSession();
    expect(useConnectionStore.getState().status).toBe('disconnected');
    expect(useConnectionStore.getState().error).toBe('Connection lost');
  });

  it('checkSession reconnects when session is valid and current state is not connected', async () => {
    const api = installElectronApiMocks();
    api.xnat.validateSession.mockResolvedValue({
      valid: true,
      connection: makeConnection(),
    });

    await useConnectionStore.getState().checkSession();
    expect(useConnectionStore.getState().status).toBe('connected');
    expect(useConnectionStore.getState().connection).toEqual(makeConnection());
    expect(useConnectionStore.getState().error).toBeNull();
  });

  it('registers session-expired listener and runs startup check when module is imported with electronAPI present', async () => {
    vi.resetModules();
    const api = installElectronApiMocks();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import('./connectionStore');
    const bootStore = mod.useConnectionStore;

    expect(api.on).toHaveBeenCalledWith('xnat:session-expired', expect.any(Function));
    expect(api.xnat.validateSession).toHaveBeenCalledTimes(1);

    bootStore.setState({
      ...bootStore.getState(),
      status: 'connected',
      connection: makeConnection(),
      error: null,
    });

    const expiredHandler = api.on.mock.calls.find((call) => call[0] === 'xnat:session-expired')?.[1] as
      | (() => void)
      | undefined;
    expect(expiredHandler).toBeTypeOf('function');
    expiredHandler?.();

    expect(bootStore.getState().status).toBe('disconnected');
    expect(bootStore.getState().connection).toBeNull();
    expect(bootStore.getState().error).toBe('Session expired');
    warnSpy.mockRestore();
  });
});
