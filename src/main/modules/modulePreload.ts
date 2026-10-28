/**
 * Preload of a module's sandboxed window (branch 9, M3). Its only job: hand the page the message
 * port the main process sends. It exposes nothing — no API, no IPC — to the module.
 */
import { ipcRenderer } from 'electron';

ipcRenderer.on('xw-port', (e) => {
  window.postMessage('xw-port', '*', e.ports);
});
