/**
 * DICOM-SR import (SR-D) — the inverse of srExport. Reconstructs measurement
 * annotations from a DICOM Structured Report (TID 1500) so a saved Measurement set
 * reloads from XNAT and reappears as Measurement-container members.
 *
 * Mirrors the SEG/RTSTRUCT load pattern: parse the DICOM, hand it to the conformant
 * @cornerstonejs/adapters MeasurementReport.generateToolState (the adapter owns
 * TID-1500 reconstruction), then add each reconstructed annotation to Cornerstone's
 * annotation state. No hand-rolled SR parsing.
 *
 * The caller re-syncs the annotation store (annotationService.sync) after import so
 * the reconstructed measurements project into the panel — and clears the SR
 * container's dirty flag, since a load is not a local edit (SR-A marks dirty on
 * draw/edit events; a reload must not look unsaved).
 */
import { metaData, getRenderingEngines } from '@cornerstonejs/core';
import { annotation as csAnnotation } from '@cornerstonejs/tools';
import { adaptersSR } from '@cornerstonejs/adapters';
import { naturalizeDicomArrayBuffer } from './dicomExportHelpers';

type ReconstructedAnnotation = {
  annotationUID?: string;
  metadata?: { toolName?: string; FrameOfReferenceUID?: string };
};
/** generateToolState returns `{ [toolType]: MeasurementState[] }`; each state wraps the
 *  real annotation under `.annotation` (some adapters return the annotation directly). */
type MeasurementState = { annotation?: ReconstructedAnnotation } & ReconstructedAnnotation;
type GeneratedToolState = Record<string, MeasurementState[]>;

const MeasurementReport = (adaptersSR as {
  Cornerstone3D: {
    MeasurementReport: {
      generateToolState: (dataset: unknown, sopMap: unknown, metadata: unknown, hooks: unknown) => GeneratedToolState;
    };
  };
}).Cornerstone3D.MeasurementReport;

/** Build the `${SOPInstanceUID}:${frameNumber}` → imageId map the adapter needs to
 *  place 2D (image-referenced) measurements back onto the loaded source images. The
 *  key scheme MUST match the adapter, which looks up
 *  `sopInstanceUIDToImageIdMap["${ReferencedSOPInstanceUID}:${ReferencedFrameNumber}"]`
 *  with ReferencedFrameNumber defaulting to 1 for single-frame instances
 *  (@cornerstonejs/adapters MeasurementReport.processSCOORDGroup). 3D (volume)
 *  measurements carry world coords and don't need a map entry. */
function buildSopInstanceUidToImageIdMap(sourceImageIds: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const imageId of sourceImageIds) {
    const sop =
      (metaData.get('sopCommonModule', imageId) as { sopInstanceUID?: string } | undefined)?.sopInstanceUID ??
      (metaData.get('generalImageModule', imageId) as { sopInstanceUID?: string } | undefined)?.sopInstanceUID;
    if (!sop) continue;
    const frame = Number((metaData.get('frameNumber', imageId) as number | undefined) ?? 1) || 1;
    map[`${sop}:${frame}`] = imageId;
  }
  return map;
}

/**
 * Reconstruct + add the measurement annotations from a DICOM-SR ArrayBuffer. Returns
 * the added annotation UIDs (empty if the SR carried no reconstructable measurements).
 * Pure w.r.t. the store — the caller re-syncs + clears dirty (see module doc).
 */
export function importMeasurementsFromDicomSr(arrayBuffer: ArrayBuffer, sourceImageIds: string[]): string[] {
  const { dataset } = naturalizeDicomArrayBuffer(arrayBuffer);
  const sopMap = buildSopInstanceUidToImageIdMap(sourceImageIds);

  let toolState: GeneratedToolState;
  try {
    toolState = MeasurementReport.generateToolState(dataset, sopMap, metaData, {});
  } catch (err) {
    console.warn('[srImport] generateToolState failed:', err);
    return [];
  }

  const added: string[] = [];
  for (const toolName of Object.keys(toolState)) {
    for (const state of toolState[toolName] ?? []) {
      // The adapter wraps the annotation under `.annotation`; tolerate either shape.
      const ann: ReconstructedAnnotation = state.annotation ?? state;
      if (!ann) continue;
      ann.metadata = ann.metadata ?? {};
      if (!ann.metadata.toolName) ann.metadata.toolName = toolName;
      try {
        // Group by FrameOfReferenceUID (the annotation carries it) so the
        // measurement renders on every viewport in that frame.
        csAnnotation.state.addAnnotation(ann as never, ann.metadata.FrameOfReferenceUID as never);
        if (ann.annotationUID) added.push(ann.annotationUID);
      } catch (err) {
        console.warn('[srImport] addAnnotation failed for a measurement:', err);
      }
    }
  }

  if (added.length > 0) {
    for (const engine of getRenderingEngines() ?? []) engine?.render();
  }
  return added;
}
