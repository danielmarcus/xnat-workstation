/**
 * DICOM Tag Dictionary — maps tag keys (xGGGGEEEE) to human-readable
 * name, keyword, VR, and module group for the DICOM Header Inspector panel.
 *
 * Covers ~400 commonly encountered DICOM tags across Patient, Study, Series,
 * Equipment, Image, Acquisition, and other modules.
 */

export interface DicomTagInfo {
  /** Human-readable name, e.g. "Patient's Name" */
  name: string;
  /** DICOM keyword, e.g. "PatientName" */
  keyword: string;
  /** Value Representation, e.g. "PN" */
  vr: string;
  /** Display group for the inspector panel */
  group: DicomTagGroup;
}

export type DicomTagGroup =
  | 'Patient'
  | 'Study'
  | 'Series'
  | 'Equipment'
  | 'Image'
  | 'Acquisition'
  | 'Frame of Reference'
  | 'Other';

export const DICOM_TAG_GROUPS_ORDER: DicomTagGroup[] = [
  'Patient',
  'Study',
  'Series',
  'Equipment',
  'Acquisition',
  'Frame of Reference',
  'Image',
  'Other',
];

export const DICOM_TAG_DICTIONARY: Record<string, DicomTagInfo> = {
  // ─── File Meta Information ────────────────────────────────────────
  'x00020000': { name: 'File Meta Information Group Length', keyword: 'FileMetaInformationGroupLength', vr: 'UL', group: 'Other' },
  'x00020001': { name: 'File Meta Information Version', keyword: 'FileMetaInformationVersion', vr: 'OB', group: 'Other' },
  'x00020002': { name: 'Media Storage SOP Class UID', keyword: 'MediaStorageSOPClassUID', vr: 'UI', group: 'Other' },
  'x00020003': { name: 'Media Storage SOP Instance UID', keyword: 'MediaStorageSOPInstanceUID', vr: 'UI', group: 'Other' },
  'x00020010': { name: 'Transfer Syntax UID', keyword: 'TransferSyntaxUID', vr: 'UI', group: 'Other' },
  'x00020012': { name: 'Implementation Class UID', keyword: 'ImplementationClassUID', vr: 'UI', group: 'Other' },
  'x00020013': { name: 'Implementation Version Name', keyword: 'ImplementationVersionName', vr: 'SH', group: 'Other' },
  'x00020016': { name: 'Source Application Entity Title', keyword: 'SourceApplicationEntityTitle', vr: 'AE', group: 'Other' },

  // ─── SOP Common (0008) ────────────────────────────────────────────
  'x00080005': { name: 'Specific Character Set', keyword: 'SpecificCharacterSet', vr: 'CS', group: 'Other' },
  'x00080008': { name: 'Image Type', keyword: 'ImageType', vr: 'CS', group: 'Image' },
  'x00080012': { name: 'Instance Creation Date', keyword: 'InstanceCreationDate', vr: 'DA', group: 'Other' },
  'x00080013': { name: 'Instance Creation Time', keyword: 'InstanceCreationTime', vr: 'TM', group: 'Other' },
  'x00080014': { name: 'Instance Creator UID', keyword: 'InstanceCreatorUID', vr: 'UI', group: 'Other' },
  'x00080016': { name: 'SOP Class UID', keyword: 'SOPClassUID', vr: 'UI', group: 'Other' },
  'x00080018': { name: 'SOP Instance UID', keyword: 'SOPInstanceUID', vr: 'UI', group: 'Other' },
  'x00080020': { name: 'Study Date', keyword: 'StudyDate', vr: 'DA', group: 'Study' },
  'x00080021': { name: 'Series Date', keyword: 'SeriesDate', vr: 'DA', group: 'Series' },
  'x00080022': { name: 'Acquisition Date', keyword: 'AcquisitionDate', vr: 'DA', group: 'Acquisition' },
  'x00080023': { name: 'Content Date', keyword: 'ContentDate', vr: 'DA', group: 'Image' },
  'x00080030': { name: 'Study Time', keyword: 'StudyTime', vr: 'TM', group: 'Study' },
  'x00080031': { name: 'Series Time', keyword: 'SeriesTime', vr: 'TM', group: 'Series' },
  'x00080032': { name: 'Acquisition Time', keyword: 'AcquisitionTime', vr: 'TM', group: 'Acquisition' },
  'x00080033': { name: 'Content Time', keyword: 'ContentTime', vr: 'TM', group: 'Image' },
  'x00080050': { name: 'Accession Number', keyword: 'AccessionNumber', vr: 'SH', group: 'Study' },
  'x00080051': { name: 'Issuer of Accession Number Sequence', keyword: 'IssuerOfAccessionNumberSequence', vr: 'SQ', group: 'Study' },
  'x00080052': { name: 'Query/Retrieve Level', keyword: 'QueryRetrieveLevel', vr: 'CS', group: 'Other' },
  'x00080054': { name: 'Retrieve AE Title', keyword: 'RetrieveAETitle', vr: 'AE', group: 'Other' },
  'x00080056': { name: 'Instance Availability', keyword: 'InstanceAvailability', vr: 'CS', group: 'Other' },
  'x00080058': { name: 'Failed SOP Instance UID List', keyword: 'FailedSOPInstanceUIDList', vr: 'UI', group: 'Other' },
  'x00080060': { name: 'Modality', keyword: 'Modality', vr: 'CS', group: 'Series' },
  'x00080061': { name: 'Modalities in Study', keyword: 'ModalitiesInStudy', vr: 'CS', group: 'Study' },
  'x00080064': { name: 'Conversion Type', keyword: 'ConversionType', vr: 'CS', group: 'Other' },
  'x00080068': { name: 'Presentation Intent Type', keyword: 'PresentationIntentType', vr: 'CS', group: 'Other' },
  'x00080070': { name: 'Manufacturer', keyword: 'Manufacturer', vr: 'LO', group: 'Equipment' },
  'x00080080': { name: 'Institution Name', keyword: 'InstitutionName', vr: 'LO', group: 'Equipment' },
  'x00080081': { name: 'Institution Address', keyword: 'InstitutionAddress', vr: 'ST', group: 'Equipment' },
  'x00080082': { name: 'Institution Code Sequence', keyword: 'InstitutionCodeSequence', vr: 'SQ', group: 'Equipment' },
  'x00080090': { name: "Referring Physician's Name", keyword: 'ReferringPhysicianName', vr: 'PN', group: 'Study' },
  'x00080096': { name: "Referring Physician Identification Sequence", keyword: 'ReferringPhysicianIdentificationSequence', vr: 'SQ', group: 'Study' },
  'x00081010': { name: 'Station Name', keyword: 'StationName', vr: 'SH', group: 'Equipment' },
  'x00081030': { name: 'Study Description', keyword: 'StudyDescription', vr: 'LO', group: 'Study' },
  'x00081032': { name: 'Procedure Code Sequence', keyword: 'ProcedureCodeSequence', vr: 'SQ', group: 'Study' },
  'x0008103e': { name: 'Series Description', keyword: 'SeriesDescription', vr: 'LO', group: 'Series' },
  'x0008103f': { name: 'Series Description Code Sequence', keyword: 'SeriesDescriptionCodeSequence', vr: 'SQ', group: 'Series' },
  'x00081040': { name: 'Institutional Department Name', keyword: 'InstitutionalDepartmentName', vr: 'LO', group: 'Equipment' },
  'x00081048': { name: "Physician(s) of Record", keyword: 'PhysiciansOfRecord', vr: 'PN', group: 'Study' },
  'x00081050': { name: "Performing Physician's Name", keyword: 'PerformingPhysicianName', vr: 'PN', group: 'Series' },
  'x00081060': { name: "Name of Physician(s) Reading Study", keyword: 'NameOfPhysiciansReadingStudy', vr: 'PN', group: 'Study' },
  'x00081070': { name: "Operators' Name", keyword: 'OperatorsName', vr: 'PN', group: 'Series' },
  'x00081080': { name: 'Admitting Diagnoses Description', keyword: 'AdmittingDiagnosesDescription', vr: 'LO', group: 'Study' },
  'x00081090': { name: "Manufacturer's Model Name", keyword: 'ManufacturerModelName', vr: 'LO', group: 'Equipment' },
  'x00081110': { name: 'Referenced Study Sequence', keyword: 'ReferencedStudySequence', vr: 'SQ', group: 'Other' },
  'x00081111': { name: 'Referenced Performed Procedure Step Sequence', keyword: 'ReferencedPerformedProcedureStepSequence', vr: 'SQ', group: 'Other' },
  'x00081115': { name: 'Referenced Series Sequence', keyword: 'ReferencedSeriesSequence', vr: 'SQ', group: 'Other' },
  'x00081120': { name: 'Referenced Patient Sequence', keyword: 'ReferencedPatientSequence', vr: 'SQ', group: 'Other' },
  'x00081140': { name: 'Referenced Image Sequence', keyword: 'ReferencedImageSequence', vr: 'SQ', group: 'Other' },
  'x00081150': { name: 'Referenced SOP Class UID', keyword: 'ReferencedSOPClassUID', vr: 'UI', group: 'Other' },
  'x00081155': { name: 'Referenced SOP Instance UID', keyword: 'ReferencedSOPInstanceUID', vr: 'UI', group: 'Other' },
  'x00081195': { name: 'Transaction UID', keyword: 'TransactionUID', vr: 'UI', group: 'Other' },
  'x00082112': { name: 'Source Image Sequence', keyword: 'SourceImageSequence', vr: 'SQ', group: 'Other' },
  'x00082218': { name: 'Anatomic Region Sequence', keyword: 'AnatomicRegionSequence', vr: 'SQ', group: 'Series' },

  // ─── Patient Module (0010) ────────────────────────────────────────
  'x00100010': { name: "Patient's Name", keyword: 'PatientName', vr: 'PN', group: 'Patient' },
  'x00100020': { name: 'Patient ID', keyword: 'PatientID', vr: 'LO', group: 'Patient' },
  'x00100021': { name: 'Issuer of Patient ID', keyword: 'IssuerOfPatientID', vr: 'LO', group: 'Patient' },
  'x00100024': { name: 'Issuer of Patient ID Qualifiers Sequence', keyword: 'IssuerOfPatientIDQualifiersSequence', vr: 'SQ', group: 'Patient' },
  'x00100030': { name: "Patient's Birth Date", keyword: 'PatientBirthDate', vr: 'DA', group: 'Patient' },
  'x00100032': { name: "Patient's Birth Time", keyword: 'PatientBirthTime', vr: 'TM', group: 'Patient' },
  'x00100040': { name: "Patient's Sex", keyword: 'PatientSex', vr: 'CS', group: 'Patient' },
  'x00100050': { name: "Patient's Insurance Plan Code Sequence", keyword: 'PatientInsurancePlanCodeSequence', vr: 'SQ', group: 'Patient' },
  'x00101000': { name: 'Other Patient IDs', keyword: 'OtherPatientIDs', vr: 'LO', group: 'Patient' },
  'x00101001': { name: 'Other Patient Names', keyword: 'OtherPatientNames', vr: 'PN', group: 'Patient' },
  'x00101002': { name: 'Other Patient IDs Sequence', keyword: 'OtherPatientIDsSequence', vr: 'SQ', group: 'Patient' },
  'x00101010': { name: "Patient's Age", keyword: 'PatientAge', vr: 'AS', group: 'Patient' },
  'x00101020': { name: "Patient's Size", keyword: 'PatientSize', vr: 'DS', group: 'Patient' },
  'x00101030': { name: "Patient's Weight", keyword: 'PatientWeight', vr: 'DS', group: 'Patient' },
  'x00101040': { name: "Patient's Address", keyword: 'PatientAddress', vr: 'LO', group: 'Patient' },
  'x00102000': { name: 'Medical Alerts', keyword: 'MedicalAlerts', vr: 'LO', group: 'Patient' },
  'x00102110': { name: 'Allergies', keyword: 'Allergies', vr: 'LO', group: 'Patient' },
  'x00102160': { name: 'Ethnic Group', keyword: 'EthnicGroup', vr: 'SH', group: 'Patient' },
  'x00102180': { name: 'Occupation', keyword: 'Occupation', vr: 'SH', group: 'Patient' },
  'x001021a0': { name: 'Smoking Status', keyword: 'SmokingStatus', vr: 'CS', group: 'Patient' },
  'x001021b0': { name: 'Additional Patient History', keyword: 'AdditionalPatientHistory', vr: 'LT', group: 'Patient' },
  'x001021c0': { name: 'Pregnancy Status', keyword: 'PregnancyStatus', vr: 'US', group: 'Patient' },
  'x00104000': { name: 'Patient Comments', keyword: 'PatientComments', vr: 'LT', group: 'Patient' },

  // ─── Clinical Trial Subject (0012) ────────────────────────────────
  'x00120010': { name: 'Clinical Trial Sponsor Name', keyword: 'ClinicalTrialSponsorName', vr: 'LO', group: 'Other' },
  'x00120020': { name: 'Clinical Trial Protocol ID', keyword: 'ClinicalTrialProtocolID', vr: 'LO', group: 'Other' },
  'x00120021': { name: 'Clinical Trial Protocol Name', keyword: 'ClinicalTrialProtocolName', vr: 'LO', group: 'Other' },
  'x00120030': { name: 'Clinical Trial Site ID', keyword: 'ClinicalTrialSiteID', vr: 'LO', group: 'Other' },
  'x00120031': { name: 'Clinical Trial Site Name', keyword: 'ClinicalTrialSiteName', vr: 'LO', group: 'Other' },
  'x00120040': { name: 'Clinical Trial Subject ID', keyword: 'ClinicalTrialSubjectID', vr: 'LO', group: 'Other' },
  'x00120042': { name: 'Clinical Trial Subject Reading ID', keyword: 'ClinicalTrialSubjectReadingID', vr: 'LO', group: 'Other' },
  'x00120050': { name: 'Clinical Trial Time Point ID', keyword: 'ClinicalTrialTimePointID', vr: 'LO', group: 'Other' },
  'x00120062': { name: 'Patient Identity Removed', keyword: 'PatientIdentityRemoved', vr: 'CS', group: 'Patient' },
  'x00120063': { name: 'De-identification Method', keyword: 'DeidentificationMethod', vr: 'LO', group: 'Patient' },
  'x00120064': { name: 'De-identification Method Code Sequence', keyword: 'DeidentificationMethodCodeSequence', vr: 'SQ', group: 'Patient' },

  // ─── General Study (0008/0020/0032) ───────────────────────────────
  'x0020000d': { name: 'Study Instance UID', keyword: 'StudyInstanceUID', vr: 'UI', group: 'Study' },
  'x00200010': { name: 'Study ID', keyword: 'StudyID', vr: 'SH', group: 'Study' },
  'x00321033': { name: 'Requesting Service', keyword: 'RequestingService', vr: 'LO', group: 'Study' },
  'x00321060': { name: 'Requested Procedure Description', keyword: 'RequestedProcedureDescription', vr: 'LO', group: 'Study' },
  'x00321064': { name: 'Requested Procedure Code Sequence', keyword: 'RequestedProcedureCodeSequence', vr: 'SQ', group: 'Study' },
  'x00400244': { name: 'Performed Procedure Step Start Date', keyword: 'PerformedProcedureStepStartDate', vr: 'DA', group: 'Study' },
  'x00400245': { name: 'Performed Procedure Step Start Time', keyword: 'PerformedProcedureStepStartTime', vr: 'TM', group: 'Study' },
  'x00400253': { name: 'Performed Procedure Step ID', keyword: 'PerformedProcedureStepID', vr: 'SH', group: 'Study' },
  'x00400254': { name: 'Performed Procedure Step Description', keyword: 'PerformedProcedureStepDescription', vr: 'LO', group: 'Study' },
  'x00400275': { name: 'Request Attributes Sequence', keyword: 'RequestAttributesSequence', vr: 'SQ', group: 'Study' },

  // ─── General Series (0008/0020) ───────────────────────────────────
  'x0020000e': { name: 'Series Instance UID', keyword: 'SeriesInstanceUID', vr: 'UI', group: 'Series' },
  'x00200011': { name: 'Series Number', keyword: 'SeriesNumber', vr: 'IS', group: 'Series' },
  'x00200060': { name: 'Laterality', keyword: 'Laterality', vr: 'CS', group: 'Series' },
  'x00081072': { name: 'Operator Identification Sequence', keyword: 'OperatorIdentificationSequence', vr: 'SQ', group: 'Series' },
  'x00180015': { name: 'Body Part Examined', keyword: 'BodyPartExamined', vr: 'CS', group: 'Series' },
  'x00181030': { name: 'Protocol Name', keyword: 'ProtocolName', vr: 'LO', group: 'Series' },
  'x00185100': { name: 'Patient Position', keyword: 'PatientPosition', vr: 'CS', group: 'Series' },

  // ─── Frame of Reference (0020) ────────────────────────────────────
  'x00200052': { name: 'Frame of Reference UID', keyword: 'FrameOfReferenceUID', vr: 'UI', group: 'Frame of Reference' },
  'x00201040': { name: 'Position Reference Indicator', keyword: 'PositionReferenceIndicator', vr: 'LO', group: 'Frame of Reference' },

  // ─── General Equipment (0008/0018) ────────────────────────────────
  'x00181000': { name: 'Device Serial Number', keyword: 'DeviceSerialNumber', vr: 'LO', group: 'Equipment' },
  'x00181016': { name: 'Secondary Capture Device Manufacturer', keyword: 'SecondaryCaptureDeviceManufacturer', vr: 'LO', group: 'Equipment' },
  'x00181018': { name: 'Secondary Capture Device Manufacturer Model Name', keyword: 'SecondaryCaptureDeviceManufacturerModelName', vr: 'LO', group: 'Equipment' },
  'x00181019': { name: 'Secondary Capture Device Software Versions', keyword: 'SecondaryCaptureDeviceSoftwareVersions', vr: 'LO', group: 'Equipment' },
  'x00181020': { name: 'Software Versions', keyword: 'SoftwareVersions', vr: 'LO', group: 'Equipment' },
  'x00181050': { name: 'Spatial Resolution', keyword: 'SpatialResolution', vr: 'DS', group: 'Equipment' },
  'x00181200': { name: 'Date of Last Calibration', keyword: 'DateOfLastCalibration', vr: 'DA', group: 'Equipment' },
  'x00181201': { name: 'Time of Last Calibration', keyword: 'TimeOfLastCalibration', vr: 'TM', group: 'Equipment' },

  // ─── Acquisition (0018) ───────────────────────────────────────────
  'x00180010': { name: 'Contrast/Bolus Agent', keyword: 'ContrastBolusAgent', vr: 'LO', group: 'Acquisition' },
  'x00180020': { name: 'Scanning Sequence', keyword: 'ScanningSequence', vr: 'CS', group: 'Acquisition' },
  'x00180021': { name: 'Sequence Variant', keyword: 'SequenceVariant', vr: 'CS', group: 'Acquisition' },
  'x00180022': { name: 'Scan Options', keyword: 'ScanOptions', vr: 'CS', group: 'Acquisition' },
  'x00180023': { name: 'MR Acquisition Type', keyword: 'MRAcquisitionType', vr: 'CS', group: 'Acquisition' },
  'x00180024': { name: 'Sequence Name', keyword: 'SequenceName', vr: 'SH', group: 'Acquisition' },
  'x00180025': { name: 'Angio Flag', keyword: 'AngioFlag', vr: 'CS', group: 'Acquisition' },
  'x00180050': { name: 'Slice Thickness', keyword: 'SliceThickness', vr: 'DS', group: 'Acquisition' },
  'x00180060': { name: 'KVP', keyword: 'KVP', vr: 'DS', group: 'Acquisition' },
  'x00180080': { name: 'Repetition Time', keyword: 'RepetitionTime', vr: 'DS', group: 'Acquisition' },
  'x00180081': { name: 'Echo Time', keyword: 'EchoTime', vr: 'DS', group: 'Acquisition' },
  'x00180082': { name: 'Inversion Time', keyword: 'InversionTime', vr: 'DS', group: 'Acquisition' },
  'x00180083': { name: 'Number of Averages', keyword: 'NumberOfAverages', vr: 'DS', group: 'Acquisition' },
  'x00180084': { name: 'Imaging Frequency', keyword: 'ImagingFrequency', vr: 'DS', group: 'Acquisition' },
  'x00180085': { name: 'Imaged Nucleus', keyword: 'ImagedNucleus', vr: 'SH', group: 'Acquisition' },
  'x00180086': { name: 'Echo Number(s)', keyword: 'EchoNumbers', vr: 'IS', group: 'Acquisition' },
  'x00180087': { name: 'Magnetic Field Strength', keyword: 'MagneticFieldStrength', vr: 'DS', group: 'Acquisition' },
  'x00180088': { name: 'Spacing Between Slices', keyword: 'SpacingBetweenSlices', vr: 'DS', group: 'Acquisition' },
  'x00180089': { name: 'Number of Phase Encoding Steps', keyword: 'NumberOfPhaseEncodingSteps', vr: 'IS', group: 'Acquisition' },
  'x00180090': { name: 'Data Collection Diameter', keyword: 'DataCollectionDiameter', vr: 'DS', group: 'Acquisition' },
  'x00180091': { name: 'Echo Train Length', keyword: 'EchoTrainLength', vr: 'IS', group: 'Acquisition' },
  'x00180093': { name: 'Percent Sampling', keyword: 'PercentSampling', vr: 'DS', group: 'Acquisition' },
  'x00180094': { name: 'Percent Phase Field of View', keyword: 'PercentPhaseFieldOfView', vr: 'DS', group: 'Acquisition' },
  'x00180095': { name: 'Pixel Bandwidth', keyword: 'PixelBandwidth', vr: 'DS', group: 'Acquisition' },
  'x00181040': { name: 'Contrast/Bolus Route', keyword: 'ContrastBolusRoute', vr: 'LO', group: 'Acquisition' },
  'x00181041': { name: 'Contrast/Bolus Volume', keyword: 'ContrastBolusVolume', vr: 'DS', group: 'Acquisition' },
  'x00181044': { name: 'Contrast/Bolus Total Dose', keyword: 'ContrastBolusTotalDose', vr: 'DS', group: 'Acquisition' },
  'x00181049': { name: 'Contrast/Bolus Ingredient Concentration', keyword: 'ContrastBolusIngredientConcentration', vr: 'DS', group: 'Acquisition' },
  'x00181060': { name: 'Trigger Time', keyword: 'TriggerTime', vr: 'DS', group: 'Acquisition' },
  'x00181062': { name: 'Nominal Interval', keyword: 'NominalInterval', vr: 'IS', group: 'Acquisition' },
  'x00181063': { name: 'Frame Time', keyword: 'FrameTime', vr: 'DS', group: 'Acquisition' },
  'x00181081': { name: 'Low R-R Value', keyword: 'LowRRValue', vr: 'IS', group: 'Acquisition' },
  'x00181082': { name: 'High R-R Value', keyword: 'HighRRValue', vr: 'IS', group: 'Acquisition' },
  'x00181083': { name: 'Intervals Acquired', keyword: 'IntervalsAcquired', vr: 'IS', group: 'Acquisition' },
  'x00181084': { name: 'Intervals Rejected', keyword: 'IntervalsRejected', vr: 'IS', group: 'Acquisition' },
  'x00181088': { name: 'Heart Rate', keyword: 'HeartRate', vr: 'IS', group: 'Acquisition' },
  'x00181090': { name: 'Cardiac Number of Images', keyword: 'CardiacNumberOfImages', vr: 'IS', group: 'Acquisition' },
  'x00181094': { name: 'Trigger Window', keyword: 'TriggerWindow', vr: 'IS', group: 'Acquisition' },
  'x00181100': { name: 'Reconstruction Diameter', keyword: 'ReconstructionDiameter', vr: 'DS', group: 'Acquisition' },
  'x00181110': { name: 'Distance Source to Detector', keyword: 'DistanceSourceToDetector', vr: 'DS', group: 'Acquisition' },
  'x00181111': { name: 'Distance Source to Patient', keyword: 'DistanceSourceToPatient', vr: 'DS', group: 'Acquisition' },
  'x00181114': { name: 'Estimated Radiographic Magnification Factor', keyword: 'EstimatedRadiographicMagnificationFactor', vr: 'DS', group: 'Acquisition' },
  'x00181120': { name: 'Gantry/Detector Tilt', keyword: 'GantryDetectorTilt', vr: 'DS', group: 'Acquisition' },
  'x00181130': { name: 'Table Height', keyword: 'TableHeight', vr: 'DS', group: 'Acquisition' },
  'x00181131': { name: 'Table Traverse', keyword: 'TableTraverse', vr: 'DS', group: 'Acquisition' },
  'x00181140': { name: 'Rotation Direction', keyword: 'RotationDirection', vr: 'CS', group: 'Acquisition' },
  'x00181150': { name: 'Exposure Time', keyword: 'ExposureTime', vr: 'IS', group: 'Acquisition' },
  'x00181151': { name: 'X-Ray Tube Current', keyword: 'XRayTubeCurrent', vr: 'IS', group: 'Acquisition' },
  'x00181152': { name: 'Exposure', keyword: 'Exposure', vr: 'IS', group: 'Acquisition' },
  'x00181153': { name: 'Exposure in µAs', keyword: 'ExposureInuAs', vr: 'IS', group: 'Acquisition' },
  'x00181160': { name: 'Filter Type', keyword: 'FilterType', vr: 'SH', group: 'Acquisition' },
  'x00181170': { name: 'Generator Power', keyword: 'GeneratorPower', vr: 'IS', group: 'Acquisition' },
  'x00181190': { name: 'Focal Spot(s)', keyword: 'FocalSpots', vr: 'DS', group: 'Acquisition' },
  'x00181210': { name: 'Convolution Kernel', keyword: 'ConvolutionKernel', vr: 'SH', group: 'Acquisition' },
  'x00181250': { name: 'Receive Coil Name', keyword: 'ReceiveCoilName', vr: 'SH', group: 'Acquisition' },
  'x00181251': { name: 'Transmit Coil Name', keyword: 'TransmitCoilName', vr: 'SH', group: 'Acquisition' },
  'x00181260': { name: 'Plate Type', keyword: 'PlateType', vr: 'SH', group: 'Acquisition' },
  'x00181261': { name: 'Phosphor Type', keyword: 'PhosphorType', vr: 'LO', group: 'Acquisition' },
  'x00181300': { name: 'Scan Velocity', keyword: 'ScanVelocity', vr: 'DS', group: 'Acquisition' },
  'x00181302': { name: 'Scan Length', keyword: 'ScanLength', vr: 'IS', group: 'Acquisition' },
  'x00181310': { name: 'Acquisition Matrix', keyword: 'AcquisitionMatrix', vr: 'US', group: 'Acquisition' },
  'x00181312': { name: 'In-plane Phase Encoding Direction', keyword: 'InPlanePhaseEncodingDirection', vr: 'CS', group: 'Acquisition' },
  'x00181314': { name: 'Flip Angle', keyword: 'FlipAngle', vr: 'DS', group: 'Acquisition' },
  'x00181315': { name: 'Variable Flip Angle Flag', keyword: 'VariableFlipAngleFlag', vr: 'CS', group: 'Acquisition' },
  'x00181316': { name: 'SAR', keyword: 'SAR', vr: 'DS', group: 'Acquisition' },
  'x00181318': { name: 'dB/dt', keyword: 'dBdt', vr: 'DS', group: 'Acquisition' },
  'x00182001': { name: 'Page Number Vector', keyword: 'PageNumberVector', vr: 'IS', group: 'Acquisition' },
  'x00185101': { name: 'View Position', keyword: 'ViewPosition', vr: 'CS', group: 'Acquisition' },

  // ─── General Image (0008/0020/0028) ───────────────────────────────
  'x00200013': { name: 'Instance Number', keyword: 'InstanceNumber', vr: 'IS', group: 'Image' },
  'x00200020': { name: 'Patient Orientation', keyword: 'PatientOrientation', vr: 'CS', group: 'Image' },
  'x00200032': { name: 'Image Position (Patient)', keyword: 'ImagePositionPatient', vr: 'DS', group: 'Image' },
  'x00200037': { name: 'Image Orientation (Patient)', keyword: 'ImageOrientationPatient', vr: 'DS', group: 'Image' },
  'x00201041': { name: 'Slice Location', keyword: 'SliceLocation', vr: 'DS', group: 'Image' },
  'x00200012': { name: 'Acquisition Number', keyword: 'AcquisitionNumber', vr: 'IS', group: 'Image' },
  'x00200100': { name: 'Temporal Position Identifier', keyword: 'TemporalPositionIdentifier', vr: 'IS', group: 'Image' },
  'x00200105': { name: 'Number of Temporal Positions', keyword: 'NumberOfTemporalPositions', vr: 'IS', group: 'Image' },
  'x00204000': { name: 'Image Comments', keyword: 'ImageComments', vr: 'LT', group: 'Image' },
  'x00280002': { name: 'Samples per Pixel', keyword: 'SamplesPerPixel', vr: 'US', group: 'Image' },
  'x00280004': { name: 'Photometric Interpretation', keyword: 'PhotometricInterpretation', vr: 'CS', group: 'Image' },
  'x00280006': { name: 'Planar Configuration', keyword: 'PlanarConfiguration', vr: 'US', group: 'Image' },
  'x00280008': { name: 'Number of Frames', keyword: 'NumberOfFrames', vr: 'IS', group: 'Image' },
  'x00280009': { name: 'Frame Increment Pointer', keyword: 'FrameIncrementPointer', vr: 'AT', group: 'Image' },
  'x00280010': { name: 'Rows', keyword: 'Rows', vr: 'US', group: 'Image' },
  'x00280011': { name: 'Columns', keyword: 'Columns', vr: 'US', group: 'Image' },
  'x00280030': { name: 'Pixel Spacing', keyword: 'PixelSpacing', vr: 'DS', group: 'Image' },
  'x00280034': { name: 'Pixel Aspect Ratio', keyword: 'PixelAspectRatio', vr: 'IS', group: 'Image' },
  'x00280100': { name: 'Bits Allocated', keyword: 'BitsAllocated', vr: 'US', group: 'Image' },
  'x00280101': { name: 'Bits Stored', keyword: 'BitsStored', vr: 'US', group: 'Image' },
  'x00280102': { name: 'High Bit', keyword: 'HighBit', vr: 'US', group: 'Image' },
  'x00280103': { name: 'Pixel Representation', keyword: 'PixelRepresentation', vr: 'US', group: 'Image' },
  'x00280106': { name: 'Smallest Image Pixel Value', keyword: 'SmallestImagePixelValue', vr: 'US', group: 'Image' },
  'x00280107': { name: 'Largest Image Pixel Value', keyword: 'LargestImagePixelValue', vr: 'US', group: 'Image' },
  'x00280120': { name: 'Pixel Padding Value', keyword: 'PixelPaddingValue', vr: 'US', group: 'Image' },
  'x00281050': { name: 'Window Center', keyword: 'WindowCenter', vr: 'DS', group: 'Image' },
  'x00281051': { name: 'Window Width', keyword: 'WindowWidth', vr: 'DS', group: 'Image' },
  'x00281052': { name: 'Rescale Intercept', keyword: 'RescaleIntercept', vr: 'DS', group: 'Image' },
  'x00281053': { name: 'Rescale Slope', keyword: 'RescaleSlope', vr: 'DS', group: 'Image' },
  'x00281054': { name: 'Rescale Type', keyword: 'RescaleType', vr: 'LO', group: 'Image' },
  'x00281055': { name: 'Window Center & Width Explanation', keyword: 'WindowCenterWidthExplanation', vr: 'LO', group: 'Image' },
  'x00281056': { name: 'VOI LUT Function', keyword: 'VOILUTFunction', vr: 'CS', group: 'Image' },
  'x00281101': { name: 'Red Palette Color Lookup Table Descriptor', keyword: 'RedPaletteColorLookupTableDescriptor', vr: 'US', group: 'Image' },
  'x00281102': { name: 'Green Palette Color Lookup Table Descriptor', keyword: 'GreenPaletteColorLookupTableDescriptor', vr: 'US', group: 'Image' },
  'x00281103': { name: 'Blue Palette Color Lookup Table Descriptor', keyword: 'BluePaletteColorLookupTableDescriptor', vr: 'US', group: 'Image' },
  'x00281201': { name: 'Red Palette Color Lookup Table Data', keyword: 'RedPaletteColorLookupTableData', vr: 'OW', group: 'Image' },
  'x00281202': { name: 'Green Palette Color Lookup Table Data', keyword: 'GreenPaletteColorLookupTableData', vr: 'OW', group: 'Image' },
  'x00281203': { name: 'Blue Palette Color Lookup Table Data', keyword: 'BluePaletteColorLookupTableData', vr: 'OW', group: 'Image' },
  'x00282110': { name: 'Lossy Image Compression', keyword: 'LossyImageCompression', vr: 'CS', group: 'Image' },
  'x00282112': { name: 'Lossy Image Compression Ratio', keyword: 'LossyImageCompressionRatio', vr: 'DS', group: 'Image' },
  'x00282114': { name: 'Lossy Image Compression Method', keyword: 'LossyImageCompressionMethod', vr: 'CS', group: 'Image' },

  // ─── Image Pixel (7FE0) ───────────────────────────────────────────
  'x7fe00010': { name: 'Pixel Data', keyword: 'PixelData', vr: 'OW', group: 'Image' },

  // ─── Multi-frame (0028) ───────────────────────────────────────────
  'x00280051': { name: 'Corrected Image', keyword: 'CorrectedImage', vr: 'CS', group: 'Image' },

  // ─── Overlay (60xx) ───────────────────────────────────────────────
  'x60000010': { name: 'Overlay Rows', keyword: 'OverlayRows', vr: 'US', group: 'Image' },
  'x60000011': { name: 'Overlay Columns', keyword: 'OverlayColumns', vr: 'US', group: 'Image' },
  'x60000040': { name: 'Overlay Type', keyword: 'OverlayType', vr: 'CS', group: 'Image' },
  'x60000050': { name: 'Overlay Origin', keyword: 'OverlayOrigin', vr: 'SS', group: 'Image' },
  'x60000100': { name: 'Overlay Bits Allocated', keyword: 'OverlayBitsAllocated', vr: 'US', group: 'Image' },
  'x60000102': { name: 'Overlay Bit Position', keyword: 'OverlayBitPosition', vr: 'US', group: 'Image' },
  'x60003000': { name: 'Overlay Data', keyword: 'OverlayData', vr: 'OW', group: 'Image' },

  // ─── NM/PET (0054) ────────────────────────────────────────────────
  'x00540010': { name: 'Energy Window Vector', keyword: 'EnergyWindowVector', vr: 'US', group: 'Acquisition' },
  'x00540011': { name: 'Number of Energy Windows', keyword: 'NumberOfEnergyWindows', vr: 'US', group: 'Acquisition' },
  'x00540020': { name: 'Detector Vector', keyword: 'DetectorVector', vr: 'US', group: 'Acquisition' },
  'x00540021': { name: 'Number of Detectors', keyword: 'NumberOfDetectors', vr: 'US', group: 'Acquisition' },
  'x00540050': { name: 'Rotation Vector', keyword: 'RotationVector', vr: 'US', group: 'Acquisition' },
  'x00540051': { name: 'Number of Rotations', keyword: 'NumberOfRotations', vr: 'US', group: 'Acquisition' },
  'x00540080': { name: 'Slice Vector', keyword: 'SliceVector', vr: 'US', group: 'Acquisition' },
  'x00540081': { name: 'Number of Slices', keyword: 'NumberOfSlices', vr: 'US', group: 'Acquisition' },
  'x00540202': { name: 'Type of Detector Motion', keyword: 'TypeOfDetectorMotion', vr: 'CS', group: 'Acquisition' },
  'x00540400': { name: 'Image ID', keyword: 'ImageID', vr: 'SH', group: 'Acquisition' },
  'x00541000': { name: 'Series Type', keyword: 'SeriesType', vr: 'CS', group: 'Series' },
  'x00541001': { name: 'Units', keyword: 'Units', vr: 'CS', group: 'Acquisition' },
  'x00541002': { name: 'Counts Source', keyword: 'CountsSource', vr: 'CS', group: 'Acquisition' },
  'x00541100': { name: 'Randoms Correction Method', keyword: 'RandomsCorrectionMethod', vr: 'CS', group: 'Acquisition' },
  'x00541101': { name: 'Attenuation Correction Method', keyword: 'AttenuationCorrectionMethod', vr: 'CS', group: 'Acquisition' },
  'x00541102': { name: 'Decay Correction', keyword: 'DecayCorrection', vr: 'CS', group: 'Acquisition' },
  'x00541103': { name: 'Reconstruction Method', keyword: 'ReconstructionMethod', vr: 'LO', group: 'Acquisition' },
  'x00541104': { name: 'Detector Lines of Response Used', keyword: 'DetectorLinesOfResponseUsed', vr: 'LO', group: 'Acquisition' },
  'x00541105': { name: 'Scatter Correction Method', keyword: 'ScatterCorrectionMethod', vr: 'LO', group: 'Acquisition' },
  'x00541300': { name: 'Frame Reference Time', keyword: 'FrameReferenceTime', vr: 'DS', group: 'Acquisition' },
  'x00541321': { name: 'Decay Factor', keyword: 'DecayFactor', vr: 'DS', group: 'Acquisition' },
  'x00541322': { name: 'Dose Calibration Factor', keyword: 'DoseCalibrationFactor', vr: 'DS', group: 'Acquisition' },

  // ─── RT Dose (3004) ───────────────────────────────────────────────
  'x30040002': { name: 'Dose Units', keyword: 'DoseUnits', vr: 'CS', group: 'Other' },
  'x30040004': { name: 'Dose Type', keyword: 'DoseType', vr: 'CS', group: 'Other' },
  'x30040006': { name: 'Dose Comment', keyword: 'DoseComment', vr: 'LO', group: 'Other' },
  'x3004000a': { name: 'Dose Summation Type', keyword: 'DoseSummationType', vr: 'CS', group: 'Other' },
  'x3004000c': { name: 'Grid Frame Offset Vector', keyword: 'GridFrameOffsetVector', vr: 'DS', group: 'Other' },
  'x3004000e': { name: 'Dose Grid Scaling', keyword: 'DoseGridScaling', vr: 'DS', group: 'Other' },

  // ─── RT Structure Set (3006) ──────────────────────────────────────
  'x30060002': { name: 'Structure Set Label', keyword: 'StructureSetLabel', vr: 'SH', group: 'Other' },
  'x30060004': { name: 'Structure Set Name', keyword: 'StructureSetName', vr: 'LO', group: 'Other' },
  'x30060008': { name: 'Structure Set Date', keyword: 'StructureSetDate', vr: 'DA', group: 'Other' },
  'x30060009': { name: 'Structure Set Time', keyword: 'StructureSetTime', vr: 'TM', group: 'Other' },

  // ─── Radiopharmaceutical (0018) ───────────────────────────────────
  'x00180031': { name: 'Radiopharmaceutical', keyword: 'Radiopharmaceutical', vr: 'LO', group: 'Acquisition' },
  'x00181070': { name: 'Radiopharmaceutical Route', keyword: 'RadiopharmaceuticalRoute', vr: 'LO', group: 'Acquisition' },
  'x00181071': { name: 'Radiopharmaceutical Volume', keyword: 'RadiopharmaceuticalVolume', vr: 'DS', group: 'Acquisition' },
  'x00181072': { name: 'Radiopharmaceutical Start Time', keyword: 'RadiopharmaceuticalStartTime', vr: 'TM', group: 'Acquisition' },
  'x00181073': { name: 'Radiopharmaceutical Stop Time', keyword: 'RadiopharmaceuticalStopTime', vr: 'TM', group: 'Acquisition' },
  'x00181074': { name: 'Radionuclide Total Dose', keyword: 'RadionuclideTotalDose', vr: 'DS', group: 'Acquisition' },
  'x00181075': { name: 'Radionuclide Half Life', keyword: 'RadionuclideHalfLife', vr: 'DS', group: 'Acquisition' },
  'x00181076': { name: 'Radionuclide Positron Fraction', keyword: 'RadionuclidePositronFraction', vr: 'DS', group: 'Acquisition' },
  'x00181077': { name: 'Radiopharmaceutical Specific Activity', keyword: 'RadiopharmaceuticalSpecificActivity', vr: 'DS', group: 'Acquisition' },
  'x00181078': { name: 'Radiopharmaceutical Start DateTime', keyword: 'RadiopharmaceuticalStartDateTime', vr: 'DT', group: 'Acquisition' },

  // ─── SOP Common (0008) — Additional ──────────────────────────────
  'x00080100': { name: 'Code Value', keyword: 'CodeValue', vr: 'SH', group: 'Other' },
  'x00080102': { name: 'Coding Scheme Designator', keyword: 'CodingSchemeDesignator', vr: 'SH', group: 'Other' },
  'x00080103': { name: 'Coding Scheme Version', keyword: 'CodingSchemeVersion', vr: 'SH', group: 'Other' },
  'x00080104': { name: 'Code Meaning', keyword: 'CodeMeaning', vr: 'LO', group: 'Other' },

  // ─── Additional Image Tags ────────────────────────────────────────
  'x00180040': { name: 'Cine Rate', keyword: 'CineRate', vr: 'IS', group: 'Acquisition' },
  'x00180070': { name: 'Counts Accumulated', keyword: 'CountsAccumulated', vr: 'IS', group: 'Acquisition' },
  'x00180071': { name: 'Acquisition Termination Condition', keyword: 'AcquisitionTerminationCondition', vr: 'CS', group: 'Acquisition' },
  'x00181004': { name: 'Plate ID', keyword: 'PlateID', vr: 'LO', group: 'Acquisition' },
  'x00181010': { name: 'Secondary Capture Device ID', keyword: 'SecondaryCaptureDeviceID', vr: 'LO', group: 'Equipment' },
  'x00181012': { name: 'Date of Secondary Capture', keyword: 'DateOfSecondaryCapture', vr: 'DA', group: 'Acquisition' },
  'x00181014': { name: 'Time of Secondary Capture', keyword: 'TimeOfSecondaryCapture', vr: 'TM', group: 'Acquisition' },
  'x00181400': { name: 'Acquisition Device Processing Description', keyword: 'AcquisitionDeviceProcessingDescription', vr: 'LO', group: 'Acquisition' },
  'x00181401': { name: 'Acquisition Device Processing Code', keyword: 'AcquisitionDeviceProcessingCode', vr: 'LO', group: 'Acquisition' },
  'x00181402': { name: 'Cassette Orientation', keyword: 'CassetteOrientation', vr: 'CS', group: 'Acquisition' },
  'x00181403': { name: 'Cassette Size', keyword: 'CassetteSize', vr: 'CS', group: 'Acquisition' },
  'x00181500': { name: 'Positioner Type', keyword: 'PositionerType', vr: 'CS', group: 'Acquisition' },
  'x00181510': { name: 'Positioner Primary Angle', keyword: 'PositionerPrimaryAngle', vr: 'DS', group: 'Acquisition' },
  'x00181511': { name: 'Positioner Secondary Angle', keyword: 'PositionerSecondaryAngle', vr: 'DS', group: 'Acquisition' },
  'x00181520': { name: 'Positioner Primary Angle Increment', keyword: 'PositionerPrimaryAngleIncrement', vr: 'DS', group: 'Acquisition' },
  'x00181521': { name: 'Positioner Secondary Angle Increment', keyword: 'PositionerSecondaryAngleIncrement', vr: 'DS', group: 'Acquisition' },
  'x00181600': { name: 'Shutter Shape', keyword: 'ShutterShape', vr: 'CS', group: 'Image' },
  'x00186000': { name: 'Sensitivity', keyword: 'Sensitivity', vr: 'DS', group: 'Acquisition' },
  'x00189004': { name: 'Content Qualification', keyword: 'ContentQualification', vr: 'CS', group: 'Image' },
  'x00189073': { name: 'Acquisition Duration', keyword: 'AcquisitionDuration', vr: 'FD', group: 'Acquisition' },
  'x00189074': { name: 'Frame Acquisition DateTime', keyword: 'FrameAcquisitionDateTime', vr: 'DT', group: 'Acquisition' },

  // ─── Spacing / Position (0018/0020/0028) ──────────────────────────
  'x00181164': { name: 'Imager Pixel Spacing', keyword: 'ImagerPixelSpacing', vr: 'DS', group: 'Image' },
  'x00280031': { name: 'Zoom Factor', keyword: 'ZoomFactor', vr: 'DS', group: 'Image' },
  'x00280032': { name: 'Zoom Center', keyword: 'ZoomCenter', vr: 'DS', group: 'Image' },

  // ─── Window/Level (0028) — Softcopy VOI LUT ──────────────────────
  'x00283010': { name: 'VOI LUT Sequence', keyword: 'VOILUTSequence', vr: 'SQ', group: 'Image' },

  // ─── Additional Study/Series Tags ─────────────────────────────────
  'x00081084': { name: 'Admitting Diagnoses Code Sequence', keyword: 'AdmittingDiagnosesCodeSequence', vr: 'SQ', group: 'Study' },
  'x00200200': { name: 'Synchronization Frame of Reference UID', keyword: 'SynchronizationFrameOfReferenceUID', vr: 'UI', group: 'Frame of Reference' },
  'x00081250': { name: 'Related Series Sequence', keyword: 'RelatedSeriesSequence', vr: 'SQ', group: 'Series' },

  // ─── Enhanced MR (0018) ───────────────────────────────────────────
  'x00189005': { name: 'Pulse Sequence Name', keyword: 'PulseSequenceName', vr: 'SH', group: 'Acquisition' },
  'x00189006': { name: 'MR Imaging Modifier Sequence', keyword: 'MRImagingModifierSequence', vr: 'SQ', group: 'Acquisition' },
  'x00189014': { name: 'Phase Contrast', keyword: 'PhaseContrast', vr: 'CS', group: 'Acquisition' },
  'x00189015': { name: 'Time of Flight Contrast', keyword: 'TimeOfFlightContrast', vr: 'CS', group: 'Acquisition' },
  'x00189020': { name: 'Magnetization Transfer', keyword: 'MagnetizationTransfer', vr: 'CS', group: 'Acquisition' },
  'x00189024': { name: 'Spectrally Selected Suppression', keyword: 'SpectrallySelectedSuppression', vr: 'CS', group: 'Acquisition' },
  'x00189025': { name: 'Oversampling Phase', keyword: 'OversamplingPhase', vr: 'CS', group: 'Acquisition' },
  'x00189029': { name: 'MR Spectroscopy Acquisition Type', keyword: 'MRSpectroscopyAcquisitionType', vr: 'CS', group: 'Acquisition' },
  'x00189058': { name: 'MR Acquisition Frequency Encoding Steps', keyword: 'MRAcquisitionFrequencyEncodingSteps', vr: 'US', group: 'Acquisition' },
  'x00189231': { name: 'MR Acquisition Phase Encoding Steps in-plane', keyword: 'MRAcquisitionPhaseEncodingStepsInPlane', vr: 'US', group: 'Acquisition' },

  // ─── CT-specific (0018) ───────────────────────────────────────────
  'x00189306': { name: 'Single Collimation Width', keyword: 'SingleCollimationWidth', vr: 'FD', group: 'Acquisition' },
  'x00189307': { name: 'Total Collimation Width', keyword: 'TotalCollimationWidth', vr: 'FD', group: 'Acquisition' },
  'x00189309': { name: 'Table Speed', keyword: 'TableSpeed', vr: 'FD', group: 'Acquisition' },
  'x00189310': { name: 'Table Feed per Rotation', keyword: 'TableFeedPerRotation', vr: 'FD', group: 'Acquisition' },
  'x00189311': { name: 'Spiral Pitch Factor', keyword: 'SpiralPitchFactor', vr: 'FD', group: 'Acquisition' },
  'x00189323': { name: 'Exposure Modulation Type', keyword: 'ExposureModulationType', vr: 'CS', group: 'Acquisition' },
  'x00189324': { name: 'Estimated Dose Saving', keyword: 'EstimatedDoseSaving', vr: 'FD', group: 'Acquisition' },
  'x00189345': { name: 'CTDIvol', keyword: 'CTDIvol', vr: 'FD', group: 'Acquisition' },

  // ─── Number of Images Related Tags ────────────────────────────────
  'x00201002': { name: 'Images in Acquisition', keyword: 'ImagesInAcquisition', vr: 'IS', group: 'Image' },
  'x00201200': { name: 'Number of Patient Related Studies', keyword: 'NumberOfPatientRelatedStudies', vr: 'IS', group: 'Patient' },
  'x00201202': { name: 'Number of Patient Related Series', keyword: 'NumberOfPatientRelatedSeries', vr: 'IS', group: 'Patient' },
  'x00201204': { name: 'Number of Patient Related Instances', keyword: 'NumberOfPatientRelatedInstances', vr: 'IS', group: 'Patient' },
  'x00201206': { name: 'Number of Study Related Series', keyword: 'NumberOfStudyRelatedSeries', vr: 'IS', group: 'Study' },
  'x00201208': { name: 'Number of Study Related Instances', keyword: 'NumberOfStudyRelatedInstances', vr: 'IS', group: 'Study' },
  'x00201209': { name: 'Number of Series Related Instances', keyword: 'NumberOfSeriesRelatedInstances', vr: 'IS', group: 'Series' },

  // ─── Scheduled / Requested Procedure (0040) ──────────────────────
  'x00400001': { name: 'Scheduled Station AE Title', keyword: 'ScheduledStationAETitle', vr: 'AE', group: 'Other' },
  'x00400002': { name: 'Scheduled Procedure Step Start Date', keyword: 'ScheduledProcedureStepStartDate', vr: 'DA', group: 'Other' },
  'x00400003': { name: 'Scheduled Procedure Step Start Time', keyword: 'ScheduledProcedureStepStartTime', vr: 'TM', group: 'Other' },
  'x00400006': { name: 'Scheduled Performing Physician Name', keyword: 'ScheduledPerformingPhysicianName', vr: 'PN', group: 'Other' },
  'x00400007': { name: 'Scheduled Procedure Step Description', keyword: 'ScheduledProcedureStepDescription', vr: 'LO', group: 'Other' },
  'x00400009': { name: 'Scheduled Procedure Step ID', keyword: 'ScheduledProcedureStepID', vr: 'SH', group: 'Other' },
  'x00400010': { name: 'Scheduled Station Name', keyword: 'ScheduledStationName', vr: 'SH', group: 'Other' },
  'x00400100': { name: 'Scheduled Procedure Step Sequence', keyword: 'ScheduledProcedureStepSequence', vr: 'SQ', group: 'Other' },
  'x00401001': { name: 'Requested Procedure ID', keyword: 'RequestedProcedureID', vr: 'SH', group: 'Study' },

  // ─── Icon Image (0088) ────────────────────────────────────────────
  'x00880200': { name: 'Icon Image Sequence', keyword: 'IconImageSequence', vr: 'SQ', group: 'Other' },

  // ─── Waveform/Presentation State ──────────────────────────────────
  'x00700001': { name: 'Graphic Annotation Sequence', keyword: 'GraphicAnnotationSequence', vr: 'SQ', group: 'Other' },
  'x00700080': { name: 'Content Label', keyword: 'ContentLabel', vr: 'CS', group: 'Other' },
  'x00700081': { name: 'Content Description', keyword: 'ContentDescription', vr: 'LO', group: 'Other' },
  'x00700082': { name: 'Presentation Creation Date', keyword: 'PresentationCreationDate', vr: 'DA', group: 'Other' },
  'x00700083': { name: 'Presentation Creation Time', keyword: 'PresentationCreationTime', vr: 'TM', group: 'Other' },
  'x00700084': { name: "Content Creator's Name", keyword: 'ContentCreatorName', vr: 'PN', group: 'Other' },
};

/**
 * Format a raw tag key (xGGGGEEEE) as a standard DICOM tag string (GGGG,EEEE).
 */
export function formatTagKey(tag: string): string {
  // tag format: xGGGGEEEE → (GGGG,EEEE)
  const hex = tag.replace('x', '').toUpperCase();
  if (hex.length !== 8) return tag;
  return `(${hex.substring(0, 4)},${hex.substring(4, 8)})`;
}

/**
 * Check if a DICOM group number is a private group (odd).
 */
export function isPrivateTag(tag: string): boolean {
  const hex = tag.replace('x', '');
  if (hex.length < 4) return false;
  const groupNum = parseInt(hex.substring(0, 4), 16);
  return groupNum % 2 !== 0;
}
