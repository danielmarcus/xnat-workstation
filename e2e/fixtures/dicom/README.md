# Local DICOM Fixtures

Real (but de-identified) DICOM datasets for E2E tests that don't require a live XNAT server. Per design doc §8.4.

## Status

All seven fixture slots are populated and tracked via Git LFS. After cloning, run `git lfs install && git lfs pull` once to download the data. Specs that depend on these fixtures check whether the fixture directory is present and skip with a clear message when it isn't, so environments without LFS data still report tests as skipped rather than failed.

## Expected layout

Each subdirectory holds one logical dataset:

| Directory | Contents | Used by | Acceptance signal |
|---|---|---|---|
| `ct-axial-300/` | Small axial CT, ~30 slices, real DICOM | volume-mode rendering, MPR preset | (Phase 1 baseline) |
| `mr-t1-t2-sameexam/` | Paired T1 + T2 MR series from one exam, shared `FrameOfReferenceUID` | A2b cross-series (T1/T2 case) | requirements §G #9 |
| `sameforuid-different-acquisition/` | Two series sharing FoR with different `AcquisitionNumber`. Covers both the design's `breath-hold-pair` and `4dct-phases` slots. | A2c FoR + acquisition heuristic, off-by-default | requirements §G #10 |
| `cross-for-ct-mr/` | CT + unregistered MR, different FoR | A2d different-FoR case | requirements §G #11 |
| `rtstruct-typed/` | RTSTRUCT covering all `RTROIInterpretedType` values | RTROIInterpretedType round-trip | requirements §G #18 |
| `seg-multilabel/` | Multi-segment SEG (≥ 5 segments) | SEG load + multi-segment ops | (multiple) |
| `cine-us/` | Multi-frame US for stack-eligibility predicate | stack-mode fallback | (Phase 1 stack predicate) |

### Why one fixture covers both `breath-hold-pair` and `4dct-phases`

The A2c heuristic in `segmentationService/visibility.ts` does not measure anatomy displacement — it reads metadata: same `FrameOfReferenceUID` + different `AcquisitionNumber` ⇒ A2c (off by default). Any pair with that metadata shape exercises the same code path. The two clinical scenarios the design enumerates (breath-hold pair, 4D-CT phase bins) collapse to one metadata-shape fixture, so we name the directory after the metadata shape and document which clinical scenarios it covers.

## How to populate

Source options, in order of preference:

1. **Synthetic, where adequate**. The A2c heuristic is a metadata-shape check — anatomy doesn't matter. A scripted generator (see `sameforuid-different-acquisition/` below) is reproducible, free of PHI, deterministic, and faster than fishing through public archives.
2. **De-identified DICOM from your own data** (XNAT export, etc.) — best when visual fidelity matters (T1/T2 differentiation, RTSTRUCT shapes).
3. **Public test sets**:
   - The Cancer Imaging Archive (TCIA) — public-domain, citable, already de-identified.
   - `dicomweb-server` test data (`@radicalimaging/dicomweb-server`).
   - DCMTK example datasets.

Place files directly in the subdirectory (no nested folders). One DICOM per file. Target ≤ 5 MB per fixture so the LFS quota doesn't bloat — these are smoke-test datasets, not regression-grade.

### Storage: Git LFS

Fixture DICOMs are tracked via Git LFS (see [`.gitattributes`](../../../.gitattributes) at repo root). Devs need `git lfs install` once per machine before cloning will populate the data. To override the fixture root entirely (e.g., point at a shared volume rather than the repo), set `XNAT_E2E_FIXTURE_ROOT`.

## De-identification

TCIA data is already de-identified (PHI removed at submission); no further work needed beyond citing the source. For data from any other source, strip patient name, ID, birth date, and any other identifiers before placing files here. Tools: `dcmodify`, `dicom-anonymizer`, or a hand-crafted dcmjs script.

## Provenance

Each populated fixture below documents its source so the data is reproducible. When a fixture is integrated, add a sub-section here with the TCIA collection, subject, and any other detail needed to re-acquire it.

### `mr-t1-t2-sameexam/`

- **Source**: TCIA [ACRIN-NSCLC-FDG-PET](https://www.cancerimagingarchive.net/collection/acrin-nsclc-fdg-pet/) collection.
- **Subject**: `ACRIN-NSCLC-FDG-PET-099`, exam `12-27-1959-NA-HEADBRAIN-75971` (date shifted by TCIA's standard de-identification offset; 1959 is not the real date of service).
- **Series**: 8 consecutive middle slices (instance numbers 11–18) from each of:
  - `8.000000-AX T1-71203` → `t1-slice11.dcm` … `t1-slice18.dcm` (320×288)
  - `3.000000-AXIAL T2-42350` → `t2-slice11.dcm` … `t2-slice18.dcm` (640×552)
- **De-identification**: TCIA's standard scrub. `PatientID` = `ACRIN-NSCLC-FDG-PET-099`; `PatientBirthDate` empty; `AccessionNumber` empty; no `InstitutionName` leak.
- **Verified metadata shape** (run `npx playwright test e2e/specs/11-fixture-cross-series.e2e.ts` to re-verify):
  - Both series share `FrameOfReferenceUID = 1.3.6.1.4.1.14519.5.2.1.7009.2403.148825602828489783665973633187`.
  - Distinct `SeriesInstanceUID` (T1 ends in `…363359237027027485077590071203`; T2 ends in `…329086580059504263013465742350`).
  - Distinct `SeriesDescription` ("AX T1" / "AXIAL T2"); both `Modality = MR`.
- **Storage**: tracked via Git LFS.
- **Re-acquiring**: download the full collection via the NBIA Data Retriever using the TCIA collection page above; re-subset by copying the same instance numbers.

### `sameforuid-different-acquisition/`

- **Source**: synthetic. Generated by [`scripts/generate-synthetic-fixture-sameforuid.mjs`](../../../scripts/generate-synthetic-fixture-sameforuid.mjs). Real TCIA 4D-CT data (candidates: 4D-Lung, NSCLC-Cetuximab) is acceptable as a future replacement, but the heuristic this fixture exercises is a metadata-shape check, not an anatomy check, so synthetic data covers the same code paths.
- **Construction**: 32 CT slices total — two series of 16 slices each, 128×128 px, 16-bit signed, sphere-phantom geometry. Series 2's sphere is offset 5 mm along +x from series 1's to model the displacement A2c expects between phases / breath-hold pairs. UIDs are deterministic (re-running the generator overwrites byte-identical files).
- **Verified metadata shape** (run `npx playwright test e2e/specs/11-fixture-cross-series.e2e.ts` to re-verify):
  - Both series share `FrameOfReferenceUID = 1.2.826.0.1.3680043.10.1338.999.1.2`.
  - Series 1 `SeriesInstanceUID = 1.2.826.0.1.3680043.10.1338.999.1.10`, `AcquisitionNumber = 1`.
  - Series 2 `SeriesInstanceUID = 1.2.826.0.1.3680043.10.1338.999.1.20`, `AcquisitionNumber = 5`.
  - Distinct `SeriesDescription` ("Synthetic CT Phase 00" / "Synthetic CT Phase 50").
- **PHI**: none. `PatientName = Synthetic^Phantom`, `PatientID = XNAT-WS-SYNTH-001`. Manufacturer is set to `XNAT-WS-SYNTH` so this is unmistakably synthetic if it ever leaks into a workstation expecting clinical data.
- **Storage**: tracked via Git LFS (see [`.gitattributes`](../../../.gitattributes)).

### `ct-axial-300/`

- **Source**: synthetic. Generated by [`scripts/generate-synthetic-fixture-ct-axial.mjs`](../../../scripts/generate-synthetic-fixture-ct-axial.mjs).
- **Construction**: one axial CT series, 30 slices, 128×128 px, 16-bit signed. Sphere-phantom geometry centered in-volume.
- **Verified metadata shape**: single `SeriesInstanceUID = 1.2.826.0.1.3680043.10.1338.998.2`; shared `FrameOfReferenceUID = …998.3`; `Modality = CT`; ≥30 slices.
- **PHI**: none.
- **Storage**: Git LFS.

### `cine-us/`

- **Source**: synthetic. Generated by [`scripts/generate-synthetic-fixture-cine-us.mjs`](../../../scripts/generate-synthetic-fixture-cine-us.mjs).
- **Construction**: one multi-frame Ultrasound instance, 16 frames, 128×128 px, 8-bit unsigned. Bouncing-bar pattern across frames so cine playback shows motion.
- **Verified metadata shape**: `SOPClassUID = 1.2.840.10008.5.1.4.1.1.6.1` (Ultrasound Image Storage); `Modality = US`; `NumberOfFrames = 16`; `FrameTime = 33.333` (~30 fps).
- **PHI**: none.
- **Storage**: Git LFS.

### `cross-for-ct-mr/`

- **Source**: synthetic. Generated by [`scripts/generate-synthetic-fixture-cross-for.mjs`](../../../scripts/generate-synthetic-fixture-cross-for.mjs).
- **Construction**: two series, 12 slices each, 128×128 px. Series 1 is CT (signed pixels, HU rescale, FoR `…996.10`). Series 2 is MR (unsigned pixels, FoR `…996.20`). Distinct FoRs is the property A2d keys on.
- **Verified metadata shape**: two series with distinct `Modality` (CT, MR) and distinct `FrameOfReferenceUID`.
- **PHI**: none.
- **Storage**: Git LFS.

### `seg-multilabel/`

- **Source**: synthetic. Generated by [`scripts/generate-synthetic-fixture-seg-multilabel.mjs`](../../../scripts/generate-synthetic-fixture-seg-multilabel.mjs).
- **Construction**: one DICOM SEG instance with 5 segments, BINARY encoding, 1 frame per segment, 128×128 px. References the `ct-axial-300` fixture's StudyInstanceUID and SeriesInstanceUID so cross-references are coherent.
- **Segments**: `GTV`, `CTV`, `PTV`, `OAR_BRAIN`, `OAR_BRAINSTEM`. Each has `RecommendedDisplayCIELabValue`, `SegmentedPropertyCategoryCodeSequence` (Anatomical Structure / SRT), and `SegmentedPropertyTypeCodeSequence` (Tissue / SCT).
- **Verified metadata shape**: `SOPClassUID = 1.2.840.10008.5.1.4.1.1.66.4`; `Modality = SEG`; `SegmentationType = BINARY`; ≥5 entries in `SegmentSequence`.
- **PHI**: none.
- **Storage**: Git LFS.

### `rtstruct-typed/`

- **Source**: synthetic. Generated by [`scripts/generate-synthetic-fixture-rtstruct-typed.mjs`](../../../scripts/generate-synthetic-fixture-rtstruct-typed.mjs).
- **Construction**: one DICOM RTSTRUCT instance with 6 ROIs covering the canonical `RTROIInterpretedType` values: `GTV`, `CTV`, `PTV`, `ORGAN`, `EXTERNAL`, `AVOIDANCE`. Each ROI has a closed-planar 6-vertex hexagonal contour on the middle slice of the referenced `ct-axial-300` series.
- **Verified metadata shape**: `SOPClassUID = 1.2.840.10008.5.1.4.1.1.481.3`; `Modality = RTSTRUCT`; `ApprovalStatus = UNAPPROVED`; 6 entries in both `StructureSetROISequence` and `RTROIObservationsSequence`; the `RTROIInterpretedType` set covers all six canonical values.
- **PHI**: none.
- **Storage**: Git LFS.

## How specs find fixtures

Specs use the `loadLocalDicomFixture` helper in `e2e/helpers/local-dicom-fixtures.ts`. The helper discovers files in a fixture subdirectory and returns their absolute paths. To override the fixture root (e.g., to point at a shared volume outside the repo), set the `XNAT_E2E_FIXTURE_ROOT` env var.

If a fixture directory is missing or empty, the helper returns `null` and the spec's `test.skip()` branch fires.
