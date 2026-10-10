/**
 * Which DICOM attributes identify a patient — for the Hide PHI display mode (SegWorks
 * parity D7). Display-only: exports follow docs/dicom-export-field-policy.md, not this.
 *
 * The whole Patient group (0010,xxxx) plus the identifying attributes of the Basic
 * Application Level Confidentiality Profile (PS3.15 Annex E) that a viewer commonly
 * shows: accession, institution, people, study/series/acquisition dates and times, IDs.
 * XNAT subject/session labels are not DICOM attributes and are pseudonymous by
 * convention; they are not hidden.
 */
const PHI_TAGS = new Set([
  'x00080020', 'x00080021', 'x00080022', 'x00080023', // study/series/acquisition/content date
  'x00080030', 'x00080031', 'x00080032', 'x00080033', // … times
  'x0008002a', // acquisition datetime
  'x00080050', // accession number
  'x00080080', 'x00080081', 'x00081040', // institution name, address, department
  'x00080090', 'x00080092', 'x00080094', // referring physician (name, address, phone)
  'x00081048', 'x00081050', 'x00081060', 'x00081070', // physicians of record / performing / reading, operators
  'x00081010', // station name
  'x00200010', // study ID
  'x00321032', 'x00321060', // requesting physician, requested procedure description
  'x00380010', 'x00380300', 'x00380400', // admission ID, current location, institution residence
  'x00400244', 'x00400245', 'x00400253', // performed procedure step start date/time, ID
]);

/** Whether a tag key ('x00100010', any case) is PHI. */
export function isPhiTag(tagKey: string): boolean {
  const k = tagKey.toLowerCase();
  return k.startsWith('x0010') || PHI_TAGS.has(k);
}

/** Viewport overlay fields that show PHI. */
export const PHI_OVERLAY_FIELDS = new Set(['patientName', 'patientId', 'studyDate', 'institutionName']);

export const PHI_MASK = '••••••';
