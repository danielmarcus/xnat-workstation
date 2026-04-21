/**
 * RT Structure Set Service — parses, loads, and exports DICOM RTSTRUCT files.
 *
 * Parse:  Binary DICOM → RtStructParseResult (ROIs + contours in world coordinates)
 * Load:   RtStructParseResult → Cornerstone contour segmentation annotations
 * Export: Cornerstone contour segmentation → DICOM RTSTRUCT binary (base64)
 *
 * The parser uses dicom-parser directly (no Cornerstone adapter for RTSTRUCT import).
 * The exporter uses @cornerstonejs/adapters' generateRTSSFromRepresentation().
 */
import * as dicomParser from 'dicom-parser';
import {
  metaData,
  utilities as csUtilities,
  getEnabledElementByViewportId,
} from '@cornerstonejs/core';
import type { Types as CoreTypes } from '@cornerstonejs/core';
import {
  segmentation as csSegmentation,
  annotation as csAnnotation,
  Enums as ToolEnums,
  utilities as csToolUtilities,
} from '@cornerstonejs/tools';
import { adaptersRT } from '@cornerstonejs/adapters';
import { useConnectionStore } from '../../stores/connectionStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { segmentationService } from './segmentationService';
import * as contourRep from './contourRepresentation';
import {
  formatOperatorsNameForConnection,
  upsertOperatorsName,
} from './operatorsName';
import {
  collectSourceDicomReferences,
  parseReferencedFrameNumber,
  requireSingleStudyReference,
  serializeDerivedDicomDataset,
} from './dicomExportHelpers';
import {
  parsePositiveInt,
  collectContourImageReferencesFromRtStruct,
  contourImageReferenceKey,
  validateRtStructDataset,
} from './dicomValidation';

function resolveFrameModule(imageId: string): {
  sopClassUID: string;
  sopInstanceUID: string;
  frameNumber: number;
  numberOfFrames: number;
} | undefined {
  const sop = metaData.get('sopCommonModule', imageId) as
    | { sopClassUID?: string; sopInstanceUID?: string; numberOfFrames?: unknown }
    | undefined;
  if (!sop?.sopClassUID || !sop?.sopInstanceUID) return undefined;

  const multiframe = metaData.get('multiframeModule', imageId) as
    | { numberOfFrames?: unknown }
    | undefined;
  const instance = metaData.get('instance', imageId) as
    | { NumberOfFrames?: unknown; numberOfFrames?: unknown }
    | undefined;
  const frameNumber = parseReferencedFrameNumber(imageId) ?? 1;
  const explicitNumberOfFrames =
    parsePositiveInt(multiframe?.numberOfFrames)
    ?? parsePositiveInt(instance?.NumberOfFrames)
    ?? parsePositiveInt(instance?.numberOfFrames)
    ?? parsePositiveInt(sop.numberOfFrames);

  return {
    sopClassUID: sop.sopClassUID,
    sopInstanceUID: sop.sopInstanceUID,
    frameNumber,
    numberOfFrames:
      explicitNumberOfFrames && explicitNumberOfFrames > 1
        ? explicitNumberOfFrames
        : (frameNumber > 1 ? Math.max(2, frameNumber) : 1),
  };
}

// ─── Bridge: register a global 'frameModule' metadata provider ──────────
//
// The @cornerstonejs/adapters referencedMetadataProvider expects
// metaData.get('frameModule', imageId) → { sopClassUID, sopInstanceUID, ... }
// but the DICOMweb image loader doesn't register this module. It puts
// SOP UID data in 'sopCommonModule' instead. We register a low-priority
// provider that bridges the gap.
metaData.addProvider((type: string, imageId: string) => {
  if (type !== 'frameModule') return undefined;
  return resolveFrameModule(imageId);
}, 100); // priority 100 — low enough to not override real providers

// ─── Types ──────────────────────────────────────────────────────

export interface RtStructContour {
  /** Flat coordinate array [x,y,z, x,y,z, ...] in DICOM LPS world coordinates */
  points: number[];
  /** SOP Instance UID of the referenced CT/MR image for this contour slice */
  referencedSOPInstanceUID: string | null;
  /** Contour geometric type (e.g. 'CLOSED_PLANAR') */
  geometricType: string;
}

export interface RtStructROI {
  roiNumber: number;
  name: string;
  /** Display color [R, G, B] 0-255 */
  color: [number, number, number];
  /** RT ROI Interpreted Type (e.g. 'ORGAN', 'PTV', 'CTV', 'EXTERNAL') */
  interpretedType: string;
  contours: RtStructContour[];
}

export interface RtStructParseResult {
  rois: RtStructROI[];
  /** Series Instance UID of the referenced imaging series */
  referencedSeriesUID: string | null;
  structureSetLabel: string;
  structureSetName: string;
}

export interface LoadedRtStruct {
  segmentationId: string;
  /** A referenced image ID from the first contour (for viewport scrolling) */
  firstReferencedImageId: string | null;
}

// ─── DICOM Tag Helpers ──────────────────────────────────────────

// RTSTRUCT sequence tags (DICOM group 3006)
const TAG = {
  // Structure Set ROI Sequence
  StructureSetROISequence: 'x30060020',
  ROINumber: 'x30060022',
  ROIName: 'x30060026',
  ReferencedFrameOfReferenceUID_ROI: 'x30060024',

  // ROI Contour Sequence
  ROIContourSequence: 'x30060039',
  ReferencedROINumber: 'x30060084',
  ROIDisplayColor: 'x3006002a',

  // Contour Sequence (within ROI Contour)
  ContourSequence: 'x30060040',
  ContourGeometricType: 'x30060042',
  NumberOfContourPoints: 'x30060046',
  ContourData: 'x30060050',

  // Contour Image Sequence (within Contour)
  ContourImageSequence: 'x30060016',
  ReferencedSOPInstanceUID: 'x00081155',

  // RT ROI Observations Sequence
  RTROIObservationsSequence: 'x30060080',
  ObservationNumber: 'x30060082',
  RTROIInterpretedType: 'x300600a4',

  // Referenced Frame of Reference Sequence (for getting Series UID)
  ReferencedFrameOfReferenceSequence: 'x30060010',
  RTReferencedStudySequence: 'x30060012',
  RTReferencedSeriesSequence: 'x30060014',
  SeriesInstanceUID: 'x0020000e',

  // Referenced Series Sequence (0008,1115) — flat, used by Cornerstone adapters export
  ReferencedSeriesSequence: 'x00081115',

  // Structure Set metadata
  StructureSetLabel: 'x30060002',
  StructureSetName: 'x30060004',
};

// ─── Default colors for ROIs without color ──────────────────────

const DEFAULT_ROI_COLORS: [number, number, number][] = [
  [220, 50, 50],    // Red
  [50, 200, 50],    // Green
  [50, 100, 220],   // Blue
  [230, 200, 40],   // Yellow
  [200, 50, 200],   // Magenta
  [50, 200, 200],   // Cyan
  [240, 140, 40],   // Orange
  [150, 80, 200],   // Purple
  [50, 220, 130],   // Spring Green
  [255, 130, 130],  // Light Red
];

let rtStructCounter = 0;

// ─── Parse ──────────────────────────────────────────────────────

/**
 * Parse a DICOM RTSTRUCT binary into a structured result.
 * Uses dicom-parser to read the raw DICOM dataset.
 */
function parseRtStruct(arrayBuffer: ArrayBuffer): RtStructParseResult {
  const byteArray = new Uint8Array(arrayBuffer);
  const dataSet = dicomParser.parseDicom(byteArray);

  const structureSetLabel = dataSet.string(TAG.StructureSetLabel) ?? 'RT Structure Set';
  const structureSetName = dataSet.string(TAG.StructureSetName) ?? '';

  // ── Step 1: Parse StructureSetROISequence → map roiNumber → { name, frameOfRefUID }
  const roiInfoMap = new Map<number, { name: string; frameOfRefUID: string }>();
  const ssROISeq = dataSet.elements[TAG.StructureSetROISequence];
  if (ssROISeq?.items) {
    for (const item of ssROISeq.items) {
      const ds = item.dataSet;
      if (!ds) continue;
      const num = ds.intString(TAG.ROINumber);
      const name = ds.string(TAG.ROIName) ?? `ROI ${num}`;
      const frameOfRefUID = ds.string(TAG.ReferencedFrameOfReferenceUID_ROI) ?? '';
      if (num !== undefined) {
        roiInfoMap.set(num, { name, frameOfRefUID });
      }
    }
  }

  // ── Step 2: Parse RTROIObservationsSequence → map roiNumber → interpretedType
  const roiObsMap = new Map<number, string>();
  const obsSeq = dataSet.elements[TAG.RTROIObservationsSequence];
  if (obsSeq?.items) {
    for (const item of obsSeq.items) {
      const ds = item.dataSet;
      if (!ds) continue;
      const refROI = ds.intString(TAG.ReferencedROINumber);
      const interpType = ds.string(TAG.RTROIInterpretedType) ?? '';
      if (refROI !== undefined) {
        roiObsMap.set(refROI, interpType);
      }
    }
  }

  // ── Step 3: Parse ROIContourSequence → build ROIs with contours
  const rois: RtStructROI[] = [];
  const roiContourSeq = dataSet.elements[TAG.ROIContourSequence];
  if (roiContourSeq?.items) {
    for (const roiItem of roiContourSeq.items) {
      const roiDs = roiItem.dataSet;
      if (!roiDs) continue;

      const refROINumber = roiDs.intString(TAG.ReferencedROINumber);
      if (refROINumber === undefined) continue;

      // Parse display color (backslash-delimited "R\G\B")
      let color: [number, number, number] =
        DEFAULT_ROI_COLORS[rois.length % DEFAULT_ROI_COLORS.length];
      const colorStr = roiDs.string(TAG.ROIDisplayColor);
      if (colorStr) {
        const parts = colorStr.split('\\').map(Number);
        if (parts.length >= 3 && parts.every((n) => !isNaN(n))) {
          color = [parts[0], parts[1], parts[2]];
        }
      }

      // Parse contours
      const contours: RtStructContour[] = [];
      const contourSeq = roiDs.elements[TAG.ContourSequence];
      if (contourSeq?.items) {
        for (const cItem of contourSeq.items) {
          const cDs = cItem.dataSet;
          if (!cDs) continue;

          const geometricType = cDs.string(TAG.ContourGeometricType) ?? 'CLOSED_PLANAR';
          const numPoints = cDs.intString(TAG.NumberOfContourPoints) ?? 0;

          // Parse contour data (backslash-delimited floats: x1\y1\z1\x2\y2\z2\...)
          const contourDataStr = cDs.string(TAG.ContourData);
          const points: number[] = [];
          if (contourDataStr) {
            const vals = contourDataStr.split('\\');
            for (const v of vals) {
              points.push(parseFloat(v));
            }
          }

          // Sanity check: points should be multiple of 3
          if (points.length < 9 || points.length % 3 !== 0) {
            console.warn(
              `[rtStructService] Skipping contour with ${points.length} coordinates ` +
              `(expected multiple of 3, >= 9 for a triangle)`,
            );
            continue;
          }

          // Get referenced SOP Instance UID
          let referencedSOPInstanceUID: string | null = null;
          const contourImageSeq = cDs.elements[TAG.ContourImageSequence];
          if (contourImageSeq?.items?.[0]?.dataSet) {
            referencedSOPInstanceUID =
              contourImageSeq.items[0].dataSet.string(TAG.ReferencedSOPInstanceUID) ?? null;
          }

          contours.push({
            points,
            referencedSOPInstanceUID,
            geometricType,
          });
        }
      }

      const info = roiInfoMap.get(refROINumber);
      rois.push({
        roiNumber: refROINumber,
        name: info?.name ?? `ROI ${refROINumber}`,
        color,
        interpretedType: roiObsMap.get(refROINumber) ?? '',
        contours,
      });
    }
  }

  // ── Step 4: Extract Referenced Series UID
  const referencedSeriesUID = extractReferencedSeriesUID(dataSet);

  console.log(
    `[rtStructService] Parsed RTSTRUCT: "${structureSetLabel}"`,
    `— ${rois.length} ROIs, ${rois.reduce((s, r) => s + r.contours.length, 0)} contours`,
    referencedSeriesUID ? `(series: ${referencedSeriesUID})` : '(no series ref)',
  );

  return { rois, referencedSeriesUID, structureSetLabel, structureSetName };
}

/**
 * Extract the referenced SeriesInstanceUID from the RTSTRUCT.
 *
 * Checks three locations (in order):
 *
 * 1. Traditional RTSTRUCT nested path:
 *    ReferencedFrameOfReferenceSequence (3006,0010)
 *      → RTReferencedStudySequence (3006,0012)
 *        → RTReferencedSeriesSequence (3006,0014)
 *          → SeriesInstanceUID (0020,000E)
 *
 * 2. Flat ReferencedSeriesSequence (0008,1115) at dataset root:
 *    This is produced by Cornerstone adapters' RTSS export.
 *    ReferencedSeriesSequence → SeriesInstanceUID (0020,000E)
 *
 * 3. Contour-level references: scan ContourImageSequence for
 *    ReferencedSOPInstanceUID and look up the series UID from contours.
 *    (Not implemented — would need SOP → Series mapping)
 */
function extractReferencedSeriesUID(
  dataSet: ReturnType<typeof dicomParser.parseDicom>,
): string | null {
  // ── Method 1: Traditional nested RTSTRUCT path ──
  const refFrameSeq = dataSet.elements[TAG.ReferencedFrameOfReferenceSequence];
  if (refFrameSeq?.items?.length) {
    for (const frameItem of refFrameSeq.items) {
      const studySeq = frameItem.dataSet?.elements[TAG.RTReferencedStudySequence];
      if (!studySeq?.items?.length) continue;

      for (const studyItem of studySeq.items) {
        const seriesSeq = studyItem.dataSet?.elements[TAG.RTReferencedSeriesSequence];
        if (!seriesSeq?.items?.length) continue;

        const uid = seriesSeq.items[0].dataSet?.string(TAG.SeriesInstanceUID);
        if (uid) return uid;
      }
    }
  }

  // ── Method 2: Flat ReferencedSeriesSequence (0008,1115) at root ──
  // Cornerstone adapters produce this format when exporting RTSTRUCT.
  const refSeriesSeq = dataSet.elements[TAG.ReferencedSeriesSequence];
  if (refSeriesSeq?.items?.length) {
    for (const item of refSeriesSeq.items) {
      const uid = item.dataSet?.string(TAG.SeriesInstanceUID);
      if (uid) return uid;
    }
  }

  return null;
}

// ─── Load ───────────────────────────────────────────────────────

/**
 * Build a lookup map from SOP Instance UID → Cornerstone imageId.
 * Used to map RTSTRUCT contour references to viewport images.
 */
function buildSOPToImageIdMap(imageIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const imageId of imageIds) {
    try {
      const sopModule = metaData.get('sopCommonModule', imageId) as
        | { sopInstanceUID?: string } | undefined;
      if (sopModule?.sopInstanceUID) {
        map.set(sopModule.sopInstanceUID, imageId);
      }
    } catch {
      // Metadata not available for this image
    }
  }
  return map;
}

/**
 * Load a parsed RTSTRUCT as a Cornerstone contour segmentation.
 *
 * Creates one segmentation with one segment per ROI. Each contour becomes
 * a PlanarFreehandContourSegmentationTool annotation registered in the
 * segmentation's annotationUIDsMap.
 */
async function loadRtStructAsContours(
  parsed: RtStructParseResult,
  sourceImageIds: string[],
  viewportId: string,
): Promise<LoadedRtStruct> {
  rtStructCounter++;
  const segmentationId = `rtstruct_${Date.now()}_${rtStructCounter}`;

  // Build SOP Instance UID → imageId lookup
  const sopToImageId = buildSOPToImageIdMap(sourceImageIds);

  // Get FrameOfReferenceUID from any source image
  let frameOfReferenceUID = '';
  for (const imageId of sourceImageIds) {
    const planeMeta = metaData.get('imagePlaneModule', imageId) as
      | { frameOfReferenceUID?: string } | undefined;
    if (planeMeta?.frameOfReferenceUID) {
      frameOfReferenceUID = planeMeta.frameOfReferenceUID;
      break;
    }
  }

  // Build segments config: one segment per ROI (1-indexed)
  const segments: Record<number, any> = {};
  const segmentIndices: number[] = [];
  let firstReferencedImageId: string | null = null;

  // Register segmentation with Cornerstone
  const segLabel = parsed.structureSetLabel || `RTSTRUCT ${rtStructCounter}`;
  for (let roiIdx = 0; roiIdx < parsed.rois.length; roiIdx++) {
    const roi = parsed.rois[roiIdx];
    const segmentIndex = roiIdx + 1; // 1-based
    segments[segmentIndex] = {
      segmentIndex,
      label: roi.name,
      locked: true,
      active: segmentIndex === 1,
      cachedStats: {},
    };
    segmentIndices.push(segmentIndex);
  }

  csSegmentation.addSegmentations([
    {
      segmentationId,
      representation: {
        type: ToolEnums.SegmentationRepresentations.Contour,
        data: contourRep.buildInitialContourData(segmentIndices) as any,
      },
      config: {
        label: segLabel,
        segments,
      },
    },
  ]);

  // Lock loaded segments by default — user must unlock to edit
  for (let roiIdx = 0; roiIdx < parsed.rois.length; roiIdx++) {
    csSegmentation.segmentLocking.setSegmentIndexLocked(segmentationId, roiIdx + 1, true);
  }

  // Create contour annotations for each ROI
  for (let roiIdx = 0; roiIdx < parsed.rois.length; roiIdx++) {
    const roi = parsed.rois[roiIdx];
    const segmentIndex = roiIdx + 1;

    for (const contour of roi.contours) {
      // Convert flat points to Point3 array
      const polyline: CoreTypes.Point3[] = [];
      for (let i = 0; i < contour.points.length; i += 3) {
        polyline.push([
          contour.points[i],
          contour.points[i + 1],
          contour.points[i + 2],
        ] as CoreTypes.Point3);
      }

      if (polyline.length < 3) continue;

      // Map SOP Instance UID → imageId
      let referencedImageId = '';
      if (contour.referencedSOPInstanceUID) {
        referencedImageId = sopToImageId.get(contour.referencedSOPInstanceUID) ?? '';
      }

      // If no direct SOP mapping, try to find the closest image by Z position
      if (!referencedImageId && polyline.length > 0) {
        referencedImageId = findClosestImageByZ(polyline[0][2], sourceImageIds) ?? '';
      }

      if (!firstReferencedImageId && referencedImageId) {
        firstReferencedImageId = referencedImageId;
      }

      const annotationUID = csUtilities.uuidv4();

      // Create the annotation object matching Cornerstone's
      // PlanarFreehandContourSegmentationTool format
      const ann: any = {
        annotationUID,
        metadata: {
          toolName: 'PlanarFreehandContourSegmentationTool',
          referencedImageId,
          FrameOfReferenceUID: frameOfReferenceUID,
        },
        data: {
          contour: {
            polyline,
            closed: contour.geometricType.trim() === 'CLOSED_PLANAR',
          },
          segmentation: {
            segmentationId,
            segmentIndex,
          },
          handles: {
            points: [],
            activeHandleIndex: null,
            textBox: {
              hasMoved: false,
              worldPosition: [0, 0, 0] as CoreTypes.Point3,
              worldBoundingBox: {
                topLeft: [0, 0, 0] as CoreTypes.Point3,
                topRight: [0, 0, 0] as CoreTypes.Point3,
                bottomLeft: [0, 0, 0] as CoreTypes.Point3,
                bottomRight: [0, 0, 0] as CoreTypes.Point3,
              },
            },
          },
        },
        highlighted: false,
        isLocked: false,
        isVisible: true,
        invalidated: false,
      };

      // Register annotation with Cornerstone's annotation state
      csAnnotation.state.addAnnotation(ann, viewportId);
      // Bulk-load attribution: preserves pre-facade behavior of map-only
      // attribution (no csToolUtilities.contourSegmentation helper call).
      // See contourRepresentation.attachAnnotationUID for rationale.
      contourRep.attachAnnotationUID(segmentationId, segmentIndex, annotationUID);
    }
  }

  // Track source imageIds for re-export
  segmentationService.trackSourceImageIds(segmentationId, sourceImageIds);

  // Add contour representation to viewport
  try {
    csSegmentation.addContourRepresentationToViewport(viewportId, [
      { segmentationId },
    ]);
  } catch (err) {
    console.error('[rtStructService] Failed to add contour representation:', err);
  }

  // Set as active segmentation
  try {
    csSegmentation.activeSegmentation.setActiveSegmentation(viewportId, segmentationId);
  } catch (err) {
    console.debug('[rtStructService] setActiveSegmentation:', err);
  }

  // Set segment colors
  for (let roiIdx = 0; roiIdx < parsed.rois.length; roiIdx++) {
    const roi = parsed.rois[roiIdx];
    const segmentIndex = roiIdx + 1;
    try {
      csSegmentation.config.color.setSegmentIndexColor(
        viewportId,
        segmentationId,
        segmentIndex,
        [roi.color[0], roi.color[1], roi.color[2], 255] as any,
      );
    } catch {
      // Color setting may fail if representation not ready
    }
  }

  // Apply contour style
  segmentationService.updateContourStyle();

  // Trigger render
  try {
    csSegmentation.triggerSegmentationEvents.triggerSegmentationDataModified(segmentationId);
    csToolUtilities.segmentation.triggerSegmentationRender(viewportId);
    const enabledEl = getEnabledElementByViewportId(viewportId);
    const vp = enabledEl?.viewport as any;
    vp?.render?.();
  } catch (err) {
    console.debug('[rtStructService] render trigger:', err);
  }

  // Update store
  const store = useSegmentationStore.getState();
  store.setActiveSegmentation(segmentationId);
  segmentationService.setActiveSegmentIndex(segmentationId, 1);

  // Sync segmentations to store
  segmentationService.sync();

  console.log(
    `[rtStructService] Loaded RTSTRUCT as contour segmentation: ${segmentationId}`,
    `(${parsed.rois.length} ROIs, ${parsed.rois.reduce((s, r) => s + r.contours.length, 0)} contours)`,
  );

  return { segmentationId, firstReferencedImageId };
}

/**
 * Find the source image closest to a given Z position (slice location).
 */
function findClosestImageByZ(z: number, imageIds: string[]): string | null {
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const imageId of imageIds) {
    try {
      const planeMeta = metaData.get('imagePlaneModule', imageId) as
        | { imagePositionPatient?: number[] } | undefined;
      if (planeMeta?.imagePositionPatient) {
        const iz = planeMeta.imagePositionPatient[2];
        const dist = Math.abs(iz - z);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = imageId;
        }
      }
    } catch {
      // Skip images without position metadata
    }
  }

  return bestId;
}

function applySourceDicomContextToRtStructDataset(dataset: any, sourceImageId: string): void {
  if (!dataset || !sourceImageId) return;

  const patient = metaData.get('patientModule', sourceImageId) as any;
  const study = metaData.get('generalStudyModule', sourceImageId) as any;
  const patientStudy = metaData.get('patientStudyModule', sourceImageId) as any;
  const series = metaData.get('generalSeriesModule', sourceImageId) as any;
  const imagePlane = metaData.get('imagePlaneModule', sourceImageId) as any;

  if (patient?.patientName) dataset.PatientName = patient.patientName;
  if (patient?.patientId) dataset.PatientID = patient.patientId;
  if (patient?.patientBirthDate) dataset.PatientBirthDate = patient.patientBirthDate;
  if (patient?.patientSex) dataset.PatientSex = patient.patientSex;

  if (study?.studyInstanceUID) dataset.StudyInstanceUID = study.studyInstanceUID;
  if (study?.studyDate) dataset.StudyDate = study.studyDate;
  if (study?.studyTime) dataset.StudyTime = study.studyTime;
  if (study?.studyID) dataset.StudyID = study.studyID;
  if (study?.accessionNumber) dataset.AccessionNumber = study.accessionNumber;
  if (study?.studyDescription) dataset.StudyDescription = study.studyDescription;
  if (study?.referringPhysicianName) dataset.ReferringPhysicianName = study.referringPhysicianName;

  if (patientStudy?.patientAge) dataset.PatientAge = patientStudy.patientAge;
  if (patientStudy?.patientWeight) dataset.PatientWeight = patientStudy.patientWeight;
  if (patientStudy?.patientSize) dataset.PatientSize = patientStudy.patientSize;

  if (imagePlane?.frameOfReferenceUID) {
    dataset.FrameOfReferenceUID = imagePlane.frameOfReferenceUID;
  }

  // Ensure core reference chain exists and points to the source study/series.
  const frameUid = imagePlane?.frameOfReferenceUID;
  const studyUid = study?.studyInstanceUID;
  const seriesUid = series?.seriesInstanceUID;
  if (frameUid && studyUid && seriesUid) {
    if (!Array.isArray(dataset.ReferencedFrameOfReferenceSequence) || dataset.ReferencedFrameOfReferenceSequence.length === 0) {
      dataset.ReferencedFrameOfReferenceSequence = [{
        FrameOfReferenceUID: frameUid,
        RTReferencedStudySequence: [{
          ReferencedSOPClassUID: '1.2.840.10008.3.1.2.3.1',
          ReferencedSOPInstanceUID: studyUid,
          RTReferencedSeriesSequence: [{
            SeriesInstanceUID: seriesUid,
            ContourImageSequence: [],
          }],
        }],
      }];
    } else {
      const rfor = dataset.ReferencedFrameOfReferenceSequence[0] ?? {};
      rfor.FrameOfReferenceUID = rfor.FrameOfReferenceUID || frameUid;
      if (!Array.isArray(rfor.RTReferencedStudySequence) || rfor.RTReferencedStudySequence.length === 0) {
        rfor.RTReferencedStudySequence = [{
          ReferencedSOPClassUID: '1.2.840.10008.3.1.2.3.1',
          ReferencedSOPInstanceUID: studyUid,
          RTReferencedSeriesSequence: [{ SeriesInstanceUID: seriesUid, ContourImageSequence: [] }],
        }];
      } else {
        const rstudy = rfor.RTReferencedStudySequence[0] ?? {};
        rstudy.ReferencedSOPClassUID = rstudy.ReferencedSOPClassUID || '1.2.840.10008.3.1.2.3.1';
        rstudy.ReferencedSOPInstanceUID = rstudy.ReferencedSOPInstanceUID || studyUid;
        if (!Array.isArray(rstudy.RTReferencedSeriesSequence) || rstudy.RTReferencedSeriesSequence.length === 0) {
          rstudy.RTReferencedSeriesSequence = [{ SeriesInstanceUID: seriesUid, ContourImageSequence: [] }];
        } else {
          const rseries = rstudy.RTReferencedSeriesSequence[0] ?? {};
          rseries.SeriesInstanceUID = rseries.SeriesInstanceUID || seriesUid;
          rstudy.RTReferencedSeriesSequence[0] = rseries;
        }
        rfor.RTReferencedStudySequence[0] = rstudy;
      }
      dataset.ReferencedFrameOfReferenceSequence[0] = rfor;
    }
  }

}

function applyCurrentSegmentColorsToRtStructDataset(dataset: any, segmentationId: string): void {
  if (!dataset || !Array.isArray(dataset.ROIContourSequence)) return;

  const segSummary = useSegmentationStore
    .getState()
    .segmentations.find((seg) => seg.segmentationId === segmentationId);
  if (!segSummary) return;

  const colorBySegmentIndex = new Map<number, [number, number, number]>();
  for (const segment of segSummary.segments) {
    if (!Number.isFinite(segment.segmentIndex) || segment.segmentIndex <= 0) continue;
    colorBySegmentIndex.set(segment.segmentIndex, [
      Math.max(0, Math.min(255, Math.round(segment.color[0]))),
      Math.max(0, Math.min(255, Math.round(segment.color[1]))),
      Math.max(0, Math.min(255, Math.round(segment.color[2]))),
    ]);
  }

  for (let i = 0; i < dataset.ROIContourSequence.length; i++) {
    const roiContour = dataset.ROIContourSequence[i];
    if (!roiContour || typeof roiContour !== 'object') continue;
    const referenced = Number(roiContour.ReferencedROINumber);
    const lookupIndex = Number.isFinite(referenced) && referenced > 0 ? referenced : i + 1;
    const rgb = colorBySegmentIndex.get(lookupIndex);
    if (!rgb) continue;
    roiContour.ROIDisplayColor = rgb;
  }
}

function toStructureSetLabel(value: string | undefined): string {
  const trimmed = value?.trim() || 'RTSTRUCT';
  return trimmed.slice(0, 16);
}

// normalizeContourImageSequenceItems, contourImageReferenceKey, and
// collectContourImageReferencesFromRtStruct moved to `./dicomValidation`.

function matchSourceReferenceToContourImage(
  contourImageRef: Record<string, unknown>,
  refsBySopInstanceUID: Map<string, ReturnType<typeof collectSourceDicomReferences>>,
) {
  const sopInstanceUID = contourImageRef.ReferencedSOPInstanceUID as string;
  const referencedFrameNumber = parsePositiveInt(contourImageRef.ReferencedFrameNumber);
  const matches = refsBySopInstanceUID.get(sopInstanceUID) ?? [];
  if (matches.length === 0) {
    throw new Error(`RTSTRUCT contour references unknown SOP Instance UID ${sopInstanceUID}.`);
  }

  if (referencedFrameNumber) {
    const exactMatch = matches.find((ref) => ref.referencedFrameNumber === referencedFrameNumber);
    if (exactMatch) return exactMatch;
    if (matches.length === 1 && matches[0]?.numberOfFrames <= 1 && referencedFrameNumber === 1) {
      return matches[0];
    }
    throw new Error(
      `RTSTRUCT contour references frame ${referencedFrameNumber} of SOP Instance UID ${sopInstanceUID}, but no matching source frame metadata was found.`,
    );
  }

  if (matches.length === 1) {
    return matches[0];
  }

  const singleFrameMatches = matches.filter((ref) => ref.numberOfFrames <= 1);
  if (singleFrameMatches.length === 1) {
    return singleFrameMatches[0];
  }

  throw new Error(
    `RTSTRUCT contour reference for SOP Instance UID ${sopInstanceUID} is ambiguous without ReferencedFrameNumber.`,
  );
}

function buildReferencedSeriesSequence(
  contourImageReferences: Array<Record<string, unknown>>,
  refsBySopInstanceUID: Map<string, ReturnType<typeof collectSourceDicomReferences>>,
): any[] {
  const seriesMap = new Map<string, { instances: Map<string, Record<string, unknown>> }>();

  for (const contourImageReference of contourImageReferences) {
    const sourceRef = matchSourceReferenceToContourImage(contourImageReference, refsBySopInstanceUID);
    if (!sourceRef.seriesInstanceUID) {
      throw new Error('RTSTRUCT source image reference is missing SeriesInstanceUID.');
    }

    if (!seriesMap.has(sourceRef.seriesInstanceUID)) {
      seriesMap.set(sourceRef.seriesInstanceUID, { instances: new Map() });
    }

    const instanceMap = seriesMap.get(sourceRef.seriesInstanceUID)!;
    const key = contourImageReferenceKey(contourImageReference);
    if (!instanceMap.instances.has(key)) {
      instanceMap.instances.set(key, {
        ReferencedSOPClassUID:
          contourImageReference.ReferencedSOPClassUID ?? sourceRef.sopClassUID,
        ReferencedSOPInstanceUID: contourImageReference.ReferencedSOPInstanceUID,
        ...(parsePositiveInt(contourImageReference.ReferencedFrameNumber)
          ? { ReferencedFrameNumber: parsePositiveInt(contourImageReference.ReferencedFrameNumber) }
          : {}),
      });
    }
  }

  return Array.from(seriesMap.entries()).map(([seriesInstanceUID, entry]) => ({
    SeriesInstanceUID: seriesInstanceUID,
    ReferencedInstanceSequence: Array.from(entry.instances.values()),
  }));
}

function buildReferencedFrameOfReferenceSequence(
  contourImageReferences: Array<Record<string, unknown>>,
  refsBySopInstanceUID: Map<string, ReturnType<typeof collectSourceDicomReferences>>,
): any[] {
  const frameMap = new Map<
    string,
    Map<
      string,
      Map<
        string,
        Map<string, Record<string, unknown>>
      >
    >
  >();

  for (const contourImageReference of contourImageReferences) {
    const sourceRef = matchSourceReferenceToContourImage(contourImageReference, refsBySopInstanceUID);
    if (!sourceRef.frameOfReferenceUID) {
      throw new Error('RTSTRUCT source image reference is missing FrameOfReferenceUID.');
    }
    if (!sourceRef.studyInstanceUID) {
      throw new Error('RTSTRUCT source image reference is missing StudyInstanceUID.');
    }
    if (!sourceRef.seriesInstanceUID) {
      throw new Error('RTSTRUCT source image reference is missing SeriesInstanceUID.');
    }

    if (!frameMap.has(sourceRef.frameOfReferenceUID)) {
      frameMap.set(sourceRef.frameOfReferenceUID, new Map());
    }
    const studyMap = frameMap.get(sourceRef.frameOfReferenceUID)!;
    if (!studyMap.has(sourceRef.studyInstanceUID)) {
      studyMap.set(sourceRef.studyInstanceUID, new Map());
    }
    const seriesMap = studyMap.get(sourceRef.studyInstanceUID)!;
    if (!seriesMap.has(sourceRef.seriesInstanceUID)) {
      seriesMap.set(sourceRef.seriesInstanceUID, new Map());
    }
    const contourImageMap = seriesMap.get(sourceRef.seriesInstanceUID)!;
    const key = contourImageReferenceKey(contourImageReference);
    if (!contourImageMap.has(key)) {
      contourImageMap.set(key, {
        ReferencedSOPClassUID:
          contourImageReference.ReferencedSOPClassUID ?? sourceRef.sopClassUID,
        ReferencedSOPInstanceUID: contourImageReference.ReferencedSOPInstanceUID,
        ...(parsePositiveInt(contourImageReference.ReferencedFrameNumber)
          ? { ReferencedFrameNumber: parsePositiveInt(contourImageReference.ReferencedFrameNumber) }
          : {}),
      });
    }
  }

  return Array.from(frameMap.entries()).map(([frameOfReferenceUID, studyMap]) => ({
    FrameOfReferenceUID: frameOfReferenceUID,
    RTReferencedStudySequence: Array.from(studyMap.entries()).map(([studyInstanceUID, seriesMap]) => ({
      ReferencedSOPClassUID: '1.2.840.10008.3.1.2.3.1',
      ReferencedSOPInstanceUID: studyInstanceUID,
      RTReferencedSeriesSequence: Array.from(seriesMap.entries()).map(([seriesInstanceUID, contourImageMap]) => ({
        SeriesInstanceUID: seriesInstanceUID,
        ContourImageSequence: Array.from(contourImageMap.values()),
      })),
    })),
  }));
}

// validateRtStructDataset moved to `./dicomValidation`.

// ─── Export ─────────────────────────────────────────────────────

/**
 * Export a contour segmentation as DICOM RTSTRUCT binary (base64 string).
 *
 * Uses @cornerstonejs/adapters' generateRTSSFromContour() which reads
 * contour annotations from the segmentation's annotationUIDsMap and
 * builds a complete RTSS dataset. We then serialize it to DICOM binary
 * using dcmjs.
 *
 * IMPORTANT: We use generateRTSSFromContour (not generateRTSSFromRepresentation)
 * because the latter checks Labelmap first and invokes generateContourSetsFromLabelmap
 * via a web worker — which fails in Electron/Vite dev mode. Since our segmentations
 * always have a Contour representation (ensured before export), we bypass the
 * Labelmap path entirely.
 */
async function exportToRtStruct(segmentationId: string): Promise<string> {
  // Resolve the RTSS adapter via the statically-imported `adaptersRT`.
  // The package exports map guarantees `adaptersRT.Cornerstone3D.RTSS` is
  // the `./RTStruct` module which re-exports everything from `./RTSS`,
  // including `generateRTSSFromContour`.
  //
  // Previously this resolution was done via two sequential `await import()`
  // calls wrapped in try/catch-swallow blocks. Both paths could silently
  // fail for unrelated reasons (bundler issues, network glitches) and the
  // only surfaced error was a generic "could not find" at export time.
  // A static import fails at module load instead, making dev-time
  // breakage obvious.
  const generateContourFn = (adaptersRT as any)?.Cornerstone3D?.RTSS?.generateRTSSFromContour;
  if (typeof generateContourFn !== 'function') {
    throw new Error(
      '[rtStructService] `adaptersRT.Cornerstone3D.RTSS.generateRTSSFromContour` ' +
      'is missing from @cornerstonejs/adapters. The package export shape may ' +
      'have changed; rtStructService.ts needs an update.',
    );
  }

  const seg = csSegmentation.state.getSegmentation(segmentationId);
  if (!seg) {
    throw new Error(`[rtStructService] Segmentation not found: ${segmentationId}`);
  }

  // Ensure the segmentation has a Contour representation with annotations
  if (!contourRep.hasContourRepresentation(segmentationId)) {
    throw new Error(
      '[rtStructService] Segmentation has no contour representation. ' +
      'Draw contours or load an RTSTRUCT before exporting.',
    );
  }

  console.log('[rtStructService] Exporting RTSTRUCT for segmentation:', segmentationId);

  const trackedSourceIds = segmentationService.getTrackedSourceImageIds(segmentationId);
  if (!trackedSourceIds || trackedSourceIds.length === 0) {
    throw new Error('[rtStructService] RTSTRUCT export requires tracked source image IDs.');
  }
  const sourceRefs = collectSourceDicomReferences(trackedSourceIds, metaData.get.bind(metaData));
  const primarySourceRef = requireSingleStudyReference(sourceRefs, 'RTSTRUCT export');

  // Build a custom metadataProvider that bridges gaps between what the
  // adapters' referencedMetadataProvider expects and what our DICOMweb
  // image loader actually registers.
  //
  // Key issue: the adapter calls metaData.get('frameModule', imageId)
  // expecting { sopClassUID, sopInstanceUID, frameNumber, numberOfFrames }
  // but our image loader doesn't register a 'frameModule' — it puts those
  // values in 'sopCommonModule' and 'multiframeModule'.
  const exportMetadataProvider = {
    get: (type: string, ...args: any[]) => {
      const imageId = args[0] as string;

      if (type === 'frameModule') {
        return resolveFrameModule(imageId);
      }

      // For all other module types, delegate to Cornerstone's provider chain
      return metaData.get(type, imageId);
    },
  };

  // Generate the RTSS dataset using the contour-specific adapter.
  // generateRTSSFromContour is synchronous — it reads annotation state directly.
  // Must pass a metadataProvider in options so createInstance() can destructure
  // { metadataProvider = metaData } without throwing on undefined, AND so
  // the referencedMetadataProvider gets frameModule data from our bridge.
  const rtssDataset: any = generateContourFn(seg, {
    metadataProvider: exportMetadataProvider,
  });
  applySourceDicomContextToRtStructDataset(rtssDataset, primarySourceRef.imageId);
  if (!rtssDataset.StudyInstanceUID && primarySourceRef.studyInstanceUID) {
    rtssDataset.StudyInstanceUID = primarySourceRef.studyInstanceUID;
  }
  if (!rtssDataset.PatientName && primarySourceRef.patientName) {
    rtssDataset.PatientName = primarySourceRef.patientName;
  }
  if (!rtssDataset.PatientID && primarySourceRef.patientId) {
    rtssDataset.PatientID = primarySourceRef.patientId;
  }
  if (!rtssDataset.PatientBirthDate && primarySourceRef.patientBirthDate) {
    rtssDataset.PatientBirthDate = primarySourceRef.patientBirthDate;
  }
  if (!rtssDataset.PatientSex && primarySourceRef.patientSex) {
    rtssDataset.PatientSex = primarySourceRef.patientSex;
  }
  if (!rtssDataset.StudyDate && primarySourceRef.studyDate) {
    rtssDataset.StudyDate = primarySourceRef.studyDate;
  }
  if (!rtssDataset.StudyTime && primarySourceRef.studyTime) {
    rtssDataset.StudyTime = primarySourceRef.studyTime;
  }
  if (!rtssDataset.StudyID && primarySourceRef.studyID) {
    rtssDataset.StudyID = primarySourceRef.studyID;
  }
  if (!rtssDataset.AccessionNumber && primarySourceRef.accessionNumber) {
    rtssDataset.AccessionNumber = primarySourceRef.accessionNumber;
  }
  if (!rtssDataset.StudyDescription && primarySourceRef.studyDescription) {
    rtssDataset.StudyDescription = primarySourceRef.studyDescription;
  }
  if (!rtssDataset.ReferringPhysicianName && primarySourceRef.referringPhysicianName) {
    rtssDataset.ReferringPhysicianName = primarySourceRef.referringPhysicianName;
  }
  if (!rtssDataset.FrameOfReferenceUID && primarySourceRef.frameOfReferenceUID) {
    rtssDataset.FrameOfReferenceUID = primarySourceRef.frameOfReferenceUID;
  }
  const operatorsName = upsertOperatorsName(
    rtssDataset.OperatorsName,
    formatOperatorsNameForConnection(useConnectionStore.getState().connection),
  );
  if (operatorsName) {
    rtssDataset.OperatorsName = operatorsName;
  }
  applyCurrentSegmentColorsToRtStructDataset(rtssDataset, segmentationId);
  if (Array.isArray(rtssDataset.RTROIObservationsSequence)) {
    for (const observation of rtssDataset.RTROIObservationsSequence) {
      if (observation && typeof observation === 'object' && observation.ROIInterpreter == null) {
        observation.ROIInterpreter = '';
      }
    }
  }
  rtssDataset.Modality = 'RTSTRUCT';
  const segmentationLabel =
    (seg as any).config?.label
    || (seg as any).label
    || 'RT Structure Set';
  rtssDataset.StructureSetLabel = toStructureSetLabel(rtssDataset.StructureSetLabel || segmentationLabel);
  rtssDataset.StructureSetName = rtssDataset.StructureSetName || segmentationLabel;
  rtssDataset.StructureSetDescription =
    rtssDataset.StructureSetDescription || segmentationLabel;
  rtssDataset.SeriesDescription = rtssDataset.SeriesDescription || segmentationLabel;
  rtssDataset.PositionReferenceIndicator = rtssDataset.PositionReferenceIndicator ?? '';

  const refsBySopInstanceUID = new Map<string, typeof sourceRefs>();
  for (const sourceRef of sourceRefs) {
    if (!sourceRef.sopInstanceUID) continue;
    const existing = refsBySopInstanceUID.get(sourceRef.sopInstanceUID) ?? [];
    existing.push(sourceRef);
    refsBySopInstanceUID.set(sourceRef.sopInstanceUID, existing);
  }

  const contourImageReferences = collectContourImageReferencesFromRtStruct(rtssDataset);
  rtssDataset.ReferencedFrameOfReferenceSequence = buildReferencedFrameOfReferenceSequence(
    contourImageReferences,
    refsBySopInstanceUID,
  );
  if (!rtssDataset.FrameOfReferenceUID && rtssDataset.ReferencedFrameOfReferenceSequence.length === 1) {
    rtssDataset.FrameOfReferenceUID = rtssDataset.ReferencedFrameOfReferenceSequence[0]?.FrameOfReferenceUID;
  }
  validateRtStructDataset(rtssDataset);

  const { arrayBuffer } = serializeDerivedDicomDataset(rtssDataset, {
    kind: 'RTSTRUCT',
    callerTag: 'rtStructService',
    defaultSOPClassUID: '1.2.840.10008.5.1.4.1.1.481.3',
    requiredDatasetFields: [
      'SOPClassUID',
      'SOPInstanceUID',
      'StudyInstanceUID',
      'SeriesInstanceUID',
      'FrameOfReferenceUID',
      'Modality',
      'StructureSetLabel',
      'StructureSetDate',
      'StructureSetTime',
      'StructureSetROISequence',
      'ROIContourSequence',
      'RTROIObservationsSequence',
      'ReferencedFrameOfReferenceSequence',
    ],
    expectedDatasetValues: {
      Modality: 'RTSTRUCT',
      StudyInstanceUID: primarySourceRef.studyInstanceUID,
    },
    includeStructureSetDateTime: true,
  });

  // Convert to base64 for IPC transport
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  console.log(
    `[rtStructService] Exported RTSTRUCT: ${(arrayBuffer.byteLength / 1024).toFixed(1)} KB`,
  );

  return base64;
}

// ─── Public API ─────────────────────────────────────────────────

export const rtStructService = {
  parseRtStruct,
  loadRtStructAsContours,
  exportToRtStruct,
};
