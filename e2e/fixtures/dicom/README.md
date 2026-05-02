# Local DICOM Fixtures

Real (but de-identified) DICOM datasets for E2E tests that don't require a live XNAT server. Per design doc §8.4.

## Status

This directory is **empty by default**. Specs that depend on these fixtures (currently planned for the multi-viewport rewrite acceptance) check whether the fixtures are present and skip with a clear message when they aren't. CI runs without fixtures should report tests as skipped, not failed.

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

Source: de-identified DICOM from your own data, or public test sets such as:

- The Cancer Imaging Archive (TCIA) — public-domain, citable, already de-identified.
- `dicomweb-server` test data (`@radicalimaging/dicomweb-server`).
- DCMTK example datasets.

Place files directly in the subdirectory (no nested folders). One DICOM per file. Target ≤ 5 MB per fixture so the repo (or LFS quota) doesn't bloat — these are smoke-test datasets, not regression-grade.

## De-identification

TCIA data is already de-identified (PHI removed at submission); no further work needed beyond citing the source. For data from any other source, strip patient name, ID, birth date, and any other identifiers before placing files here. Tools: `dcmodify`, `dicom-anonymizer`, or a hand-crafted dcmjs script.

## Provenance

Each populated fixture below documents its source so the data is reproducible. When a fixture is integrated, add a sub-section here with the TCIA collection, subject, and any other detail needed to re-acquire it.

### `mr-t1-t2-sameexam/`

- **Source**: TBD — a TCIA collection with paired T1 and T2 MR sequences in a single exam (candidates: Brain-Tumor-Progression, IvyGAP, RIDER NEURO MRI). Pick the smallest subject whose exam contains both sequences sharing `FrameOfReferenceUID`.
- **Subject ID**: TBD (record after selection).
- **Series**: one T1, one T2; ≤ ~30 slices each.
- **Verified metadata shape**:
  - Both series have the same `(0020,0052) FrameOfReferenceUID`.
  - Both series have distinct `(0020,000E) SeriesInstanceUID`.
  - Both series have distinct `(0008,103E) SeriesDescription` (e.g., contains "T1" / "T2").

### `sameforuid-different-acquisition/`

- **Source**: TBD — a TCIA 4D-CT collection (candidates: 4D-Lung, NSCLC-Cetuximab, public 4D-CT phase studies). Use two phase bins from one subject as the two series.
- **Subject ID**: TBD (record after selection).
- **Series**: two CT phase bins, ~30 slices each.
- **Verified metadata shape**:
  - Both series have the same `(0020,0052) FrameOfReferenceUID`.
  - The two series have different `(0020,0012) AcquisitionNumber`.
  - Both series have distinct `(0020,000E) SeriesInstanceUID`.

## How specs find fixtures

Specs use the `loadLocalDicomFixture` helper in `e2e/helpers/local-dicom-fixtures.ts`. The helper discovers files in a fixture subdirectory and returns their absolute paths. To override the fixture root (e.g., to point at a shared volume outside the repo), set the `XNAT_E2E_FIXTURE_ROOT` env var.

If a fixture directory is missing or empty, the helper returns `null` and the spec's `test.skip()` branch fires.
