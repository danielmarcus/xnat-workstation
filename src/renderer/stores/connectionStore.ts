/**
 * Connection Store — Zustand store for XNAT connection state.
 *
 * Mirrors the service-layer pattern from viewerStore: actions delegate
 * to the IPC bridge (window.electronAPI.xnat), store holds reactive state.
 *
 * Also listens for session-expired events from the main process.
 */
import { create } from 'zustand';
import type {
  ConnectionStatus,
  XnatConnectionInfo,
  XnatLoginCredentials,
} from '@shared/types/xnat';

interface ConnectionStore {
  // ─── State ──────────────────────────────────────────────────
  status: ConnectionStatus;
  connection: XnatConnectionInfo | null;
  error: string | null;

  // ─── Actions ────────────────────────────────────────────────
  login: (creds: XnatLoginCredentials) => Promise<boolean>;
  browserLogin: (serverUrl: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;

  // ─── Internal (called by event listener) ────────────────────
  _setExpired: () => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  status: 'disconnected',
  connection: null,
  error: null,

  login: async (creds) => {
    set({ status: 'connecting', error: null });

    try {
      const result = await window.electronAPI.xnat.login(creds);

      if (result.success && result.connection) {
        set({
          status: 'connected',
          connection: result.connection,
          error: null,
        });
        return true;
      } else {
        set({
          status: 'error',
          error: result.error || 'Login failed',
          connection: null,
        });
        return false;
      }
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        connection: null,
      });
      return false;
    }
  },

  browserLogin: async (serverUrl) => {
    set({ status: 'connecting', error: null });

    try {
      const result = await window.electronAPI.xnat.browserLogin(serverUrl);

      if (result.success && result.connection) {
        set({
          status: 'connected',
          connection: result.connection,
          error: null,
        });
        return true;
      } else {
        set({
          status: result.error === 'Login cancelled' ? 'disconnected' : 'error',
          error: result.error === 'Login cancelled' ? null : (result.error || 'Login failed'),
          connection: null,
        });
        return false;
      }
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        connection: null,
      });
      return false;
    }
  },

  logout: async () => {
    try {
      await window.electronAPI.xnat.logout();
    } catch {
      // Best-effort
    }
    set({ status: 'disconnected', connection: null, error: null });
  },

  checkSession: async () => {
    try {
      const result = await window.electronAPI.xnat.validateSession();
      if (result.valid) {
        // Session is active — if we weren't already connected, update state.
        // This handles auto-reconnection by the main process session manager.
        const current = useConnectionStore.getState();
        if (current.status !== 'connected') {
          set({
            status: 'connected',
            connection: result.connection ?? current.connection,
            error: null,
          });
        }
      } else {
        // Only show "Session expired" if we were previously connected.
        // On first launch with no session, just stay disconnected without an error.
        const current = useConnectionStore.getState();
        if (current.status === 'connected' || current.connection !== null) {
          set({ status: 'disconnected', connection: null, error: 'Session expired' });
        }
        // else: first launch, no previous session — stay at initial state (no error)
      }
    } catch {
      // Only show "Connection lost" if we had an active connection
      const current = useConnectionStore.getState();
      if (current.status === 'connected' || current.connection !== null) {
        set({ status: 'disconnected', connection: null, error: 'Connection lost' });
      }
    }
  },

  _setExpired: () => {
    set({ status: 'disconnected', connection: null, error: 'Session expired' });
  },
}));

// ─── Session Expiry Listener ─────────────────────────────────────
// Register once when this module is imported. The main process sends
// 'xnat:session-expired' when keepalive detects the session is gone.
if (typeof window !== 'undefined' && window.electronAPI) {
  window.electronAPI.on('xnat:session-expired', () => {
    console.warn('[connectionStore] Session expired (notified by main process)');
    useConnectionStore.getState()._setExpired();
  });

  // ─── Auto-detect existing session on startup ─────────────────
  // The main process session manager may have auto-reconnected using
  // saved credentials. Check immediately so the renderer reflects the
  // actual connection state without requiring the user to log in again.
  useConnectionStore.getState().checkSession();
}
