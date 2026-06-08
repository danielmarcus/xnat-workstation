/**
 * DICOM SEG export for segmentationService.
 *
 * Extracted verbatim from segmentationService.ts (P1.8e decomposition, pure
 * extraction — no logic change). Exports a Cornerstone segmentation (or a
 * multi-layer group, composited into multi-valued labelmaps) as a base64
 * DICOM SEG binary via the @cornerstonejs/adapters generateSegmentation path.
 *
 * The only service-specific dependency is the current default color palette
 * (which can be reassigned via setDefaultColorSequence), injected as a live
 * getter through {@link createDicomSegExport}. Everything else is imported
 * directly. The service delegates its public exportToDicomSeg /
 * _exportGroupToDicomSeg methods here so its public API is unchanged.
 */
import { metaData, cache, imageLoader } from '@cornerstonejs/core';
import { segmentation as csSegmentation, Enums as ToolEnums } from '@cornerstonejs/tools';
import { adaptersSEG } from '@cornerstonejs/adapters';
import { data as dcmjsData } from 'dcmjs';
import { useConnectionStore } from '../../../stores/connectionStore';
import { rtStructService } from '../rtStructService';
import * as sourceImageTracking from '../sourceImageTracking';
import * as mlg from '../multiLayerGroup';
import { sanitizeSegmentIndices } from './segmentationHelpers';
import { applySourceDicomContextToSegDataset } from './dicomContext';
import {
  serializeDerivedDicomDataset,
  requireSingleStudyReference,
  collectSourceDicomReferences,
} from '../dicomExportHelpers';
import {
  formatOperatorsNameForConnection,
  upsertOperatorsName,
} from '../operatorsName';

const SEGMENTED_PROPERTY_CATEGORY_CODE = Object.freeze({
  CodeValue: '91723000',
  CodingSchemeDesignator: 'SCT',
  CodeMeaning: 'Anatomical structure',
});

const SEGMENTED_PROPERTY_TYPE_CODE = Object.freeze({
  CodeValue: '85756007',
  CodingSchemeDesignator: 'SCT',
  CodeMeaning: 'Tissue',
});

export interface DicomSegExportDeps {
  /** Current default color palette (live; respects setDefaultColorSequence). */
  getDefaultColors(): [number, number, number, number][];
}

export interface DicomSegExport {
  exportToDicomSeg(segmentationId: string): Promise<string>;
  _exportGroupToDicomSeg(groupId: string): Promise<string>;
}

export function createDicomSegExport(deps: DicomSegExportDeps): DicomSegExport {
  const isMultiLayerGroup = mlg.isMultiLayerGroup;

  /**
   * Export a segmentation as a DICOM SEG binary (base64-encoded).
   *
   * Pipeline:
   * 1. Retrieve the Cornerstone segmentation state + source imageIds
   * 2. Get source image objects from cache (they provide DICOM metadata)
   * 3. Build labelmaps2D array + segment metadata for the adapter
   * 4. Call adaptersSEG.Cornerstone3D.Segmentation.generateSegmentation()
   * 5. Serialize derivation dataset to ArrayBuffer via dcmjs
   * 6. Return base64-encoded string for IPC transport
   */
  async function exportToDicomSeg(segmentationId: string): Promise<string> {
    // ─── Multi-layer group path ─────────────────────────────
    // Composite all sub-seg binary layers into multi-valued labelmaps,
    // build a temporary Cornerstone segmentation for the legacy export path.
    if (isMultiLayerGroup(segmentationId)) {
      return _exportGroupToDicomSeg(segmentationId);
    }

    // ─── Legacy (non-group) path ────────────────────────────
    const seg = csSegmentation.state.getSegmentation(segmentationId);
    if (!seg) {
      throw new Error(`[segmentationService] Segmentation not found: ${segmentationId}`);
    }

    const storedSrcImageIds = sourceImageTracking.getSourceImageIds(segmentationId);
    if (!storedSrcImageIds || storedSrcImageIds.length === 0) {
      throw new Error(
        '[segmentationService] No source imageIds tracked for this segmentation. ' +
        'Cannot export without source DICOM references.',
      );
    }
    // Work with a copy so sorting doesn't mutate the stored array
    const originalSrcImageIds = [...storedSrcImageIds];
    let srcImageIds = [...originalSrcImageIds];
    const originalIndexBySourceId = new Map<string, number>();
    const validIndexBySourceId = new Map<string, number>();
    originalSrcImageIds.forEach((id, idx) => {
      if (!originalIndexBySourceId.has(id)) {
        originalIndexBySourceId.set(id, idx);
      }
    });

    // Get labelmap imageIds from the segmentation's representation data
    const labelmapData = seg.representationData?.Labelmap;
    if (!labelmapData) {
      throw new Error('[segmentationService] Segmentation has no Labelmap representation data.');
    }
    const labelmapImageIds: string[] = (labelmapData as any).imageIds ?? [];
    if (labelmapImageIds.length === 0) {
      throw new Error('[segmentationService] Segmentation has no labelmap imageIds.');
    }

    console.log(`[segmentationService] Exporting DICOM SEG: ${segmentationId} (${labelmapImageIds.length} slices)`);

    // Step 1: Get source Cornerstone image objects (needed by generateSegmentation
    // for DICOM metadata extraction: study/series/image UIDs, pixel spacing, etc.)
    const sourceImages: any[] = [];
    const validSrcImageIds: string[] = [];
    const skippedSources: Array<{ srcId: string; index: number; error: string }> = [];
    for (const srcId of originalSrcImageIds) {
      const img = cache.getImage(srcId);
      if (!img) {
        skippedSources.push({
          srcId,
          index: originalIndexBySourceId.get(srcId) ?? -1,
          error: 'source image not cached',
        });
        continue;
      }
      const validIndex = validSrcImageIds.length;
      sourceImages.push(img);
      validSrcImageIds.push(srcId);
      validIndexBySourceId.set(srcId, validIndex);
    }
    if (sourceImages.length === 0) {
      const first = skippedSources[0];
      throw new Error(
        `[segmentationService] Could not load any source images for export. `
        + `${first ? `${first.srcId}: ${first.error}` : ''}`,
      );
    }
    srcImageIds = validSrcImageIds;
    if (skippedSources.length > 0) {
      console.warn(
        `[segmentationService] Skipping ${skippedSources.length}/${originalSrcImageIds.length} source images `
        + `that failed to load for export (likely non-image DICOM objects).`,
      );
    }

    // Step 2: Build labelmaps2D array — one entry per source image slice.
    // Each entry has { pixelData, segmentsOnLabelmap, rows, columns }.
    //
    // CRITICAL: labelmaps2D[i] must correspond to sourceImages[i] (and
    // srcImageIds[i]).  generateSegmentation pairs them by index.
    //
    // For stack-based segmentations, the brush tool writes pixel data into
    // the labelmap images managed by the SegmentationStateManager's
    // _stackLabelmapImageIdReferenceMap. We need to read the LIVE data
    // from those mapped images, not just the original registered imageIds
    // (which may point to stale/empty cache entries).
    //
    // Strategy: use csSegmentation.segmentation.getLabelmapImageIds() to get
    // the canonical imageIds, then try cache.getImage() for each. Also try
    // the viewport-mapped imageIds via getStackSegmentationImageIdsForViewport.
    const labelmaps2D: any[] = [];
    const rows = sourceImages[0].rows ?? sourceImages[0].height ?? 512;
    const columns = sourceImages[0].columns ?? sourceImages[0].width ?? 512;

    // Use the labelmap imageIds from the representation data directly.
    // DO NOT call getStackSegmentationImageIdsForViewport() — it triggers
    // _updateAllLabelmapSegmentationImageReferences() which is broken in v4.16
    // and corrupts the _stackLabelmapImageIdReferenceMap (maps all source images
    // to the same labelmap, causing bleed to all slices + extreme lag).
    const effectiveLmIds = labelmapImageIds;

    const toImageIdMatchKey = (imageId: string | undefined): string => {
      if (!imageId || typeof imageId !== 'string') return '';
      let key = imageId;
      if (key.startsWith('wadouri:')) key = key.slice('wadouri:'.length);
      if (key.startsWith('wadors:')) key = key.slice('wadors:'.length);
      key = key.replace(/\/frames\/\d+$/i, '');
      key = key
        .replace(/([?&])frame=\d+(&?)/gi, (_m, sep, tail) => (sep === '?' && tail ? '?' : tail ? sep : ''))
        .replace(/[?&]$/, '');
      return key;
    };
    const getSopUidForImageId = (imageId: string | undefined): string | undefined => {
      if (!imageId || typeof imageId !== 'string') return undefined;
      const gen = metaData.get('generalImageModule', imageId) as any;
      const inst = metaData.get('instance', imageId) as any;
      const metaUid = gen?.sopInstanceUID ?? inst?.SOPInstanceUID ?? inst?.sopInstanceUID;
      if (typeof metaUid === 'string' && metaUid.length > 0) return metaUid;
      const key = toImageIdMatchKey(imageId);
      const queryIndex = key.indexOf('?');
      if (queryIndex < 0) return undefined;
      const params = new URLSearchParams(key.slice(queryIndex + 1));
      const queryUid =
        params.get('objectUID')
        ?? params.get('objectUid')
        ?? params.get('SOPInstanceUID')
        ?? params.get('sopInstanceUID');
      return queryUid ?? undefined;
    };

    // Build source->labelmap lookup maps.
    const refIdToLabelmap = new Map<string, any>();
    const refKeyToLabelmap = new Map<string, any>();
    const refSopToLabelmap = new Map<string, any>();
    for (let li = 0; li < effectiveLmIds.length; li++) {
      const lmId = effectiveLmIds[li];
      if (!lmId) continue;
      const lmImage = cache.getImage(lmId);
      if (!lmImage) continue;
      const refId = (lmImage as any).referencedImageId;
      if (refId) {
        refIdToLabelmap.set(refId, lmImage);
        const refKey = toImageIdMatchKey(refId);
        if (refKey && !refKeyToLabelmap.has(refKey)) {
          refKeyToLabelmap.set(refKey, lmImage);
        }
        const refSopUid = getSopUidForImageId(refId);
        if (refSopUid && !refSopToLabelmap.has(refSopUid)) {
          refSopToLabelmap.set(refSopUid, lmImage);
        }
      }
    }
    const resolveMappedLabelmapImage = (value: any): any | undefined => {
      if (typeof value === 'string' && value.length > 0) {
        return cache.getImage(value);
      }
      if (Array.isArray(value)) {
        for (const candidate of value) {
          if (typeof candidate !== 'string' || candidate.length === 0) continue;
          const img = cache.getImage(candidate);
          if (img) return img;
        }
      }
      return undefined;
    };
    const stackRefIdToLabelmap = new Map<string, any>();
    const stackRefKeyToLabelmap = new Map<string, any>();
    const stackRefSopToLabelmap = new Map<string, any>();
    try {
      const mgr = csSegmentation.defaultSegmentationStateManager as any;
      const stackRefMap = mgr?._stackLabelmapImageIdReferenceMap?.get?.(segmentationId);
      if (stackRefMap && typeof stackRefMap.forEach === 'function') {
        stackRefMap.forEach((lmValue: any, refIdRaw: any) => {
          const refId = typeof refIdRaw === 'string' ? refIdRaw : String(refIdRaw ?? '');
          if (!refId) return;
          const lmImage = resolveMappedLabelmapImage(lmValue);
          if (!lmImage) return;
          stackRefIdToLabelmap.set(refId, lmImage);
          const refKey = toImageIdMatchKey(refId);
          if (refKey && !stackRefKeyToLabelmap.has(refKey)) {
            stackRefKeyToLabelmap.set(refKey, lmImage);
          }
          const refSopUid = getSopUidForImageId(refId);
          if (refSopUid && !stackRefSopToLabelmap.has(refSopUid)) {
            stackRefSopToLabelmap.set(refSopUid, lmImage);
          }
        });
      }
    } catch (err) {
      console.debug('[segmentationService] Could not read stack labelmap reference map:', err);
    }

    const resolveLabelmapImage = (srcId: string, sourceIndex: number): { image: any | undefined; match: 'ref' | 'normalized' | 'sop' | 'index' | 'none' } => {
      const stackExact = stackRefIdToLabelmap.get(srcId);
      if (stackExact) return { image: stackExact, match: 'ref' };
      const exact = refIdToLabelmap.get(srcId);
      if (exact) return { image: exact, match: 'ref' };

      const srcKey = toImageIdMatchKey(srcId);
      if (srcKey) {
        const stackNormalized = stackRefKeyToLabelmap.get(srcKey);
        if (stackNormalized) return { image: stackNormalized, match: 'normalized' };
        const normalized = refKeyToLabelmap.get(srcKey);
        if (normalized) return { image: normalized, match: 'normalized' };
      }

      const srcSopUid = getSopUidForImageId(srcId);
      if (srcSopUid) {
        const stackSopMatch = stackRefSopToLabelmap.get(srcSopUid);
        if (stackSopMatch) return { image: stackSopMatch, match: 'sop' };
        const sopMatch = refSopToLabelmap.get(srcSopUid);
        if (sopMatch) return { image: sopMatch, match: 'sop' };
      }

      const lmByIndex = cache.getImage(effectiveLmIds[sourceIndex]);
      if (lmByIndex) return { image: lmByIndex, match: 'index' };
      return { image: undefined, match: 'none' };
    };

    const getSliceHasPixels = (lmImage: any): boolean => {
      if (!lmImage) return false;
      const scalarData: any =
        lmImage.voxelManager?.getScalarData?.()
        ?? lmImage.imageFrame?.pixelData
        ?? lmImage.getPixelData?.();
      if (!scalarData || typeof scalarData.length !== 'number') return false;
      for (let i = 0; i < scalarData.length; i++) {
        if (Number(scalarData[i]) > 0) return true;
      }
      return false;
    };

    if (skippedSources.length > 0) {
      const skippedWithPaintedData = skippedSources.filter(({ srcId, index }) => {
        const fallbackIndex = index >= 0 && index < effectiveLmIds.length
          ? index
          : 0;
        const resolved = resolveLabelmapImage(srcId, fallbackIndex);
        return getSliceHasPixels(resolved.image);
      });
      if (skippedWithPaintedData.length > 0) {
        const first = skippedWithPaintedData[0];
        throw new Error(
          `[segmentationService] Cannot export SEG: source slice ${first.srcId} failed to load `
          + `(${first.error}) and contains segmentation data.`,
        );
      }
    }

    // Debug: sample first labelmap to understand its structure
    const sampleLmId = effectiveLmIds[0];
    if (sampleLmId) {
      const sampleImg = cache.getImage(sampleLmId);
      console.log(`[segmentationService] Sample labelmap [0]: id=${sampleLmId}, cached=${!!sampleImg}, hasVoxelManager=${!!sampleImg?.voxelManager}, referencedImageId=${(sampleImg as any)?.referencedImageId}`);
      if (sampleImg?.voxelManager) {
        const sd = sampleImg.voxelManager.getScalarData();
        let nonZero = 0;
        for (let k = 0; k < sd.length; k++) { if (sd[k] !== 0) nonZero++; }
        console.log(`[segmentationService] Sample labelmap scalar data: type=${sd.constructor.name}, length=${sd.length}, nonZero=${nonZero}`);
      }
    }

    const lookupStats = { ref: 0, normalized: 0, sop: 0, index: 0, none: 0 };
    for (let i = 0; i < srcImageIds.length; i++) {
      const srcId = srcImageIds[i];
      const sourceIndex = validIndexBySourceId.get(srcId) ?? i;
      const resolved = resolveLabelmapImage(srcId, sourceIndex);
      lookupStats[resolved.match]++;
      const lmImage = resolved.image;

      if (!lmImage) {
        labelmaps2D.push({
          pixelData: new Uint8Array(rows * columns),
          segmentsOnLabelmap: [],
          rows,
          columns,
        });
        continue;
      }

      // Get pixel data from the labelmap image.
      // scalarData may be Float32Array, Int16Array, etc. — we need Uint8 label values.
      let pixelData: Uint8Array;
      if (lmImage.voxelManager) {
        const scalarData = lmImage.voxelManager.getScalarData();
        if (scalarData instanceof Uint8Array || scalarData instanceof Uint8ClampedArray) {
          pixelData = new Uint8Array(scalarData);
        } else {
          pixelData = new Uint8Array(scalarData.length);
          for (let k = 0; k < scalarData.length; k++) {
            pixelData[k] = Math.max(0, Math.min(255, Math.round(scalarData[k])));
          }
        }
      } else if ((lmImage as any).getPixelData) {
        const raw = (lmImage as any).getPixelData();
        if (raw instanceof Uint8Array || raw instanceof Uint8ClampedArray) {
          pixelData = new Uint8Array(raw);
        } else {
          pixelData = new Uint8Array(raw.length);
          for (let k = 0; k < raw.length; k++) {
            pixelData[k] = Math.max(0, Math.min(255, Math.round(raw[k])));
          }
        }
      } else {
        pixelData = new Uint8Array(rows * columns);
      }

      // Find which segments are present on this slice
      const segmentsOnSlice = new Set<number>();
      for (let j = 0; j < pixelData.length; j++) {
        if (pixelData[j] > 0) {
          segmentsOnSlice.add(pixelData[j]);
        }
      }

      labelmaps2D.push({
        pixelData,
        segmentsOnLabelmap: sanitizeSegmentIndices(Array.from(segmentsOnSlice)),
        rows,
        columns,
      });
    }
    console.log(
      `[segmentationService] labelmap lookup: ref=${lookupStats.ref}, normalized=${lookupStats.normalized}, `
      + `sop=${lookupStats.sop}, index=${lookupStats.index}, none=${lookupStats.none}`,
    );

    // Step 3: Build segment metadata array (index 0 = null for background).
    const segmentMetadata: any[] = [null]; // index 0 = background
    if (seg.segments) {
      // seg.segments can be a Map or a plain object depending on Cornerstone version
      const segKeys: number[] = [];
      if (seg.segments instanceof Map) {
        for (const k of seg.segments.keys()) {
          const n = typeof k === 'number' ? k : parseInt(String(k), 10);
          if (n > 0 && !isNaN(n)) segKeys.push(n);
        }
      } else {
        for (const k of Object.keys(seg.segments)) {
          const n = parseInt(k, 10);
          if (n > 0 && !isNaN(n)) segKeys.push(n);
        }
      }
      const maxIdx = segKeys.length > 0 ? Math.max(...segKeys) : 0;

      for (let idx = 1; idx <= maxIdx; idx++) {
        const segment = seg.segments instanceof Map ? seg.segments.get(idx) : seg.segments[idx];
        if (!segment) {
          segmentMetadata.push(null);
          continue;
        }

        // Get color for recommended display
        let color = deps.getDefaultColors()[(idx - 1) % deps.getDefaultColors().length];
        const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(segmentationId);
        if (viewportIds.length > 0) {
          try {
            const c = csSegmentation.config.color.getSegmentIndexColor(
              viewportIds[0],
              segmentationId,
              idx,
            );
            if (c && c.length >= 3) {
              color = [c[0], c[1], c[2], c[3] ?? 255];
            }
          } catch {
            // Use default
          }
        }

        // Convert RGB (0-255) to normalized RGB (0-1), then to DICOM CIE Lab
        const normalizedRgb = [color[0] / 255, color[1] / 255, color[2] / 255];
        const cieLabValues =
          (dcmjsData as any).Colors?.rgb2DICOMLAB?.(normalizedRgb) ?? [0, 0, 0];

        segmentMetadata.push({
          SegmentLabel: segment.label || `Segment ${idx}`,
          SegmentDescription: segment.label || `Segment ${idx}`,
          SegmentNumber: idx,
          SegmentAlgorithmType: 'SEMIAUTOMATIC',
          SegmentAlgorithmName: 'XNAT Workstation',
          SegmentedPropertyCategoryCodeSequence: SEGMENTED_PROPERTY_CATEGORY_CODE,
          SegmentedPropertyTypeCodeSequence: SEGMENTED_PROPERTY_TYPE_CODE,
          RecommendedDisplayCIELabValue: cieLabValues,
        });
      }
    }

    // Step 4: Build labelmap3D structure for the adapter
    const labelmap3D = {
      labelmaps2D,
      metadata: segmentMetadata,
    };

    // Step 5: Call generateSegmentation with a metadata wrapper.
    //
    // generateSegmentation internally calls:
    //   metadata.get("StudyData", imageId)   → study-level DICOM attributes
    //   metadata.get("SeriesData", imageId)  → series-level DICOM attributes
    //   metadata.get("ImageData", imageId)   → image-level attributes (MUST include Rows, Columns)
    //
    // These module types are normally handled by the adapters' referencedMetadataProvider
    // (registered as a side-effect). If the side-effect was tree-shaken, these
    // return undefined, and dcmjs derivation sets Rows/Columns to "" (via || ""),
    // causing a 0-byte PixelData allocation and empty SEG files.
    //
    // We create an explicit metadata provider that:
    // 1. Uses metaData.getNormalized() for the complex metadata chains
    // 2. ALWAYS forces Rows/Columns to the known source image dimensions
    //    (from sourceImages[0].rows/columns, already computed as `rows`/`columns` above)
    //    This is the single most critical guarantee — without valid Rows/Columns,
    //    the entire SEG generation produces a broken empty file.
    const STUDY_MODULES = ['patientModule', 'patientStudyModule', 'generalStudyModule'];
    const SERIES_MODULES = ['generalSeriesModule'];
    const IMAGE_MODULES = ['generalImageModule', 'imagePlaneModule', 'cineModule', 'voiLutModule', 'modalityLutModule', 'sopCommonModule'];

    const getArrayFromVectorLike = (value: any): number[] | null => {
      if (Array.isArray(value) && value.length >= 3) {
        return [Number(value[0]), Number(value[1]), Number(value[2])];
      }
      if (
        value
        && typeof value === 'object'
        && Number.isFinite(value.x)
        && Number.isFinite(value.y)
        && Number.isFinite(value.z)
      ) {
        return [Number(value.x), Number(value.y), Number(value.z)];
      }
      return null;
    };

    const exportMetadataProvider = {
      get: (type: string, ...args: any[]) => {
        const imageId = args[0] as string;
        if (type === 'StudyData') {
          return metaData.getNormalized(imageId, STUDY_MODULES);
        }
        if (type === 'SeriesData') {
          return metaData.getNormalized(imageId, SERIES_MODULES);
        }
        if (type === 'ImageData') {
          const normalized: Record<string, any> = metaData.getNormalized(imageId, IMAGE_MODULES);
          const imagePlane = metaData.get('imagePlaneModule', imageId) as any;
          const sourceIndex = Math.max(0, srcImageIds.indexOf(imageId));

          // Ensure ImageOrientationPatient exists (dcmjs SEG normalizer requires it).
          if (!Array.isArray(normalized.ImageOrientationPatient) || normalized.ImageOrientationPatient.length < 6) {
            const fromNormalized = Array.isArray(normalized.imageOrientationPatient) && normalized.imageOrientationPatient.length >= 6
              ? normalized.imageOrientationPatient
              : null;
            const fromPlane = Array.isArray(imagePlane?.imageOrientationPatient) && imagePlane.imageOrientationPatient.length >= 6
              ? imagePlane.imageOrientationPatient
              : null;
            const row = getArrayFromVectorLike(imagePlane?.rowCosines);
            const col = getArrayFromVectorLike(imagePlane?.columnCosines);
            if (fromNormalized) {
              normalized.ImageOrientationPatient = [...fromNormalized];
            } else if (fromPlane) {
              normalized.ImageOrientationPatient = [...fromPlane];
            } else if (row && col) {
              normalized.ImageOrientationPatient = [...row, ...col];
            } else {
              // Last-resort orthogonal identity orientation for single-slice / malformed metadata.
              normalized.ImageOrientationPatient = [1, 0, 0, 0, 1, 0];
            }
          }

          // Ensure ImagePositionPatient exists (dcmjs SEG normalizer requires it).
          if (!Array.isArray(normalized.ImagePositionPatient) || normalized.ImagePositionPatient.length < 3) {
            const fromNormalized = Array.isArray(normalized.imagePositionPatient) && normalized.imagePositionPatient.length >= 3
              ? normalized.imagePositionPatient
              : null;
            const fromPlane = Array.isArray(imagePlane?.imagePositionPatient) && imagePlane.imagePositionPatient.length >= 3
              ? imagePlane.imagePositionPatient
              : null;
            if (fromNormalized) {
              normalized.ImagePositionPatient = [...fromNormalized];
            } else if (fromPlane) {
              normalized.ImagePositionPatient = [...fromPlane];
            } else {
              // Keep deterministic ordering along Z when true geometry is unavailable.
              normalized.ImagePositionPatient = [0, 0, sourceIndex];
            }
          }

          // Prefer explicit PixelSpacing when imagePlane provides it.
          if (!Array.isArray(normalized.PixelSpacing) || normalized.PixelSpacing.length < 2) {
            const rowSpacing = Number(imagePlane?.rowPixelSpacing);
            const colSpacing = Number(imagePlane?.columnPixelSpacing);
            if (Number.isFinite(rowSpacing) && Number.isFinite(colSpacing) && rowSpacing > 0 && colSpacing > 0) {
              normalized.PixelSpacing = [rowSpacing, colSpacing];
            }
          }

          if (!normalized.FrameOfReferenceUID && imagePlane?.frameOfReferenceUID) {
            normalized.FrameOfReferenceUID = imagePlane.frameOfReferenceUID;
          }

          // ALWAYS force Rows/Columns from known source image dimensions.
          // This is the critical fix: we do NOT trust the metadata chain to
          // provide these. We use the source image dimensions directly.
          normalized.Rows = rows;
          normalized.Columns = columns;
          return normalized;
        }
        // For all other module types, delegate to Cornerstone's provider chain
        return metaData.get(type, imageId);
      },
    };

    // ─── Sort sourceImages + labelmaps2D by IPP distance (descending) ───
    //
    // CRITICAL: dcmjs SEGImageNormalizer.normalize() internally sorts the
    // datasets by distance along the scan axis (descending — see
    // ImageNormalizer.normalize() in dcmjs). It then builds the
    // PerFrameFunctionalGroupsSequence in that sorted order. However,
    // fillSegmentation() pairs labelmaps2D[i] with frame i by index.
    //
    // If sourceImages / labelmaps2D are in filename order (which may be
    // REVERSED relative to IPP spatial order), the pixel data gets written
    // to the wrong PerFrameFunctionalGroupsSequence frame — causing the
    // "paint on slice 2, shows on slice 19" mirroring bug after reload.
    //
    // Fix: sort both arrays by IPP distance (descending) BEFORE passing to
    // generateSegmentation, matching the normalizer's internal sort. This
    // ensures labelmaps2D[i] corresponds to the correct sorted frame.
    {
      const refPlane = metaData.get('imagePlaneModule', srcImageIds[0]);
      const refIOP = refPlane?.imageOrientationPatient;
      const refIPP = refPlane?.imagePositionPatient;

      if (refIOP && refIPP) {
        // Compute scan axis (same cross product as dcmjs normalizer)
        const rowVec = [refIOP[0], refIOP[1], refIOP[2]];
        const colVec = [refIOP[3], refIOP[4], refIOP[5]];
        const scanAxis = [
          rowVec[1] * colVec[2] - rowVec[2] * colVec[1],
          rowVec[2] * colVec[0] - rowVec[0] * colVec[2],
          rowVec[0] * colVec[1] - rowVec[1] * colVec[0],
        ];

        // Build (distance, index) pairs
        const distIndexPairs: { dist: number; idx: number }[] = [];
        for (let i = 0; i < srcImageIds.length; i++) {
          const plane = metaData.get('imagePlaneModule', srcImageIds[i]);
          const ipp = plane?.imagePositionPatient;
          if (ipp) {
            const posVec = [ipp[0] - refIPP[0], ipp[1] - refIPP[1], ipp[2] - refIPP[2]];
            const dist = posVec[0] * scanAxis[0] + posVec[1] * scanAxis[1] + posVec[2] * scanAxis[2];
            distIndexPairs.push({ dist, idx: i });
          } else {
            distIndexPairs.push({ dist: i, idx: i }); // fallback
          }
        }

        // Sort descending by distance (same as dcmjs normalizer: b[0] - a[0])
        distIndexPairs.sort((a, b) => b.dist - a.dist);

        // Check if sort order differs from input order
        const needsReorder = distIndexPairs.some((p, i) => p.idx !== i);
        if (needsReorder) {
          const sortedSrcImageIds = distIndexPairs.map(p => srcImageIds[p.idx]);
          const sortedSourceImages = distIndexPairs.map(p => sourceImages[p.idx]);
          const sortedLabelmaps2D = distIndexPairs.map(p => labelmaps2D[p.idx]);

          // Replace with sorted arrays
          srcImageIds = sortedSrcImageIds;
          sourceImages.length = 0;
          sourceImages.push(...sortedSourceImages);
          labelmaps2D.length = 0;
          labelmaps2D.push(...sortedLabelmaps2D);
          console.log(`[segmentationService] Reordered ${distIndexPairs.length} slices by IPP distance to match dcmjs normalizer sort`);
        }
      } else {
        console.warn(`[segmentationService] Could not get IOP/IPP for sorting — proceeding with original order.`);
      }
    }

    // Pre-export validation: count segment-frame pairs (same logic as fillSegmentation)
    const totalSegFrames = labelmaps2D.reduce((sum, lm) =>
      sum + sanitizeSegmentIndices(lm.segmentsOnLabelmap ?? []).length, 0);
    console.log(`[segmentationService] Pre-export check: ${totalSegFrames} segment-frame pairs across ${labelmaps2D.length} slices`);

    if (totalSegFrames === 0) {
      const nonZeroPixels = labelmaps2D.reduce((sum, lm) => {
        const pd: Uint8Array | undefined = lm?.pixelData;
        if (!pd || typeof pd.length !== 'number') return sum;
        let local = 0;
        for (let i = 0; i < pd.length; i++) {
          if (pd[i] > 0) local++;
        }
        return sum + local;
      }, 0);
      throw new Error(
        `No painted segment data found in any slice. Nothing to export. `
        + `(nonZeroPixels=${nonZeroPixels})`,
      );
    }

    console.log(`[segmentationService] Generating DICOM SEG: ${sourceImages.length} images, ${segmentMetadata.length - 1} segments, ${rows}×${columns}`);

    let segDerivation: any;
    try {
      segDerivation = adaptersSEG.Cornerstone3D.Segmentation.generateSegmentation(
        sourceImages,
        labelmap3D,
        exportMetadataProvider,
      );
    } catch (genErr) {
      console.error('[segmentationService] generateSegmentation failed:', genErr);
      throw new Error(`DICOM SEG generation failed: ${genErr instanceof Error ? genErr.message : String(genErr)}`);
    }

    if (!segDerivation?.dataset) {
      throw new Error('[segmentationService] generateSegmentation returned no dataset');
    }

    // Persist the user-given segmentation label as SeriesDescription
    // so it survives round-trip (export → XNAT → re-import → loadDicomSeg label extraction)
    segDerivation.dataset.SeriesDescription = seg.label || 'Segmentation';

    // ─── Post-generation validation ───
    //
    // Even though we force Rows/Columns in the metadata provider, the
    // derivation chain (dcmjs SegmentationDerivation → DerivedPixels →
    // DerivedDataset) can still end up with "" for Rows/Columns via
    // assignFromReference's `|| ""` fallback if the multiframe's
    // Rows/Columns got lost during normalization.
    //
    // If that happened, setNumberOfFrames() allocated a 0-byte PixelData
    // (because "" * "" * N = NaN → ArrayBuffer(NaN) = 0 bytes), and
    // all segment pixel data writes were no-ops.
    //
    // We detect this condition and fully rebuild the DICOM SEG dataset.
    const ds = segDerivation.dataset;
    const sourceRefs = collectSourceDicomReferences(srcImageIds, metaData.get.bind(metaData));
    const primarySourceRef = requireSingleStudyReference(sourceRefs, 'DICOM SEG export');
    applySourceDicomContextToSegDataset(ds, primarySourceRef.imageId, metaData.get.bind(metaData));
    if (!ds.StudyInstanceUID && primarySourceRef.studyInstanceUID) ds.StudyInstanceUID = primarySourceRef.studyInstanceUID;
    if (!ds.PatientName && primarySourceRef.patientName) ds.PatientName = primarySourceRef.patientName;
    if (!ds.PatientID && primarySourceRef.patientId) ds.PatientID = primarySourceRef.patientId;
    if (!ds.PatientBirthDate && primarySourceRef.patientBirthDate) ds.PatientBirthDate = primarySourceRef.patientBirthDate;
    if (!ds.PatientSex && primarySourceRef.patientSex) ds.PatientSex = primarySourceRef.patientSex;
    if (!ds.StudyDate && primarySourceRef.studyDate) ds.StudyDate = primarySourceRef.studyDate;
    if (!ds.StudyTime && primarySourceRef.studyTime) ds.StudyTime = primarySourceRef.studyTime;
    if (!ds.StudyID && primarySourceRef.studyID) ds.StudyID = primarySourceRef.studyID;
    if (!ds.AccessionNumber && primarySourceRef.accessionNumber) ds.AccessionNumber = primarySourceRef.accessionNumber;
    if (!ds.StudyDescription && primarySourceRef.studyDescription) ds.StudyDescription = primarySourceRef.studyDescription;
    if (!ds.ReferringPhysicianName && primarySourceRef.referringPhysicianName) {
      ds.ReferringPhysicianName = primarySourceRef.referringPhysicianName;
    }
    if (!ds.FrameOfReferenceUID && primarySourceRef.frameOfReferenceUID) {
      ds.FrameOfReferenceUID = primarySourceRef.frameOfReferenceUID;
    }
    const primaryImagePlane = metaData.get('imagePlaneModule', primarySourceRef.imageId) as any;
    ds.SharedFunctionalGroupsSequence ||= {};
    ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence ||= {};
    if (
      !Array.isArray(ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.PixelSpacing)
      && Number.isFinite(primaryImagePlane?.rowPixelSpacing)
      && Number.isFinite(primaryImagePlane?.columnPixelSpacing)
    ) {
      ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.PixelSpacing = [
        primaryImagePlane.rowPixelSpacing,
        primaryImagePlane.columnPixelSpacing,
      ];
    }
    if (
      !ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SliceThickness
      && Number.isFinite(primaryImagePlane?.sliceThickness)
      && primaryImagePlane.sliceThickness > 0
    ) {
      ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SliceThickness = primaryImagePlane.sliceThickness;
    }
    if (
      !ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SliceThickness
      && Number.isFinite(primaryImagePlane?.spacingBetweenSlices)
      && primaryImagePlane.spacingBetweenSlices > 0
    ) {
      ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SliceThickness = primaryImagePlane.spacingBetweenSlices;
    }
    if (!ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SliceThickness) {
      ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SliceThickness = 1;
    }
    if (
      !ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SpacingBetweenSlices
      && Number.isFinite(primaryImagePlane?.spacingBetweenSlices)
      && primaryImagePlane.spacingBetweenSlices > 0
    ) {
      ds.SharedFunctionalGroupsSequence.PixelMeasuresSequence.SpacingBetweenSlices = primaryImagePlane.spacingBetweenSlices;
    }
    ds.SharedFunctionalGroupsSequence.PlaneOrientationSequence ||= {};
    if (
      !Array.isArray(ds.SharedFunctionalGroupsSequence.PlaneOrientationSequence.ImageOrientationPatient)
      && Array.isArray(primaryImagePlane?.imageOrientationPatient)
      && primaryImagePlane.imageOrientationPatient.length >= 6
    ) {
      ds.SharedFunctionalGroupsSequence.PlaneOrientationSequence.ImageOrientationPatient = [
        ...primaryImagePlane.imageOrientationPatient,
      ];
    }
    const operatorsName = upsertOperatorsName(
      ds.OperatorsName,
      formatOperatorsNameForConnection(useConnectionStore.getState().connection),
    );
    if (operatorsName) {
      ds.OperatorsName = operatorsName;
    }

    const dsRowsValid = typeof ds.Rows === 'number' && ds.Rows > 0;
    const dsColsValid = typeof ds.Columns === 'number' && ds.Columns > 0;

    if (!dsRowsValid || !dsColsValid) {
      console.warn(
        `[segmentationService] Dataset has invalid Rows=${ds.Rows}, Columns=${ds.Columns} ` +
        `(expected ${rows}×${columns}). Fixing and rebuilding PixelData.`,
      );
      ds.Rows = rows;
      ds.Columns = columns;
    }

    // Ensure NumberOfFrames is a valid number
    if (ds.NumberOfFrames && typeof ds.NumberOfFrames !== 'number') {
      ds.NumberOfFrames = parseInt(String(ds.NumberOfFrames), 10) || 1;
    }

    // Check if PixelData was correctly populated.
    // In DICOM SEG, NumberOfFrames is the count of (segment, slice) pairs,
    // NOT the total number of source slices. PixelData should be bit-packed:
    //   size = ceil(Rows * Columns * NumberOfFrames / 8)
    const numFrames = typeof ds.NumberOfFrames === 'number' ? ds.NumberOfFrames : 1;
    const expectedPixelBytes = Math.ceil((ds.Rows * ds.Columns * numFrames) / 8);
    const currentPixelSize = ds.PixelData instanceof ArrayBuffer ? ds.PixelData.byteLength : 0;

    if (currentPixelSize < expectedPixelBytes) {
      console.warn(
        `[segmentationService] PixelData too small (${currentPixelSize} bytes, ` +
        `expected ≥${expectedPixelBytes} for ${numFrames} frames of ${ds.Rows}×${ds.Columns}). ` +
        `Rebuilding from labelmaps.`,
      );

      // Determine which (segment, slice) pairs are referenced.
      // PerFrameFunctionalGroupsSequence tells us which frames exist.
      const pfgs = ds.PerFrameFunctionalGroupsSequence;
      const nFrames = Array.isArray(pfgs) ? pfgs.length : numFrames;

      // Count referenced frame indices per segment
      // The adapter created PerFrameFunctionalGroupsSequence entries in order:
      //   for each segment → for each referenced slice.
      // We need to re-derive the mapping from labelmaps2D.
      const referencedFrames: { segIdx: number; sliceIdx: number }[] = [];
      for (let segIdx = 1; segIdx < segmentMetadata.length; segIdx++) {
        if (!segmentMetadata[segIdx]) continue;
        for (let sliceIdx = 0; sliceIdx < labelmaps2D.length; sliceIdx++) {
          const lm = labelmaps2D[sliceIdx];
          if (lm && lm.segmentsOnLabelmap.includes(segIdx)) {
            referencedFrames.push({ segIdx, sliceIdx });
          }
        }
      }

      const actualFrameCount = referencedFrames.length || nFrames;
      const slicePixels = ds.Rows * ds.Columns;
      const totalPixels = slicePixels * actualFrameCount;

      // Build unpacked pixel data (1 byte per pixel, binary: 0 or 1)
      const unpackedPixels = new Uint8Array(totalPixels);
      for (let f = 0; f < referencedFrames.length; f++) {
        const { segIdx, sliceIdx } = referencedFrames[f];
        const lm = labelmaps2D[sliceIdx];
        if (!lm?.pixelData) continue;
        const frameOffset = f * slicePixels;
        for (let p = 0; p < lm.pixelData.length && p < slicePixels; p++) {
          unpackedPixels[frameOffset + p] = lm.pixelData[p] === segIdx ? 1 : 0;
        }
      }

      // Bit-pack (1 bit per pixel, LSB first)
      const packedLen = Math.ceil(totalPixels / 8);
      const packedPixels = new Uint8Array(packedLen);
      for (let i = 0; i < totalPixels; i++) {
        if (unpackedPixels[i]) {
          packedPixels[i >> 3] |= (1 << (i % 8));
        }
      }
      ds.PixelData = packedPixels.buffer;
      ds.NumberOfFrames = actualFrameCount;

      console.log(
        `[segmentationService] Rebuilt PixelData: ${actualFrameCount} frames, ` +
        `${packedLen} bytes (${totalPixels} pixels bit-packed)`,
      );
    }

    console.log(`[segmentationService] DICOM SEG: Rows=${ds.Rows}, Columns=${ds.Columns}, Frames=${ds.NumberOfFrames}, PixelData=${ds.PixelData?.byteLength ?? 0} bytes`);

    // Step 6: Finalize and serialize the derived SEG with shared DICOM validation.
    const dataset = segDerivation.dataset;
    dataset.Modality = 'SEG';
    dataset.Rows = rows;
    dataset.Columns = columns;
    if (typeof dataset.BitsAllocated !== 'number' || dataset.BitsAllocated <= 0) {
      dataset.BitsAllocated = 1;
    }
    if (typeof dataset.BitsStored !== 'number' || dataset.BitsStored <= 0) {
      dataset.BitsStored = 1;
    }
    if (typeof dataset.HighBit !== 'number') {
      dataset.HighBit = 0;
    }
    if (typeof dataset.SamplesPerPixel !== 'number' || dataset.SamplesPerPixel <= 0) {
      dataset.SamplesPerPixel = 1;
    }
    if (typeof dataset.PixelRepresentation !== 'number') {
      dataset.PixelRepresentation = 0;
    }

    const { arrayBuffer } = serializeDerivedDicomDataset(dataset, {
      kind: 'SEG',
      callerTag: 'segmentationService',
      defaultSOPClassUID: '1.2.840.10008.5.1.4.1.1.66.4',
      requiredDatasetFields: [
        'SOPClassUID',
        'SOPInstanceUID',
        'StudyInstanceUID',
        'SeriesInstanceUID',
        'Modality',
        'Rows',
        'Columns',
        'NumberOfFrames',
        'PixelData',
        'SegmentSequence',
        'PerFrameFunctionalGroupsSequence',
        'SharedFunctionalGroupsSequence',
      ],
      expectedDatasetValues: {
        Modality: 'SEG',
        StudyInstanceUID: primarySourceRef.studyInstanceUID,
        Rows: rows,
        Columns: columns,
      },
      includeContentDateTime: true,
    });

    // ─── Binary validation ───
    // Parse the just-written ArrayBuffer with dicom-parser to verify that
    // Rows and Columns are correct in the actual binary output. If they're
    // wrong, we REFUSE to save a broken file.
    try {
      const dicomParser = await import('dicom-parser');
      const verifyBytes = new Uint8Array(arrayBuffer);
      const verifyDs = dicomParser.parseDicom(verifyBytes);
      const finalRows = verifyDs.uint16('x00280010');
      const finalCols = verifyDs.uint16('x00280011');
      const finalPixelData = verifyDs.elements['x7fe00010'];
      const finalPixelLen = finalPixelData ? finalPixelData.length : 0;

      console.log(
        `[segmentationService] Binary validation: Rows=${finalRows}, Columns=${finalCols}, ` +
        `PixelData=${finalPixelLen} bytes`,
      );

      if (finalRows === 0 || finalCols === 0) {
        throw new Error(
          `DICOM SEG binary validation failed: Rows=${finalRows}, Columns=${finalCols}. ` +
          `The file would be unreadable. This is a bug — please report it.`,
        );
      }

      if (finalRows !== rows || finalCols !== columns) {
        throw new Error(
          `DICOM SEG binary validation failed: expected ${rows}×${columns}, ` +
          `got ${finalRows}×${finalCols}. The file would load incorrectly.`,
        );
      }

      if (finalPixelLen === 0) {
        throw new Error(
          `DICOM SEG binary validation failed: PixelData is empty (0 bytes). ` +
          `The segmentation data would be lost.`,
        );
      }
    } catch (validationErr) {
      if (validationErr instanceof Error && validationErr.message.startsWith('DICOM SEG binary validation')) {
        throw validationErr; // Re-throw our validation errors
      }
      console.warn('[segmentationService] Could not validate binary output:', validationErr);
      // Non-critical: proceed even if dicom-parser validation fails
    }

    // Step 7: Convert to base64 for IPC transport.
    const bytes = new Uint8Array(arrayBuffer);
    console.log(`[segmentationService] Serialized DICOM SEG: ${(arrayBuffer.byteLength / 1024).toFixed(1)} KB, converting to base64...`);

    const binaryChunks: string[] = [];
    const chunkSize = 4096;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, bytes.length);
      let chunk = '';
      for (let j = i; j < end; j++) {
        chunk += String.fromCharCode(bytes[j]);
      }
      binaryChunks.push(chunk);
    }
    const binary = binaryChunks.join('');
    const base64 = btoa(binary);

    console.log(`[segmentationService] DICOM SEG exported: ${(base64.length / 1024).toFixed(1)} KB base64`);
    return base64;
  }

  /**
   * Export a multi-layer group to DICOM SEG by compositing all sub-seg
   * binary layers into multi-valued labelmaps (pixel value = segment index).
   * Higher-indexed segments win at overlap pixels.
   */
  async function _exportGroupToDicomSeg(groupId: string): Promise<string> {
    const dims = mlg.getGroupDimensions(groupId);
    const srcImageIds = dims?.sourceImageIds ?? sourceImageTracking.getSourceImageIds(groupId) ?? [];
    if (srcImageIds.length === 0) {
      throw new Error('[segmentationService] No source imageIds for group export.');
    }

    const subSegArr = mlg.getGroupSlots(groupId) ?? [];
    const metaMap = mlg.getSegmentMetaMap(groupId);
    const { rows, columns } = dims ?? { rows: 512, columns: 512 };
    const sliceCount = srcImageIds.length;
    const pixelsPerSlice = rows * columns;

    // Build composited labelmaps: for each slice, iterate sub-segs in order.
    // Higher-indexed segment overwrites lower at overlap pixels.
    const compositedSlices: Uint8Array[] = [];
    for (let s = 0; s < sliceCount; s++) {
      const composited = new Uint8Array(pixelsPerSlice);
      for (let i = 0; i < subSegArr.length; i++) {
        const subSegId = subSegArr[i];
        if (!subSegId) continue;
        const segmentIndex = i + 1;
        const subSeg = csSegmentation.state.getSegmentation(subSegId);
        const lmImageIds: string[] = (subSeg?.representationData as any)?.Labelmap?.imageIds ?? [];
        if (s >= lmImageIds.length) continue;
        const lmImage = cache.getImage(lmImageIds[s]);
        if (!lmImage) continue;
        const scalarData =
          lmImage.voxelManager?.getScalarData?.()
          ?? (lmImage as any).getPixelData?.();
        if (!scalarData) continue;
        for (let p = 0; p < pixelsPerSlice && p < scalarData.length; p++) {
          if (Number(scalarData[p]) > 0) {
            composited[p] = segmentIndex;
          }
        }
      }
      compositedSlices.push(composited);
    }

    // Build segment metadata
    const segmentMetadata: any[] = [null]; // index 0 = background
    const maxIdx = subSegArr.length;
    for (let idx = 1; idx <= maxIdx; idx++) {
      if (!subSegArr[idx - 1]) {
        segmentMetadata.push(null);
        continue;
      }
      const meta = metaMap?.get(idx);
      const color = meta?.color ?? deps.getDefaultColors()[(idx - 1) % deps.getDefaultColors().length];
      const normalizedRgb = [color[0] / 255, color[1] / 255, color[2] / 255];
      const cieLabValues =
        (dcmjsData as any).Colors?.rgb2DICOMLAB?.(normalizedRgb) ?? [0, 0, 0];

      segmentMetadata.push({
        SegmentLabel: meta?.label ?? `Segment ${idx}`,
        SegmentDescription: meta?.label ?? `Segment ${idx}`,
        SegmentNumber: idx,
        SegmentAlgorithmType: 'SEMIAUTOMATIC',
        SegmentAlgorithmName: 'XNAT Workstation',
        SegmentedPropertyCategoryCodeSequence: SEGMENTED_PROPERTY_CATEGORY_CODE,
        SegmentedPropertyTypeCodeSequence: SEGMENTED_PROPERTY_TYPE_CODE,
        RecommendedDisplayCIELabValue: cieLabValues,
      });
    }

    // Create a temporary single-layer Cornerstone segmentation with the
    // composited labelmaps, register it, export, then clean up.
    const tempSegId = `_export_temp_${groupId}_${Date.now()}`;
    const tempLmImageIds: string[] = [];
    try {
      // Create labelmap images for the temporary segmentation
      for (let s = 0; s < sliceCount; s++) {
        const srcId = srcImageIds[s];
        const localId = `${tempSegId}_slice_${s}`;
        const pixelData = compositedSlices[s];

        const imagePlane = metaData.get('imagePlaneModule', srcId) as any;
        imageLoader.createAndCacheLocalImage(localId, {
          scalarData: pixelData,
          dimensions: [columns, rows],
          spacing: [
            Number(imagePlane?.columnPixelSpacing) || 1,
            Number(imagePlane?.rowPixelSpacing) || 1,
          ],
          origin: imagePlane?.imagePositionPatient,
          direction: imagePlane?.imageOrientationPatient,
          frameOfReferenceUID: imagePlane?.frameOfReferenceUID,
          referencedImageId: srcId,
        } as any);
        tempLmImageIds.push(localId);
      }

      // Build segments object for Cornerstone
      const segments: Record<number, any> = {};
      for (let idx = 1; idx <= maxIdx; idx++) {
        if (!subSegArr[idx - 1]) continue;
        const meta = metaMap?.get(idx);
        segments[idx] = {
          label: meta?.label ?? `Segment ${idx}`,
          locked: false,
          active: idx === 1,
          segmentIndex: idx,
          cachedStats: {},
        };
      }

      // Register temporary segmentation
      csSegmentation.addSegmentations([{
        segmentationId: tempSegId,
        representation: {
          type: ToolEnums.SegmentationRepresentations.Labelmap,
          data: { imageIds: tempLmImageIds } as any,
        },
        config: {
          label: mlg.getGroupLabel(groupId) ?? 'Segmentation',
          segments,
        },
      }]);

      // Track source image IDs for the temp seg
      sourceImageTracking.setSourceImageIds(tempSegId, [...srcImageIds]);

      // Delegate to the legacy export path
      const result = await exportToDicomSeg(tempSegId);

      return result;
    } finally {
      // Clean up temporary segmentation
      try { csSegmentation.removeSegmentation(tempSegId); } catch { /* ok */ }
      sourceImageTracking.clearSourceImageIds(tempSegId);
      // Clean up temporary labelmap images from cache
      for (const lmId of tempLmImageIds) {
        try { cache.removeImageLoadObject(lmId); } catch { /* ok */ }
      }
    }
  }

  return { exportToDicomSeg, _exportGroupToDicomSeg };
}
