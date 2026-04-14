# XNAT + DICOM Project Notes

## Storage Model
- SEG and RTSTRUCT are uploaded to XNAT as derived scans, not just loose files.
- SEG scan IDs use the `30xx` convention; RTSTRUCT scan IDs use the `40xx` convention.
- RTSTRUCT uploads currently create `xnat:rtImageScanData` scans with `type=RTSTRUCT`.
- RTSTRUCT DICOM files are uploaded under the `secondary` resource with `content=secondary` and `label=secondary`.
- After SEG or RTSTRUCT upload/overwrite, the app triggers scan-level `pullDataFromHeaders=true` so XNAT re-extracts scan metadata from the uploaded DICOM.

## DICOM Identity Rules
- Preserve the source study identity when exporting derived objects.
- `StudyInstanceUID` on SEG and RTSTRUCT should match the referenced source study; it is not regenerated.
- `SeriesInstanceUID` and `SOPInstanceUID` are new for the derived object.
- Prefer source DICOM metadata over renderer/UI state when populating patient, study, and reference fields.
- Export code may need to fall back to raw cached DICOM tags when Cornerstone module metadata is incomplete.

## User Attribution
- Use `OperatorsName (0008,1070)` for SEG and RTSTRUCT user attribution.
- Format the current user as `Last Name, First Name`.
- If `OperatorsName` already has a different value, append the current user instead of overwriting.

## RTSTRUCT Interoperability Rules
- RTSTRUCT export must include a complete nested reference tree:
  `ReferencedFrameOfReferenceSequence -> RTReferencedStudySequence -> RTReferencedSeriesSequence -> ContourImageSequence`
- `ContourImageSequence` must not be emitted as an empty placeholder.
- ROI numbering must stay aligned across:
  `StructureSetROISequence`, `ROIContourSequence`, and `RTROIObservationsSequence`.
- If required source study/series/frame/image references are missing, export should fail rather than writing an incomplete RTSTRUCT.

## XNAT / DICOM Relationship
- XNAT scan metadata for derived SEG/RTSTRUCT objects depends on the uploaded DICOM headers plus a post-upload header refresh.
- If XNAT or Weasis behavior looks wrong, inspect the actual generated DICOM bytes first, not only the UI DICOM tags panel.
- The DICOM tags viewer can show raw source tags even when Cornerstone module metadata is incomplete, so exporter bugs can come from metadata translation rather than missing source tags.

## Key Files
- Shared DICOM export helpers:
  [src/renderer/lib/cornerstone/dicomExportHelpers.ts](/Users/dan/Documents/CodexProjects/XNAT%20Workstation/src/renderer/lib/cornerstone/dicomExportHelpers.ts)
- SEG export path:
  [src/renderer/lib/cornerstone/segmentationService.ts](/Users/dan/Documents/CodexProjects/XNAT%20Workstation/src/renderer/lib/cornerstone/segmentationService.ts)
- RTSTRUCT export path:
  [src/renderer/lib/cornerstone/rtStructService.ts](/Users/dan/Documents/CodexProjects/XNAT%20Workstation/src/renderer/lib/cornerstone/rtStructService.ts)
- XNAT upload path:
  [src/main/xnat/xnatClient.ts](/Users/dan/Documents/CodexProjects/XNAT%20Workstation/src/main/xnat/xnatClient.ts)
- Export policy:
  [docs/dicom-export-field-policy.md](/Users/dan/Documents/CodexProjects/XNAT%20Workstation/docs/dicom-export-field-policy.md)
- RTSTRUCT compliance review:
  [docs/rtstruct-compliance-review.md](/Users/dan/Documents/CodexProjects/XNAT%20Workstation/docs/rtstruct-compliance-review.md)

## Validation Expectations
- For DICOM export changes, run `npm run test:dicom:compliance`.
- Byte-level/generated-file validation matters more than mocked unit behavior alone.
- External validator coverage lives in:
  [src/renderer/lib/cornerstone/__tests__/dicomExternalCompliance.test.ts](/Users/dan/Documents/CodexProjects/XNAT%20Workstation/src/renderer/lib/cornerstone/__tests__/dicomExternalCompliance.test.ts)
- If debugging interoperability issues, compare the actual generated DICOM file against a known-good artifact and inspect the parsed bytes directly.
