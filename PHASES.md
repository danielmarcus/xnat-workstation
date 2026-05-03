# XNAT Workstation — Development Phases

## Phase 0: Prove Cornerstone3D Works in Electron + Vite (Complete)
- Scaffold Electron + Vite 5 + React 19 + TypeScript + Tailwind project
- Initialize Cornerstone3D v4.15.30 (core, tools, DICOM image loader)
- Configure Vite for web workers, WASM, SharedArrayBuffer
- Create CornerstoneViewport component and render a DICOM image
- Verify dev mode and production build both work

## Phase 1: Core Viewer with Basic Navigation (Complete)
- Stack viewport with Window/Level, Pan, Zoom, Scroll tools
- ViewportOverlay with four-corner DICOM metadata display
- Toolbar with tool buttons, W/L presets, viewport actions (reset, invert, rotate, flip)
- Cine playback with FPS control
- Service layer architecture: viewportService, toolService, metadataService
- Zustand stores: viewerStore, metadataStore
- DICOM loading via drag-and-drop, file picker, and DICOMweb

## Phase 2: XNAT Connection & Session Management (Complete)
- XNAT REST API client with JSESSION cookie auth
- Session lifecycle manager with keepalive
- IPC bridge for secure credential handling (credentials stay in main process)
- Login form UI and connection status indicator
- webRequest interceptor for injecting auth headers into WADO-URI fetches
- QIDO-RS proxy through IPC for DICOMweb browsing

## Phase 3: Multi-Panel Viewport Layouts (Complete)
- 1x1, 1x2, 2x1, 2x2 grid configurations
- Per-panel independent state (VOI, zoom, rotation, flip, invert, scroll)
- One RenderingEngine with multiple viewports
- One shared ToolGroup across all panels
- Active panel selection with visual indicator
- Layout selector in toolbar
- ViewportGrid component orchestrating CSS grid layout

## Phase 4: Annotation & Measurement Tools (Complete)
- 8 annotation tools: Length, Angle, Bidirectional, Elliptical ROI, Rectangle ROI, Circle ROI, Probe, Arrow Annotate, Planar Freehand ROI
- AnnotationToolDropdown with 2-column grid and inline SVG icons
- annotationStore (Zustand) synced from Cornerstone events via annotationService
- AnnotationListPanel: right-side panel with select/highlight, delete, clear-all
- Custom ArrowAnnotate text callback (floating input instead of blocked window.prompt)

## Phase 5: DICOM Header Inspector (Complete)
- Full DICOM tag inspector panel reading raw datasets from wadouri cache
- ~400 tag dictionary with human-readable names across 7 DICOM module groups
- Collapsible sections grouped by module
- Text search across tag name, keyword, tag number, and value
- Private tag toggle, smart value formatting (dates, times, sequences, binary)
- Auto-updates when scrolling images or switching active viewport

## Phase 6: Export & Screenshot (Complete)
- Save viewport as PNG/JPEG image (includes annotations)
- Copy viewport to system clipboard
- Save raw DICOM file to local filesystem
- ExportDropdown in toolbar with toast notifications
- IPC handlers using Electron's nativeImage and save dialog

## Phase 7: Hanging Protocols (Complete)
- Protocol type definitions and built-in protocols (CT Pre/Post Contrast, MR Brain Standard, Side by Side, Single Series)
- Protocol matching engine with scan metadata analysis
- Auto-detect best protocol based on loaded scans
- Manual protocol selection
- Auto-fallback layout when no protocol matches
- "Load All as Protocol" button in XNAT Browser

## Phase 8: MPR / Multiplanar Reconstruction (Complete)
- Streaming 3D volume creation from image stacks with progress tracking
- ORTHOGRAPHIC volume viewports for Axial, Sagittal, Coronal planes
- 2x2 grid: 3 MPR viewports + original stack reference
- CrosshairsTool for synchronized navigation across planes
- Orientation labels (A/P, R/L, S/I) on each viewport
- Keyboard navigation (arrow keys, Page Up/Down, Home/End)
- Separate MPR tool group, state preservation on MPR enter/exit
- Clean memory management (volume destroyed from cache on exit)

## Phase 9: Segmentation Overlay (Complete)
- Stack-based labelmap segmentation (one labelmap image per source slice)
- Brush, Eraser, and Threshold Brush tools
- Auto-creation of segmentation when first activating a brush tool
- Pre-loading of all source images to ensure metadata availability for overlay matching
- Segmentation panel UI with segment list, color display, visibility/lock toggles
- Segment add/remove, color customization (10-color palette)
- Configurable brush size, fill opacity, outline rendering
- DICOM SEG loading via @cornerstonejs/adapters
- segmentationStore (Zustand) synced from Cornerstone events via segmentationService

## Phase 10: Contouring Tools (Complete)
- **Freehand contour segmentation** — PlanarFreehandContourSegmentationTool for drawing closed contours
- **Spline contour segmentation** — SplineContourSegmentationTool (Cardinal, Linear, Catmull-Rom, BSpline) with spline type selector
- **Livewire contour segmentation** — LivewireContourSegmentationTool for semi-automatic edge-snapping contour tracing
- **Scissor tools** — CircleScissorsTool, RectangleScissorsTool for region-based labelmap fills
- **Paint fill** — PaintFillTool for flood-fill within connected regions
- **Sculptor tool** — SculptorTool for push/pull editing of existing contour boundaries
- **Contour panel UI** — Grouped segmentation tool dropdown (Paint / Contour / Fill sections), contour-specific controls
- **Dual representation architecture** — Every segmentation gets both Labelmap and Contour representationData at creation for seamless tool switching
- **PolySeg addon** — @cornerstonejs/polymorphic-segmentation registered for representation conversion
- **Deferred to Phase 10b:** Undo/redo and contour-to-labelmap conversion

## Phase 11: Save to XNAT (Future)
- **DICOM SEG export** — Serialize labelmap segmentations to DICOM SEG format using @cornerstonejs/adapters, with proper headers (Referenced Series, Frame of Reference, segment metadata)
- **DICOM RT-STRUCT export** — Serialize contour-based segmentations to RT Structure Set format for radiation therapy workflows
- **Annotation export** — Serialize Cornerstone annotation/measurement data to a storable format (DICOM SR or JSON)
- **Upload to XNAT** — Push DICOM SEG, RT-STRUCT, and annotation data to XNAT via REST API as assessors on the source imaging session
- **XNAT ROI Collection integration** — Store segmentations/contours as XNAT ROI Collections (icr:roiCollectionData) for compatibility with existing XNAT ROI workflows
- **Save confirmation UI** — Upload progress indicator, success/error feedback, conflict detection (overwrite vs. new assessor)
- **Auto-save / draft support** — Periodic local auto-save of in-progress segmentations to prevent data loss; resume editing after app restart
- **Round-trip workflow** — Load existing DICOM SEG / RT-STRUCT from XNAT, edit, save back as new version

## Phase 12: UI Polish & Icons (Partially Complete)
- Shared SVG icon library (icons.tsx) with 20+ consistent stroke-based icons
- Icon + label tool buttons, icon-only action buttons with tooltips
- Custom chevron arrows on select dropdowns
- Toolbar layout cleanup with consistent spacing
- Remaining: keyboard shortcut hints, hover state refinements, overall visual refinement pass

---

## Future Enhancements (Beyond Phase 12)

### Hanging Protocol Definition UI + Server Storage
- Visual protocol editor for creating custom hanging protocols
- Cross-session comparison workflows
- XNAT REST storage for protocol definitions
- Shared protocols across users within a project

### Segmentation Enhancements
- Segmentation interpolation between slices (shape-based auto-fill between key slices)
- Segment statistics & measurements (volume, HU stats, CSV export)
- Multi-viewport segmentation sync (volume-based cross-plane painting)
- Lazy labelmap creation for large series performance

### XNAT Integration Enhancements
- Assessment forms (RECIST 1.1, RANO-BM)
- Worklist system

### Advanced Features
- Fusion overlays (PET/CT)
- Packaging & distribution (Electron-builder, auto-update, installers)

---

## Multi-Viewport Annotation Rewrite

A separate workstream tracked in `docs/multiviewport-annotation-*.md`. Phase numbers below are scoped to this workstream and are independent of the historical project phases above.

### MV-Phase 0: Preparation (In progress)
**Goal:** foundation; no user-visible behavior change.

- ✅ **0.1** Land annotation data model types (`Container`, `Member`, `SourceIdentity`, `ActiveState`, `ApprovalState`, `ContainerHistory`) in `src/renderer/types/annotation.ts` with construction + JSON round-trip tests.
- ✅ **0.2** Add `multiviewport.enabled` feature flag to `preferencesStore` (default `false`). Persisted; merge handles legacy state without the key.
- ✅ **0.3** Add `transportStore` skeleton: per-container version token, save-in-flight, last outcome, last error, external-change-pending. Surface for the H1–H10 transport contract.
- ✅ **0.4** Add four service skeletons: `containerService`, `undoService`, `viewportLayoutService`, `transportContractService`. All methods throw a clear `not yet implemented` error until consumed in subsequent phases.
- ✅ **0.5** Decompose `segmentationService.ts` (5614 → 4407 lines, −22%) into the existing `segmentationService/` subfolder:
    - `segmentationService/historyMemo.ts` (Phase 0.5.A) — Cornerstone HistoryMemo wrapping.
    - `segmentationService/contourClipboard.ts` (Phase 0.5.B) — copy/paste machinery, Point3 math, paste history-memo, selection-sync handler.
    - `segmentationService/autoSave.ts` (Phase 0.5.C) — debounced auto-save, dirty-tracking suppression, labelmap-interpolation orchestrator, event handlers.
    - Each submodule wires its service-level dependencies via DI (a single `wireXxx({...})` call from `segmentationService.initialize()`).
- ✅ **0.6** Decompose `toolService.ts` (1047 → 850 lines): `toolService/scissor.ts` extracts the scissor-tool strategy/cursor/patching/modifier-listener machinery with the same DI pattern.
- ✅ **0.7** PolySeg validation against open issues #1288, #1837, #1188.
    - Installed: `@cornerstonejs/polymorphic-segmentation` 4.16.1. Latest on npm: 4.22.3.
    - **#1288 (contour → closed-surface re-conversion)**: closed without merged fix; no fix in newer versions. Application-level workaround needed if hit. Not blocking for v1 — first conversion works; second-pass conversion is a feature gap, not a defect.
    - **#1837 (Vite MIME-type error on contour→stack-labelmap)**: closed; root cause is Vite bundler config. Our [vite.config.ts](vite.config.ts) already has the recommended `assetsInclude: ['**/*.wasm']`, `worker: { format: 'es' }`, and `optimizeDeps.exclude` for `@cornerstonejs/polymorphic-segmentation`. **Not affected.**
    - **#1188 (segmentation MPR mismatch)**: closed without merged fix; metadata-conformance issue on the SEG side. Not blocking but adds risk to MPR rendering of imported SEGs; verify with real fixtures in MV-Phase 1.
    - **Verdict**: hold at 4.16.1; upgrading to 4.22.3 buys nothing relevant. Real fixture-based regression testing happens in MV-Phase 1.
- ✅ **0.8** Acceptance: app builds, runs, looks identical; all 565 existing tests pass.

### MV-Phase 1: Viewport unification (In progress)
**Goal:** volume default; one tool group; MPR mode consolidated. Behind `multiViewport.enabled` flag.

- ✅ **1.1** Stack-eligibility predicate (`viewportService/stackEligibility.ts`): pure-logic decision between volume and stack based on modality (US/XA/RF/NM/DX/CR/MG → stack), multi-frame cine without spatial dim → stack, single image → stack, otherwise → volume. 19 tests.
- ✅ **1.2** Reference-counted shared-volume cache in `volumeService` keyed on `(scanId, FrameOfReferenceUID)`. Two viewports reformatting the same scan now share one ImageVolume. 9 tests.
- ✅ **1.3** New `viewportService` methods: `createVolumeViewport`, `setVolume`, `getVolumeViewport`, `resolveViewportType`, and the high-level `createViewportForImages` that picks volume-vs-stack and hooks into the shared-volume cache.
- ✅ **1.4** `Viewport.tsx` introduced as the unified rendering surface. Reads `multiViewport.enabled` + applies eligibility. ViewportGrid migrated to import `Viewport` instead of `CornerstoneViewport`.
- ✅ **1.4b** `VolumeViewport.tsx`: minimum-viable ORTHOGRAPHIC volume mode with shared-volume acquire/release, tool-group attach, segmentation overlay attach. Slice navigation, cine, click-select annotations are deferred to subsequent commits.
- ✅ **1.5** `viewportLayoutService` preset implementations (1x1, 1x2, 2x1, 2x2, mpr-2x2, custom). Data model + applyPreset/getCurrentPresetId. Grid-instantiation wired to ViewportGrid in 1.8.
- ✅ **1.6** CrosshairsTool registered in primary tool group (Phase 1.6). Stays bound to WindowLevel via TOOL_NAME_MAP until volume mode becomes universal — the registration is structural prep; the binding flip happens in Phase 6 when stack viewports go away.
- ✅ **1.7** Full VolumeViewport event surface: VOLUME_NEW_IMAGE event for slice changes, wheel-scroll slice nav with the same threshold UX as stack mode, VOI/CAMERA event wiring, viewportReadyService integration, image-preload service, click-to-select contour annotations, crosshair pointer handlers, resize observer, cine cleanup, slice-loading pending overlay. Initial state read after first render: slice index, total, zoom, VOI, metadata overlay, native orientation, image dimensions.
- ✅ **1.8** ViewportGrid migration: when flag is on, oriented panels render via Viewport → VolumeViewport (with the orientation prop) instead of OrientedViewport. App.tsx's handleToggleMPR routes through viewportLayoutService.applyPreset('mpr-2x2') when flag is on: ensures 2x2 layout, propagates active scan to panels 0/1/2 with AXIAL/SAGITTAL/CORONAL orientations, falls through to legacy enterMPR otherwise.
- ✅ **Acceptance — signal 3** covered by `e2e/specs/08-volume-mode-acceptance.e2e.ts` (segmentation lifecycle on volume viewport + legacy fallback). All 4 volume-mode E2E tests in `07-volume-mode.e2e.ts` pass (volume viewport renders, wheel-scroll slice nav, flag toggle hook, legacy fallback). All 6 of 6 legacy `03-image-viewing.e2e.ts` tests still pass (no regression on stack-mode path).
- ✅ **Acceptance — signal 6** (rapid layout switching: 2×2 → 1×1 → MPR → 2×2 with no structures lost) — *Item 3*: covered by [e2e/specs/10-layout-switching.e2e.ts](e2e/specs/10-layout-switching.e2e.ts). Real Playwright flow: setup loads the test scan, expands to 2×2 via the toolbar; the test then drives the rapid sequence with no `waitForTimeout` between transitions, only one `requestAnimationFrame` flush per step. Four assertions per variant map 1:1 onto the §G #6 invariants — `assertSnapshotPreserved` (no structures lost / no duplicates), `assertSingleDirtyFlag` (exactly one entry in `dirtySegIds`, the global `hasUnsavedChanges` true), `assertNoStaleHighlights` (`activeSegmentationIdByPanel` has no entries pointing at panels removed by `setLayout`), and a best-effort `exportToDicomSeg` byte-stable round-trip (skipped with a logged note when the underlying brush flow doesn't land non-zero pixels — see below). Six new `__XNAT_E2E__` hooks landed: `setLayout`, `toggleMpr` (mirrors App.tsx `handleToggleMPR` end-to-end on both flag paths), `getDirtyState`, `getSegmentationSnapshot`, `getActiveByPanel`, `exportSegmentationToBase64`, plus the `markSegmentationDirty` / `markAllSegmentationsClean` pair (used to manufacture the dirty-state precondition Signal 6 wants to test against — needed because two pre-existing test-rig brittlenesses make brush-stroke labelmap flow unreliable: PHASES.md Item 1 row 06 brush-doesn't-set-dirty, plus the same brush events don't reliably land non-zero pixel data, surfacing as `nonZeroPixels=0`). Both flag-off (legacy enterMPR → MPRViewportGrid) and flag-on (`viewportLayoutService.applyPreset('mpr-2x2')`) variants pass; full spec runs in ~17 s. **No layout-churn races surfaced** — the in-memory state is structurally clean across the rapid sequence on both paths.
- ✅ **Acceptance — signal G7** (undo after a brush stroke made on a panel that's been closed) — *Item 2*: covered by [e2e/specs/09-undo-after-close.e2e.ts](e2e/specs/09-undo-after-close.e2e.ts). Real Playwright flow: 1x2 layout, the test scan loaded into both panels, real "Add segmentation" dialog targeting panel_1, real Brush click, real pointer-event stroke on panel_1's canvas → assert canUndo + a `labelmap:…` top entry → `__XNAT_E2E__.closePanel('panel_1')` shrinks layout to 1x1 (same `setLayout` transition the toolbar drives) → real `Ctrl+Z` keypress → assert canRedo flipped (memo moved to redo stack). Two new `__XNAT_E2E__` hooks landed for this: `closePanel(panelId)` and `getUndoStackInfo()` (peeks `DefaultHistoryMemo` via the existing `historyMemo.ts` accessors). Flag-on (volume-mode) variant is committed as `test.fixme` with a precise reason — `createNewSegmentation` produces a stack-labelmap rep that doesn't render writable pixel data on a `VolumeViewport`, so brush events fire but no memo lands; same brittleness `08-volume-mode-acceptance.e2e.ts` already calls out. Promote to a real test when MV-Phase 2.6/2.7 wires volume-labelmap support.
- ⏳ **Acceptance — performance budget** (4-panel CT load ≤ baseline + 30%): needs an instrumented E2E + comparison run. Deferred.
- ✅ **Local DICOM fixtures** (e2e/fixtures/dicom/) — *Item 4*: harness landed in Phase 1 (loader + 10 unit tests). Pipeline acceptance landed in [`e2e/specs/11-fixture-cross-series.e2e.ts`](e2e/specs/11-fixture-cross-series.e2e.ts): discovers each fixture, parses files with dcmjs, validates the metadata-shape claim each fixture is named for; skips cleanly when a fixture isn't on disk. Spec is 8 / 8. **Renamed** the design's `breath-hold-pair` slot to `sameforuid-different-acquisition` since the A2c heuristic keys on metadata (shared FoR + differing `AcquisitionNumber`), not anatomy displacement; same fixture covers the design's `4dct-phases` scenario. **Storage**: Git LFS via `.gitattributes` at the repo root. **Renderer hook** `__XNAT_E2E__.loadLocalDicomFiles(panelId, paths[])` lands fixture DICOMs into a panel through the production wadouri.fileManager + setPanelImageIds path with no XNAT round-trip; companion `setFakeConnected(bool)` opens the viewer gate for local-fixture specs. Spec drives the hook to mount the T1+T2 fixture on two panels and asserts both viewport canvases render. **All seven fixture slots populated** (~9 MB total via LFS):
    - `mr-t1-t2-sameexam/` (6.9 MB) — TCIA ACRIN-NSCLC-FDG-PET-099, 8 middle slices each of T1 / T2.
    - `sameforuid-different-acquisition/` (1.1 MB) — synthetic CT phase pair (16 slices × 2).
    - `ct-axial-300/` (1.1 MB) — synthetic axial CT, 30 slices.
    - `cine-us/` (260 KB) — synthetic multi-frame US, 16 frames.
    - `cross-for-ct-mr/` (864 KB) — synthetic CT + MR with distinct FoRs, 12 slices each.
    - `seg-multilabel/` (16 KB) — synthetic DICOM SEG with 5 segments referencing `ct-axial-300`.
    - `rtstruct-typed/` (8 KB) — synthetic RTSTRUCT with 6 ROIs (`GTV`, `CTV`, `PTV`, `ORGAN`, `EXTERNAL`, `AVOIDANCE`).
    
    **Follow-ups, completed:**

    - **Live-XNAT spec migration to local fixtures** ([e2e/helpers/fixture-load.ts](e2e/helpers/fixture-load.ts)): seven specs (03 / 04 / 05 / 07 / 08 / 09 / 10) now load from local TCIA / synthetic fixtures via `loadFixtureScan` + `__XNAT_E2E__.setFakeConnected`. Full Playwright suite: 38 passed, 7 skipped (fixmes, see below), 1 failed — the pre-existing "select annotation highlights it" failure documented in Item 1 row 04, **zero new regressions**. PHI surface in test artifacts now limited to live-XNAT specs 01 / 02 / 06.
    - **Signal 9 (A2b cross-series classifier)** acceptance landed in `11-fixture-cross-series.e2e.ts`: loads T1+T2, mounts both series on two panels in stack mode, creates a structure on panel_0, asserts the new `__XNAT_E2E__.getCrossSeriesAction` hook returns `eligibility='native'` + `action.kind='reset'` for the native viewport and `eligibility='cross-series-A2b'` + `action.kind='apply-cross-series'` for the non-native one. The hook wraps `classifySegmentationOnViewport` (visibility.ts) + `resolveAction` (styling.ts), so the test exercises the production classify pipeline.

    **Migration fixmes (6 tests skipped, all pre-Phase-2.7 territory):**

    - 04 / 05 / 09 / 10 brush-stroke flows: the synthetic CT path's segmentation-create flow logs `[segmentationService] No sub-seg for group … index 1` — no default sub-segmentation is created for the multi-layer group, so the panel never exposes an "Add Segment" or "Brush" button. Pre-migration these passed against real CT data. Tagged Phase 2.7 territory; revisit when the multi-layer-group lifecycle settles.
    - **Signal 10 (A2c off-by-default) deferred**: Cornerstone's wadouri `instance` metadata module does not surface `AcquisitionNumber` for `dicomfile:` image IDs. The A2c branch of `classifyForEligibility` needs both sides to have non-null AcquisitionNumber to distinguish A2c from A2b; with the gap the synthetic fixture classifies as A2b. Fix is a per-imageId AcquisitionNumber metadata provider for the dicomfile scheme, or surfacing it via `dicomwebLoader.orderImageIdsByDicomMetadata` pre-load — both Phase 2.x territory.
    - 09 flag-on (volume mode) — same Phase 1 capability gap originally documented (volume-mode SEG editing).

#### Item 1: full E2E health check (2026-05-01)

Suite ran end-to-end with `--max-failures=999` (the default `maxFailures: 1` had been hiding 11 of 26 specs after the first failure). Result on `multiviewport-annotation` HEAD: **29 / 32 pass, 3 fail**. Each failure was reproduced against `f215bb9` (last main commit before the branch) by replaying the same tests in a `git worktree` against that revision; all three failures are present there with identical failure modes, so all three are pre-existing and **zero Phase 1 regressions** were introduced by the rewrite.

| Spec | Tests | Pass | Pre-existing fail | Phase 1 regression | Notes |
|---|---|---|---|---|---|
| 01-login.e2e.ts | 4 | 4 | 0 | 0 | clean |
| 02-navigation.e2e.ts | 4 | 4 | 0 | 0 | clean |
| 03-image-viewing.e2e.ts | 6 | 6 | 0 | 0 | clean — legacy stack path unaffected |
| 04-annotations.e2e.ts | 5 | 4 | 1 | 0 | "select annotation highlights it" — clicking the `<li>` in the annotation panel never updates `selectedUID`, so the `bg-blue-900` selected class never lands. Selection event flow predates the branch and reproduces on `f215bb9`; not a cheap selector fix. |
| 05-segmentations.e2e.ts | 6 | 5 | 1 | 0 | "click contour, ctrl-c/ctrl-v, undo/redo and interpolation" — paste yields `total=2 / autoGeneratedTotal=0` instead of `19 / 17`. Same failure on `f215bb9`. A targeted fix exists on `fix/contour-paste-interpolation-uid` (`961fb28`) but was never merged to `main`; merging belongs in a separate PR, not this health check. |
| 06-save-upload.e2e.ts | 1 | 0 | 1 | 0 | "upload segmentation to XNAT" — Save button stays `disabled` because the freshly-painted SEG is not flagged dirty. Same on `f215bb9`; pre-dates the Phase 0.5.C autoSave extraction. Real fix needs the dirty-tracking trigger investigated. |
| 07-volume-mode.e2e.ts | 4 | 4 | 0 | 0 | clean |
| 08-volume-mode-acceptance.e2e.ts | 2 | 2 | 0 | 0 | clean |
| **Total** | **32** | **29** | **3** | **0** | |

None of the three pre-existing failures match the cheap-selector-update pattern (cf. `f44ca95`); fixing them requires Cornerstone event-flow / dirty-tracking investigation that is out of scope for Item 1. Each is documented above for follow-up. Phase 2 work is unblocked by this health check (zero regressions).

**Status (2026-05-01, end of Phase 1 work)**: Functional Phase 1 cut behind `multiViewport.enabled`. Volume rendering, shared-volume cache, oriented panels, MPR preset routing, full event surface on VolumeViewport, primary-group CrosshairsTool registration, E2E coverage of the headline signal. Remaining items (performance budget, real DICOM fixtures) are deferred but tracked. Signals 3 / 6 / G7 are all pinned. Phase 2 work (cross-series rendering A2b, single-source-of-truth undo, list-panel UX) can begin without blocking on the deferrals.

### MV-Phase 2: Annotation behavior (Complete)
**Goal:** cross-series rendering, single source of truth, undo, dirty/save. Behind `multiViewport.enabled` flag.

The design's Phase 2 bullet list (design §7.4) compresses two distinct workstreams: (A) FoR/visibility/drawing-routing — self-contained pure-logic + Cornerstone hooks; (B) undo/save coordination — Container-dependent. Sub-phasing makes the dependency explicit so each PR is small and revertable.

#### Workstream A — FoR / visibility / drawing routing

- ✅ **2.1** A2c FoR-eligibility heuristic (`segmentationService/visibility.ts`). Pure-logic classifier `classifyForEligibility(member, viewport) → 'native' | 'cross-series-A2b' | 'cross-series-A2c' | 'cross-FoR'`. Same FoR + different `AcquisitionNumber` → A2c (off by default); same → A2b (on with flag); "when uncertain, prefer A2b." 18 tests.
- ✅ **2.2** `multiViewport.crossSeriesRendering` preference (default `true`). Refined `shouldRenderByDefault` to take `CrossSeriesRenderingPolicy = { enabled, a2cOptedIn }`; A2c stays hidden in Phase 2 (a2cOptedIn=false) until per-container opt-in lands in Phase 3 list panel. 7 new preferences-store tests.
- ✅ **2.3** Visibility metadata adapter + high-level helpers `classifySegmentationOnViewport` / `classifyAnnotationOnViewport` / `isSegmentationRenderableOnViewport` / `isAnnotationRenderableOnViewport`. Adapter is a factory taking 4 lookup deps (`metaData.get`, viewport `getCurrentImageId`, segmentation source-image lookup via `sourceImageTracking`, annotation referencedImageId). Wired into `segmentationService.initialize() / dispose()`. 30 tests.
- ✅ **2.4a** Standalone `styling.ts` module (Phase 2.4 D9 non-native rendering). Pure logic + DI; `resolveAction(eligibility, policy) → reset | apply-cross-series | hide`. Style constants: dashed contour outline (cadence "6,3"), reduced fill alpha for labelmap. **Honest scope note:** Cornerstone's LabelmapStyle has no `outlineDash`, so cross-series labelmaps differentiate via reduced fill opacity alone — dashed outlines apply to contours only. 15 tests.
- ✅ **2.4b** Wire styling via `SEGMENTATION_REPRESENTATION_ADDED` / `_MODIFIED` events + preferencesStore subscription on the cross-series toggle. All gated on `multiViewport.enabled`; legacy path unaffected.
- ✅ **2.5a** B3 drawing-routing block via lock-guard extension. `decideDrawingRouting` returns allow / block-no-FoR-matched / block-cross-FoR / block-cross-series with hint message. Wired into `toolService.installLockGuard` (now takes `viewportId`); console.warn hint placeholder.
- ✅ **2.5b** Visual hint UI for the B3 block. New `viewportHintStore` (Zustand, per-viewport transient hint with TTL-based auto-clear; revision counter prevents stale-clear). New `<ViewportHint>` overlay component mounted on `VolumeViewport` and `CornerstoneViewport`. Lock-guard's block branch now routes the hint message into the store. Inline amber-on-dark, top-center, `pointer-events: none`, fade-in animation. 18 tests (11 store + 7 component).

#### Workstream B — Undo / save coordination (Container-dependent)

The undo + transport work needs a Container abstraction over Cornerstone segmentation/annotation state. The Phase 0 types in `src/renderer/types/annotation.ts` exist, but no segmentation in the running app has a `Container` object — the codebase keys everything off `csSegmentationId`. To make A8 ("undo is per-container") and E2 ("queue-next-save per-container") meaningful subjects, 2.6 must land before 2.7 / 2.8.

- ✅ **2.6** Container-bridge scaffolding (`src/renderer/lib/cornerstone/containerBridge.ts`). Minimal `csSegmentationId → Container` 1:1 lookup with auto-track listener on `SEGMENTATION_ADDED` / `_REMOVED` (no segmentation creation-site changes required). Kind inferred from prefix (`rtstruct_*` → RTSTRUCT, else SEG). Bookkeeping setters (`setDirty`, `setSaveInFlight`, `setVersionToken`) staged for 2.7 / 2.8 consumption. 33 unit tests.
- ✅ **2.7a** `undoService` impl + record-side wiring (passive). Per-container undo/redo stacks with depth cap UNDO_HISTORY_LIMIT (100, oldest dropped first), §A8 cross-container isolation, save-is-not-a-barrier semantics, and explicit `clear()` for E3/H6 reload. `historyMemo.ts` extended to mirror enriched memos into `undoService.record(...)` when the segmentationId resolves through `containerBridge`. Behavior-neutral — dispatch unchanged. 17 unit tests.
- ✅ **2.7b** Dispatch swap. `segmentationService.undo() / .redo() / .getUndoState()` and `refreshUndoState()` prefer `undoService` for the active container; fall back to `DefaultHistoryMemo` only when no container is active (loose annotations / measurements). When containerId is set but undoService has no entries, the dispatch is a no-op rather than reaching into the global ring — preserves §A8 isolation. The lock-block check still consults `DefaultHistoryMemo`'s top entry (same memo lives in both rings during 2.7's transitional period). Full suite: 760 passing.
- ✅ **2.8a** `segmentationService/transport.ts` queue-next-save coordinator (standalone). Per-container state machine (idle / debouncing / saving / saving-pending) implementing §E2: never two concurrent saves; an edit during save sets pending; success → fires queued save immediately, conflict / transient / permanent → preserves dirty + records on transportStore. SaveAdapter DI seam so the actual save target is pluggable. 21 unit tests covering all branches.
- ✅ **2.8b** Wire `transport.notifyDirty(containerId)` into `onSegmentationDataModified` and `onAnnotationAutoSave` alongside the legacy autoSave path, gated on `multiViewport.enabled`. Both pipelines run in parallel during the transitional period — legacy autoSave handles the actual backup; transport records per-container dirty state for the Phase 3 list-panel D7.4 indicators. No SaveAdapter installed yet — the §E2 state machine is exercised but doesn't fire actual saves until a real adapter lands (XNAT integration workstream or Phase 3 list-panel save actions). No new tests in 2.8b — wiring is a one-line `notifyDirty` call; E2E coverage of the wired pipeline lands in 2.9 (signal 14).

**Pre-existing dirty/save bugs to watch for in 2.7 / 2.8** (handed off from the Phase 1 deferred-task agent — don't fix as part of 2.6, but worth knowing for the next phases):
- **`markSegmentationDirty` workaround** at [e2e/specs/10-layout-switching.e2e.ts:399-416 / :543-552](e2e/specs/10-layout-switching.e2e.ts) — after a real brush stroke, `hasUnsavedChanges` does not get set. Suspect: `suppressDirtyTrackingCount` or `loadInProgressCount` is non-zero in test conditions when the brush event arrives ([autoSave.ts:429-440](src/renderer/lib/cornerstone/segmentationService/autoSave.ts#L429-L440)). Same surface as the [06-save-upload.e2e.ts](e2e/specs/06-save-upload.e2e.ts) row above.
- **`nonZeroPixels=0` on `exportToDicomSeg` after a real brush stroke** (flag-off variant; [segmentationService.ts:3868-3884](src/renderer/lib/cornerstone/segmentationService.ts#L3868-L3884)) — brush events fire but no labelmap pixels get written. Plausible: labelmap representation not attached at brush time, or canvas→IJK coord translation goes out-of-bounds. Upstream of bug 1 (no pixels → no dirty event). The volume-mode variant of [09-undo-after-close.e2e.ts:305-317](e2e/specs/09-undo-after-close.e2e.ts#L305-L317) calls out the same gap.

**If 2.7 / 2.8 naturally fixes either**: swap the `markSegmentationDirty(...)` calls in spec 10 for the real brush-induced dirty path and verify Signal 6 still passes. That's the success signal that the container abstraction did the right thing.

**2.7 audit (2026-05-02)**: 2.7a/2.7b touched undoService, historyMemo.ts's record-side wiring, and segmentationService's undo/redo/getUndoState/refreshUndoState dispatch. None of that path crosses autoSave's dirty pipeline or the export's labelmap-pixel pipeline. **Neither bug is fixed by 2.7**; both remain candidates for 2.8 (which explicitly reworks the dirty path via queue-next-save coordination).

**2.8 audit (2026-05-02)**: 2.8b's `transport.notifyDirty` call sits *inside* the existing `if (!isDirtyTrackingSuppressed())` branch in `onSegmentationDataModified` — so when suppression is the bug (the suspect for Bug 1), `transport.notifyDirty` won't fire either; both pipelines stay quiet under the same gate. The new transport coordinator preserves the legacy semantics rather than changing them. **Bug 1 not fixed by 2.8.** Bug 2 (no labelmap pixels written after brush) lives in the brush → labelmap render pipeline, which 2.8 doesn't touch — **also not fixed**. Both bugs are now downstream of all Phase 2 work and need targeted investigation: Bug 1 wants someone to identify why `isDirtyTrackingSuppressed()` returns true during the test's brush stroke (suspect: stale time-based suppression window from a prior load, or a leaked suppression counter); Bug 2 wants someone to confirm whether the labelmap representation is attached at brush time and whether the canvas→IJK transform falls inside the volume extent.

#### E2E acceptance specs

- ✅ **2.9** Service-integration test suite for acceptance signals 9, 10, 11, 12, 14, 15 plus the §A8 cross-viewport identity (G7 stand-in for the Phase 2 container-scoped path). 24 tests in [multiviewport-phase2-integration.test.ts](src/renderer/lib/cornerstone/__tests__/multiviewport-phase2-integration.test.ts) wire the Phase 2 modules together with synthetic metadata + a synthetic SaveAdapter to exercise the full pipeline for each signal. Synthetic metadata is injected through the same DI seams production uses (`wireVisibility`, `transport.setAdapter`, `containerBridge.register`), so these tests exercise the real classify / decideDrawingRouting / resolveAction / queue-next-save / undoService paths — only the metadata source and save target are stubbed. The §8.1 design rule "no mocking of internal services" is preserved.
- ⏳ **Playwright E2E for the same signals** is blocked on the cross-series + breath-hold + cross-FoR DICOM fixtures Phase 1 deferred (see `docs/multiviewport-annotation-design.md` §8.4). The service-integration suite is the regression spine until those fixtures land. When they do, the Phase 1 pattern (one spec per signal in `e2e/specs/`, `data-testid` selectors via `__XNAT_E2E__` hooks) extends naturally.
- ⏳ **A12 stress variant** (handed off from the Phase 1 deferred-task agent): the existing rapid-layout sequence in spec 10 completes in <200 ms with no async loads in flight, so A12's epoch races may not surface at this cadence. A real A12 stress would be 4 panels with real scan loads streaming + layout churn during streaming. Worth landing as a Playwright spec once the cross-series fixtures are available — the container bridge gives a clean place to instrument the cs-attach lifecycle for that test.

#### Acceptance signal coverage matrix (Phase 2 scope)

| Signal | Description | Delivered by | Test layer | Status |
|---|---|---|---|---|
| **1** | Axial draw → sagittal/coronal live update | Phase 1 PolySeg + Phase 2 visibility | E2E ([08-volume-mode-acceptance.e2e.ts](e2e/specs/08-volume-mode-acceptance.e2e.ts)) | ✅ |
| **2** | Two panels on same series, different slice indices | Phase 1 (legacy stack path) | E2E ([03-image-viewing.e2e.ts](e2e/specs/03-image-viewing.e2e.ts)) | ✅ |
| **8** | Click contour in panel A → highlighted in both | Phase 2 (canvas) + Phase 3 (list panel) | partial | ⏳ canvas-canvas selection sync needs viewerStore selection set; list panel = Phase 3 |
| **9** | T1+T2 cross-series with dashed stroke | Phase 2.1/2.2/2.3/2.4 | service-integration ✅ / E2E ⏳ | ⏳ E2E blocked on cross-series fixture |
| **10** | Breath-hold A2c off-by-default | Phase 2.1/2.2/2.3 | service-integration ✅ / E2E ⏳ | ⏳ E2E blocked on breath-hold fixture |
| **11** | Cross-FoR not rendered, list visible | Phase 2.3 | service-integration ✅ / E2E ⏳ | ⏳ E2E blocked on cross-FoR fixture; list panel = Phase 3 |
| **12** | Drawing block on non-native viewport + hint | Phase 2.5a/2.5b | service-integration ✅ / E2E ⏳ | ⏳ E2E blocked on cross-series fixture |
| **14** | Queue-next-save through rapid edits | Phase 2.8a/2.8b | service-integration ✅ / E2E ⏳ | ⏳ E2E needs SaveAdapter wired to real backup |
| **15** | Undo past save re-dirties container | Phase 2.7a/2.7b + Phase 2.8 | service-integration ✅ / E2E ⏳ | ⏳ E2E needs real save action |
| **G7** | Undo after panel close (cross-viewport identity) | Phase 1 (flag-off) + Phase 2.7 (flag-on path) | E2E ([09-undo-after-close.e2e.ts](e2e/specs/09-undo-after-close.e2e.ts), `test.fixme` for flag-on) + service-integration ✅ | ⏳ flag-on E2E pending volume-labelmap brush capability gap |

Signals 3, 4, 5, 6, 7 are covered by Phase 1 (volume-mode E2E + pre-existing legacy specs). Signals 13, 16, 17, 18, 19, 20, 21, 22 are Phase 3+ scope.

**Honest cliff edges remaining at end of Phase 2**:
- Three DICOM fixtures (cross-series same-FoR pair, breath-hold pair, cross-FoR CT+MR) gate the full Playwright coverage of signals 9-12.
- The dirty/save bugs flagged by the deferred-task agent ([Workstream B handoff notes](#) above) survive Phase 2 — both are downstream of the suppression / brush-pixel-write paths Phase 2 intentionally didn't refactor.
- D9 labelmap dashed-outline limitation: Cornerstone's LabelmapStyle has no `outlineDash`, so cross-series labelmaps differentiate via fill-alpha alone (documented at the top of [styling.ts](src/renderer/lib/cornerstone/segmentationService/styling.ts)).
- A2c per-container opt-in is hardcoded `false` until Phase 3 list-panel work wires the user toggle.
- Save action: transport.ts has no SaveAdapter installed yet — §E2 state machine is exercised but doesn't fire actual saves until the XNAT integration workstream or Phase 3 list-panel save actions wire one.
- ⏳ Signals 9 (T1+T2 cross-series with dashed stroke), 10 (breath-hold A2c off-by-default), 11 (different FoR, list visible but no canvas render) **need fixtures Phase 1 deferred** (`e2e/fixtures/dicom/cross-series` and `breath-hold-pair`). Service-integration coverage with synthetic metadata is the stand-in until fixtures land.
- ⏳ Signal 8 (canvas selection sync) is partial — Phase 2 can deliver canvas-canvas sync via a global selection set; full signal needs Phase 3 list panel hover/click sync (D7.8).

**Status (2026-05-02, end of Phase 2 work)**: Workstream A complete (2.1 → 2.5b). Workstream B complete (2.6 container-bridge, 2.7 undoService impl + dispatch swap, 2.8 transport queue-next-save coordinator + wiring). 2.9 service-integration coverage of acceptance signals 9-15 + §A8 G7 stand-in landed; full Playwright E2E for signals 9-12 blocked on cross-series + breath-hold + cross-FoR fixtures (deferred from Phase 1). Test suite at 805 passing (was 610 at end of Phase 1). All commits behind `multiViewport.enabled`; legacy path verified unaffected by Phase 1 health check (Item 1 above). Phase 3 (list panel) can begin without blocking on the deferred items.

### MV-Phase 3: List panel (In progress)
**Goal:** D7 fully realized. Container + member hierarchy with rich per-row metadata, selection / active model, visibility-mode cycling, hover sync, approval workflow, ROI type editing, provenance indicators, multi-select bulk operations. Behind `multiViewport.enabled` flag; legacy AnnotationListPanel + SegmentationPanel remain mounted under flag-off until Phase 6.

Sub-phase plan (similar shape to Phase 2):

- ✅ **3.1** `containerService` impl — read methods (getActiveContainer / getActiveMember / getApprovalHistory) + metadata mutations (renameContainer / approveContainer / revokeApproval). All operate on the bridge's Container summary state with no Cornerstone interaction. Member CRUD + container create/delete still throw with phase pointers (Phase 3.2 / 3.6 / 3.8 lights up each). 33 unit tests.
- ✅ **3.2a** `useContainerStore` Zustand + bridge change-notification surface. `containerBridge.subscribe(listener)` is the additive API; every bridge mutation (register / unregister / setDirty / setSaveInFlight / setVersionToken / clearAll) and every containerService rename / approve / revoke surfaces in the store as an immutable shallow-copy snapshot. Idempotent setters early-out with no listener notification when value didn't change. 15 sync tests.
- ✅ **3.2b** Cornerstone segment → Member auto-sync. `containerStoreSync` now subscribes to `SEGMENTATION_ADDED` / `SEGMENTATION_MODIFIED` and rebuilds `Container.members[]` from `csSegmentation.state.getSegmentation(csSegId).segments`. Member identity (id + createdAt) preserved across rebuilds when segmentIndex is unchanged. SEG defaults to 'filled' visibility, RTSTRUCT to 'outlined' (per §D7.3). 12 additional tests.
- ✅ **3.3** `ContainerListPanel` component shell. Hierarchy renderer (container row → member rows). Per-row visuals: kind badge (RTSTRUCT/SEG/POI), name, dirty marker, approved badge, color swatch, visibility-mode glyph (○/◐/●), locked indicator. Mounts when `multiViewport.enabled` (alongside legacy panels during the transitional period). 11 component tests.
- ✅ **3.4** Visibility-mode 3-state cycling (D7.3). New `segmentationService/memberVisibility.ts` with `resolveMemberStyle` / `nextVisibilityMode` / `applyMemberVisibilityMode` (per-segment style override + per-viewport per-segment visibility). `containerService.setMemberVisibility(memberId, mode)` mutates bridge + applies through to Cornerstone; does NOT mark dirty (visibility is session-only per §D7.10). ContainerListPanel's eye-icon glyph is now a clickable button cycling filled → outlined → hidden → filled. 21 new tests (11 module + 6 service + 4 component).
- ✅ **3.5a** Selection set + activeMember + row click handlers (D7.5). New `containerSelectionStore` (Zustand) with `activeMemberId` + `selectionSet` + `hoverMemberId` separate from viewerStore. `containerService.setActiveMember(memberId)` impl mirrors to legacy `useSegmentationStore` for tool compatibility. ContainerListPanel rows: single-click selects, shift/ctrl multi-selects, double-click activates+selects, color-swatch click activates without changing selection. Visual: blue bg for selected, amber ring for active. 28 new tests (18 store + 4 service + 6 component).
- ✅ **3.5b** Row hover wiring. mouseEnter/mouseLeave write `hoverMemberId` to the selection store. Hovered rows get distinct styling (`bg-zinc-800/60`); selection takes precedence over hover. The reciprocal canvas-side hover (canvas → row, hover-on-canvas emphasizes the matching row) is staged for a follow-on — requires touching Cornerstone tool internals which is its own design effort. 4 new component tests.
- ✅ **3.6** Member CRUD + per-member action menu. `containerService.createMember / deleteMember / renameMember / recolorMember` wired through `segmentationService.addSegment / removeSegment / renameSegment / setSegmentColor` via the wireContainerService DI seam. Each marks the container dirty (per A9). createMember is async (addSegment is); the rest are synchronous. ContainerListPanel rows now have a "⋯" action-menu button → popover with Rename / Delete. Rename swaps the name span for an inline `<input>` with Enter-submit / Escape-cancel / blank-noop / same-name-noop semantics. Delete prompts via window.confirm before calling deleteMember (Phase 3.8 swaps in a styled dialog). Outside-click closes the popover. 30 new tests (16 service + 14 component).
- ✅ **3.7a** Filter / search by member name (D7.7). Non-destructive substring filter; containers with no matching members hide; "No matches" placeholder; clear button. 9 component tests.
- ✅ **3.7b** A2c per-container opt-in toggle (§A2c, §D11). Adds `Container.a2cOptedIn: boolean` (default false) and `containerService.setA2cOptedIn(containerId, optedIn)`. Styling pipeline's `StylingDeps.readPolicy` signature widened to `(segmentationId) => Policy` so the per-container opt-in can be resolved via the bridge. `cornerstoneStylingDeps` now reads it from `containerBridge.getContainer(...)?.a2cOptedIn`. `segmentationService` subscribes to bridge changes and re-applies styling for the affected container's (segmentation, viewport) pairs whenever `a2cOptedIn` (or any other Container field) flips. Per-container "A2c" pill button on each container row (orange when on, dim when off) lights up the Phase 2.2 hardcoded false. Session-only — does NOT mark dirty per §D7.10. 5 service tests + 5 component tests.
- ✅ **3.7c** Sort options (D7.7). Dropdown next to filter input — Creation order (default, matches §B7 Z-order), Alphabetical, Segment index. Sort is presentation-only — does NOT mutate `Container.members[]`. Composes with filter (filter narrows, sort orders the survivors). Each container is sorted independently. 7 component tests. Parse-error / loading states (D7.9) deferred — `Container.parseError` is in the type but no transport-side path populates it yet (XNAT integration workstream).
- ⏳ **3.8** Approval workflow UI (D7.11) — approve / revoke confirm dialogs; container-level edit-lock when approved. ROI type badge + inline edit (D7.2 RTSTRUCT-specific). Provenance indicators (D7.2). E2E for signals 18, 19, 20, 22.

**Status (2026-05-03, in progress)**: data layer + UI shell + visibility cycling + selection model + row hover + member CRUD + action menu + filter/search + A2c opt-in toggle landed (3.1 → 3.7b). Test suite at 976 passing. Legacy panels still mount under flag-off; ContainerListPanel mounts alongside under flag-on for verification. Outstanding sub-phases: 3.7c (sort + parse-error / loading states), 3.8 (approval UI + ROI type + provenance + E2E for signals 18/19/20/22), and the bidirectional canvas ↔ row hover sync (Phase 3.5b reciprocal — staged as its own follow-on because it requires Cornerstone tool internals).

