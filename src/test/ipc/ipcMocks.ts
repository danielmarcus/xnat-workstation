import { vi } from 'vitest';

type IpcHandler = (event: unknown, ...args: any[]) => any;
type RendererListener = (event: unknown, ...args: any[]) => void;

export function createIpcMainMock() {
  const handlers = new Map<string, IpcHandler>();
  const listeners = new Map<string, Set<RendererListener>>();

  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, listener: RendererListener) => {
      if (!listeners.has(channel)) {
        listeners.set(channel, new Set());
      }
      listeners.get(channel)?.add(listener);
    }),
  };

  return {
    ipcMain,
    handlers,
    listeners,
    async invoke(channel: string, ...args: any[]) {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`No ipcMain handler registered for channel: ${channel}`);
      }
      return handler({}, ...args);
    },
    async invokeWithErrorCapture(channel: string, ...args: any[]) {
      try {
        return { ok: true as const, value: await this.invoke(channel, ...args) };
      } catch (error) {
        return { ok: false as const, error };
      }
    },
  };
}

export function createIpcRendererMock() {
  const listeners = new Map<string, Set<RendererListener>>();
  const invokeHandlers = new Map<string, (...args: any[]) => any>();

  const ipcRenderer = {
    invoke: vi.fn(async (channel: string, ...args: any[]) => {
      const invokeHandler = invokeHandlers.get(channel);
      if (!invokeHandler) {
        throw new Error(`No ipcRenderer invoke handler registered for channel: ${channel}`);
      }
      return invokeHandler(...args);
    }),
    send: vi.fn(),
    on: vi.fn((channel: string, listener: RendererListener) => {
      if (!listeners.has(channel)) {
        listeners.set(channel, new Set());
      }
      listeners.get(channel)?.add(listener);
    }),
    removeListener: vi.fn((channel: string, listener: RendererListener) => {
      listeners.get(channel)?.delete(listener);
    }),
  };

  return {
    ipcRenderer,
    listeners,
    invokeHandlers,
    registerInvoke(channel: string, handler: (...args: any[]) => any) {
      invokeHandlers.set(channel, handler);
    },
    emit(channel: string, ...args: any[]) {
      for (const listener of listeners.get(channel) ?? []) {
        listener({}, ...args);
      }
    },
  };
}

export function createWindowElectronApiMock() {
  return {
    platform: 'darwin',
    xnat: {
      browserLogin: vi.fn(),
      logout: vi.fn(),
      validateSession: vi.fn(),
      getConnection: vi.fn(),
      dicomwebFetch: vi.fn(),
      getProjects: vi.fn(),
      getSubjects: vi.fn(),
      getSessions: vi.fn(),
      getScans: vi.fn(),
      getScanFiles: vi.fn(),
      getProjectSessions: vi.fn(),
      downloadScanFile: vi.fn(),
      uploadDicomSeg: vi.fn(),
      uploadDicomRtStruct: vi.fn(),
      overwriteDicomSeg: vi.fn(),
      overwriteDicomRtStruct: vi.fn(),
      prepareDicomForUpload: vi.fn(),
      autoSaveTemp: vi.fn(),
      listTempFiles: vi.fn(),
      deleteTempFile: vi.fn(),
      downloadTempFile: vi.fn(),
    },
    export: {
      saveScreenshot: vi.fn(),
      copyToClipboard: vi.fn(),
      copyViewportCapture: vi.fn(),
      saveDicom: vi.fn(),
      saveAllSlices: vi.fn(),
      saveReport: vi.fn(),
      saveDicomSeg: vi.fn(),
      saveDicomRtStruct: vi.fn(),
      saveViewportCapture: vi.fn(),
    },
    updater: {
      getState: vi.fn(),
      configure: vi.fn(),
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn(),
      onStatus: vi.fn(),
    },
    on: vi.fn(),
  };
}

export function installWindowElectronApiMock(
  api = createWindowElectronApiMock(),
): typeof api {
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'electronAPI', {
      value: api,
      configurable: true,
      writable: true,
    });
  }
  return api;
}
