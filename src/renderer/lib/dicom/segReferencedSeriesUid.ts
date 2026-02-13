import * as dicomParser from 'dicom-parser';

/**
 * Parse a DICOM SEG ArrayBuffer and extract the Referenced Series Instance UID.
 * This tells us which source series the SEG was created from.
 */
export function getReferencedSeriesUID(segArrayBuffer: ArrayBuffer): string | null {
  try {
    const byteArray = new Uint8Array(segArrayBuffer);
    const dataSet = dicomParser.parseDicom(byteArray);

    // Method 1: ReferencedSeriesSequence (0008,1115) → SeriesInstanceUID (0020,000E)
    const refSeriesSeq = dataSet.elements['x00081115'];
    if (refSeriesSeq?.items?.length) {
      const uid = refSeriesSeq.items[0].dataSet?.string('x0020000e');
      if (uid) {
        console.log(`[segReferencedSeriesUid] SEG ReferencedSeriesSequence → SeriesInstanceUID: ${uid}`);
        return uid;
      }
    }

    // Method 2: ReferencedFrameOfReferenceSequence (3006,0010) →
    //   RTReferencedStudySequence (3006,0012) →
    //   RTReferencedSeriesSequence (3006,0014) → SeriesInstanceUID (0020,000E)
    const refFrameSeq = dataSet.elements['x30060010'];
    if (refFrameSeq?.items?.length) {
      const studySeq = refFrameSeq.items[0].dataSet?.elements['x30060012'];
      if (studySeq?.items?.length) {
        const seriesSeq = studySeq.items[0].dataSet?.elements['x30060014'];
        if (seriesSeq?.items?.length) {
          const uid = seriesSeq.items[0].dataSet?.string('x0020000e');
          if (uid) {
            console.log(`[segReferencedSeriesUid] SEG ReferencedFrameOfReferenceSequence → SeriesInstanceUID: ${uid}`);
            return uid;
          }
        }
      }
    }

    // Method 3: Check the SEG's own SeriesInstanceUID as a last resort
    // (this is the SEG's series, not the source, but log it for debugging)
    const ownSeriesUID = dataSet.string('x0020000e');
    console.log(`[segReferencedSeriesUid] SEG own SeriesInstanceUID: ${ownSeriesUID || 'not found'}`);

    // Log available top-level sequence tags for debugging
    const seqTags = Object.keys(dataSet.elements).filter(
      (k) => dataSet.elements[k].items && dataSet.elements[k].items!.length > 0
    );
    console.log(`[segReferencedSeriesUid] SEG sequence tags: ${seqTags.join(', ')}`);

    return null;
  } catch (err) {
    console.warn('[segReferencedSeriesUid] Failed to parse SEG DICOM header:', err);
    return null;
  }
}
