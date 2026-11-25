/**
 * xnat-workstation:// links (docs/open-from-link.md): the main process registers the scheme,
 * receives links from the OS, validates them and holds the latest one until the renderer takes
 * it. Nothing in a link is run, fetched or logged here; the renderer gets only the parsed fields.
 */
import { app, ipcMain, type BrowserWindow } from 'electron';
import path from 'path';
import { IPC } from '../shared/ipcChannels';
import { OPEN_LINK_SCHEME, findOpenLinkArg, parseOpenLink, type OpenLinkRequest } from '../shared/openLink';

export interface OpenLinkWindowHost {
  getWindow(): BrowserWindow | null;
  createWindow(): void;
}

let host: OpenLinkWindowHost | null = null;
let pending: OpenLinkRequest | null = null;

/**
 * Take the single-instance lock and start listening for links. Call before `ready`: macOS
 * delivers the link that launched the app before it. False when another instance holds the
 * lock; it has been handed this one's arguments, and this one should quit.
 */
export function initOpenLinks(windowHost: OpenLinkWindowHost): boolean {
  if (!app.requestSingleInstanceLock()) return false;
  host = windowHost;

  if (process.env.E2E_TESTING !== '1') registerProtocolClient();

  app.on('open-url', (event, url) => {
    event.preventDefault();
    receiveOpenLink(url);
  });
  app.on('second-instance', (_event, argv) => {
    const url = findOpenLinkArg(argv);
    if (url) receiveOpenLink(url);
    else focusWindow();
  });

  const launchLink = findOpenLinkArg(process.argv);
  if (launchLink) receiveOpenLink(launchLink);

  ipcMain.handle(IPC.OPEN_LINK_TAKE, () => {
    const request = pending;
    pending = null;
    return request;
  });
  return true;
}

export function receiveOpenLink(url: string): void {
  const parsed = parseOpenLink(url);
  if (!parsed.ok) {
    console.warn(`[openLink] Ignored a link: ${parsed.reason}`);
    return;
  }
  pending = parsed.request;
  if (!app.isReady()) return;
  if (focusWindow()) host?.getWindow()?.webContents.send(IPC.OPEN_LINK_RECEIVED);
}

/** False when there was no window, and one was created (its renderer takes the link once loaded). */
function focusWindow(): boolean {
  if (!host || !app.isReady()) return false;
  const win = host.getWindow();
  if (!win) {
    host.createWindow();
    return false;
  }
  // Under E2E the window stays off-screen and never takes focus (index.ts).
  if (process.env.E2E_TESTING !== '1') {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  return true;
}

function registerProtocolClient(): void {
  // Under `electron .` the executable is Electron itself, so the app's path goes with it.
  const registered = process.defaultApp && process.argv.length >= 2
    ? app.setAsDefaultProtocolClient(OPEN_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])])
    : app.setAsDefaultProtocolClient(OPEN_LINK_SCHEME);
  if (!registered) console.warn(`[openLink] Could not register as the ${OPEN_LINK_SCHEME}:// handler`);
}
