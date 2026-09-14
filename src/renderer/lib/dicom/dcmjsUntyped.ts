/**
 * Typed view of the dcmjs `data` members its shipped typings omit.
 *
 * `dcmjs` exports `DicomMessage` and `Colors` at runtime but does not declare them, so
 * call sites were reaching for `(dcmjsData as any).DicomMessage`. Declaring the shapes we
 * actually use once — here — keeps `any` out of the call sites and gives a single place to
 * fix if dcmjs ships real types later.
 *
 * Only the members this app calls are declared; add to them as needed rather than widening
 * to `any`.
 */
import { data as dcmjsData } from 'dcmjs';

/** A parsed DICOM file as returned by `DicomMessage.readFile`. */
export interface DicomMessageFile {
  dict: Record<string, unknown>;
  meta: Record<string, unknown>;
  write: () => ArrayBuffer;
}

interface DcmjsUntypedMembers {
  DicomMessage: {
    readFile: (buffer: ArrayBuffer, options?: Record<string, unknown>) => DicomMessageFile;
  };
  Colors: {
    /** sRGB (0–1 per channel) → DICOM CIELab, as used for RecommendedDisplayCIELabValue. */
    rgb2DICOMLAB?: (rgb: [number, number, number]) => [number, number, number];
  };
}

/** `dcmjs.data`, plus the members its typings leave out. */
export const dcmjs = dcmjsData as typeof dcmjsData & DcmjsUntypedMembers;
