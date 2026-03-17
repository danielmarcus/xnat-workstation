import os from 'os';
import crypto from 'crypto';
import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC } from '../../shared/ipcChannels';
import type { MainDiagnosticsSnapshot } from '../../shared/types/diagnostics';
import { deidentifyText } from '../../shared/diagnostics/deidentify';
import { getMainLogSnapshot } from '../diagnostics/mainLogBuffer';

function mb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function hostFingerprint(hostname: string): string {
  if (!hostname) return 'unknown';
  return crypto.createHash('sha256').update(hostname).digest('hex').slice(0, 12);
}

export function registerDiagnosticsHandlers(): void {
  ipcMain.handle(IPC.DIAGNOSTICS_GET_MAIN_SNAPSHOT, async () => {
    try {
      const memory = process.memoryUsage();
      const cpus = os.cpus();
      const logs = getMainLogSnapshot(220);

      const snapshot: MainDiagnosticsSnapshot = {
        generatedAt: new Date().toISOString(),
        app: {
          name: app.getName(),
          version: app.getVersion(),
          isPackaged: app.isPackaged,
          pid: process.pid,
          uptimeSec: Math.round(process.uptime()),
          windowCount: BrowserWindow.getAllWindows().length,
        },
        runtime: {
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
          v8: process.versions.v8,
          platform: process.platform,
          arch: process.arch,
        },
        system: {
          osType: os.type(),
          osRelease: os.release(),
          osVersion: os.version(),
          cpuModel: deidentifyText(cpus[0]?.model || 'unknown'),
          cpuCount: cpus.length,
          totalMemoryMB: mb(os.totalmem()),
          freeMemoryMB: mb(os.freemem()),
          loadAverage: os.loadavg().map((v) => Math.round(v * 100) / 100),
          hostnameFingerprint: hostFingerprint(os.hostname()),
        },
        process: {
          rssMB: mb(memory.rss),
          heapUsedMB: mb(memory.heapUsed),
          heapTotalMB: mb(memory.heapTotal),
          externalMB: mb(memory.external),
          argv: process.argv.map((arg) => deidentifyText(arg)),
        },
        logs,
      };

      return { ok: true, snapshot } as const;
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } as const;
    }
  });
}
