import { app, BrowserWindow, Menu, nativeImage, ipcMain, protocol, shell } from 'electron';
import path from 'path';
import { registerAuthHandlers } from './ipc/authHandlers';
import { registerProxyHandlers } from './ipc/proxyHandlers';
import { registerExportHandlers } from './ipc/exportHandlers';
import { registerUploadHandlers } from './ipc/uploadHandlers';
import { registerBackupHandlers } from './ipc/backupHandlers';
import { registerCheckpointHandlers } from './ipc/checkpointHandlers';
import { currentEdition, registerModuleHandlers } from './ipc/moduleHandlers';
import { MODULE_SCHEME_PRIVILEGES, registerModuleRunHandlers } from './modules/moduleRuntime';
import { EXTENSION_SCHEME_PRIVILEGES, registerExtensionHandlers } from './ipc/extensionHandlers';

// Modules' sandboxed windows load from xnat-module://, extensions' renderer parts from
// xnat-extension://. Privileged schemes must be registered before ready, and in ONE call:
// each call replaces the previous registrations.
protocol.registerSchemesAsPrivileged([MODULE_SCHEME_PRIVILEGES, EXTENSION_SCHEME_PRIVILEGES]);
import { registerDiagnosticsHandlers } from './ipc/diagnosticsHandlers';
import { registerUpdateHandlers } from './ipc/updateHandlers';
import { installMainLogCapture } from './diagnostics/mainLogBuffer';
import { IPC } from '../shared/ipcChannels';
import { autoUpdateService } from './updater/autoUpdateService';

installMainLogCapture();

// Suppress EPIPE errors from console.log when stdout/stderr pipe is broken.
// This is common when Electron is launched from a terminal that disconnects.
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});

// ─── App Name ───────────────────────────────────────────────────
// The edition's names (docs/editions.md): its short name ("XNAT" for the open-source edition)
// in the macOS menu bar and dock instead of the default "Electron" — and, set before ready, the
// user-data folder — and its product name in titles and the About panel.
const PRODUCT_NAME = currentEdition()?.productName ?? 'XNAT Workstation';

// Under a test harness, secure storage (safeStorage) uses Chromium's stand-in keychain: tests
// never create or read items in the user's real keychain, and a re-signed test build is never
// stopped by a keychain prompt. Before ready, as a Chromium switch must be.
if (process.env.E2E_TESTING === '1') app.commandLine.appendSwitch('use-mock-keychain');

/**
 * Developer tools in a packaged app: the edition's choice (design point 11) — an edition with
 * licensed extensions turns them off. Development and E2E builds keep them.
 */
const devToolsAllowed = (): boolean => !(app.isPackaged && currentEdition()?.devTools === false);
app.name = currentEdition()?.appName ?? 'XNAT';

let mainWindow: BrowserWindow | null = null;
// App-close guard: set true once the renderer has confirmed it's safe to quit
// (no unsaved annotations, or the user chose to save/discard). See the 'close'
// interceptor + APP_CLOSE_DECISION handler below.
let allowClose = false;

const isDev = !app.isPackaged;
const devServerUrl = (() => {
  const raw = process.env.VITE_DEV_SERVER_URL?.trim();
  if (!raw) return 'http://localhost:5173/';
  return raw.endsWith('/') ? raw : `${raw}/`;
})();

// ─── Icon Paths ─────────────────────────────────────────────────
// The official XNAT icon lives in build/. In dev mode __dirname is
// dist/main/main/, so we resolve relative to the project root.
// In production (packaged), electron-builder copies build/ into resources.

function getIconPath(filename: string): string {
  if (isDev) {
    // dev: dist/main/main/index.js → project root
    return path.join(__dirname, '..', '..', '..', 'build', filename);
  }
  // production: resources/build/
  return path.join(process.resourcesPath, 'build', filename);
}

function loadIcon(filename: string): Electron.NativeImage {
  const p = getIconPath(filename);
  try {
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) return img;
  } catch {
    // file not found — return empty
  }
  return nativeImage.createEmpty();
}

// ─── App Menu ───────────────────────────────────────────────────
// Build a custom application menu that shows "XNAT" instead
// of "Electron" in the macOS menu bar.

function buildAppMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only — shows "XNAT" as the first menu)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const, label: `About ${PRODUCT_NAME}` },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const, label: `Hide ${PRODUCT_NAME}` },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const, label: `Quit ${PRODUCT_NAME}` },
      ],
    }] : []),
    // File menu
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' as const },
          { role: 'delete' as const },
          { role: 'selectAll' as const },
        ] : [
          { role: 'delete' as const },
          { type: 'separator' as const },
          { role: 'selectAll' as const },
        ]),
      ],
    },
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        ...(devToolsAllowed() ? [{ role: 'toggleDevTools' as const }] : []),
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
        ] : [
          { role: 'close' as const },
        ]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow(): void {
  // CSP is set via <meta> tag in production HTML (index.html) to avoid
  // conflicting with session.webRequest.onHeadersReceived used by the
  // XNAT session manager for injecting CORS/CORP headers.
  // In dev mode, Vite's HMR requires inline scripts so CSP is skipped.

  const appIcon = loadIcon('icon.png');

  const isE2E = process.env.E2E_TESTING === '1';

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    // The fully-collapsed toolbar needs 988px (869px of content + the 119px right group),
    // so anything narrower clips items out of the toolbar's hidden overflow with nothing
    // left to collapse. 800 predated several toolbar additions; useToolbarCollapse assumed
    // this floor held and it did not. Re-measure alongside LEVEL_MIN_WIDTHS.
    minWidth: 1000,
    minHeight: 600,
    // E2E: create hidden, then show it OFF-SCREEN without stealing focus.
    // Cornerstone3D needs a *shown* window with real dimensions for WebGL, so we
    // can't leave it hidden — but positioning it far off-screen + showInactive()
    // lets it render without ever appearing on screen or activating the app, so
    // test runs don't interrupt other work.
    show: !isE2E,
    ...(isE2E ? { x: -5000, y: -5000 } : {}),
    title: PRODUCT_NAME,
    icon: appIcon.isEmpty() ? undefined : appIcon,
    backgroundColor: '#09090b',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Allow preload to require() local modules
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      devTools: devToolsAllowed(),
    },
  });

  if (isDev && !isE2E) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools();
  } else {
    // In production / E2E: dist/main/main/index.js -> ../../renderer/index.html
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  }

  // E2E: render the window OFF-SCREEN without stealing focus once the page is
  // ready. showInactive() makes it renderable (so WebGL/canvas work) but does
  // not activate the app; the off-screen position keeps it out of sight so test
  // runs don't interrupt the user.
  if (isE2E) {
    mainWindow.once('ready-to-show', () => {
      mainWindow?.setPosition(-5000, -5000);
      mainWindow?.showInactive();
    });
  }

  // App-close guard: intercept the first quit, ask the renderer about unsaved
  // annotations, and only really close once the renderer replies 'proceed' (via
  // APP_CLOSE_DECISION → allowClose). Bypassed under E2E so the test harness can
  // close the window without a hanging prompt.
  // The window keeps the edition's product name; the page's own <title> is not an edition's.
  mainWindow.on('page-title-updated', (e) => e.preventDefault());
  mainWindow.on('close', (e) => {
    if (allowClose || isE2E) return;
    e.preventDefault();
    mainWindow?.webContents.send(IPC.APP_CLOSE_REQUESTED);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Register IPC handlers before creating the window
  registerAuthHandlers();
  registerProxyHandlers();
  registerExportHandlers();
  registerUploadHandlers();
  registerBackupHandlers();
  registerCheckpointHandlers();
  registerModuleHandlers();
  registerModuleRunHandlers();
  registerExtensionHandlers();
  registerDiagnosticsHandlers();
  registerUpdateHandlers();
  autoUpdateService.initialize();

  // App-close guard: the renderer's decision after the unsaved-annotations prompt.
  // 'proceed' → mark allowClose + actually close; 'cancel' → stay (no-op).
  ipcMain.on(IPC.APP_CLOSE_DECISION, (_event, decision: 'proceed' | 'cancel') => {
    if (decision === 'proceed') {
      allowClose = true;
      mainWindow?.close();
    }
  });

  // Shell: open URL in system browser
  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, async (_event, url: string) => {
    // Only allow http(s) URLs
    if (url.startsWith('http://') || url.startsWith('https://')) {
      await shell.openExternal(url);
      return { ok: true };
    }
    return { ok: false, error: 'invalid_url' };
  });

  // Set the macOS dock icon (dev mode only — packaged app uses Info.plist).
  // In dev mode we can only use PNG; macOS won't apply the rounded-square
  // treatment but the icon is still correct. Production uses .icns from
  // the app bundle which gets full macOS styling automatically.
  // In E2E mode, hide the dock icon so the app doesn't appear in cmd-tab.
  if (process.platform === 'darwin' && app.dock) {
    if (process.env.E2E_TESTING === '1') {
      app.dock.hide();
    } else {
      const dockIcon = loadIcon('icon.png');
      if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
    }
  }

  // Configure macOS About panel metadata.
  // Note: iconPath is linux/win32 only — macOS About panel inherits
  // the dock icon automatically, so no icon property is needed here.
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: PRODUCT_NAME,
    });
  }

  // Set up the application menu (replaces "Electron" with "XNAT")
  buildAppMenu();

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  autoUpdateService.dispose();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
