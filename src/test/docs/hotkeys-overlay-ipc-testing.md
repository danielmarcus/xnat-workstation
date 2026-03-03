# Hotkeys, Overlay, and IPC Test Harness

## Hotkeys
- Use `src/renderer/test/hotkeys/keyboard.ts` to dispatch deterministic keyboard events.
- Use `makeInputTarget` / `makeDivTarget` to validate ignore-rules for form controls and content-editable nodes.
- Keep map setup explicit in each test via `hotkeyService.setHotkeyMap(...)`, and always `uninstall()` in cleanup.

## Overlay
- Use `src/renderer/test/overlay/renderWithStores.tsx` to seed `viewer`, `metadata`, `preferences`, and legacy overlay visibility in one call.
- Use `overlayFixtures.ts` for stable panel IDs and metadata values.
- Use `overlayAsserts.ts` helpers for visibility/content checks to avoid brittle DOM details.

## IPC
- Use `src/test/ipc/ipcMocks.ts`:
  - `createIpcMainMock()` for handler registration + invocation in node tests.
  - `createWindowElectronApiMock()` / `installWindowElectronApiMock()` for renderer bridge tests.
- Add new contract entries in `src/shared/ipc/channels.ts` and bind wrapper signatures to those request/response types.
- Prefer table-driven assertions for channel registration and payload pass-through to catch drift quickly.
