# E2E DICOM fixtures

Synthetic, PHI-free DICOM datasets for **offline** Playwright E2E (no live XNAT,
no network). The generator is the source of truth; the generated `.dcm` files are
git-ignored (regenerate them locally before running E2E that needs them).

## Generate

```bash
# from repo root, with node on PATH
node e2e/fixtures/dicom/generate.cjs              # all datasets
node e2e/fixtures/dicom/generate.cjs ct-axial-300 # one dataset
```

## Datasets

| Name               | What it is                                                              | Status |
|--------------------|-------------------------------------------------------------------------|--------|
| `ct-axial-300`     | Binary CT sphere phantom (two HU values).                               | ✅ built |
| `ct-axial-anatomy` | Intensity-varied CT — air/-1000, soft-tissue/+40, lesion/+70, bone/+1000, sharp boundaries (for region-grow / paint-fill / threshold tolerance). | ✅ built |
| `rtstruct-typed`   | Source CT (sphere) + a hand-built RTSTRUCT referencing it (shared UIDs), 4 ROIs covering distinct RTROIInterpretedType (EXTERNAL/GTV/ORGAN/MARKER). Verified to load via the app (`e2e/specs/11-fixture-rtstruct`). | ✅ built |
| `seg-multilabel`   | Source CT (sphere) + a hand-built multi-segment BINARY DICOM SEG (5 segments on distinct slices, continuous LSB-first bitstream). Verified to load via the app (`e2e/specs/12-fixture-seg`). | ✅ built |
| `mr-t1-t2-sameexam` | Two MR series (T1 + T2), SAME study + Frame of Reference, distinct series. | ✅ built |
| `breath-hold-pair` | Two CT series, SAME Frame of Reference, anatomy displaced (sphere shifted). | ✅ built |
| `cross-for-ct-mr`  | CT + MR, same study, DIFFERENT Frame of Reference (unregistered, no SRO). | ✅ built |
| `4dct-phases`      | 4 CT temporal phases (sphere translated in z), shared study + Frame of Reference. | ✅ built |
| `cine-us`          | Multi-frame ultrasound (16 frames, 8-bit, moving bar, cine-rate tags). | ✅ built |

**All 9 design fixtures built.** `4dct-phases` / `cine-us` carry no §G acceptance
signal yet — they back Phase-5 cine work; structurally validated, in-app
load-validation deferred to Phase 5.

Note: SEG/RTSTRUCT are **hand-built** in `generate.cjs` (not exported via the app),
because the app's adapter-based export reads source study metadata that is only
registered for XNAT-loaded images, not local files. Hand-building references the
co-generated source UIDs directly and is validated against the app's loader.

## Notes

- Explicit VR Little Endian, CT Image Storage (`1.2.840.10008.5.1.4.1.1.2`),
  signed 16-bit pixels, identity Rescale. See CLAUDE.md → DICOM Compliance.
- UIDs are freshly generated per run (`dcmjs` `DicomMetaDictionary.uid`), so a
  regeneration is internally consistent but not byte-identical across runs.
- Loaded into the app via the local-DICOM import path (`App.loadLocalFiles`),
  driven in E2E by `e2e/helpers/local-fixture.ts`.
