import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import path from 'path';
import { registerAuthHandlers } from './ipc/authHandlers';
import { registerProxyHandlers } from './ipc/proxyHandlers';
import { registerExportHandlers } from './ipc/exportHandlers';
import { registerUploadHandlers } from './ipc/uploadHandlers';

// Suppress EPIPE errors from console.log when stdout/stderr pipe is broken.
// This is common when Electron is launched from a terminal that disconnects.
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});

// ─── App Name ───────────────────────────────────────────────────
// Set the app name to "XNAT Viewer" so macOS shows it in the menu
// bar and dock instead of the default "Electron".
app.name = 'XNAT Viewer';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const isDev = !app.isPackaged;

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

function createTrayIcon(): Electron.NativeImage {
  if (process.platform === 'darwin') {
    // macOS: Use iconTemplate.png (22×22 @1x) with iconTemplate@2x.png (44×44)
    // for Retina. The "Template" suffix tells Electron/macOS to treat this as a
    // template image — only alpha is used; the system tints it for light/dark mode.
    // Electron auto-loads the @2x variant when it exists alongside the @1x file.
    const p = getIconPath('iconTemplate.png');
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) return img;
    // Fallback: return the full color icon
  }
  // Windows/Linux: use the full color icon for the tray
  return loadIcon('icon.png');
}

// ─── App Menu ───────────────────────────────────────────────────
// Build a custom application menu that shows "XNAT Viewer" instead
// of "Electron" in the macOS menu bar.

function buildAppMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only — shows "XNAT Viewer" as the first menu)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
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

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'XNAT Viewer',
    icon: appIcon.isEmpty() ? undefined : appIcon,
    backgroundColor: '#09090b',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Allow preload to require() local modules
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173/');
    mainWindow.webContents.openDevTools();
  } else {
    // In production: dist/main/main/index.js -> ../../renderer/index.html
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(): void {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('XNAT Viewer');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show XNAT Viewer',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(contextMenu);

  // Click on tray icon shows the window (macOS/Linux behavior)
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  // Register IPC handlers before creating the window
  registerAuthHandlers();
  registerProxyHandlers();
  registerExportHandlers();
  registerUploadHandlers();

  // Set the macOS dock icon (dev mode only — packaged app uses Info.plist)
  if (process.platform === 'darwin' && app.dock) {
    const dockIcon = loadIcon('icon.png');
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

  // Set up the application menu (replaces "Electron" with "XNAT Viewer")
  buildAppMenu();

  createWindow();
  createTray();
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
