/**
 * E2E fixture bridge — loads local DICOM files into a panel.
 *
 * Used by the `__XNAT_E2E__.loadLocalDicomFiles(panelId, paths)` hook to
 * mount fixture DICOMs into a viewport without going through the XNAT
 * browser flow. The bridge:
 *
 *   1. IPC-fetches each file's bytes from the main process (the renderer
 *      is context-isolated and cannot read disk directly).
 *   2. Wraps each buffer in a `File` and registers it with Cornerstone's
 *      wadouri fileManager, returning a `dicomfile:N` image ID.
 *   3. Sorts the image IDs by DICOM metadata (instance number / position).
 *   4. Calls a panel-image-ids setter that App.tsx registers at mount.
 *
 * Production builds (`E2E_TESTING != 1`) leave `electronAPI.localE2e`
 * undefined; calls through this bridge will reject with a clear error.
 */
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { imageLoader } from '@cornerstonejs/core';
import { dicomwebLoader } from '../cornerstone/dicomwebLoader';
import { useViewerStore } from '../../stores/viewerStore';

type SetPanelImageIdsUpdater = (
  prev: Record<string, string[]>,
) => Record<string, string[]>;

type SetPanelImageIdsFn = (updater: SetPanelImageIdsUpdater) => void;

let registeredSetter: SetPanelImageIdsFn | null = null;

export function registerSetPanelImageIds(fn: SetPanelImageIdsFn): void {
  registeredSetter = fn;
}

export function unregisterSetPanelImageIds(): void {
  registeredSetter = null;
}

async function readDicomBytes(absPath: string): Promise<ArrayBuffer> {
  const api = window.electronAPI?.localE2e;
  if (!api?.readDicomFile) {
    throw new Error(
      'electronAPI.localE2e.readDicomFile is not available — main process must be launched with E2E_TESTING=1',
    );
  }
  const result = await api.readDicomFile(absPath);
  if (!result.ok || !result.data) {
    throw new Error(`Failed to read ${absPath}: ${result.error ?? 'unknown error'}`);
  }
  return result.data;
}

function basenameOf(absPath: string): string {
  const idx = Math.max(absPath.lastIndexOf('/'), absPath.lastIndexOf('\\'));
  return idx >= 0 ? absPath.slice(idx + 1) : absPath;
}

/**
 * Synthesize a stable scanId for the given path set. VolumeViewport.tsx
 * gates on `scanId` being present; the volume cache keys on
 * `(scanId, frameOfReferenceUID)`. Derive the id from the path set so
 * (a) two distinct series from the same fixture directory get distinct
 * scanIds (different files → different hash) and (b) re-loading the
 * same paths produces the same scanId (volume cache hit).
 */
function syntheticScanId(paths: readonly string[]): string {
  if (paths.length === 0) return 'fixture';
  const sorted = [...paths].sort();
  let h = 5381;
  const joined = sorted.join('|');
  for (let i = 0; i < joined.length; i++) {
    h = ((h << 5) + h + joined.charCodeAt(i)) >>> 0;
  }
  return `fixture:${h.toString(16)}`;
}

export interface LoadLocalDicomFilesResult {
  panelId: string;
  imageIds: string[];
  sourcePaths: string[];
}

/**
 * Mount the given fixture files into a panel, replacing whatever was there.
 * Returns the resolved image IDs so the spec can assert on them. The setter
 * registered by App.tsx is invoked synchronously, so the React lifecycle
 * picks up the new IDs on the next render.
 */
export async function loadLocalDicomFiles(
  panelId: string,
  paths: readonly string[],
): Promise<LoadLocalDicomFilesResult> {
  if (!registeredSetter) {
    throw new Error(
      'loadLocalDicomFiles: setPanelImageIds setter not registered — App.tsx must have mounted',
    );
  }
  if (paths.length === 0) {
    throw new Error('loadLocalDicomFiles: paths array is empty');
  }

  const buffers = await Promise.all(paths.map(readDicomBytes));
  let imageIds = buffers.map((buffer, index) => {
    const blob = new Blob([buffer], { type: 'application/dicom' });
    const file = new File([blob], basenameOf(paths[index]), {
      type: 'application/dicom',
    });
    return wadouri.fileManager.add(file);
  });

  // Pre-load every image through the standard image-loader path. For
  // `dicomfile:N` IDs the file manager has the bytes in memory, so this
  // doesn't fetch — it just decodes and populates Cornerstone's metadata
  // providers (image plane module, etc.) so volume creation has the
  // imagePositionPatient / imageOrientationPatient it needs for every
  // slice. The XNAT browser flow gets this for free via QIDO-RS pre-fetch;
  // local-file flows have to drive it themselves.
  await Promise.all(
    imageIds.map((id) =>
      imageLoader.loadAndCacheImage(id).catch((err: unknown) => {
        console.warn(`[e2eFixtureBridge] pre-load failed for ${id}:`, err);
      }),
    ),
  );

  if (imageIds.length > 1) {
    try {
      imageIds = await dicomwebLoader.orderImageIdsByDicomMetadata(
        imageIds,
        `loadLocalDicomFiles(${panelId})`,
      );
    } catch (err) {
      console.warn('[e2eFixtureBridge] metadata ordering failed; using IPC order:', err);
    }
  }

  registeredSetter((prev) => ({ ...prev, [panelId]: imageIds }));

  // VolumeViewport.tsx gates on a non-empty scanId in panelScanMap.
  // Setting one here lets the fixture flow through the same volume
  // creation path the XNAT browser uses.
  useViewerStore.getState().setPanelScan(panelId, syntheticScanId(paths));

  return { panelId, imageIds, sourcePaths: [...paths] };
}
