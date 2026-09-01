/**
 * srReferences — resolve which imaging series a DICOM-SR describes, so a
 * Measurement scan clicked in the XNAT browser can be loaded onto (or alongside)
 * its source images. The mirror of `segReferencedSeriesUid` for SR.
 *
 * A TID-1500 SR does not carry a `ReferencedSeriesSequence` at the top level the way
 * a SEG does. Its evidence lives in **Current Requested Procedure Evidence Sequence
 * (0040,A375)**: study → `ReferencedSeriesSequence (0008,1115)` → `SeriesInstanceUID
 * (0020,000E)` + `ReferencedSOPSequence (0008,1199)` → `ReferencedSOPInstanceUID
 * (0008,1155)`. Pertinent Other Evidence (0040,A385) has the same shape and is read
 * as a fallback, and image references inside the content tree
 * (`ReferencedSOPSequence` anywhere) are collected as a last resort so the SOP-based
 * lookup still works for SRs whose evidence sequence is missing.
 */
import * as dicomParser from 'dicom-parser';

const TAG = {
  currentRequestedProcedureEvidence: 'x0040a375',
  pertinentOtherEvidence: 'x0040a385',
  referencedSeriesSequence: 'x00081115',
  seriesInstanceUID: 'x0020000e',
  referencedSOPSequence: 'x00081199',
  referencedSOPInstanceUID: 'x00081155',
  contentSequence: 'x0040a730',
} as const;

export interface SrReferenceInfo {
  /** SeriesInstanceUID of the imaging series the measurements were made on. */
  referencedSeriesUID: string | null;
  /** Every referenced image SOPInstanceUID found, in encounter order. */
  referencedSOPInstanceUIDs: string[];
}

type DataSet = {
  string?: (tag: string) => string | undefined;
  elements: Record<string, { items?: Array<{ dataSet?: DataSet }> } | undefined>;
};

function collectSopUids(dataSet: DataSet | undefined, out: Set<string>): void {
  if (!dataSet) return;
  const sopSeq = dataSet.elements?.[TAG.referencedSOPSequence];
  for (const item of sopSeq?.items ?? []) {
    const uid = item?.dataSet?.string?.(TAG.referencedSOPInstanceUID);
    if (uid) out.add(uid);
  }
  // Recurse the content tree: image references hang off measurement content items.
  const contentSeq = dataSet.elements?.[TAG.contentSequence];
  for (const item of contentSeq?.items ?? []) {
    collectSopUids(item?.dataSet, out);
  }
}

/** Walk one evidence sequence (study items → series items), collecting series + SOPs. */
function readEvidence(
  dataSet: DataSet,
  evidenceTag: string,
  sopUids: Set<string>,
): string | null {
  let seriesUID: string | null = null;
  const evidence = dataSet.elements?.[evidenceTag];
  for (const studyItem of evidence?.items ?? []) {
    const seriesSeq = studyItem?.dataSet?.elements?.[TAG.referencedSeriesSequence];
    for (const seriesItem of seriesSeq?.items ?? []) {
      const uid = seriesItem?.dataSet?.string?.(TAG.seriesInstanceUID);
      // First series wins: measurements referencing several series can't be attached
      // to one source panel anyway, and the caller falls back to SOP matching.
      if (uid && !seriesUID) seriesUID = uid;
      collectSopUids(seriesItem?.dataSet, sopUids);
    }
  }
  return seriesUID;
}

/**
 * Parse an SR ArrayBuffer for its source-series linkage. Never throws: a malformed
 * file yields nulls/empties and the caller falls back to the active panel.
 */
export function getSrReferenceInfo(arrayBuffer: ArrayBuffer): SrReferenceInfo {
  const sopUids = new Set<string>();
  try {
    const dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer), {
      untilTag: 'x7fe00010',
    }) as unknown as DataSet;

    const seriesUID =
      readEvidence(dataSet, TAG.currentRequestedProcedureEvidence, sopUids)
      ?? readEvidence(dataSet, TAG.pertinentOtherEvidence, sopUids);

    // Content-tree references (last resort for SOP-based source lookup).
    collectSopUids(dataSet, sopUids);

    return { referencedSeriesUID: seriesUID, referencedSOPInstanceUIDs: [...sopUids] };
  } catch (err) {
    console.warn('[srReferences] could not parse the SR references:', err);
    return { referencedSeriesUID: null, referencedSOPInstanceUIDs: [...sopUids] };
  }
}
