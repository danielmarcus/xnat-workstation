import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC } from '../../shared/ipcChannels';
import type {
  CrashSnapshotPayload,
  CrashSnapshotSummary,
  MainDiagnosticsSnapshot,
} from '../../shared/types/diagnostics';
import { deidentifyText } from '../../shared/diagnostics/deidentify';
import { getMainLogSnapshot } from '../diagnostics/mainLogBuffer';

/** Directory where crash snapshots are persisted (spec §13.8). */
function crashSnapshotDir(): string {
  return path.join(app.getPath('userData'), 'diagnostics');
}

/**
 * Crash snapshot ids are filenames we mint ourselves (ISO timestamp with
 * filesystem-safe separators). Reject anything else so the read/delete
 * handlers can't be used for path traversal.
 */
function isSafeSnapshotId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9._-]+\.json$/.test(id) && !id.includes('..');
}

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

  // ── Crash snapshots (MV-Phase 7.1, spec §13.8) ────────────────────────

  ipcMain.handle(IPC.DIAGNOSTICS_WRITE_CRASH_SNAPSHOT, async (_evt, payload: CrashSnapshotPayload) => {
    try {
      if (!payload || typeof payload.message !== 'string' || typeof payload.capturedAt !== 'string') {
        return { ok: false, error: 'Invalid crash snapshot payload' } as const;
      }
      const dir = crashSnapshotDir();
      await fs.mkdir(dir, { recursive: true });
      // Filesystem-safe ISO timestamp: 2026-06-02T18:30:12.345Z → 2026-06-02T18-30-12-345Z
      const id = `${payload.capturedAt.replace(/[:.]/g, '-')}.json`;
      const filePath = path.join(dir, id);
      const enriched: CrashSnapshotPayload = {
        ...payload,
        appVersion: payload.appVersion ?? app.getVersion(),
      };
      // Atomic-ish write (same .tmp → rename pattern as backupHandlers).
      const tmpPath = `${filePath}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(enriched, null, 2), 'utf8');
      await fs.rename(tmpPath, filePath);
      return { ok: true, id } as const;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) } as const;
    }
  });

  ipcMain.handle(IPC.DIAGNOSTICS_LIST_CRASH_SNAPSHOTS, async () => {
    try {
      const dir = crashSnapshotDir();
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        return { ok: true, snapshots: [] } as const; // dir doesn't exist yet
      }
      const snapshots: CrashSnapshotSummary[] = [];
      for (const name of names) {
        if (!name.endsWith('.json') || !isSafeSnapshotId(name)) continue;
        try {
          const raw = await fs.readFile(path.join(dir, name), 'utf8');
          const parsed = JSON.parse(raw) as CrashSnapshotPayload;
          snapshots.push({
            id: name,
            capturedAt: parsed.capturedAt ?? 'unknown',
            reason: parsed.reason ?? 'uncaught-error',
            message: parsed.message ?? '(no message)',
          });
        } catch {
          // Corrupt snapshot — skip rather than fail the whole list.
        }
      }
      snapshots.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
      return { ok: true, snapshots } as const;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) } as const;
    }
  });

  ipcMain.handle(IPC.DIAGNOSTICS_READ_CRASH_SNAPSHOT, async (_evt, id: unknown) => {
    try {
      if (!isSafeSnapshotId(id)) return { ok: false, error: 'Invalid snapshot id' } as const;
      const raw = await fs.readFile(path.join(crashSnapshotDir(), id), 'utf8');
      return { ok: true, snapshot: JSON.parse(raw) as CrashSnapshotPayload } as const;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) } as const;
    }
  });

  ipcMain.handle(IPC.DIAGNOSTICS_DELETE_CRASH_SNAPSHOT, async (_evt, id: unknown) => {
    try {
      if (!isSafeSnapshotId(id)) return { ok: false, error: 'Invalid snapshot id' } as const;
      await fs.unlink(path.join(crashSnapshotDir(), id));
      return { ok: true } as const;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) } as const;
    }
  });
}
