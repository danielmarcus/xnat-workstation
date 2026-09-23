# Cornerstone3D 4.16.1 → 5.10.11 upgrade plan

Status: **in progress** on branch `cornerstone-v5` (started 2026-09-23). Living document — execute top to bottom, tick phases off here.

## Summary

| | |
|---|---|
| Installed | `@cornerstonejs/{core,tools,dicom-image-loader,adapters,polymorphic-segmentation}` **4.16.1** (declared `^4.16.1`) |
| Latest | **5.10.11** (5.0.0 shipped 2026-06-09; 5.x has had ~11 minors since) |
| Last 4.x | **4.22.13** (2026-05-26). No 4.x release since 5.0.0 → treat 4.x as unmaintained (inferred; no stated policy) |
| Public API break for us | **Small.** None of the removed public exports are used here (`getStackViewport(s)`, `getVolumeViewports`, `setDataIds`, `convertPALETTECOLOR`, `createPointInEllipse` radius option, `filterViewportsWith*`, `ROICachedStats` — grep is empty). |
| Real risk | **Behaviour changes under our internals**: the default DICOM loader/metadata path, the labelmap segmentation data model, and ~60 places where we reach into private Cornerstone state or work around a documented 4.x quirk. |

**Recommendation:** upgrade, in two hops — 4.16.1 → 4.22.13 first (same major, isolates 4.x drift), then → 5.10.11 with the legacy metadata provider switched ON, then migrate internals phase by phase. Do not attempt a single jump with v5 defaults: the loader change alone silently empties every `dataSetCacheManager` read (DICOM header panel, export, crosshair, ordering).

Evidence: v5 migration guides (cornerstonejs.org `/docs/migration-guides/5x`), GitHub releases, and a `.d.ts`/`package.json` diff of the published tarballs (both versions `npm pack`ed; diffs kept in the session scratchpad `cs-diff/`, regenerate with `npm pack @cornerstonejs/<pkg>@<ver>`).

## What v5 changes that touches this app

### 1. DICOM loading & metadata (highest risk)
- `wadouri` / `dicomfile` / `dicomweb` now load through `loadImageFromNaturalizedMetadata` by default. The legacy wadouri metadata provider is not registered, **`dataSetCacheManager` is no longer populated by image loads**, and `image.data` is a naturalized object, not a dicom-parser `DataSet`. (From reading `wadouri/register.js` / `loadImage.js` in 5.10.11 — not spelled out in the docs.)
- Escape hatch: `dicomImageLoader.init({ useLegacyMetadataProvider: true })` restores 4.x behaviour (logs a deprecation warning).
- Metadata moved to a new package **`@cornerstonejs/metadata`** (re-exported from core). NATURALIZED metadata is the new base state; the cache is read-through. Existing `metaData.addProvider` chains keep working. `metaData.get` is now typed `(type, ...queries: string[])`.
- `dicomImageLoader.init()` → `registerLoaders()` now calls **`cache.purgeCache()`** — init must stay before any image is cached.
- Progressive loading: new `initialChunkSize` (32 KB) and `msBetweenDecode` (500 ms) defaults.

**Our exposure:** 10 `wadouri.dataSetCacheManager.get(...)` reads and 4 explicit `.load(...)` calls — `dicomwebLoader.ts:126,256`, `appHelpers.ts:196,228`, `dicomExportHelpers.ts:268,276`, `unifiedCrosshair.ts:227`, `sessionDerivedIndexStore.ts:450`, `DicomHeaderPanel.tsx:214`, `ExportDropdown.tsx:361`. Reads that rely on the image load having filled the cache (the header panel, export) return nothing under v5 defaults. Explicit `.load()` sites keep working. Also `rtStructService.ts:92-95` registers a global `frameModule` provider at priority 100 that must still win over the new default providers.

### 2. Labelmap segmentation data model
- `representationData.Labelmap` is normalized into `{ labelmaps: {[id]: LabelmapLayer}, segmentBindings, primaryLabelmapId }`; primary layer id `${segId}-storage-0`. Old `{volumeId}` / `{imageIds}` inputs are still accepted, but the **stored shape is mutated**.
- **Removed private internals**: `SegmentationStateManager._stackLabelmapImageIdReferenceMap`, `_labelmapImageIdReferenceMap`, `_updateLabelmapImageIdReferenceMap`, `_generateMapKey` (replaced by `LabelmapImageReferenceResolver`).
- New native overlapping segments: `init({ segmentation: { overwriteMode } })` — default `'all'` = 4.x behaviour. Optional RLE labelmaps (`getScalarData()` then returns a copy).
- Brush strategies paint via `voxelSlab.iterateVoxelsInShape`; custom strategies opt in with `operationData.brushVoxelSlabFill`.

**Our exposure (breaks at runtime, not compile time — all behind `as any`):**
- `segmentationService.ts:378-418, 2570-2587` **write** `_stackLabelmapImageIdReferenceMap` / `_labelmapImageIdReferenceMap` directly.
- `dicomSegExport.ts:256-257` **reads** `_stackLabelmapImageIdReferenceMap` to find live labelmap images for export.
- `dicomSegExport.ts:182-185` documents working around `_updateAllLabelmapSegmentationImageReferences` being "broken in v4.16" — replaced upstream; the workaround must be re-derived.
- 37 reads of `representationData.Labelmap.{imageIds,volumeId}` / `.Contour` (segmentationService, contourRepresentation, contourEditPrereq, E2E hooks). Contour shape unchanged; Labelmap shape changed.
- The multi-layer-group design (`_layer_N` sub-segs, `resolveContainerSubjectId`, group SEG export via an unattached temp seg) must be re-verified against the new layer ids (`-storage-N`).
- `cornerstoneMocks.ts` fakes `_stackLabelmapImageIdReferenceMap` — unit tests would keep passing against a map v5 no longer has. Mocks must move with the code.

### 3. Tools, cursors, bindings
- `ToolGroup`, `cursors`/`registerCursor`, `IStackViewport`/`IVolumeViewport` (`getSliceIndex`, `getCurrentImageIdIndex`, `scroll`, `jumpToWorld`, `setOrientation`), `getClosestImageId`, `convertStackToVolumeLabelmap`, `addSegmentations`: **no `.d.ts` change**. Behaviour still needs re-verification because we depend on undocumented semantics (binding merge, exact modifier match, `_getCursor` fallback order, `registerCursor` BASE geometry, keyUp cursor reset).
- Spline/Livewire: private `_activateModify`/`_deactivateModify` moved to protected on `AnnotationTool`; `_dragCallback` protected.
- `addNewAnnotation` on ROI tools can return `null`; `CircleROI.handles.points` is `Point3[]`; cached stats retyped.

**Our exposure:**
- `tools/SafePaintFillTool.ts` **subclasses `PaintFillTool`**, replaces `preMouseDownCallback`, calls protected helpers (`getFixedDimension`, `generateHelpers`, `getFramesModified`, `doneEditMemo`).
- Instance patches: `contourPreviewMultiViewport.ts:55-109` (wraps `activateDraw` / `renderContourBeingDrawn`), `toolService.ts:279-320` (scissors `preMouseDownCallback`, legacy — `toolService` is dead code on the live path), `toolService.ts:520-570` (sculptor), `unifiedToolService.ts:719-753` (`disableCursor`, RegionSegmentPlus `mouseTimer`).
- Cursor internals: `unifiedToolService.ts:836-946` (`CursorSVG[name].name` mutation, named-cursor catalogue incl. the absent `CircleScissor.ERASE_INSIDE`).
- Undo: `undoHistory.ts:210-224` **monkey-patches `DefaultHistoryMemo.push`** and reads ring internals (`.ring/.position/.size`). v5 reworked contour + labelmap undo (#2785, #2817) — highest-risk single patch.
- Interpolation: `init.ts:69` / `interpolationAcceptance.ts` rely on our `ANNOTATION_COMPLETED` listener running before Cornerstone's, and on `InterpolationManager` internals.
- `init.ts:116-119` registers `SplineContourSegmentationTool` with `AnnotationToPointData` (may now be done upstream).

### 4. Adapters & dcmjs
- dcmjs **0.49.4 → 0.52.0** (arrives via `@cornerstonejs/metadata` / adapters). SR parsing adapted to dcmjs structural changes (#2643); SR now encodes spline control points.
- `createFromDICOMSegBuffer` deprecated (still works) → `createFromDicomSegImageId` / `createLabelmapsFromDICOMBuffer`. SEG segments indexed by SegmentNumber; compressed SEG supported.
- **Our exposure:** SEG import (`segmentationService.ts:3484`, with a Rows/Columns buffer repair at 3185-3240 and custom metadata provider), SEG export (`dicomSegExport.ts:699`), RTSS export through `(adaptersRT as any).Cornerstone3D.RTSS.generateRTSSFromContour` (`rtStructService.ts:954`), SR import/export (`srImport.ts`, `srExport.ts` — lazy import dodges an adaptersSR init crash; re-test), dcmjs used **directly** in 5 files but **not declared** in `package.json`, and `writeDicomDict.ts:36-60` patches the dcmjs `WriteBufferStream` prototype.

### 5. Dependencies & build
- All `@cornerstonejs/*` are **exact-pinned to each other** in 5.x: bump every package together. New peers: `@cornerstonejs/metadata`, `@cornerstonejs/utils` (5.10.11).
- vtk.js **34.15.1 → 36.4.1** (core dep, tools/polySeg peer). Tools adds `clipper2-ts`.
- Codecs move to charls 1.2.5, libjpeg-turbo-8bit 1.2.4, openjpeg 1.3.2, openjph 2.4.9 (docs say progressive HTJ2K wants openjph ≥ 2.4.10 — we don't pin codecs, and don't use progressive HTJ2K, so accept 2.4.9). Codecs are now CSP-safe (no `eval`) — good for Electron.
- ESM-only with explicit `.js` extensions; `require()` unsupported. Renderer + e2e tsconfig already use `moduleResolution: bundler` ✅. `tsconfig.main.json` uses `node`, but the main process imports no Cornerstone ✅.
- Vite guidance unchanged (`optimizeDeps.exclude` dicom-image-loader, `worker.format: 'es'`) — our config already matches; `optimizeDeps.include` lists `@kitware/vtk.js` and the four codec subpaths, which need re-checking after the version bumps.
- Some published `.d.ts` contain broken `import("packages/core/dist/esm/types")` paths; with `skipLibCheck: true` those types become `any` silently — don't trust a clean typecheck as proof.

### 6. Upstream fixes that may retire our workarounds
Check each; delete the workaround only with an E2E proving the upstream fix:
- Oblique: brush fill, Freehand ROI on oblique volumes (#2744), **`LabelMapEditWithContour` on oblique data (#2842)** — our index-space contour-fill rasterizer (`contourEditPrereq.ts:149-158`) exists because of this.
- Contour segmentation undo/redo (#2817) vs our hand-built memo in `contourEditPrereq.ts:20-29`.
- BrushTool mousedown crash (#2785); brush shape on rotated images (#2743).
- Removed spline being re-converted (#2824) vs `segmentationService.ts:2096-2233`.
- Interpolation on oblique series (`interpolationAcceptance.ts:239-256` normal-drift fix) — still a CS3D limitation per project notes; re-test with `ct-oblique`.

## Plan

Each phase ends green on: `npm run typecheck`, `npx vitest run`, `npm run build && npm run test:e2e:offline` (list reporter, `--max-failures=0`), `npm run test:dicom:compliance`; live-XNAT specs at phase 2 and 7. Commit per phase on a `cornerstone-v5` branch.

### Phase 0 — Baseline
- [x] Branch `cornerstone-v5`. Baseline on 4.16.1 (2026-09-23): typecheck clean · **906** unit · **38** DICOM-compliance · **170** offline E2E, all green. Perf reference stays `docs/perf-baseline.md` (re-measured in Phase 8). Live-XNAT specs (`--project=auth`: login + browser navigation, read-only): run at the Phase 2 gate.
- [x] Declare `dcmjs` as a direct dependency at the version adapters currently resolves (`^0.49.4`), so the later bump is an explicit, reviewable change.

### Phase 1 — 4.16.1 → 4.22.13 (last 4.x)
- [x] Bump all five packages to exact `4.22.13` (vtk.js, codecs, dcmjs unchanged at this hop). Full gate green: typecheck · 906 unit · 38 compliance · 170 offline E2E.
- [x] Only 4.x drift found: a TYPE mismatch between Cornerstone's own packages — polySeg's `createAndAddContourSegmentationsFromClippedSurfaces` takes `Viewport`, tools' `PolySegAddOn` passes `StackViewport | VolumeViewport`. Narrow documented cast at the `initTools` boundary (`init.ts`); re-check on v5.

### Phase 2 — 5.10.11 in compatibility mode
- [x] Bump all `@cornerstonejs/*` to exact `5.10.11`; add `@cornerstonejs/metadata` and `@cornerstonejs/utils`; bump dcmjs to 0.52.0 (one deduped copy; vtk.js 36.4.1).
- [x] `init.ts`: `initDicomImageLoader({ maxWebWorkers, useLegacyMetadataProvider: true })`. Loader init runs before any viewport exists, so the new cache purge is harmless.
- [x] Codemod — skipped, see findings (nothing it rewrites is used).
- [x] Type errors: none beyond the persisting polySeg cast.
- [x] Gate result: typecheck clean · 906 unit · 38 compliance · **163 / 170 offline E2E**. The 7 failures are all segmentation/contour and carry into Phase 3–4:
  - `tools/sphere-brush-family` ×2 — slices-touched reads 0 (E2E hook reads `Labelmap.volumeId`; v5 stores `labelmaps{}` — hook or painting, TBD)
  - `annotations/contour-preview-multiviewport` — in-progress contour offset 0.063 vs < 0.03 in the second viewport (instance patch on `renderContourBeingDrawn`)
  - `annotations/same-scan-viewport-parity` (contour from second viewport not added), `annotations/scan-switch-prompt` ×2 (contour not drawn), `annotations/second-viewport-renders` (annotation not rendered on a later-opened viewport)
- [ ] Vite: re-verify `optimizeDeps.include` entries resolve (vtk 36, codec subpaths); dev server and `npm run build` both load images, including HTJ2K/JPEG-LS/JPEG2000 fixtures if we have them.
- [ ] Expect segmentation failures here (phase 3). Everything **else** must be green before moving on — including the live XNAT specs and the packaged app (Phase 8 smoke run early).

**Phase 2 findings (2026-09-23)** — none of these were in the release notes; all surfaced from the gates:
- **Renderer failed to mount** (`Class extends value undefined`): vtk.js 36 depends on `xmlbuilder2` 4, which dropped the browser bundle 3.x shipped (`browser: lib/xmlbuilder2.min.js`) and `require`s Node's `events` at class-definition time; Vite stubs Node built-ins in the renderer. Reached through Cornerstone core's mesh cache (`Mesh.js` → `XMLPolyDataReader`). Fix: declare the browser port **`events`** as a dependency (Vite resolves the bare `events` import to it). Its `url` require is only used inside functions never called on this path.
- **25 unit-test files failed to load**: dcmjs 0.52's `exports` maps `import` to `build/dcmjs.es.js` without `"type": "module"`, so Node (Vitest externalizes deps) loads it as CommonJS and Cornerstone's named dcmjs imports fail. Fix: `vitest.config.ts` `server.deps.inline` for `@cornerstonejs/*` and `dcmjs`. The app build is unaffected.
- **Every exported SEG failed dciodvfy**: the v5 adapter's `applyPerFrameFunctionalGroups` replaces dcmjs's per-frame `DerivationImageSequence` with a bare `SourceImageSequence` item, dropping `ReferencedSOPClassUID` (Type 1), `PurposeOfReferenceCodeSequence` and `DerivationCodeSequence` (1C). Fix: `completeSegDerivationReferences` in `dicomExportHelpers.ts`, run by `serializeDerivedDicomDataset` for every SEG (restores dcmjs's exact codes; class UID from the SEG's own `ReferencedSeriesSequence`). Worth reporting upstream.
- polySeg ↔ tools `PolySegAddOn` type mismatch persists in 5.10.11 — cast kept.
- Codemod not run: it only rewrites `getStackViewport(s)` / `getVolumeViewports` / `setDataIds`, none of which are used.

### Phase 3 — Labelmap internals
- [x] **Stop converting stack → volume labelmaps and stop hand-populating the private reference maps** (`segmentationService.ts` `addSubSegToViewport` and the legacy single path). v5 renders STACK labelmaps on volume viewports natively (its `LabelmapImageReferenceResolver` matches each labelmap image to viewport slices with `isReferenceViewable(..., { asOverlay: true })`). Observed stored shape on an ORTHOGRAPHIC viewport: one `storageKind: 'stack'` layer, no `volumeId`. v5's `convertStackToVolumeLabelmap` writes a top-level `volumeId` the normalized model ignores, and rebuilds the volume by re-*loading* each labelmap image.
- [x] **Register a cache-backed image loader for the app's `generated:` labelmap scheme** (`generatedImageLoader.ts`, `init.ts`). When a labelmap can't be matched image-for-image (same series loaded into a second viewport under new imageIds), v5 renders it through a geometry volume with no `referencedImageIds`; adding it computes a default VOI by re-loading the middle image with `ignoreCache`, which threw "No image loader found for scheme 'generated'" — a viewport opened after painting showed no mask (`annotations/second-viewport-renders`).
- [x] Export: `dicomSegExport` no longer reads `_stackLabelmapImageIdReferenceMap` (always empty on v5); the canonical labelmap imageIds + `referencedImageId` matching was already the primary path.
- [x] `labelmapLayers.ts` `labelmapStorage()` reads v5 layers (with a 4.x top-level fallback); every `representationData.Labelmap.{imageIds,volumeId}` read in app code and the E2E voxel hooks goes through it. The E2E per-slice hook read only `volumeId`, so `tools/sphere-brush-family` saw zero painted slices on v5 — painting itself was fine.
- [x] Mocks: the fake private map and `convertStackToVolumeLabelmap` stub removed from `cornerstoneMocks.ts` and `segmentationService.loadExport.test.ts`.
- [x] **Contour behaviour changes in v5** (tests updated to keep their intent, no app change):
  - a freehand Structure stroke that encloses no area (a straight line) is closed and then **dropped** on mouse-up (4.x kept a zero-area sliver) — `annotations/scan-switch-prompt`, `annotations/contour-preview-multiviewport` now draw strokes that enclose an area (the latter still open until mouse-up, verified red with the multi-viewport preview patch disabled);
  - overlapping contours of one segment on one plane are **unioned** into a single contour (4.x kept both) — `annotations/same-scan-viewport-parity` draws its second loop clear of the first.
- [x] Gate: typecheck · 910 unit · 38 compliance · **170 / 170 offline E2E**.
- [ ] Still to verify in Phase 4/5: multi-layer groups under `overwriteMode: 'all'` (default kept), per-viewport hide, group SEG export via temp seg.

### Phase 4 — Tool internals, cursors, undo
- [ ] `SafePaintFillTool`: rebase on the 5.10.11 `PaintFillTool` source; confirm the protected helpers still exist with the same contract (brush voxel-slab change).
- [ ] Undo: re-validate the `DefaultHistoryMemo.push` monkey-patch and ring-internals reads against v5's contour/labelmap undo rework. If v5 exposes the needed hooks, replace the patch.
- [ ] Re-verify instance patches (`contourPreviewMultiViewport`, sculptor, BrushTool `disableCursor`, RegionSegmentPlus `mouseTimer`), interpolation listener order, spline `AnnotationToPointData` registration.
- [ ] Cursor & binding semantics: `cursor-matrix`, `tool-cursors`, `shift-nav-swap`, `tool-binding-leak`, `switch-bindings` specs are the contract — all must pass unchanged.
- [ ] Delete `toolService.ts` (dead legacy path, never initialized) rather than porting its patches — flag separately if not done already.

### Phase 5 — Adapters & DICOM output
- [ ] SEG import/export, RTSTRUCT export, SR import/export round-trips; `test:dicom:compliance`; `rtStructService.roundtrip.test.ts`, `dicomExternalCompliance.test.ts` (these use the real adapters).
- [ ] Re-check the SEG Rows/Columns buffer repair, PatientAge fix-up, and `writeDicomDict` dcmjs prototype patch against dcmjs 0.52.0 — each may be fixed or may break.
- [ ] Re-test the adaptersSR init crash that the lazy `srImport` import dodges.
- [ ] Optionally move SEG import to `createFromDicomSegImageId` (removes the preload-before-parse workaround in `App.tsx:529-532`).

### Phase 6 — Leave the legacy metadata provider
- [ ] Introduce one app-level accessor for "DICOM attributes of an imageId" backed by `metaData` / NATURALIZED, and migrate the 10 `dataSetCacheManager.get` sites to it (header panel, export, crosshair, ordering, session index).
- [ ] Verify the `frameModule` provider (`rtStructService.ts:92`) and our generic-metadata registrations for generated labelmap images still resolve.
- [ ] Remove `useLegacyMetadataProvider: true`. Full gate, including the header panel and export, driven through the UI.

### Phase 7 — Retire workarounds / adopt fixes (optional, per item)
- [ ] For each item in §6, write or reuse the E2E that the workaround exists for, remove the workaround, keep it removed only if the E2E stays green (use `ct-oblique`, not just axial).
- [ ] Native overlapping segments (`overwriteMode`) could replace the multi-layer-group machinery — that is a **design change**, not part of this upgrade; write it up separately if wanted.

### Phase 8 — Packaging & release
- [ ] `electron-builder` build; smoke-test the packaged app on macOS: image load (all codecs), workers, polySeg worker, SEG/RTSTRUCT/SR save to XNAT, COOP/COEP in the packaged app (only the dev server sets them in `vite.config.ts`).
- [ ] Perf run vs Phase 0 baseline (`docs/perf-baseline.md`).
- [ ] Merge.

## Risks & open questions
- **Silent failures, not compile errors.** Almost every risky site is behind `as any`; typecheck will be clean while features break. The E2E suite is the real gate — keep it pixel/behaviour-level.
- **Undo patch** is the likeliest to need a redesign rather than a port.
- **4.x end of life** is inferred from the release history only.
- Effort estimate (rough): Phases 1–2 ~1 day; 3–4 several days (labelmap + undo are the unknowns); 5–6 ~2 days; 7 open-ended; 8 ~0.5 day.
