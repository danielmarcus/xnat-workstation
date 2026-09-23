import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { datasetSource, toWadouriUri } from './dicomDatasetSource';
import { data as dcmjsData } from 'dcmjs';
import { writeDicomDict } from './writeDicomDict';
import type { ApprovalModule } from '../annotations/approval';
import { dcmjs as dcmjsUntyped } from '../dicom/dcmjsUntyped';

declare const __APP_VERSION__: string;

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

export const WORKSTATION_IMPLEMENTATION_CLASS_UID =
  '2.25.80302813137786398554742050926734630921603366648225212145404';

export const WORKSTATION_DICOM_METADATA = Object.freeze({
  SpecificCharacterSet: 'ISO_IR 192',
  Manufacturer: 'XNAT Workstation',
  ManufacturerModelName: 'XNAT Workstation',
  DeviceSerialNumber: 'XNATWS',
  SoftwareVersions: APP_VERSION,
  StationName: 'XNATWS',
});

export type DerivedDicomKind = 'SEG' | 'RTSTRUCT' | 'SR';

export interface SourceDicomReference {
  imageId: string;
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  frameOfReferenceUID?: string;
  sopClassUID?: string;
  sopInstanceUID?: string;
  patientName?: unknown;
  patientId?: string;
  patientBirthDate?: string;
  patientSex?: string;
  studyDate?: string;
  studyTime?: string;
  studyID?: string;
  accessionNumber?: string;
  studyDescription?: string;
  referringPhysicianName?: unknown;
  patientAge?: string;
  patientWeight?: number | string;
  patientSize?: number | string;
  referencedFrameNumber?: number;
  numberOfFrames: number;
}

export interface SerializeDerivedDicomOptions {
  kind: DerivedDicomKind;
  /**
   * Container approval state (D7.11) to persist as the DICOM approval attributes
   * (`ApprovalStatus` + `Reviewer*`). Omit to leave the dataset's own values alone;
   * pass an UNAPPROVED record to explicitly clear a previously-approved object.
   */
  approval?: ApprovalModule;
  callerTag: string;
  defaultSOPClassUID: string;
  requiredDatasetFields: string[];
  requiredFileMetaFields?: string[];
  expectedDatasetValues?: Record<string, unknown>;
  includeContentDateTime?: boolean;
  includeStructureSetDateTime?: boolean;
}

/**
 * DICOM "Age String" (VR=AS) is a FIXED-LENGTH VR: exactly 4 characters, formed
 * as three digits followed by a unit — D (days), W (weeks), M (months) or
 * Y (years), e.g. "059Y". dcmjs validates this on read and logs
 * "Invalid length for fixed length tag, vr AS, length 4 != N" whenever a
 * non-conformant value (most commonly a bare number like "59") is encountered.
 *
 * We copy PatientAge (0010,1010) from source-study metadata — which is not
 * guaranteed to be conformant — into derived SEG/RTSTRUCT datasets, so this
 * pattern lets callers flag rather than silently propagate a malformed value.
 */
export const DICOM_AGE_STRING_PATTERN = /^\d{3}[DWMY]$/;

export function isConformantAgeString(value: unknown): value is string {
  return typeof value === 'string' && DICOM_AGE_STRING_PATTERN.test(value);
}

/**
 * Set `dataset.PatientAge` only when `value` is a conformant DICOM Age String.
 * A non-conformant value is worse than an absent optional tag — it makes the
 * derived object trip dcmjs's fixed-length-VR check on every subsequent read —
 * so we omit it and warn, per the repo's DICOM-compliance rule to flag (not
 * silently pass through) non-conformant data. `context` is a short label
 * ('SEG' / 'RTSTRUCT') identifying the export path in the warning.
 */
export function applyConformantPatientAge(
  dataset: any,
  value: unknown,
  context: string,
): void {
  if (value === undefined || value === null || value === '') return;
  if (isConformantAgeString(value)) {
    dataset.PatientAge = value;
    return;
  }
  console.warn(
    `[dicomExportHelpers] ${context}: omitting non-conformant PatientAge ` +
    `(VR=AS requires nnn[D|W|M|Y], e.g. "059Y"); got ${JSON.stringify(value)}`,
  );
}

function extractMetaValue(meta: any, key: string): unknown {
  const value = meta?.[key];
  if (value && typeof value === 'object' && Array.isArray(value.Value)) {
    return value.Value[0];
  }
  return value;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value);
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function hasPopulatedValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (value instanceof ArrayBuffer) return value.byteLength > 0;
  if (ArrayBuffer.isView(value)) return value.byteLength > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sanitizeNaturalizedDataset(dataset: any): void {
  const NUMERIC_VR_TAGS = new Set([
    'Rows', 'Columns', 'BitsAllocated', 'BitsStored', 'HighBit',
    'PixelRepresentation', 'SamplesPerPixel', 'NumberOfFrames',
    'PlanarConfiguration', 'SmallestImagePixelValue', 'LargestImagePixelValue',
    'WindowCenter', 'WindowWidth', 'RescaleIntercept', 'RescaleSlope',
    'InstanceNumber', 'AcquisitionNumber', 'SeriesNumber',
    'RecommendedDisplayCIELabValue', 'MaximumFractionalValue',
    'LossyImageCompressionRatio', 'LossyImageCompressionMethod',
    'ObservationNumber', 'ReferencedROINumber', 'ROINumber',
    'ContourNumber', 'NumberOfContourPoints', 'ReferencedFrameNumber',
  ]);

  const visit = (obj: any): void => {
    if (obj == null || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      if (key === '_vrMap' || key === '_meta') continue;
      const value = obj[key];
      if (value === undefined) {
        delete obj[key];
        continue;
      }
      if (typeof value === 'number' && Number.isNaN(value)) {
        obj[key] = 0;
        continue;
      }
      if (value === '' && NUMERIC_VR_TAGS.has(key)) {
        delete obj[key];
        continue;
      }
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const entry = value[i];
          if (typeof entry === 'number' && Number.isNaN(entry)) {
            value[i] = 0;
          } else if (entry === undefined) {
            value[i] = '';
          } else if (entry && typeof entry === 'object' && !(entry instanceof ArrayBuffer) && !ArrayBuffer.isView(entry)) {
            visit(entry);
          }
        }
        continue;
      }
      if (value && typeof value === 'object' && !(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value)) {
        visit(value);
      }
    }
  };

  visit(dataset);
}

function sanitizeDenaturalizedDataset(dict: any): void {
  const NUMERIC_VR_TYPES = new Set(['US', 'UL', 'SS', 'SL', 'FL', 'FD', 'IS', 'DS']);
  if (dict == null || typeof dict !== 'object') return;

  for (const tagKey of Object.keys(dict)) {
    const entry = dict[tagKey];
    if (entry == null || typeof entry !== 'object') continue;
    if (!Array.isArray(entry.Value)) continue;

    const isNumericVR = NUMERIC_VR_TYPES.has(entry.vr);
    for (let i = 0; i < entry.Value.length; i++) {
      const value = entry.Value[i];
      if (typeof value === 'number' && Number.isNaN(value)) {
        entry.Value[i] = 0;
      } else if (value === 'NaN' || value === 'undefined' || value === 'null') {
        entry.Value[i] = isNumericVR ? 0 : '';
      } else if (value === '' && isNumericVR) {
        entry.Value[i] = 0;
      } else if (typeof value === 'string' && isNumericVR && Number.isNaN(Number.parseFloat(value))) {
        entry.Value[i] = 0;
      } else if (value === undefined || value === null) {
        entry.Value[i] = isNumericVR ? 0 : '';
      } else if (typeof value === 'object') {
        sanitizeDenaturalizedDataset(value);
      }
    }
  }
}

function nowDicomDateTime(): { date: string; time: string } {
  const now = new Date();
  const pad2 = (value: number) => String(value).padStart(2, '0');
  const pad6 = (value: number) => String(value).padStart(6, '0');

  return {
    date: `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`,
    time: `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}.${pad6(now.getMilliseconds() * 1000)}`,
  };
}

export function parseReferencedFrameNumber(imageId: string): number | null {
  const queryMatch = imageId.match(/[?&]frame=(\d+)/);
  if (queryMatch) {
    return parsePositiveInt(queryMatch[1]);
  }
  const pathMatch = imageId.match(/\/frames\/(\d+)(?:[/?#]|$)/);
  if (pathMatch) {
    return parsePositiveInt(pathMatch[1]);
  }
  return null;
}

function toBaseInstanceUri(imageId: string): string {
  return toWadouriUri(imageId)
    .replace(/\/frames\/\d+(?=([/?#]|$))/gi, '')
    .replace(/([?&])frame=\d+(&?)/gi, (_match, separator: string, tail: string) => {
      if (tail) {
        return separator === '?' ? '?' : separator;
      }
      return '';
    })
    .replace(/[?&]$/, '');
}

function getCachedSourceDataSet(imageId: string): any | null {
  const candidates = Array.from(new Set([
    // The loader's own key first — for a local `dicomfile:N` it is the fileManager
    // index, which neither form below produces.
    safeDatasetKey(imageId),
    toWadouriUri(imageId),
    toBaseInstanceUri(imageId),
  ])).filter(Boolean);

  for (const uri of candidates) {
    try {
      if (wadouri.dataSetCacheManager.isLoaded(uri)) {
        const dataSet = wadouri.dataSetCacheManager.get(uri);
        if (dataSet) return dataSet;
      }
    } catch {
      // Try the next possible cache key.
    }

    try {
      const dataSet = wadouri.dataSetCacheManager.get(uri);
      if (dataSet) return dataSet;
    } catch {
      // Keep falling back through candidate keys.
    }
  }

  return null;
}

function safeDatasetKey(imageId: string): string {
  try {
    return datasetSource(imageId).uri;
  } catch {
    return ''; // loader not initialized (isolated tests)
  }
}

function readCachedDicomString(dataSet: any, tag: string): string | undefined {
  const value = dataSet?.string?.(tag);
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readCachedDicomNumber(dataSet: any, tag: string): number | undefined {
  return parsePositiveInt(readCachedDicomString(dataSet, tag)) ?? undefined;
}

export function collectSourceDicomReferences(
  imageIds: string[],
  getMetaData: (type: string, imageId: string) => any,
): SourceDicomReference[] {
  const seen = new Set<string>();
  const refs: SourceDicomReference[] = [];

  for (const imageId of imageIds) {
    if (!imageId || seen.has(imageId)) continue;
    seen.add(imageId);

    const patient = getMetaData('patientModule', imageId) as any;
    const study = getMetaData('generalStudyModule', imageId) as any;
    const patientStudy = getMetaData('patientStudyModule', imageId) as any;
    const series = getMetaData('generalSeriesModule', imageId) as any;
    const imagePlane = getMetaData('imagePlaneModule', imageId) as any;
    const sopCommon = getMetaData('sopCommonModule', imageId) as any;
    const instance = getMetaData('instance', imageId) as any;
    const multiframe = getMetaData('multiframeModule', imageId) as any;
    const cachedDataSet = getCachedSourceDataSet(imageId);

    const referencedFrameNumber = parseReferencedFrameNumber(imageId) ?? undefined;
    const explicitNumberOfFrames =
      parsePositiveInt(multiframe?.numberOfFrames)
      ?? parsePositiveInt(instance?.NumberOfFrames)
      ?? parsePositiveInt(instance?.numberOfFrames)
      ?? parsePositiveInt(sopCommon?.numberOfFrames)
      ?? readCachedDicomNumber(cachedDataSet, 'x00280008');

    // Cornerstone 5's metadata providers split and rename these: StudyInstanceUID moved
    // to generalSeriesModule, patientModule says `patientID`, PatientSex moved to
    // patientStudyModule, and StudyID is in no module at all. So each field tries the
    // 4.x module key, its v5 home, the naturalized `instance` module (DICOM keywords),
    // then the raw dataset. Missing StudyInstanceUID made every SEG export refuse to run.
    refs.push({
      imageId,
      studyInstanceUID:
        study?.studyInstanceUID ?? series?.studyInstanceUID ?? instance?.StudyInstanceUID
        ?? readCachedDicomString(cachedDataSet, 'x0020000d'),
      seriesInstanceUID:
        series?.seriesInstanceUID ?? instance?.SeriesInstanceUID ?? readCachedDicomString(cachedDataSet, 'x0020000e'),
      frameOfReferenceUID:
        imagePlane?.frameOfReferenceUID ?? instance?.FrameOfReferenceUID ?? readCachedDicomString(cachedDataSet, 'x00200052'),
      sopClassUID: sopCommon?.sopClassUID ?? instance?.SOPClassUID ?? readCachedDicomString(cachedDataSet, 'x00080016'),
      sopInstanceUID:
        sopCommon?.sopInstanceUID ?? instance?.SOPInstanceUID ?? readCachedDicomString(cachedDataSet, 'x00080018'),
      patientName: patient?.patientName ?? instance?.PatientName ?? readCachedDicomString(cachedDataSet, 'x00100010'),
      patientId:
        patient?.patientId ?? patient?.patientID ?? instance?.PatientID ?? readCachedDicomString(cachedDataSet, 'x00100020'),
      patientBirthDate:
        patient?.patientBirthDate ?? instance?.PatientBirthDate ?? readCachedDicomString(cachedDataSet, 'x00100030'),
      patientSex:
        patient?.patientSex ?? patientStudy?.patientSex ?? instance?.PatientSex
        ?? readCachedDicomString(cachedDataSet, 'x00100040'),
      studyDate: study?.studyDate ?? readCachedDicomString(cachedDataSet, 'x00080020'),
      studyTime: study?.studyTime ?? readCachedDicomString(cachedDataSet, 'x00080030'),
      studyID: study?.studyID ?? study?.studyId ?? instance?.StudyID ?? readCachedDicomString(cachedDataSet, 'x00200010'),
      accessionNumber: study?.accessionNumber ?? readCachedDicomString(cachedDataSet, 'x00080050'),
      studyDescription: study?.studyDescription ?? readCachedDicomString(cachedDataSet, 'x00081030'),
      referringPhysicianName: study?.referringPhysicianName ?? readCachedDicomString(cachedDataSet, 'x00080090'),
      patientAge: patientStudy?.patientAge ?? readCachedDicomString(cachedDataSet, 'x00101010'),
      patientWeight: patientStudy?.patientWeight ?? readCachedDicomString(cachedDataSet, 'x00101030'),
      patientSize: patientStudy?.patientSize ?? readCachedDicomString(cachedDataSet, 'x00101020'),
      referencedFrameNumber,
      numberOfFrames:
        explicitNumberOfFrames && explicitNumberOfFrames > 1
          ? explicitNumberOfFrames
          : (referencedFrameNumber ? Math.max(2, referencedFrameNumber) : 1),
    });
  }

  return refs;
}

export function requireSingleStudyReference(
  refs: SourceDicomReference[],
  label: string,
): SourceDicomReference {
  const refsWithStudy = refs.filter((ref) => typeof ref.studyInstanceUID === 'string' && ref.studyInstanceUID.length > 0);
  const uniqueStudyUIDs = Array.from(new Set(refsWithStudy.map((ref) => ref.studyInstanceUID)));
  if (uniqueStudyUIDs.length === 0) {
    throw new Error(`${label} requires source DICOM metadata with StudyInstanceUID.`);
  }
  if (uniqueStudyUIDs.length > 1) {
    throw new Error(`${label} cannot export from multiple source studies.`);
  }

  const primary = refsWithStudy.find((ref) => ref.studyInstanceUID === uniqueStudyUIDs[0]);
  if (!primary) {
    throw new Error(`${label} could not resolve a primary source study reference.`);
  }
  return primary;
}

export function applyWorkstationDicomMetadata(dataset: any): void {
  dataset.SpecificCharacterSet = WORKSTATION_DICOM_METADATA.SpecificCharacterSet;
  dataset.Manufacturer = WORKSTATION_DICOM_METADATA.Manufacturer;
  dataset.ManufacturerModelName = WORKSTATION_DICOM_METADATA.ManufacturerModelName;
  dataset.DeviceSerialNumber = WORKSTATION_DICOM_METADATA.DeviceSerialNumber;
  dataset.SoftwareVersions = WORKSTATION_DICOM_METADATA.SoftwareVersions;
  dataset.StationName = WORKSTATION_DICOM_METADATA.StationName;
}

export function applyGeneratedDateTimeFields(
  dataset: any,
  options: { includeContentDateTime?: boolean; includeStructureSetDateTime?: boolean } = {},
): void {
  const { date, time } = nowDicomDateTime();
  if (!dataset.SeriesDate) dataset.SeriesDate = date;
  if (!dataset.SeriesTime) dataset.SeriesTime = time;
  if (options.includeContentDateTime) {
    if (!dataset.ContentDate) dataset.ContentDate = date;
    if (!dataset.ContentTime) dataset.ContentTime = time;
  }
  if (options.includeStructureSetDateTime) {
    if (!dataset.StructureSetDate) dataset.StructureSetDate = date;
    if (!dataset.StructureSetTime) dataset.StructureSetTime = time;
  }
}

export function ensureDicomFileMeta(
  dataset: any,
  defaultSOPClassUID: string,
): void {
  const fileMetaVersionBuf = new Uint8Array(2);
  fileMetaVersionBuf[1] = 1;

  const transferSyntaxUID =
    extractMetaValue(dataset._meta, 'TransferSyntaxUID')
    ?? '1.2.840.10008.1.2.1';

  dataset._meta = {
    MediaStorageSOPClassUID: dataset.SOPClassUID || defaultSOPClassUID,
    MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
    ImplementationVersionName: `XNATWS-${APP_VERSION}`.slice(0, 16),
    TransferSyntaxUID: transferSyntaxUID,
    ImplementationClassUID: WORKSTATION_IMPLEMENTATION_CLASS_UID,
    FileMetaInformationVersion: fileMetaVersionBuf.buffer,
  };
}

function validateFields(
  target: Record<string, unknown>,
  fields: string[],
  label: string,
): string[] {
  const errors: string[] = [];
  for (const field of fields) {
    if (!hasPopulatedValue(target[field])) {
      errors.push(`${label} is missing required field ${field}`);
    }
  }
  return errors;
}

function validateExpectedValues(
  target: Record<string, unknown>,
  expectedValues: Record<string, unknown>,
  label: string,
): string[] {
  const errors: string[] = [];
  for (const [field, expected] of Object.entries(expectedValues)) {
    if (expected === undefined) continue;
    if (!valuesEqual(target[field], expected)) {
      errors.push(`${label} field ${field} did not match expected value`);
    }
  }
  return errors;
}

export function naturalizeDicomArrayBuffer(arrayBuffer: ArrayBuffer): { dataset: any; meta: any } {
  const file = dcmjsUntyped.DicomMessage.readFile(arrayBuffer);
  const dataset = (dcmjsData as any).DicomMetaDictionary.naturalizeDataset(file.dict);
  const meta = (dcmjsData as any).DicomMetaDictionary.naturalizeDataset(file.meta);
  return { dataset, meta };
}

const SOURCE_IMAGE_PURPOSE = {
  CodeValue: '121322',
  CodingSchemeDesignator: 'DCM',
  CodeMeaning: 'Source image for image processing operation',
};
const SEGMENTATION_DERIVATION = {
  CodeValue: '113076',
  CodingSchemeDesignator: 'DCM',
  CodeMeaning: 'Segmentation',
};

const asList = (value: unknown): any[] => (Array.isArray(value) ? value : value ? [value] : []);

/**
 * Complete each SEG frame's DerivationImageSequence item.
 *
 * Cornerstone 5's SEG adapter (`applyPerFrameFunctionalGroups`) REPLACES the item
 * dcmjs's Segmentation derivation builds with a bare
 * `{ SourceImageSequence: [{ ReferencedSOPInstanceUID, ReferencedFrameNumber? }] }`,
 * dropping three attributes the Derivation Image / SOP Instance Reference macros
 * require — ReferencedSOPClassUID (Type 1), PurposeOfReferenceCodeSequence and
 * DerivationCodeSequence (Type 1C) — so every exported SEG failed dciodvfy. Restore
 * them exactly as dcmjs writes them. The class UID comes from the SEG's own
 * ReferencedSeriesSequence, which lists every referenced instance with its class.
 * Existing values are never overwritten.
 */
export function completeSegDerivationReferences(dataset: any): void {
  const sopClassByInstance = new Map<string, string>();
  for (const series of asList(dataset?.ReferencedSeriesSequence)) {
    for (const inst of asList(series?.ReferencedInstanceSequence)) {
      if (inst?.ReferencedSOPInstanceUID && inst?.ReferencedSOPClassUID) {
        sopClassByInstance.set(inst.ReferencedSOPInstanceUID, inst.ReferencedSOPClassUID);
      }
    }
  }
  for (const frame of asList(dataset?.PerFrameFunctionalGroupsSequence)) {
    for (const derivation of asList(frame?.DerivationImageSequence)) {
      derivation.DerivationCodeSequence ??= { ...SEGMENTATION_DERIVATION };
      for (const source of asList(derivation.SourceImageSequence)) {
        const sopClass = sopClassByInstance.get(source?.ReferencedSOPInstanceUID);
        if (!source.ReferencedSOPClassUID && sopClass) source.ReferencedSOPClassUID = sopClass;
        source.PurposeOfReferenceCodeSequence ??= { ...SOURCE_IMAGE_PURPOSE };
      }
    }
  }
}

export function serializeDerivedDicomDataset(
  dataset: any,
  options: SerializeDerivedDicomOptions,
): { arrayBuffer: ArrayBuffer; parsedDataset: any; parsedMeta: any } {
  applyWorkstationDicomMetadata(dataset);
  if (options.kind === 'SEG') completeSegDerivationReferences(dataset);
  if (options.approval) {
    // Approval (D7.11) round-trips through the file, so a reload arrives locked.
    // ReviewerName/Date/Time are deleted rather than blanked when unapproved — an
    // empty person-name is legal but misleading, and absence IS the DICOM default.
    dataset.ApprovalStatus = options.approval.ApprovalStatus;
    for (const field of ['ReviewerName', 'ReviewDate', 'ReviewTime'] as const) {
      const value = options.approval[field];
      if (value) dataset[field] = value;
      else delete dataset[field];
    }
  }
  applyGeneratedDateTimeFields(dataset, {
    includeContentDateTime: options.includeContentDateTime,
    includeStructureSetDateTime: options.includeStructureSetDateTime,
  });
  ensureDicomFileMeta(dataset, options.defaultSOPClassUID);
  sanitizeNaturalizedDataset(dataset);

  const preWriteErrors = [
    ...validateFields(dataset, options.requiredDatasetFields, `${options.kind} dataset`),
    ...validateFields(
      dataset._meta as Record<string, unknown>,
      options.requiredFileMetaFields ?? [
        'MediaStorageSOPClassUID',
        'MediaStorageSOPInstanceUID',
        'TransferSyntaxUID',
        'ImplementationClassUID',
        'ImplementationVersionName',
        'FileMetaInformationVersion',
      ],
      `${options.kind} file meta`,
    ),
    ...validateExpectedValues(dataset, options.expectedDatasetValues ?? {}, `${options.kind} dataset`),
  ];
  if (preWriteErrors.length > 0) {
    throw new Error(preWriteErrors.join(' '));
  }

  const denaturalizedMeta = (dcmjsData as any).DicomMetaDictionary.denaturalizeDataset(dataset._meta);
  const denaturalizedDict = (dcmjsData as any).DicomMetaDictionary.denaturalizeDataset(dataset);
  sanitizeDenaturalizedDataset(denaturalizedMeta);
  sanitizeDenaturalizedDataset(denaturalizedDict);

  const arrayBuffer = writeDicomDict(
    (dcmjsData as any).DicomDict,
    denaturalizedMeta,
    denaturalizedDict,
    options.callerTag,
  );

  const { dataset: parsedDataset, meta: parsedMeta } = naturalizeDicomArrayBuffer(arrayBuffer);
  const postWriteErrors = [
    ...validateFields(parsedDataset, options.requiredDatasetFields, `${options.kind} parsed dataset`),
    ...validateFields(
      parsedMeta,
      options.requiredFileMetaFields ?? [
        'MediaStorageSOPClassUID',
        'MediaStorageSOPInstanceUID',
        'TransferSyntaxUID',
        'ImplementationClassUID',
        'ImplementationVersionName',
        'FileMetaInformationVersion',
      ],
      `${options.kind} parsed file meta`,
    ),
    ...validateExpectedValues(parsedDataset, options.expectedDatasetValues ?? {}, `${options.kind} parsed dataset`),
  ];

  const parsedMetaExpectations = {
    MediaStorageSOPClassUID: dataset.SOPClassUID || options.defaultSOPClassUID,
    MediaStorageSOPInstanceUID: dataset.SOPInstanceUID,
  };
  postWriteErrors.push(
    ...validateExpectedValues(parsedMeta, parsedMetaExpectations, `${options.kind} parsed file meta`),
  );

  if (postWriteErrors.length > 0) {
    throw new Error(postWriteErrors.join(' '));
  }

  return { arrayBuffer, parsedDataset, parsedMeta };
}
