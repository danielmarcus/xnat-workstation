/**
 * IPC handlers for local DICOM fixture reads (E2E only).
 *
 * Reads raw DICOM bytes from disk and returns them to the renderer as a
 * Buffer. Reads are restricted to a configured fixture-root directory; any
 * absolute path that doesn't resolve under the root is rejected. The handler
 * is registered only when `E2E_TESTING=1`, so production builds do not
 * expose this surface.
 *
 * The renderer uses these bytes to register Cornerstone wadouri Blobs via
 * `wadouri.fileManager.add(...)`, providing a `dicomfile:N` image ID that
 * the existing viewport pipeline can mount without any XNAT round-trip.
 */
import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IPC } from '../../shared/ipcChannels';

function defaultFixtureRoot(): string {
  // Default to the repo's e2e/fixtures/dicom/ directory. Tests can override
  // via XNAT_E2E_FIXTURE_ROOT, matching the helper in
  // e2e/helpers/local-dicom-fixtures.ts.
  return process.env.XNAT_E2E_FIXTURE_ROOT
    ?? path.resolve(__dirname, '..', '..', '..', '..', 'e2e', 'fixtures', 'dicom');
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function registerLocalE2eHandlers(): void {
  const fixtureRoot = path.resolve(defaultFixtureRoot());

  ipcMain.handle(
    IPC.LOCAL_E2E_READ_DICOM_FILE,
    async (_event: Electron.IpcMainInvokeEvent, absPath: string) => {
      try {
        if (typeof absPath !== 'string' || absPath.length === 0) {
          return { ok: false, error: 'absPath must be a non-empty string' };
        }
        const resolved = path.resolve(absPath);
        if (!isInside(fixtureRoot, resolved)) {
          return {
            ok: false,
            error: `path outside fixture root (${fixtureRoot}): ${resolved}`,
          };
        }
        const buffer = await fs.readFile(resolved);
        // Convert to a transferable ArrayBuffer slice so Electron's
        // structured-clone serializer hands it to the renderer cleanly.
        const slice = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        );
        return { ok: true, data: slice, sizeBytes: buffer.length };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  );

  console.log(
    `[localE2eHandlers] registered ${IPC.LOCAL_E2E_READ_DICOM_FILE} (fixture root: ${fixtureRoot})`,
  );
}
