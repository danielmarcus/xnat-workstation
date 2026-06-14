/**
 * DICOM-SR export (Transport TR5, SR write) — serialize measurement annotations into a
 * DICOM Structured Report (TID 1500 Measurement Report) for save-to-XNAT.
 *
 * Mirrors the SEG (dicomSegExport) / RTSTRUCT (rtStructService) export pattern: gather the
 * live Cornerstone annotations, hand them to the conformant @cornerstonejs/adapters
 * serializer, and finalize via the shared serializeDerivedDicomDataset (workstation
 * metadata + file-meta + validation). No hand-rolled SR IOD — the adapter owns TID-1500
 * conformance, the same way adaptersSEG/adaptersRT own SEG/RTSTRUCT.
 */
import { metaData } from '@cornerstonejs/core';
import { annotation as csAnnotation } from '@cornerstonejs/tools';
import { adaptersSR, NO_IMAGE_ID } from '@cornerstonejs/adapters';
import { serializeDerivedDicomDataset } from './dicomExportHelpers';

const MeasurementReport = (adaptersSR as { Cornerstone3D: { MeasurementReport: { generateReport: (toolState: unknown, mp: unknown, opts: unknown) => { dataset: Record<string, unknown> } } } }).Cornerstone3D.MeasurementReport;

// Comprehensive 3D SR — the SOP class the adapter emits for volume (3D) measurements.
const COMPREHENSIVE_3D_SR = '1.2.840.10008.5.1.4.1.1.88.34';

type ToolStateData = { data: unknown[] };
type ToolState = Record<string, Record<string, ToolStateData>>;

/**
 * Group the given measurement annotations into the adapter's toolState shape
 * (`{ [imageId]: { [toolName]: { data: [...annotations] } } }`). 2D measurements key on
 * their referencedImageId; volume (3D) measurements use NO_IMAGE_ID.
 */
export function buildMeasurementToolState(annotationUIDs: string[]): ToolState {
  const toolState: ToolState = {};
  for (const uid of annotationUIDs) {
    const ann = csAnnotation.state.getAnnotation?.(uid) as
      | { metadata?: { toolName?: string; referencedImageId?: string } }
      | undefined;
    const toolName = ann?.metadata?.toolName;
    if (!ann || !toolName) continue;
    const imageId = ann.metadata?.referencedImageId ?? NO_IMAGE_ID;
    (toolState[imageId] ??= {});
    (toolState[imageId][toolName] ??= { data: [] });
    toolState[imageId][toolName].data.push(ann);
  }
  return toolState;
}

/**
 * Serialize the given measurement annotations to a DICOM-SR file (base64). Returns null if
 * there are no serializable measurements.
 */
export async function exportMeasurementsToDicomSr(
  annotationUIDs: string[],
  options: { seriesDescription?: string; seriesNumber?: number } = {},
): Promise<string | null> {
  const toolState = buildMeasurementToolState(annotationUIDs);
  if (Object.keys(toolState).length === 0) return null;

  const report = MeasurementReport.generateReport(toolState, metaData, {
    SeriesDescription: options.seriesDescription ?? 'Measurements',
    SeriesNumber: options.seriesNumber ?? 1,
  });

  const { arrayBuffer } = serializeDerivedDicomDataset(report.dataset, {
    kind: 'SR',
    callerTag: 'srExport',
    defaultSOPClassUID: COMPREHENSIVE_3D_SR,
    includeContentDateTime: true,
    requiredDatasetFields: ['SOPClassUID', 'SOPInstanceUID', 'Modality'],
    // Self-validate SR-ness: serialization throws if the adapter didn't emit an SR
    // (so a returned base64 is, by construction, a conformant SR that round-tripped
    // through the dcmjs write+parse validation).
    expectedDatasetValues: { Modality: 'SR' },
  });

  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
