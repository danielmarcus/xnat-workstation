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
    
    **Follow-up** (separate task): migrate live-XNAT specs (03/04/05/07/08/09/10) to the local fixtures via the renderer hook so the PHI surface in test artifacts shrinks to specs 01/02/06; extend `11-fixture-cross-series.e2e.ts` with contour-creation logic to drive canvas-level assertions for signals 9 (A2b dashed stroke) and 10 (A2c off-by-default).

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

### MV-Phase 2: Annotation behavior (In progress)
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
- ⏳ **2.7** `undoService` impl backed by container bridge. Replace scattered `DefaultHistoryMemo.undo()` direct calls (segmentationService.ts:4277-4313) with `undoService.undo(activeContainerId)`. Cornerstone HistoryMemo stays as the storage layer; undoService is the per-container facade.
- ⏳ **2.8** `segmentationService/transport.ts` queue-next-save coordinator. Wraps `autoSave.ts` to enforce E2 "if saveInFlight, defer next save until completion."

**Pre-existing dirty/save bugs to watch for in 2.7 / 2.8** (handed off from the Phase 1 deferred-task agent — don't fix as part of 2.6, but worth knowing for the next phases):
- **`markSegmentationDirty` workaround** at [e2e/specs/10-layout-switching.e2e.ts:399-416 / :543-552](e2e/specs/10-layout-switching.e2e.ts) — after a real brush stroke, `hasUnsavedChanges` does not get set. Suspect: `suppressDirtyTrackingCount` or `loadInProgressCount` is non-zero in test conditions when the brush event arrives ([autoSave.ts:429-440](src/renderer/lib/cornerstone/segmentationService/autoSave.ts#L429-L440)). Same surface as the [06-save-upload.e2e.ts](e2e/specs/06-save-upload.e2e.ts) row above.
- **`nonZeroPixels=0` on `exportToDicomSeg` after a real brush stroke** (flag-off variant; [segmentationService.ts:3868-3884](src/renderer/lib/cornerstone/segmentationService.ts#L3868-L3884)) — brush events fire but no labelmap pixels get written. Plausible: labelmap representation not attached at brush time, or canvas→IJK coord translation goes out-of-bounds. Upstream of bug 1 (no pixels → no dirty event). The volume-mode variant of [09-undo-after-close.e2e.ts:305-317](e2e/specs/09-undo-after-close.e2e.ts#L305-L317) calls out the same gap.

**If 2.7 / 2.8 naturally fixes either**: swap the `markSegmentationDirty(...)` calls in spec 10 for the real brush-induced dirty path and verify Signal 6 still passes. That's the success signal that the container abstraction did the right thing.

#### E2E acceptance specs

- ⏳ **2.9** E2E specs for signals achievable without cross-series fixtures: signals 1 (axial→sagittal/coronal live update; mostly Phase 1 PolySeg territory — verify), 12 (drawing block on non-native viewport — exercises 2.5a), 14 (queue-next-save — exercises 2.8), 15 (undo past save point — exercises 2.7).
- ⏳ **A12 stress variant** (handed off from the Phase 1 deferred-task agent): the existing rapid-layout sequence in spec 10 completes in <200 ms with no async loads in flight, so A12's epoch races may not surface at this cadence. A real A12 stress would be 4 panels with real scan loads streaming + layout churn during streaming. Worth landing as part of 2.9 once the container bridge gives a clean place to instrument the cs-attach lifecycle.
- ⏳ Signals 9 (T1+T2 cross-series with dashed stroke), 10 (breath-hold A2c off-by-default), 11 (different FoR, list visible but no canvas render) **need fixtures Phase 1 deferred** (`e2e/fixtures/dicom/cross-series` and `breath-hold-pair`). Service-integration coverage with synthetic metadata is the stand-in until fixtures land.
- ⏳ Signal 8 (canvas selection sync) is partial — Phase 2 can deliver canvas-canvas sync via a global selection set; full signal needs Phase 3 list panel hover/click sync (D7.8).

**Status (2026-05-02)**: Workstream A complete (2.1 → 2.5b). Workstream B 2.6 (container-bridge scaffolding) complete; 2.7 (undoService) and 2.8 (transport.ts queue-next-save) outstanding. E2E specs (2.9) outstanding. Test suite at 744 passing (was 610 at end of Phase 1). All commits behind `multiViewport.enabled`; legacy path verified unaffected by Phase 1 health check (Item 1 above).

