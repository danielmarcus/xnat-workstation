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

Planned for later Phase-0 passes (per the design's fixture matrix): `mr-t1-t2-sameexam`,
`4dct-phases`, `breath-hold-pair`, `cross-for-ct-mr`, `rtstruct-typed`,
`seg-multilabel`, `cine-us`.

## Notes

- Explicit VR Little Endian, CT Image Storage (`1.2.840.10008.5.1.4.1.1.2`),
  signed 16-bit pixels, identity Rescale. See CLAUDE.md → DICOM Compliance.
- UIDs are freshly generated per run (`dcmjs` `DicomMetaDictionary.uid`), so a
  regeneration is internally consistent but not byte-identical across runs.
- Loaded into the app via the local-DICOM import path (`App.loadLocalFiles`),
  driven in E2E by `e2e/helpers/local-fixture.ts`.
