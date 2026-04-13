# DICOM Export Field Policy

This document defines the field-population policy for workstation-generated DICOM SEG and RTSTRUCT objects.

## Goals

- Produce Part 10 compliant DICOM files.
- Preserve patient and study identity from the referenced source images.
- Generate new series and SOP instance identity for derived objects.
- Stamp workstation equipment metadata rather than generic library placeholders.
- Prefer explicit failure over silently writing structurally incomplete derived objects.

## Shared Fields

### Required Part 10 file meta

- `FileMetaInformationVersion (0002,0001)`
- `MediaStorageSOPClassUID (0002,0002)`
- `MediaStorageSOPInstanceUID (0002,0003)`
- `TransferSyntaxUID (0002,0010)`
- `ImplementationClassUID (0002,0012)`
- `ImplementationVersionName (0002,0013)`

### Source identity copied from referenced DICOM when available

- `PatientName (0010,0010)`
- `PatientID (0010,0020)`
- `PatientBirthDate (0010,0030)`
- `PatientSex (0010,0040)`
- `PatientAge (0010,1010)`
- `PatientSize (0010,1020)`
- `PatientWeight (0010,1030)`
- `StudyInstanceUID (0020,000D)`
- `StudyDate (0008,0020)`
- `StudyTime (0008,0030)`
- `StudyID (0020,0010)`
- `AccessionNumber (0008,0050)`
- `StudyDescription (0008,1030)`
- `ReferringPhysicianName (0008,0090)`
- `FrameOfReferenceUID (0020,0052)` when the source images provide it

### Workstation identity applied to every derived object

- `SpecificCharacterSet (0008,0005) = ISO_IR 192`
- `Manufacturer (0008,0070) = XNAT Workstation`
- `ManufacturerModelName (0008,1090) = XNAT Workstation`
- `DeviceSerialNumber (0018,1000) = XNATWS`
- `SoftwareVersions (0018,1020) = app version`
- `StationName (0008,1010) = XNATWS`

### User attribution

- `OperatorsName (0008,1070)` is populated as `Last Name, First Name`
- Existing different values are preserved and the current user is appended as an additional PN value
- `OperatorIdentificationSequence (0008,1072)` is reserved for future structured identity work once stable IDs are available

## SEG Policy

### Required dataset expectations

- `Modality = SEG`
- `SOPClassUID = Segmentation Storage`
- `StudyInstanceUID` must match the referenced source study
- `SeriesInstanceUID` and `SOPInstanceUID` are generated for the derived object
- `Rows`, `Columns`, `NumberOfFrames`, and `PixelData` must be valid after serialization
- `SegmentSequence`, `PerFrameFunctionalGroupsSequence`, and `SharedFunctionalGroupsSequence` must be present

### Interoperability enhancements

- `SeriesDescription` preserves the visible segmentation label
- Each segment includes both `SegmentLabel` and `SegmentDescription`
- `RecommendedDisplayCIELabValue` is generated from the current segment color

## RTSTRUCT Policy

### Required dataset expectations

- `Modality = RTSTRUCT`
- `SOPClassUID = RT Structure Set Storage`
- `StudyInstanceUID` must match the referenced source study
- `StructureSetLabel`, `StructureSetName`, `StructureSetDescription`, `StructureSetDate`, and `StructureSetTime` are populated for every export
- `StructureSetROISequence`, `ROIContourSequence`, and `RTROIObservationsSequence` must stay aligned by ROI number

### Reference-tree rules

- `ReferencedFrameOfReferenceSequence` must be built from actual contour-image references
- Every nested `RTReferencedStudySequence` must contain at least one `RTReferencedSeriesSequence`
- Every nested `RTReferencedSeriesSequence` must contain a non-empty `ContourImageSequence`
- Multi-frame contour references must emit `ReferencedFrameNumber` when the source contour is tied to a specific frame

### Friendly export defaults

- `SeriesDescription` follows the visible structure-set label
- `FrameOfReferenceUID` is preserved from the source images when possible

## Validation Rules

- Missing required dataset fields cause export failure.
- Missing required Part 10 file meta causes export failure.
- Mismatch between file meta and dataset SOP class or SOP instance causes export failure.
- RTSTRUCT exports fail if ROI numbering is inconsistent or the nested reference tree is incomplete.
- Optional viewer-specific or cosmetic fields may be absent without blocking export.
