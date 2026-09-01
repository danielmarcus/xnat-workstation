/**
 * readApproval — pull the DICOM approval attributes out of a derived object
 * (SEG / RTSTRUCT / SR) so a loaded container arrives with its approval state
 * (requirements D7.11: "loaded already-approved containers have editing affordances
 * disabled at load").
 *
 * Uses `dicom-parser` with `untilTag` stopping before PixelData: this runs on every
 * annotation load, and naturalizing a multi-frame SEG just to read three strings
 * would re-allocate the whole labelmap. Mapping/validation is delegated to the pure
 * `parseApprovalModule`.
 */
import * as dicomParser from 'dicom-parser';
import { parseApprovalModule } from '../annotations/approval';
import type { ApprovalRecord } from '@shared/types/annotation';

/** ApprovalStatus (300E,0002) · ReviewDate (300E,0004) · ReviewTime (300E,0005) · ReviewerName (300E,0008). */
const TAG = {
  approvalStatus: 'x300e0002',
  reviewDate: 'x300e0004',
  reviewTime: 'x300e0005',
  reviewerName: 'x300e0008',
} as const;

/**
 * The approval state recorded in the file. A file without the attributes (every file
 * not written by an approving workstation) reads as unapproved, and so does an
 * unparseable one — approval must never be *invented* from a read failure.
 */
export function readApprovalFromArrayBuffer(arrayBuffer: ArrayBuffer): ApprovalRecord {
  try {
    const dataSet = dicomParser.parseDicom(new Uint8Array(arrayBuffer), { untilTag: 'x7fe00010' });
    return parseApprovalModule({
      ApprovalStatus: dataSet.string?.(TAG.approvalStatus),
      ReviewDate: dataSet.string?.(TAG.reviewDate),
      ReviewTime: dataSet.string?.(TAG.reviewTime),
      ReviewerName: dataSet.string?.(TAG.reviewerName),
    });
  } catch (err) {
    console.warn('[readApproval] could not read the approval attributes:', err);
    return parseApprovalModule(undefined);
  }
}
