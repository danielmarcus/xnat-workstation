/**
 * DICOMweb Loader — fetches instance lists via QIDO-RS through the
 * authenticated IPC proxy, and builds wadouri: image IDs pointing to
 * the XNAT server's WADO-URI endpoint.
 *
 * QIDO-RS requests go through IPC to the main process (which adds auth).
 * WADO-URI requests (actual DICOM file fetches by Cornerstone) go directly
 * to the XNAT server — the main process's webRequest interceptor
 * automatically injects auth headers.
 */
import { metaData } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { pLimit } from '../util/pLimit';

/** DICOM tags used in QIDO-RS responses */
const TAG_SOP_INSTANCE_UID = '00080018';
const TAG_INSTANCE_NUMBER = '00200013';
type Vec3 = [number, number, number];

interface ScanImageIdsCacheEntry {
  imageIds: string[];
}

interface ImageOrderingMeta {
  imageId: string;
  uri: string;
  originalIndex: number;
  instanceNumber: number | null;
  imagePositionPatient: Vec3 | null;
  rowCosines: Vec3 | null;
  columnCosines: Vec3 | null;
  positionScalar: number | null;
}

/**
 * Extract a DICOM tag value from a QIDO-RS JSON response item.
 */
function getTagValue(item: Record<string, any>, tag: string): string {
  return item?.[tag]?.Value?.[0] ?? '';
}

function getTagNumber(item: Record<string, any>, tag: string): number {
  const val = item?.[tag]?.Value?.[0];
  return typeof val === 'number' ? val : parseInt(val, 10) || 0;
}

function toWadouriUri(imageId: string): string {
  return imageId.startsWith('wadouri:') ? imageId.slice(8) : imageId;
}

function toFrameImageId(imageId: string, frameNumber: number): string {
  return `${imageId}&frame=${frameNumber}`;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseVec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const x = parseNumber(value[0]);
  const y = parseNumber(value[1]);
  const z = parseNumber(value[2]);
  if (x === null || y === null || z === null) return null;
  return [x, y, z];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function readImageOrderingMeta(imageId: string, originalIndex: number): ImageOrderingMeta {
  const uri = toWadouriUri(imageId);

  const plane = metaData.get('imagePlaneModule', imageId) as
    | { imagePositionPatient?: unknown; rowCosines?: unknown; columnCosines?: unknown }
    | undefined;
  const generalImage = metaData.get('generalImageModule', imageId) as
    | { instanceNumber?: unknown }
    | undefined;
  const instanceMeta = metaData.get('instance', imageId) as
    | { InstanceNumber?: unknown }
    | undefined;

  let datasetInstanceNumber: number | null = null;
  try {
    if (wadouri.dataSetCacheManager.isLoaded(uri)) {
      const dataSet = wadouri.dataSetCacheManager.get(uri);
      datasetInstanceNumber = parseNumber(dataSet?.string?.('x00200013'));
    }
  } catch {
    // Ignore missing dataset cache entries.
  }

  const instanceNumber =
    parseNumber(instanceMeta?.InstanceNumber)
    ?? parseNumber(generalImage?.instanceNumber)
    ?? datasetInstanceNumber;

  const imagePositionPatient = parseVec3(plane?.imagePositionPatient);
  const rowCosines = parseVec3(plane?.rowCosines);
  const columnCosines = parseVec3(plane?.columnCosines);

  return {
    imageId,
    uri,
    originalIndex,
    instanceNumber,
    imagePositionPatient,
    rowCosines,
    columnCosines,
    positionScalar: null,
  };
}

function assignPositionScalars(entries: ImageOrderingMeta[]): void {
  let geometryScalars = 0;
  for (const entry of entries) {
    const ipp = entry.imagePositionPatient;
    const row = entry.rowCosines;
    const col = entry.columnCosines;
    if (!ipp || !row || !col) continue;
    const normal = cross(row, col);
    const magnitude = Math.hypot(normal[0], normal[1], normal[2]);
    if (!Number.isFinite(magnitude) || magnitude <= 1e-6) continue;
    entry.positionScalar = dot(ipp, normal);
    geometryScalars++;
  }

  if (geometryScalars >= 2) return;

  const positions = entries
    .map((entry) => entry.imagePositionPatient)
    .filter((v): v is Vec3 => !!v);
  if (positions.length < 2) return;

  const ranges: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    let min = Infinity;
    let max = -Infinity;
    for (const position of positions) {
      if (position[axis] < min) min = position[axis];
      if (position[axis] > max) max = position[axis];
    }
    ranges[axis] = max - min;
  }
  const dominantAxis =
    ranges[1] > ranges[0]
      ? (ranges[2] > ranges[1] ? 2 : 1)
      : (ranges[2] > ranges[0] ? 2 : 0);

  for (const entry of entries) {
    if (entry.positionScalar !== null || !entry.imagePositionPatient) continue;
    entry.positionScalar = entry.imagePositionPatient[dominantAxis];
  }
}

function compareNullableNumbers(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function scanCacheKey(sessionId: string, scanId: string): string {
  return `${sessionId}|${scanId}`;
}

const scanImageIdsCache = new Map<string, ScanImageIdsCacheEntry>();
const scanImageIdsInFlight = new Map<string, Promise<string[]>>();

async function getNumberOfFramesForImageId(imageId: string): Promise<number> {
  const uri = toWadouriUri(imageId);
  try {
    if (!wadouri.dataSetCacheManager.isLoaded(uri)) {
      await wadouri.dataSetCacheManager.load(uri, undefined as any, imageId);
    }
    const dataSet = wadouri.dataSetCacheManager.get(uri);
    const parsed = parseInt(String(dataSet?.string?.('x00280008') ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 1 ? parsed : 1;
  } catch {
    return 1;
  }
}

async function sortImageIdsByDicomMetadata(
  imageIds: string[],
  contextLabel: string,
): Promise<string[]> {
  const limit = pLimit(12);
  await Promise.all(
    imageIds.map((imageId) =>
      limit(async () => {
        try {
          const uri = toWadouriUri(imageId);
          if (!wadouri.dataSetCacheManager.isLoaded(uri)) {
            await wadouri.dataSetCacheManager.load(uri, undefined as any, imageId);
          }
        } catch (err) {
          // Keep partial metadata available; missing slices fall back to instance/file ordering.
          console.debug('[dicomwebLoader] Metadata pre-load failed for imageId:', imageId, err);
        }
      })
    ),
  );

  const entries = imageIds.map((imageId, index) => readImageOrderingMeta(imageId, index));
  assignPositionScalars(entries);

  entries.sort((a, b) => {
    const scalarCmp = compareNullableNumbers(a.positionScalar, b.positionScalar);
    if (scalarCmp !== 0) return scalarCmp;

    const instanceCmp = compareNullableNumbers(a.instanceNumber, b.instanceNumber);
    if (instanceCmp !== 0) return instanceCmp;

    const uriCmp = a.uri.localeCompare(b.uri, undefined, { numeric: true });
    if (uriCmp !== 0) return uriCmp;

    return a.originalIndex - b.originalIndex;
  });

  const geometryCount = entries.reduce((count, entry) => (
    entry.positionScalar === null ? count : count + 1
  ), 0);
  const instanceCount = entries.reduce((count, entry) => (
    entry.instanceNumber === null ? count : count + 1
  ), 0);

  console.log(
    `[dicomwebLoader] Ordered ${entries.length} images for ${contextLabel} `
    + `(geometry=${geometryCount}, instance=${instanceCount})`,
  );

  return entries.map((entry) => entry.imageId);
}

export const dicomwebLoader = {
  clearScanImageIdsCache(sessionId?: string): void {
    if (!sessionId) {
      scanImageIdsCache.clear();
      scanImageIdsInFlight.clear();
      return;
    }
    const prefix = `${sessionId}|`;
    for (const key of Array.from(scanImageIdsCache.keys())) {
      if (key.startsWith(prefix)) scanImageIdsCache.delete(key);
    }
    for (const key of Array.from(scanImageIdsInFlight.keys())) {
      if (key.startsWith(prefix)) scanImageIdsInFlight.delete(key);
    }
  },

  /**
   * Order arbitrary imageIds by DICOM spatial metadata (IPP/IOP) with
   * InstanceNumber fallback. Useful for local imports and other non-XNAT stacks.
   */
  async orderImageIdsByDicomMetadata(
    imageIds: string[],
    contextLabel = 'custom image set',
  ): Promise<string[]> {
    if (imageIds.length <= 1) return imageIds;
    return sortImageIdsByDicomMetadata(imageIds, contextLabel);
  },

  /**
   * Fetch the instance list for a series via QIDO-RS (through IPC proxy),
   * sort by instance number, and build wadouri: image IDs pointing to
   * the XNAT server's WADO-URI endpoint.
   *
   * @param studyUID - DICOM Study Instance UID
   * @param seriesUID - DICOM Series Instance UID
   * @param serverUrl - XNAT server base URL (e.g. "https://xnat.example.com")
   */
  async getSeriesImageIds(
    studyUID: string,
    seriesUID: string,
    serverUrl: string,
  ): Promise<string[]> {
    // QIDO-RS path — goes through IPC to main process for auth
    const qidoPath = `/studies/${studyUID}/series/${seriesUID}/instances`;

    const result = await window.electronAPI.xnat.dicomwebFetch(qidoPath, {
      accept: 'application/dicom+json',
    });

    if (!result.ok) {
      throw new Error(`QIDO-RS failed: ${result.status} ${result.error || ''}`);
    }

    const instances = result.data as Record<string, any>[];

    if (!Array.isArray(instances) || instances.length === 0) {
      throw new Error('No instances found for series');
    }

    // Sort by instance number for correct slice ordering
    instances.sort((a, b) => {
      const numA = getTagNumber(a, TAG_INSTANCE_NUMBER);
      const numB = getTagNumber(b, TAG_INSTANCE_NUMBER);
      return numA - numB;
    });

    // Build wadouri: image IDs using the XNAT server's WADO-URI endpoint.
    // These URLs go directly from the renderer to the XNAT server.
    // Auth headers are injected by the main process's webRequest interceptor.
    const baseUrl = serverUrl.replace(/\/+$/, '');
    const imageIds = instances.map((inst) => {
      const sopInstanceUID = getTagValue(inst, TAG_SOP_INSTANCE_UID);
      return `wadouri:${baseUrl}/xapi/dicomweb/wado?requestType=WADO&studyUID=${encodeURIComponent(studyUID)}&seriesUID=${encodeURIComponent(seriesUID)}&objectUID=${encodeURIComponent(sopInstanceUID)}&contentType=application%2Fdicom`;
    });

    console.log(`[dicomwebLoader] Built ${imageIds.length} imageIds for series ${seriesUID}`);
    return imageIds;
  },

  /**
   * Fetch DICOM file entries for a scan via XNAT REST API, then build wadouri:
   * image IDs pointing directly to each file on the XNAT server.
   *
   * Ordering: uses InstanceNumber from the XNAT catalog XML when available
   * (single lightweight HTTP request). Falls back to filename alphanumeric
   * sort only when InstanceNumber is entirely absent.
   *
   * @param sessionId - XNAT experiment/session ID (e.g. "XNAT_E00001")
   * @param scanId - Scan number within the session (e.g. "1")
   */
  async getScanImageIds(
    sessionId: string,
    scanId: string,
  ): Promise<string[]> {
    const key = scanCacheKey(sessionId, scanId);

    const cached = scanImageIdsCache.get(key);
    if (cached) {
      return [...cached.imageIds];
    }

    const inFlight = scanImageIdsInFlight.get(key);
    if (inFlight) {
      const ids = await inFlight;
      return [...ids];
    }

    const promise = (async () => {
      const result = await window.electronAPI.xnat.getScanFiles(sessionId, scanId);

      if (!result.ok || !result.serverUrl) {
        throw new Error(`Failed to get scan files: ${result.error || 'Unknown error'}`);
      }

      if (result.files.length === 0) {
        throw new Error('No DICOM files found for this scan');
      }

      const baseUrl = result.serverUrl.replace(/\/+$/, '');

      // Build enriched entries with wadouri imageIds.
      const entries = result.files.map((f) => ({
        imageId: `wadouri:${baseUrl}${f.uri}`,
        instanceNumber: f.instanceNumber,
      }));

      // Sort by InstanceNumber when available (from XNAT catalog XML),
      // with filename as tiebreaker. Fall back to pure filename sort
      // only when InstanceNumber is entirely absent.
      const hasInstanceNumbers = entries.some((e) => e.instanceNumber != null);
      if (hasInstanceNumbers) {
        entries.sort((a, b) => {
          const instA = a.instanceNumber ?? Number.MAX_SAFE_INTEGER;
          const instB = b.instanceNumber ?? Number.MAX_SAFE_INTEGER;
          if (instA !== instB) return instA - instB;
          return a.imageId.localeCompare(b.imageId, undefined, { numeric: true });
        });
        console.log(
          `[dicomwebLoader] Ordered ${entries.length} images by InstanceNumber for scan ${sessionId}/${scanId}`,
        );
      } else {
        entries.sort((a, b) => a.imageId.localeCompare(b.imageId, undefined, { numeric: true }));
        console.log(
          `[dicomwebLoader] Ordered ${entries.length} images by filename for scan ${sessionId}/${scanId} (no InstanceNumber available)`,
        );
      }

      let finalIds = entries.map((e) => e.imageId);

      // Some modalities (for example breast tomosynthesis) can arrive as a
      // single multi-frame DICOM object rather than many single-frame files.
      // Expand that one object into frame-addressable wadouri ids so the stack
      // viewport can scroll through every frame instead of showing 1/1.
      if (finalIds.length === 1) {
        const baseImageId = finalIds[0];
        const numberOfFrames = await getNumberOfFramesForImageId(baseImageId);
        if (numberOfFrames > 1) {
          finalIds = Array.from(
            { length: numberOfFrames },
            (_, frameIndex) => toFrameImageId(baseImageId, frameIndex + 1),
          );
          console.log(
            `[dicomwebLoader] Expanded single-file multiframe scan ${sessionId}/${scanId} `
            + `into ${numberOfFrames} frame imageIds`,
          );
        }
      }

      scanImageIdsCache.set(key, { imageIds: [...finalIds] });
      return finalIds;
    })();

    scanImageIdsInFlight.set(key, promise);
    try {
      const ids = await promise;
      return [...ids];
    } finally {
      scanImageIdsInFlight.delete(key);
    }
  },
};
