# RTSTRUCT Compliance Review

This note reviews the RT Structure Set export path in
`src/renderer/lib/cornerstone/rtStructService.ts` against the DICOM RT Structure
Set IOD and calls out the changes required to make the generated files compliant.

## Summary

The current export path relies on the Cornerstone RTSS adapter to generate the
base dataset, then patches only a subset of patient/study metadata before
serialization. That leaves three compliance gaps:

1. The RT Structure Set reference chain is incomplete. We currently create
   `RTReferencedSeriesSequence` entries with an empty `ContourImageSequence`,
   which violates the RT Structure Set module when that sequence is present.
2. The RTSTRUCT Part 10 file meta header is not completed before writing, so
   required file meta elements such as Media Storage SOP Class UID and Media
   Storage SOP Instance UID are not guaranteed to be present in the output file.
3. Multi-frame source instances are not represented correctly because the export
   metadata shim hardcodes `frameNumber = 1` and `numberOfFrames = 1` for every
   referenced image.

## Findings

### 1. Incomplete `ReferencedFrameOfReferenceSequence` tree

Current code:

- `applySourceDicomContextToRtStructDataset()` only patches the first tracked
  source image and only updates `dataset.ReferencedFrameOfReferenceSequence[0]`.
- When it has to create the nested study/series reference chain itself, it
  writes:
  - `RTReferencedStudySequence`
  - `RTReferencedSeriesSequence`
  - `ContourImageSequence: []`

Relevant code:

- `src/renderer/lib/cornerstone/rtStructService.ts:633-674`

Why this is non-compliant:

- In the RT Structure Set module, `Referenced Frame of Reference Sequence` is
  Type 3, but once `RT Referenced Study Sequence` is present, its nested
  `RT Referenced Series Sequence` is Type 1, and that nested
  `Contour Image Sequence` is also Type 1 with one or more items.
- An empty `ContourImageSequence` therefore produces an invalid structure set.

Required change:

1. Build `ReferencedFrameOfReferenceSequence` from the actual referenced contour
   images, not from only the first tracked source image.
2. Group references by:
   - `FrameOfReferenceUID`
   - `StudyInstanceUID`
   - `SeriesInstanceUID`
3. For each referenced series item, populate `ContourImageSequence` with one or
   more SOP Instance references corresponding to the images used by the
   contours.
4. Preserve support for multiple frames of reference, multiple studies, and
   multiple series rather than only mutating `[0]`.

Implementation note:

- The adapter already emits contour-level `ContourImageSequence` items in
  `ROIContourSequence` for each contour, but our post-processing should also
  build the required structure-set-level reference tree rather than inserting an
  empty placeholder sequence.

### 2. Incomplete Part 10 file meta header

Current code:

- RTSTRUCT export passes through the adapter `_meta` as-is and writes it
  directly.
- Unlike SEG export, RTSTRUCT export does not synthesize required file meta
  fields before calling `writeDicomDict()`.

Relevant code:

- RTSTRUCT path: `src/renderer/lib/cornerstone/rtStructService.ts:825-847`
- Shared writer: `src/renderer/lib/cornerstone/writeDicomDict.ts:15-61`
- SEG path that already does this correctly:
  `src/renderer/lib/cornerstone/segmentationService.ts:5140-5156`

Why this is non-compliant:

- Every DICOM Part 10 file must contain File Meta Information.
- Media Storage SOP Class UID `(0002,0002)`, Media Storage SOP Instance UID
  `(0002,0003)`, and Transfer Syntax UID `(0002,0010)` are required Type 1 file
  meta elements.
- The adapter `_meta` only provides transfer syntax and implementation metadata;
  it does not populate the Media Storage SOP fields needed for a compliant file.

Required change:

1. Mirror the SEG export behavior for RTSTRUCT export and synthesize a complete
   `_meta` object before serialization.
2. Populate at least:
   - `MediaStorageSOPClassUID = dataset.SOPClassUID`
   - `MediaStorageSOPInstanceUID = dataset.SOPInstanceUID`
   - `TransferSyntaxUID`
   - `ImplementationClassUID`
   - `ImplementationVersionName`
   - `FileMetaInformationVersion`
3. Keep the file meta consistent with the dataset SOP Class/SOP Instance that
   is written into the body.

### 3. Incorrect handling of multi-frame source references

Current code:

- The RTSTRUCT export metadata bridge returns this for every image:
  - `frameNumber: 1`
  - `numberOfFrames: 1`

Relevant code:

- `src/renderer/lib/cornerstone/rtStructService.ts:781-803`

Why this is non-compliant:

- The adapter uses this shim to populate `ContourImageSequence` references.
- For multi-frame source objects, the Image SOP Instance Reference Macro
  requires `ReferencedFrameNumber` when a specific frame is being referenced.
- Hardcoding all source instances as single-frame drops the frame-specific
  reference information and can make the contour-to-image linkage ambiguous or
  wrong for enhanced multi-frame CT/MR/PT inputs.

Required change:

1. Resolve the real source frame number from the source image ID or registered
   multi-frame metadata.
2. Return the true `numberOfFrames` from the source instance metadata.
3. Allow `ReferencedFrameNumber` to be emitted when the source SOP Instance is
   multi-frame.
4. Add an export test that covers a multi-frame source image and verifies that
   the resulting contour references include the expected frame number.

## Lower-priority interoperability improvements

These are not the primary compliance blockers, but they would improve the
quality of generated RTSTRUCT objects:

- Replace the generic adapter `Manufacturer = "cs3d"` with workstation-specific
  equipment metadata if available.
- Populate `Source Series Information Sequence (3006,004C)` when contours are
  derived from a source series that differs from the primary referenced series.
- Add export validation that parses the generated RTSTRUCT and asserts:
  - required file meta fields exist
  - `ReferencedFrameOfReferenceSequence` contains nested study/series/image
    references
  - no `ContourImageSequence` is empty when the structure-set-level reference
    tree is present

## Standards References

- DICOM PS3.3 2026b, RT Structure Set IOD Module Table:
  https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_a.19.3.html
- DICOM PS3.3 2026b, RT Series Module:
  https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_c.8.8.html
- DICOM PS3.3 2026b, Structure Set Module:
  https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_c.8.8.5.html
- DICOM PS3.3 2026b, ROI Contour Module:
  https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_c.8.8.6.html
- DICOM PS3.3 2026b, RT ROI Observations Module:
  https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_c.8.8.8.html
- DICOM PS3.10, DICOM File Meta Information:
  https://dicom.nema.org/dicom/2013/output/html/part10.html
