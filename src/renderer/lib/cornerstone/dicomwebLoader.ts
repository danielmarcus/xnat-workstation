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

/** DICOM tags used in QIDO-RS responses */
const TAG_SOP_INSTANCE_UID = '00080018';
const TAG_INSTANCE_NUMBER = '00200013';

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

export const dicomwebLoader = {
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
   * Fetch DICOM file URIs for a scan via XNAT REST API, then build wadouri:
   * image IDs pointing directly to each file on the XNAT server.
   *
   * This is used by the XNAT browser (scan-level loading) — it doesn't need
   * QIDO-RS because XNAT provides the file list directly via REST.
   *
   * @param sessionId - XNAT experiment/session ID (e.g. "XNAT_E00001")
   * @param scanId - Scan number within the session (e.g. "1")
   */
  async getScanImageIds(sessionId: string, scanId: string): Promise<string[]> {
    const result = await window.electronAPI.xnat.getScanFiles(sessionId, scanId);

    if (!result.ok || !result.serverUrl) {
      throw new Error(`Failed to get scan files: ${result.error || 'Unknown error'}`);
    }

    if (result.files.length === 0) {
      throw new Error('No DICOM files found for this scan');
    }

    const baseUrl = result.serverUrl.replace(/\/+$/, '');

    // Build wadouri: image IDs — each file URI is a path like
    // /data/experiments/.../scans/.../resources/DICOM/files/xxx.dcm
    // The webRequest interceptor will inject auth headers automatically.
    const imageIds = result.files.map(
      (uri) => `wadouri:${baseUrl}${uri}`,
    );

    // Sort by filename for consistent ordering
    imageIds.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    console.log(`[dicomwebLoader] Built ${imageIds.length} imageIds for scan ${sessionId}/${scanId}`);
    return imageIds;
  },
};
