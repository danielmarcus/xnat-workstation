import { app, BrowserWindow, Menu, nativeImage, ipcMain, shell } from 'electron';
import path from 'path';
import { registerAuthHandlers } from './ipc/authHandlers';
import { registerProxyHandlers } from './ipc/proxyHandlers';
import { registerExportHandlers } from './ipc/exportHandlers';
import { registerUploadHandlers } from './ipc/uploadHandlers';
import { registerBackupHandlers } from './ipc/backupHandlers';
import { registerDiagnosticsHandlers } from './ipc/diagnosticsHandlers';
import { installMainLogCapture } from './diagnostics/mainLogBuffer';
import { IPC } from '../shared/ipcChannels';

installMainLogCapture();

// Suppress EPIPE errors from console.log when stdout/stderr pipe is broken.
// This is common when Electron is launched from a terminal that disconnects.
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});

// ─── App Name ───────────────────────────────────────────────────
// Set the app name to "XNAT" so macOS shows it in the menu
// bar and dock instead of the default "Electron".
app.name = 'XNAT';

let mainWindow: BrowserWindow | null = null;

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
        { role: 'about' as const, label: 'About XNAT Workstation' },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const, label: 'Hide XNAT Workstation' },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const, label: 'Quit XNAT Workstation' },
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
        { role: 'toggleDevTools' as const },
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
    minWidth: 800,
    minHeight: 600,
    // E2E: create hidden, then showInactive() to avoid stealing focus.
    // Cornerstone3D needs a visible window with real dimensions for WebGL,
    // so we can't leave it hidden — but showInactive() avoids activation.
    show: !isE2E,
    title: 'XNAT Workstation',
    icon: appIcon.isEmpty() ? undefined : appIcon,
    backgroundColor: '#09090b',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Allow preload to require() local modules
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
    },
  });

  if (isDev && !isE2E) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools();
  } else {
    // In production / E2E: dist/main/main/index.js -> ../../renderer/index.html
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  }

  // E2E: show the window without stealing focus once the page is ready.
  // showInactive() makes the window visible (so WebGL/canvas work) but
  // does not activate the app or bring it to front.
  if (isE2E) {
    mainWindow.once('ready-to-show', () => {
      mainWindow?.showInactive();
    });
  }

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
  registerDiagnosticsHandlers();

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
      applicationName: 'XNAT Workstation',
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

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
