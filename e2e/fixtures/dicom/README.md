# Local DICOM Fixtures

Real (but anonymized) DICOM datasets for E2E tests that don't require a live XNAT server. Per design doc §8.4.

## Status

This directory is **empty by default**. Specs that depend on these fixtures (currently planned for the multi-viewport rewrite acceptance) check whether the fixtures are present and skip with a clear message when they aren't. CI runs without fixtures should report tests as skipped, not failed.

## Expected layout

Each subdirectory holds one logical dataset:

| Directory | Contents | Used by |
|---|---|---|
| `ct-axial-300/` | Small axial CT, ~30 slices, real DICOM | volume-mode rendering, MPR preset |
| `mr-t1-t2-sameexam/` | Paired T1 + T2 MR, shared FoR | A2b cross-series (T1/T2 case) |
| `4dct-phases/` | 4D-CT with ≥ 3 phase bins, same FoR | A2c phase-bin case |
| `breath-hold-pair/` | Two CT series, shared FoR, different `AcquisitionNumber` | A2c breath-hold case |
| `cross-for-ct-mr/` | CT + unregistered MR, different FoR | A2d different-FoR case |
| `rtstruct-typed/` | RTSTRUCT covering all `RTROIInterpretedType` values | RTROIInterpretedType round-trip |
| `seg-multilabel/` | Multi-segment SEG (≥ 5 segments) | SEG load + multi-segment ops |
| `cine-us/` | Multi-frame US for stack-eligibility predicate | stack-mode fallback |

## How to populate

Source: anonymized DICOM from your own data, or public test sets such as:

- The Cancer Imaging Archive (TCIA) — search for small public-domain series.
- `dicomweb-server` test data (`@radicalimaging/dicomweb-server`).
- DCMTK example datasets.

Place files directly in the subdirectory (no nested folders). One DICOM per file. Total size per fixture should stay under ~10 MB so the repo doesn't bloat — these are smoke-test datasets, not regression-grade.

## Anonymization

Strip patient name, ID, birth date, and any other identifiers before placing files here. Tools: `dcmodify`, `dicom-anonymizer`, or a hand-crafted dcmjs script.

## How specs find fixtures

Specs use the `loadLocalDicomFixture` helper in `e2e/helpers/local-dicom-fixtures.ts`. The helper discovers files in a fixture subdirectory, returns their absolute paths, and the spec sets up Cornerstone to load them via the `wadouri:` scheme (for files) or via the local-file IPC channel (for paths the renderer process can't fetch directly).

If a fixture directory is missing or empty, the helper returns `null` and the spec's `test.skip()` branch fires.
