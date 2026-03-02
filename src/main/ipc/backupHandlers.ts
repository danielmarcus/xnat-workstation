/**
 * IPC handlers for local backup cache operations.
 *
 * Manages a per-session backup directory under Electron's userData path:
 *   <userData>/backups/<sessionId>/manifest.json
 *   <userData>/backups/<sessionId>/<segId>_<timestamp>.dcm
 *
 * All file I/O is async via fs/promises.
 */
import { ipcMain, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IPC } from '../../shared/ipcChannels';
import type { BackupManifest, BackupSessionSummary } from '../../shared/types/backup';

let backupRoot: string | null = null;

function getBackupRoot(): string {
  if (!backupRoot) {
    backupRoot = path.join(app.getPath('userData'), 'backups');
  }
  return backupRoot;
}

function sessionDir(sessionId: string): string {
  // Sanitize sessionId to prevent path traversal
  const safe = sessionId.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  return path.join(getBackupRoot(), safe);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function registerBackupHandlers(): void {
  // ─── Write a backup file ─────────────────────────────────────
  ipcMain.handle(
    IPC.BACKUP_WRITE_FILE,
    async (
      _event: Electron.IpcMainInvokeEvent,
      sessionId: string,
      filename: string,
      base64Data: string,
    ) => {
      try {
        const dir = sessionDir(sessionId);
        await ensureDir(dir);
        const filePath = path.join(dir, filename);
        const buffer = Buffer.from(base64Data, 'base64');
        await fs.writeFile(filePath, buffer);
        return { ok: true, path: filePath, sizeBytes: buffer.length };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[backupHandlers] writeFile error:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Read a backup file ──────────────────────────────────────
  ipcMain.handle(
    IPC.BACKUP_READ_FILE,
    async (
      _event: Electron.IpcMainInvokeEvent,
      sessionId: string,
      filename: string,
    ) => {
      try {
        const filePath = path.join(sessionDir(sessionId), filename);
        const buffer = await fs.readFile(filePath);
        return { ok: true, data: buffer.toString('base64') };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[backupHandlers] readFile error:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Delete a backup file ────────────────────────────────────
  ipcMain.handle(
    IPC.BACKUP_DELETE_FILE,
    async (
      _event: Electron.IpcMainInvokeEvent,
      sessionId: string,
      filename: string,
    ) => {
      try {
        const filePath = path.join(sessionDir(sessionId), filename);
        await fs.unlink(filePath).catch(() => {}); // ignore if already gone
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[backupHandlers] deleteFile error:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── List files in a session's backup directory ──────────────
  ipcMain.handle(
    IPC.BACKUP_LIST_SESSION,
    async (
      _event: Electron.IpcMainInvokeEvent,
      sessionId: string,
    ) => {
      try {
        const dir = sessionDir(sessionId);
        let fileNames: string[];
        try {
          fileNames = await fs.readdir(dir);
        } catch {
          return { ok: true, files: [] }; // directory doesn't exist yet
        }
        const files: Array<{ name: string; sizeBytes: number; modifiedAt: string }> = [];
        for (const name of fileNames) {
          if (!name.endsWith('.dcm')) continue;
          try {
            const stat = await fs.stat(path.join(dir, name));
            if (!stat.isFile()) continue;
            files.push({
              name,
              sizeBytes: stat.size,
              modifiedAt: stat.mtime.toISOString(),
            });
          } catch { /* skip */ }
        }
        return { ok: true, files };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[backupHandlers] listSession error:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Read manifest.json ──────────────────────────────────────
  ipcMain.handle(
    IPC.BACKUP_READ_MANIFEST,
    async (
      _event: Electron.IpcMainInvokeEvent,
      sessionId: string,
    ) => {
      try {
        const manifestPath = path.join(sessionDir(sessionId), 'manifest.json');
        const raw = await fs.readFile(manifestPath, 'utf-8');
        const manifest: BackupManifest = JSON.parse(raw);
        return { ok: true, manifest };
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          return { ok: false, error: 'not_found' };
        }
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[backupHandlers] readManifest error:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Write manifest.json (atomic: write to .tmp then rename) ─
  ipcMain.handle(
    IPC.BACKUP_WRITE_MANIFEST,
    async (
      _event: Electron.IpcMainInvokeEvent,
      sessionId: string,
      manifestJson: string,
    ) => {
      try {
        const dir = sessionDir(sessionId);
        await ensureDir(dir);
        const manifestPath = path.join(dir, 'manifest.json');
        const tmpPath = manifestPath + '.tmp';
        await fs.writeFile(tmpPath, manifestJson, 'utf-8');
        await fs.rename(tmpPath, manifestPath);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[backupHandlers] writeManifest error:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Delete entire session backup directory ──────────────────
  ipcMain.handle(
    IPC.BACKUP_DELETE_SESSION,
    async (
      _event: Electron.IpcMainInvokeEvent,
      sessionId: string,
    ) => {
      try {
        const dir = sessionDir(sessionId);
        await fs.rm(dir, { recursive: true, force: true });
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[backupHandlers] deleteSession error:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── List all session backup directories with summaries ──────
  ipcMain.handle(
    IPC.BACKUP_LIST_ALL_SESSIONS,
    async () => {
      try {
        const root = getBackupRoot();
        let dirNames: string[];
        try {
          dirNames = await fs.readdir(root);
        } catch {
          return { ok: true, sessions: [] }; // root doesn't exist yet
        }

        const sessions: BackupSessionSummary[] = [];
        for (const dirName of dirNames) {
          const manifestPath = path.join(root, dirName, 'manifest.json');
          try {
            const raw = await fs.readFile(manifestPath, 'utf-8');
            const manifest: BackupManifest = JSON.parse(raw);
            const totalSize = manifest.entries.reduce((sum, e) => sum + e.sizeBytes, 0);
            sessions.push({
              sessionId: manifest.sessionId,
              serverUrl: manifest.serverUrl,
              entryCount: manifest.entries.length,
              totalSizeBytes: totalSize,
              lastUpdated: manifest.lastUpdated,
              projectId: manifest.projectId ?? '',
              subjectId: manifest.subjectId ?? '',
              subjectLabel: manifest.subjectLabel ?? '',
              sessionLabel: manifest.sessionLabel ?? manifest.sessionId,
            });
          } catch {
            // No manifest or invalid — skip
          }
        }

        return { ok: true, sessions };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[backupHandlers] listAllSessions error:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Get the backup cache root path ──────────────────────────
  ipcMain.handle(
    IPC.BACKUP_GET_CACHE_PATH,
    async () => {
      return { ok: true, path: getBackupRoot() };
    },
  );
}
