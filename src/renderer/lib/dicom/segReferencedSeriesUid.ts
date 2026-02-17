import * as dicomParser from 'dicom-parser';

export interface SegReferenceInfo {
  referencedSeriesUID: string | null;
  referencedSOPInstanceUIDs: string[];
}

function addReferencedSopUidsFromSequence(
  seqItems: Array<{ dataSet?: any }> | undefined,
  target: Set<string>,
): void {
  if (!seqItems?.length) return;
  for (const item of seqItems) {
    const uid = item?.dataSet?.string?.('x00081155');
    if (uid) target.add(uid);
  }
}

/**
 * Parse a DICOM SEG ArrayBuffer and extract:
 * 1) Referenced Series Instance UID (primary linkage), and
 * 2) Referenced SOP Instance UIDs (fallback linkage).
 */
export function getSegReferenceInfo(segArrayBuffer: ArrayBuffer): SegReferenceInfo {
  const referencedSopUids = new Set<string>();

  try {
    const byteArray = new Uint8Array(segArrayBuffer);
    const dataSet = dicomParser.parseDicom(byteArray);

    // Capture SourceImageSequence references anywhere they commonly appear.
    // Top-level SourceImageSequence (0008,2112)
    addReferencedSopUidsFromSequence(dataSet.elements['x00082112']?.items, referencedSopUids);
    // Top-level ReferencedImageSequence (0008,1140)
    addReferencedSopUidsFromSequence(dataSet.elements['x00081140']?.items, referencedSopUids);
    // Shared Functional Group: DerivationImageSequence -> SourceImageSequence
    const sharedFgItems = dataSet.elements['x52009229']?.items;
    if (sharedFgItems?.length) {
      const derivItems = sharedFgItems[0]?.dataSet?.elements['x00089124']?.items;
      if (derivItems?.length) {
        addReferencedSopUidsFromSequence(
          derivItems[0]?.dataSet?.elements['x00082112']?.items,
          referencedSopUids,
        );
      }
    }
    // Per-frame Functional Groups: DerivationImageSequence -> SourceImageSequence
    const perFrameItems = dataSet.elements['x52009230']?.items;
    if (perFrameItems?.length) {
      for (const frameItem of perFrameItems) {
        const derivItems = frameItem?.dataSet?.elements['x00089124']?.items;
        if (!derivItems?.length) continue;
        addReferencedSopUidsFromSequence(
          derivItems[0]?.dataSet?.elements['x00082112']?.items,
          referencedSopUids,
        );
      }
    }

    // Method 1: ReferencedSeriesSequence (0008,1115) -> SeriesInstanceUID (0020,000E)
    const refSeriesSeq = dataSet.elements['x00081115'];
    if (refSeriesSeq?.items?.length) {
      // Also capture explicit referenced instance UIDs if present.
      addReferencedSopUidsFromSequence(
        refSeriesSeq.items[0].dataSet?.elements['x0008114a']?.items,
        referencedSopUids,
      );

      const uid = refSeriesSeq.items[0].dataSet?.string('x0020000e');
      if (uid) {
        console.log(`[segReferencedSeriesUid] SEG ReferencedSeriesSequence -> SeriesInstanceUID: ${uid}`);
        return {
          referencedSeriesUID: uid,
          referencedSOPInstanceUIDs: Array.from(referencedSopUids),
        };
      }
    }

    // Method 2: ReferencedFrameOfReferenceSequence (3006,0010) ->
    //   RTReferencedStudySequence (3006,0012) ->
    //   RTReferencedSeriesSequence (3006,0014) -> SeriesInstanceUID (0020,000E)
    const refFrameSeq = dataSet.elements['x30060010'];
    if (refFrameSeq?.items?.length) {
      const studySeq = refFrameSeq.items[0].dataSet?.elements['x30060012'];
      if (studySeq?.items?.length) {
        const seriesSeq = studySeq.items[0].dataSet?.elements['x30060014'];
        if (seriesSeq?.items?.length) {
          const uid = seriesSeq.items[0].dataSet?.string('x0020000e');
          if (uid) {
            console.log(`[segReferencedSeriesUid] SEG ReferencedFrameOfReferenceSequence -> SeriesInstanceUID: ${uid}`);
            return {
              referencedSeriesUID: uid,
              referencedSOPInstanceUIDs: Array.from(referencedSopUids),
            };
          }
        }
      }
    }

    if (referencedSopUids.size > 0) {
      console.log(
        `[segReferencedSeriesUid] SEG fallback references: ${referencedSopUids.size} SOP Instance UID(s)`,
      );
    }

    // Debug-only: log SEG's own SeriesInstanceUID (not source linkage).
    const ownSeriesUID = dataSet.string('x0020000e');
    console.log(`[segReferencedSeriesUid] SEG own SeriesInstanceUID: ${ownSeriesUID || 'not found'}`);

    const seqTags = Object.keys(dataSet.elements).filter(
      (k) => dataSet.elements[k].items && dataSet.elements[k].items!.length > 0,
    );
    console.log(`[segReferencedSeriesUid] SEG sequence tags: ${seqTags.join(', ')}`);

    return {
      referencedSeriesUID: null,
      referencedSOPInstanceUIDs: Array.from(referencedSopUids),
    };
  } catch (err) {
    console.warn('[segReferencedSeriesUid] Failed to parse SEG DICOM header:', err);
    return {
      referencedSeriesUID: null,
      referencedSOPInstanceUIDs: Array.from(referencedSopUids),
    };
  }
}

/**
 * Backward-compatible helper used by existing call sites.
 */
export function getReferencedSeriesUID(segArrayBuffer: ArrayBuffer): string | null {
  return getSegReferenceInfo(segArrayBuffer).referencedSeriesUID;
}
