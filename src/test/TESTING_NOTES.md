# Testing Notes

This project uses Vitest with mixed environments:

- Renderer tests (`src/renderer/**/*.test.tsx?`) run in `jsdom`.
- Main/preload tests run in `node`.

## Reusable test harnesses

- Hotkeys: `src/renderer/test/hotkeys/keyboard.ts`, `hotkeyFixtures.ts`
  - Use `dispatchKey(...)` for deterministic key event simulation.
- Overlay: `src/renderer/test/overlay/renderWithStores.tsx`, `overlayAsserts.ts`, `overlayFixtures.ts`
  - Seed store state directly and assert semantic text/testid output.
- IPC: `src/test/ipc/ipcMocks.ts`, `payloadSchemas.ts`
  - Mock `ipcMain`/`ipcRenderer` contracts without launching Electron.
- Cornerstone interface mocks: `src/renderer/test/cornerstone/*`
  - Use fake event targets and narrow mocked exports only for imported APIs.

## App/UI integration patterns

- `src/renderer/App.test.tsx`
  - Viewer-shell behavior with mocked `ViewerPage`/`XnatBrowser`.
  - Drag/drop, unsaved-dialog decisions, resize-collapse, and disconnect cleanup.
- `src/renderer/components/viewer/Toolbar.test.tsx`
  - Tool actions, dropdown lifecycle, MPR branches, and settings modal toggles.
- `src/renderer/components/settings/SettingsModal.test.tsx`
  - Tab-level preference writes and edge paths for incomplete hotkey bindings.

## Main/preload patterns

- `src/preload/index.test.ts`
  - Import-time `contextBridge.exposeInMainWorld` assertion plus channel forwarding.
- `src/main/xnat/sessionManager.test.ts`
  - Browser login lifecycle, keepalive expiry, interceptor setup, auth-failure teardown.
- `src/main/xnat/xnatClient.test.ts`
  - Auth/headers, payload filtering, upload/overwrite routing, and temp-resource APIs.

When adding tests, prefer behavior assertions (outputs/state transitions/IPC payloads) over implementation details.
