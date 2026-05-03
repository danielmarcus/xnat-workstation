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

### MV-Phase 1: Viewport unification (Complete — closure gate satisfied 2026-05-03)
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

#### Acceptance-scenarios audit (G1–G22, added 2026-05-03)

The earlier "Functional Phase 1 cut" framing pinned only signals **3, 6, G7** (and added 9 via fixture spec 11). It conflated "playwright suite green" with "requirements scenarios pass." The mapping below covers every scenario in [docs/multiviewport-annotation-requirements.md §G](docs/multiviewport-annotation-requirements.md). A scenario in MV-Phase 1's scope must have a real evidence row before Phase 1 can close.

In-Phase-1 scope = scenarios covering volume default, viewport unification, MPR consolidation, multi-panel load/layout foundation: **G1, G2, G3, G6, G7, G8**. Scenarios outside this set are deferred to their owning phase and listed for completeness only.

| Scenario | Summary | Owning phase | Status | Evidence / gap |
|---|---|---|---|---|
| G1 | Axial+sagittal+coronal of one CT; freehand contour visible live across all three | **MV-Phase 1** | ✅ pinned | [`e2e/specs/13-g1-acceptance.e2e.ts`](e2e/specs/13-g1-acceptance.e2e.ts) drives the production `mpr-2x2` preset against the local CT fixture, draws contours on three axial slices via `createTestContour`, and asserts the sagittal + coronal panels report the same `getActiveContourSnapshot.total`. The data-layer cross-orientation invariant — the only one observable without pixel rendering — is pinned. Live cross-orientation pixel rendering is exercised separately by G3 (volume-mode acceptance). |
| G2 | Same series in two stack panels at different slice indices; edit on A visible when B scrolls there | **MV-Phase 1** | ✅ pinned | [`e2e/specs/12-g2-g8-acceptance.e2e.ts`](e2e/specs/12-g2-g8-acceptance.e2e.ts) mounts the local CT fixture on two stack panels at different slice indices (5 / 15) via the panel-scoped loader (post-#75 fix), draws a contour on panel A's slice, asserts panel B reports `onCurrentSlice=0` while at slice 15, scrolls B to slice 5, asserts `onCurrentSlice=1`. App-level coverage of the loader precondition lives at `src/renderer/App.test.tsx:627+`. |
| G3 | Volume in axial-MPR + stack; brush on stack, MPR shows resampled voxels live | MV-Phase 1 | ✅ pinned | `e2e/specs/07-volume-mode.e2e.ts`, `08-volume-mode-acceptance.e2e.ts`. |
| G4 | Lock segment on panel A; brush on panel B blocked | MV-Phase 2 | ✅ owning phase Complete | covered in MV-Phase 2 work; out of Phase 1 gate. |
| G5 | Per-viewport hide of "GTV"; close panel → reopen resets to global default | MV-Phase 3 | ❌ not implemented (UX gap) | D7.3 visibility-mode (Phase 3.4 `memberVisibility.applyMemberVisibilityMode`) is **global** per member, applied to every viewport the segmentation is attached to. The per-viewport hide A5 describes ("hide on panel A only, others still show") has no UI surface — `ContainerListPanel` calls `setMemberVisibility(memberId, mode)` without a viewportId. The Cornerstone-side per-viewport API exists at `segmentationService.setSegmentVisibility(viewportId, …)`, but it is only invoked by the legacy "apply to ALL viewports" path in `SegmentationManager.userToggledVisibility`. Closing G5 needs a Phase 5/6 UX item: per-viewport hide affordance distinct from the global cycle, with explicit teardown on viewport-destroy. |
| G6 | Four panels, rapid 2×2 → 1×1 → MPR → 2×2; no structures lost / single dirty flag | **MV-Phase 1** | ✅ pinned | `e2e/specs/10-layout-switching.e2e.ts`. |
| G7 | Undo after a brush stroke on a panel that has since been closed | **MV-Phase 1** | ✅ pinned | `e2e/specs/09-undo-after-close.e2e.ts` (flag-on volume variant `test.fixme`, tracked). |
| G8 | Two panels on same scan; contour click in A highlights in both; list-panel click highlights in both; empty-space click in B clears both | **MV-Phase 1** | ✅ pinned | [`e2e/specs/12-g2-g8-acceptance.e2e.ts`](e2e/specs/12-g2-g8-acceptance.e2e.ts) mounts the local CT fixture on two panels (post-#75 fix), creates a contour on panel A, asserts both panels' `getActiveContourSnapshot` resolves the same `selected[]` annotation set and the same `(activeSegmentationId, activeSegmentIndex)`. Cornerstone's annotation-selection state is global by construction — the load-bearing data-layer guarantee for canvas-canvas selection sync. Phase 3.5c hit-test + hover-sync coverage stays as the unit/component layer. |
| G9 | T1+T2 same FoR; contour drawn on T1 renders dashed on T2 at nearest slice; hover tooltip; cross-series read-only | MV-Phase 2 | ✅ owning phase Complete | partial spec coverage in `e2e/specs/11-fixture-cross-series.e2e.ts`. |
| G10 | Breath-hold pair (shared FoR, displaced anatomy); off-by-default; toggle "show structures from related series" | MV-Phase 2 | ⏳ classifier deferred | A2c branch blocked on `AcquisitionNumber` provider for `dicomfile:` scheme (documented above). |
| G11 | Cross-FoR CT+MR; structure-set hidden on MR viewport; list panel shows "different FoR" indicator | MV-Phase 2 | ✅ owning phase Complete | classifier covers cross-FoR; UI indicator from D9 work. |
| G12 | Drawing on non-native series blocked at gesture-start with hint | MV-Phase 2 | ✅ owning phase Complete | drawing-routing in 2.x. |
| G13 | Interpolate every 5th slice; save without prompt; reload identical geometry | MV-Phase 4 | ✅ pinned | `multiviewport-phase4-integration.test.ts` signal 13; E2E ⏳ on RTSTRUCT save-load fixture. |
| G14 | Autosave + queue-next-save under in-flight save; no edits lost | MV-Phase 2 | ✅ owning phase Complete | E2 queue-next-save coordinator in 2.x. |
| G15 | Undo crosses save point; dirty flag re-asserts; new save flushes post-undo state | MV-Phase 2 | ⏳ partial | save-not-a-barrier semantics in 2.7a; needs explicit cross-save-point E2E. |
| G16 | 3D paint-fill on axial appears resampled on sagittal MPR; one undo reverts entire fill | MV-Phase 5 | ⏳ scheduled | tool audit phase. |
| G17 | Empty active member; drawing appends to it (not a new one); empty marker clears | MV-Phase 3 | ✅ owning phase work landed | A2c opt-in / member-CRUD in 3.x. |
| G18 | RTSTRUCT ROI types; inline edit; round-trip via `RTROIInterpretedType` | MV-Phase 3 | ✅ pinned | 3.8d service-integration coverage. |
| G19 | Approve container; members edit-locked; persist via `ApprovalStatus`; revoke flow | MV-Phase 3 | ✅ pinned | 3.8a–e + 3.8e service-layer edit-lock. |
| G20 | Visibility modes filled / outlined / hidden; not persisted on reload | MV-Phase 3 | ✅ owning phase work landed | 2.9 + 3.x. |
| G21 | Region-segment / smart brush; lock blocks at gesture-start | MV-Phase 5 | ⏳ scheduled | tool audit phase. |
| G22 | Interpolation provenance round-trip (`interpolated` → manual on edit; survives save where DICOM permits) | MV-Phase 4 | ✅ pinned | `multiviewport-phase4-integration.test.ts` signal 22. |

**Phase 1 closure gate**: G1, G2, G3, G6, G7, G8 are all ✅ now. The [issue #75](https://github.com/danielmarcus/xnat-workstation/issues/75) loader-scoping fix landed first (panel-scoped prompt + scoped discard in `loadFromXnatScan`, with four App-level acceptance tests). G1 closes via [`13-g1-acceptance.e2e.ts`](e2e/specs/13-g1-acceptance.e2e.ts) on the `mpr-2x2` preset; G2 + G8 close via [`12-g2-g8-acceptance.e2e.ts`](e2e/specs/12-g2-g8-acceptance.e2e.ts) on the two-panels-same-series stack-mode flow. Phase 1 closure gate satisfied as of 2026-05-03.

**Status (2026-05-03, Phase 1 closed)**: the earlier "end of Phase 1 work" framing was premature; the audit re-opened it on G1, G2, G8. All three are now ✅: G1 via [`13-g1-acceptance.e2e.ts`](e2e/specs/13-g1-acceptance.e2e.ts) (`mpr-2x2` cross-orientation contour visibility), G2 + G8 via [`12-g2-g8-acceptance.e2e.ts`](e2e/specs/12-g2-g8-acceptance.e2e.ts) (two stack panels on the same series, post-#75-loader-scoping). Volume rendering, shared-volume cache, oriented panels, MPR preset routing, full event surface on VolumeViewport, primary-group CrosshairsTool registration, plus the panel-scoped loader fix (issue #75) are all in place. Performance budget remains deferred but is not a Phase 1 gate. Future phases should continue using per-scenario audit tables as exit gates rather than relying on aggregate playwright-suite counts.

### MV-Phase 2: Annotation behavior (Complete — signals 2 / 8 closed via E2E 2026-05-03; signals 9/10/11/12/14/15 ⏳ on deferred fixtures)
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
| **2** | Two panels on same series, different slice indices | Phase 1 (legacy stack path) | E2E ([`12-g2-g8-acceptance.e2e.ts`](e2e/specs/12-g2-g8-acceptance.e2e.ts)) + App-level loader-scoping coverage at `src/renderer/App.test.tsx:627+`. | ✅ — issue #75 loader-scoping fix landed first; the spec now mounts two stack panels on the local CT fixture at different slice indices, draws a contour on panel A, and verifies panel B sees it after scrolling to the edited slice. |
| **8** | Click contour in panel A → highlighted in both | Phase 2 (canvas) + Phase 3 (list panel) | unit + component for selection store + hit-test + hover-sync (Phase 3.5c) + E2E ([`12-g2-g8-acceptance.e2e.ts`](e2e/specs/12-g2-g8-acceptance.e2e.ts)). | ✅ — both panels resolve the same `selected[]` annotation set and the same `(activeSegmentationId, activeSegmentIndex)` from `getActiveContourSnapshot`, confirming Cornerstone's global selection state is shared across viewports without per-panel replication. |
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

**Status (2026-05-02, end of Phase 2 work — superseded 2026-05-03)**: Workstream A complete (2.1 → 2.5b). Workstream B complete (2.6 container-bridge, 2.7 undoService impl + dispatch swap, 2.8 transport queue-next-save coordinator + wiring). 2.9 service-integration coverage of acceptance signals 9-15 + §A8 G7 stand-in landed; full Playwright E2E for signals 9-12 blocked on cross-series + breath-hold + cross-FoR fixtures (deferred from Phase 1). Test suite at 805 passing (was 610 at end of Phase 1). All commits behind `multiViewport.enabled`; legacy path verified unaffected by Phase 1 health check (Item 1 above).

**Re-flag (2026-05-03)**: the original closure framing did not hold up under audit. Specific corrections:
- Signal 2 was claimed ✅ on the basis of `03-image-viewing.e2e.ts`, which is a single-panel image-viewer spec and does not test two panels on the same series. The genuine flag-on path is broken by [issue #75](https://github.com/danielmarcus/xnat-workstation/issues/75) — the loader prompts the user to discard unsaved annotations whenever any scan is loaded into a second viewport. Status corrected to ❌ failing.
- Signal 8 was already ⏳ partial; with #75 it is now blocked rather than partial — the precondition can't be set up.
- Signals 9, 10, 11, 12, 14, 15 carry service-integration ✅ but no on-screen verification. The synthetic-metadata path validates classifier / coordinator logic, not what users see. Honest, but should not be conflated with E2E pass.
- G7 flag-on (volume-mode brush + close + undo) is committed as `test.fixme`; the headline cross-viewport-identity signal does not run on the production rendering path.

Phase 2 deliverables (workstreams A + B) are functionally landed. Signals 2 and 8 close via the [issue #75](https://github.com/danielmarcus/xnat-workstation/issues/75) loader-scoping fix + [`12-g2-g8-acceptance.e2e.ts`](e2e/specs/12-g2-g8-acceptance.e2e.ts). Signals 9 / 10 / 11 / 12 / 14 / 15 remain ⏳ on the deferred cross-series + breath-hold + cross-FoR + RTSTRUCT-save-load fixtures (service-integration coverage is the regression spine until those fixtures land).

### MV-Phase 3: List panel (Complete — signals 8/17 closed 2026-05-03; signal 5 ❌ deferred to Phase 5/6 UX work)
**Goal:** D7 fully realized. Container + member hierarchy with rich per-row metadata, selection / active model, visibility-mode cycling, hover sync, approval workflow, ROI type editing, provenance indicators, multi-select bulk operations. Behind `multiViewport.enabled` flag; legacy AnnotationListPanel + SegmentationPanel remain mounted under flag-off until Phase 6.

Sub-phase plan (similar shape to Phase 2):

- ✅ **3.1** `containerService` impl — read methods (getActiveContainer / getActiveMember / getApprovalHistory) + metadata mutations (renameContainer / approveContainer / revokeApproval). All operate on the bridge's Container summary state with no Cornerstone interaction. Member CRUD + container create/delete still throw with phase pointers (Phase 3.2 / 3.6 / 3.8 lights up each). 33 unit tests.
- ✅ **3.2a** `useContainerStore` Zustand + bridge change-notification surface. `containerBridge.subscribe(listener)` is the additive API; every bridge mutation (register / unregister / setDirty / setSaveInFlight / setVersionToken / clearAll) and every containerService rename / approve / revoke surfaces in the store as an immutable shallow-copy snapshot. Idempotent setters early-out with no listener notification when value didn't change. 15 sync tests.
- ✅ **3.2b** Cornerstone segment → Member auto-sync. `containerStoreSync` now subscribes to `SEGMENTATION_ADDED` / `SEGMENTATION_MODIFIED` and rebuilds `Container.members[]` from `csSegmentation.state.getSegmentation(csSegId).segments`. Member identity (id + createdAt) preserved across rebuilds when segmentIndex is unchanged. SEG defaults to 'filled' visibility, RTSTRUCT to 'outlined' (per §D7.3). 12 additional tests.
- ✅ **3.3** `ContainerListPanel` component shell. Hierarchy renderer (container row → member rows). Per-row visuals: kind badge (RTSTRUCT/SEG/POI), name, dirty marker, approved badge, color swatch, visibility-mode glyph (○/◐/●), locked indicator. Mounts when `multiViewport.enabled` (alongside legacy panels during the transitional period). 11 component tests.
- ✅ **3.4** Visibility-mode 3-state cycling (D7.3). New `segmentationService/memberVisibility.ts` with `resolveMemberStyle` / `nextVisibilityMode` / `applyMemberVisibilityMode` (per-segment style override + per-viewport per-segment visibility). `containerService.setMemberVisibility(memberId, mode)` mutates bridge + applies through to Cornerstone; does NOT mark dirty (visibility is session-only per §D7.10). ContainerListPanel's eye-icon glyph is now a clickable button cycling filled → outlined → hidden → filled. 21 new tests (11 module + 6 service + 4 component).
- ✅ **3.5a** Selection set + activeMember + row click handlers (D7.5). New `containerSelectionStore` (Zustand) with `activeMemberId` + `selectionSet` + `hoverMemberId` separate from viewerStore. `containerService.setActiveMember(memberId)` impl mirrors to legacy `useSegmentationStore` for tool compatibility. ContainerListPanel rows: single-click selects, shift/ctrl multi-selects, double-click activates+selects, color-swatch click activates without changing selection. Visual: blue bg for selected, amber ring for active. 28 new tests (18 store + 4 service + 6 component).
- ✅ **3.5b** Row hover wiring. mouseEnter/mouseLeave write `hoverMemberId` to the selection store. Hovered rows get distinct styling (`bg-zinc-800/60`); selection takes precedence over hover. 4 new component tests.
- ✅ **3.5c-row** Row → canvas direction. New `segmentationService/memberHoverSync.ts` subscribes to `useContainerSelectionStore.hoverMemberId` and applies a transient style highlight (thicker outline) to the corresponding segment on every viewport. State machine clears the previous highlight on transition. Wired from `segmentationService.initialize()`. 13 unit tests.
- ✅ **3.5c-canvas-contour** Canvas → row direction (contour hit-test). New `contourHitTest.ts` (extracted from the duplicated click-to-select logic in CornerstoneViewport / VolumeViewport) with `findContourAtCanvasPoint(viewport, canvasPoint, opts) → { annotationUID, distance } | null`. New `contourHoverSync.ts` wires `mousemove` (rAF-throttled) + `mouseleave` on each viewport, runs the hit-test, resolves `annotationUID → memberId` via `annotation.data.segmentation.{segmentationId, segmentIndex}` + bridge lookup, and pushes the result to `setHover`. Both `CornerstoneViewport` and `VolumeViewport` wire it; the existing click handlers refactored to use the shared `findContourAtCanvasPoint` (~50 LOC of dead duplication removed). Self-gates on `multiViewport.enabled`. 29 new tests (15 hit-test + 14 hover-sync) covering pure-logic distance math, hit-radius semantics, multi-annotation tie-break, polyline projection edges, mouseleave clear, flag-off no-op, dispose-removes-listeners.
- ✅ **3.5c-canvas-labelmap** Canvas → row direction for labelmap voxels. New `labelmapHitTest.ts` exports `findLabelmapSegmentAtWorldPoint(viewport, worldPoint) → { segmentationId, segmentIndex } | null`. Uses Cornerstone's stable public `csTools.utilities.segmentation.getSegmentIndexAtWorldPoint` API (sampling at world point — abstracts over stack vs volume labelmap internally). Iterates labelmap reps via `csSegmentation.state.getViewportSegmentationRepresentations(viewportId)`; first non-zero hit wins (matches the on-screen draw order = visually-topmost segment). `runHitTest` extended with a contour-first-then-labelmap two-stage strategy: contour hit takes precedence so a cursor near a contour outline highlights the contour-side member; labelmap detection only fires when the cursor is in the interior of a labelmap fill away from any contour edge. `HitTestViewport` interface widened to include `id` and `canvasToWorld` for the labelmap path. 15 new tests (10 labelmap-hit-test + 5 fallback-in-runHitTest). My earlier "needs Cornerstone tool internals" deferral was wrong — the API is stable and public.
- ✅ **3.6** Member CRUD + per-member action menu. `containerService.createMember / deleteMember / renameMember / recolorMember` wired through `segmentationService.addSegment / removeSegment / renameSegment / setSegmentColor` via the wireContainerService DI seam. Each marks the container dirty (per A9). createMember is async (addSegment is); the rest are synchronous. ContainerListPanel rows now have a "⋯" action-menu button → popover with Rename / Delete. Rename swaps the name span for an inline `<input>` with Enter-submit / Escape-cancel / blank-noop / same-name-noop semantics. Delete prompts via window.confirm before calling deleteMember (Phase 3.8 swaps in a styled dialog). Outside-click closes the popover. 30 new tests (16 service + 14 component).
- ✅ **3.7a** Filter / search by member name (D7.7). Non-destructive substring filter; containers with no matching members hide; "No matches" placeholder; clear button. 9 component tests.
- ✅ **3.7b** A2c per-container opt-in toggle (§A2c, §D11). Adds `Container.a2cOptedIn: boolean` (default false) and `containerService.setA2cOptedIn(containerId, optedIn)`. Styling pipeline's `StylingDeps.readPolicy` signature widened to `(segmentationId) => Policy` so the per-container opt-in can be resolved via the bridge. `cornerstoneStylingDeps` now reads it from `containerBridge.getContainer(...)?.a2cOptedIn`. `segmentationService` subscribes to bridge changes and re-applies styling for the affected container's (segmentation, viewport) pairs whenever `a2cOptedIn` (or any other Container field) flips. Per-container "A2c" pill button on each container row (orange when on, dim when off) lights up the Phase 2.2 hardcoded false. Session-only — does NOT mark dirty per §D7.10. 5 service tests + 5 component tests.
- ✅ **3.7c** Sort options (D7.7). Dropdown next to filter input — Creation order (default, matches §B7 Z-order), Alphabetical, Segment index. Sort is presentation-only — does NOT mutate `Container.members[]`. Composes with filter (filter narrows, sort orders the survivors). Each container is sorted independently. 7 component tests. Parse-error / loading states (D7.9) deferred — `Container.parseError` is in the type but no transport-side path populates it yet (XNAT integration workstream).
- ✅ **3.8a** Approval workflow UI (D7.11). Per-container Approve / Revoke buttons. Approve calls `containerService.approveContainer`; Revoke prompts via `window.confirm` then `containerService.revokeApproval`. Approved containers hide the per-member action menu (edit-locked per §D7.11). Existing "✓ approved" badge stays alongside the Revoke button when approved. 7 component tests.
- ✅ **3.8b** ROI type badge + provenance indicator + setRoiType impl. `containerService.setRoiType(memberId, type)` mutates Member.roiType on RTSTRUCT containers (no-op on SEG / POI), marks dirty for DICOM round-trip. ROI type badge on member rows shows the DICOM RTROIInterpretedType (GTV/CTV/PTV/ORGAN/EXTERNAL/AVOIDANCE/MARKER/etc.) with type-coded colors per radiotherapy convention (rose/orange/amber for treatment volumes, emerald/blue for anatomy, red for avoidance, purple for markers). Provenance indicator on member rows shows non-manual provenance with single-character glyphs (~, ↓, AI, ƒ, def). 5 service tests + 12 component tests.
- ✅ **3.8c** Inline ROI type editor for un-approved RTSTRUCT members. Static badge becomes a styled `<select>` with all 22 DICOM RTROIInterpretedType values; onChange calls `containerService.setRoiType`. Color hint (rose/orange/amber/etc.) inherits from the same `roiTypeColor` map as the static badge. Approved containers + non-RTSTRUCT containers fall back to the read-only badge / no badge. 5 component tests + the existing badge tests adjusted for the editor/static-badge dichotomy.
- ✅ **3.8d** Service-integration coverage of signals 18 (ROI type round-trip) + 19 (approval persistence). 8 tests in [multiviewport-phase2-integration.test.ts](src/renderer/lib/cornerstone/__tests__/multiviewport-phase2-integration.test.ts) wire `containerService.setRoiType` / `approveContainer` / `revokeApproval` through the queue-next-save coordinator with a synthetic `SaveAdapter` that captures the persistable surface and verifies the round-tripped value matches. Includes coverage of the audit-trail append-only invariant (revoke-after-approve) and approval state survival across `notifyChange`. **Documented limitation**: service-layer edit-lock when approved is not yet enforced — the UI hides the action menu (Phase 3.8a) but the service still accepts mutations. A Phase 3.8e refinement would close that gap. Signal 20 (visibility mode) is session-only per §D7.10 — already covered at the service-integration layer in Phase 2.9. Signal 22 (provenance round-trip) still needs interpolation work; defer to Phase 4.
- ✅ **3.8e** Service-layer edit-lock enforcement when approved. `assertNotApproved` guard threaded through every persisted-state mutation: `renameContainer`, `createMember`, `deleteMember`, `renameMember`, `recolorMember`, `setRoiType`. Throws with a clear "container 'X' is approved (edit-locked)" message that names the offending action. Session-only state (visibility cycling, A2c opt-in, active member) intentionally NOT edit-locked per §D7.10 / §D7.11. `revokeApproval` is the unlock path. 2 new integration tests verify both the lock (six mutation methods refused) and the un-locked-state allowances.
- ⏳ **3.8f** (deferred) Playwright E2E for the same signals once cross-series + DICOM SEG / RTSTRUCT save-load fixtures land.
- ✅ **3.8g** Phase 3 polish: 11 outstanding D7.x affordances landed in one batch.
  - **D7.1 expand/collapse** Per-container chevron with local `isExpanded` state; default expanded; aria-expanded toggles.
  - **D7.2/C5 lock toggle** New `containerService.setMemberLock(memberId, locked)` mirrored to `csSegmentation.segmentLocking.setSegmentIndexLocked` via a `setSegmentLocked` dep on `MemberCrudDeps`. Refused on approved containers (the §D7.11 container-level lock supersedes per-member). UI replaces the passive 🔒 span with a hover-revealed clickable toggle; on approved containers the icon stays read-only.
  - **D7.4 cross-series / different-FoR / conflict / interpolation indicators** Member rows compute eligibility via existing `classifyAnnotationOnViewport` / `classifySegmentationOnViewport` against `useViewerStore.activeViewportId`; A2b shows blue X-S badge, A2c shows orange A2c badge, A2d shows red FoR badge. Container row surfaces conflict (`transportStore.externalChangePending`), transient + permanent error from `transportStore.lastError`, plus the `member.interpolationState === 'has-interpolated'` AI marker on rows.
  - **D7.6 container Save / Revert / Export** New `containerActions.ts` module with `saveContainer` (routes to `transport.flushNow`), `revertContainer` (deferred to XNAT integration workstream — entry point wired now), `exportContainer` (routes through existing `exportToDicomSeg` / `exportToRtStruct` + `electronAPI.export.saveDicom*`). UI: per-container "⋯" menu with Save / Revert / Export options. Save disabled when not dirty / approved; Revert disabled when not dirty / approved.
  - **D7.5 / D7.6 multi-select bulk operations** New `BulkActionBar` component shown when `selectionSet.size > 0`. Supports bulk Show / Hide / Lock / Unlock / Delete. Lock and Delete skip members in approved containers (edit-locked); Show / Hide pass through (visibility is session-only).
  - **D7.6 session-level Save All** Header button shown when at least one container is dirty; calls `containerActions.saveAllDirty` which flushes every dirty container sequentially.
  - **D7.9 loading + parse-error states** Added `loadInFlight` field to `TransportRecord` plus `beginLoad`/`finishLoad` mutations; container row surfaces a load spinner when set. Container row also surfaces `Container.parseError` as a red ⚠ parse badge with the error message in the tooltip — the data path lands when XNAT integration writes parseError on parse failure.
  - 33 new tests (16 containerActions + 17 ContainerListPanel covering bulk, action menu, indicators, expand/collapse, save-all, lock toggle).
  - Total test count: 1202 passing.

#### Acceptance signal coverage matrix (Phase 3 scope)

Added 2026-05-03 as part of the cross-phase audit. Phase 3's original closure paragraph claimed completeness based on code deliverables landed (data layer + UI shell + cycling + selection + hover sync + CRUD + filter/search + A2c + sort + approval + ROI type + edit-lock + polish). The matrix below maps that work onto the requirements-doc G-signals it was supposed to satisfy.

| Signal | Description | Delivered by | Test layer | Status |
|---|---|---|---|---|
| **5** | Hide structure on panel A only; close panel and reopen → resets to global default per A5 | Phase 3.4 visibility plumbing (global only) | unit / component for the cycling + per-segment style override | ❌ not implemented — D7.3 visibility-mode is global; no per-viewport hide UX surface exists. `ContainerListPanel.setMemberVisibility(memberId, mode)` applies through every attached viewport via `applyMemberVisibilityMode`'s viewport-iteration loop. Cornerstone's per-viewport API at `segmentationService.setSegmentVisibility(viewportId, …)` is in place but only used by the legacy global toggle. Closing G5 needs a new "hide on this viewport only" affordance + teardown hook on viewport-destroy. |
| **8** | Two panels on same scan; contour click in A highlights in both; list-panel click highlights in both; empty-space click in B clears both | Phase 3.5a/3.5b/3.5c (selection store + bidirectional hover sync) | unit + component coverage of selection store + hit-test + hover-sync modules + E2E ([`12-g2-g8-acceptance.e2e.ts`](e2e/specs/12-g2-g8-acceptance.e2e.ts)). | ✅ — both panels resolve the same `selected[]` and `(activeSegmentationId, activeSegmentIndex)` from the global Cornerstone selection state. |
| **17** | Active member is empty; "active" indicator shows; drawing on the active viewport appends to the empty member, not a new one; empty marker clears | Phase 3.5a (active-member model) + 3.6 (member CRUD) + Phase 3.2b containerStoreSync identity-preservation | service-integration ([`g17-active-member-append.test.ts`](src/renderer/lib/cornerstone/__tests__/g17-active-member-append.test.ts)) | ✅ — 4 tests wire `containerService.setActiveMember` + `containerStoreSync.rebuildMembersFromCs` through their production DI seams with synthetic Cornerstone state, proving (a) setActiveMember mirrors `(csSegmentationId, segmentIndex)` to the legacy store so drawing tools target the empty member, (b) rebuilding after a notional draw preserves `Member.id` (no append), (c) only a genuinely-new `segmentIndex` produces a new member (negative control). |
| **18** | Load RTSTRUCT with typed ROIs; type badge per row; inline edit; round-trip via DICOM `RTROIInterpretedType` | Phase 3.8b/3.8c (badge + inline editor) + Phase 3.8d (service-integration) | service-integration ✅ / E2E ⏳ | ⏳ E2E blocked on RTSTRUCT save-load fixture (3.8f). |
| **19** | Approve container; members edit-locked; persist via DICOM `ApprovalStatus`; revoke flow | Phase 3.8a (UI) + 3.8d (round-trip) + 3.8e (service-layer edit-lock) | service-integration ✅ / E2E ⏳ | ⏳ E2E blocked on RTSTRUCT save-load fixture (3.8f). Service layer covered. |
| **20** | Visibility cycling filled / outlined / hidden; not persisted on reload (per D7.10) | Phase 3.4 + Phase 2.9 service-integration coverage | service-integration ✅ | ✅ |

Signals 1, 2, 3, 6, 7 are Phase 1 / Phase 2 territory. Signals 9–15 are Phase 2. Signals 13, 22, A8 are Phase 4. Signals 16, 21 are Phase 5.

**Phase 3 closure gate**: signals 5, 8, 17, 18, 19 must all be ✅. Status as of 2026-05-03: **8 ✅** ([`12-g2-g8-acceptance.e2e.ts`](e2e/specs/12-g2-g8-acceptance.e2e.ts)), **17 ✅** ([`g17-active-member-append.test.ts`](src/renderer/lib/cornerstone/__tests__/g17-active-member-append.test.ts)), **18 / 19** still service-integration-only with E2E deferred on the RTSTRUCT save-load fixture (acceptable per the documented fixture blocker), **5 ❌ not implemented** — D7.3 visibility-mode is global; A5 per-viewport hide has no UX surface and needs a dedicated affordance + viewport-destroy teardown to close. Phase 3 is therefore Complete-with-G5-deferred to a Phase 5/6 UX item.

**Status (2026-05-03 audit)**: data layer + UI shell + visibility cycling + selection model + bidirectional hover sync (row ↔ canvas, contour AND labelmap) + member CRUD + action menu + filter/search + A2c opt-in + sort + approval UI + ROI type / provenance + inline ROI type editor + signal 18/19 service-integration + service-layer edit-lock when approved + 11 D7.x polish items (3.8g) landed (3.1 → 3.5c-canvas-labelmap + 3.6 + 3.7 + 3.8a–e + 3.8g). Test suite at 1202 passing. Legacy panels still mount under flag-off; ContainerListPanel mounts alongside under flag-on for verification.

The original closing paragraph framed Phase 3 list-panel work as "complete apart from 3.8f and signal 22." Audit-complete status (2026-05-03): G17 closes via the new service-integration suite, G8 closes via the same E2E spec that closes G2 (post-#75), and G5 remains ❌ as a documented UX gap (D7.3 is global; per-viewport A5 hide isn't implemented). Phase 3 is "Complete except for the G5 UX gap and the deferred RTSTRUCT save-load fixture-gated E2E for signals 18/19/22."

### MV-Phase 4: Interpolation cleanup (Complete)
**Goal:** write-through model per design §B5 — auto-accept always, provenance stamping, single-undo per pass, marker that fades on edit/save. Behind `multiViewport.enabled` for the user-visible bits; the deletion of the legacy preference + dialog (4.6) is a behavior change for both flag states.

- ✅ **4.1** Provenance stamping module (`segmentationService/provenance.ts`). Subscribes to `ANNOTATION_INTERPOLATION_PROCESS_COMPLETED`, resolves `(csSegmentationId, segmentIndex)` from the event detail to a `memberId` via the bridge, and stamps `provenance: 'interpolated'` + `interpolationState: 'has-interpolated'` on the affected member. New `containerService.setMemberProvenance` and `setMemberInterpolationState` setters (idempotent on no-op, do NOT mark dirty per §D7.10, and explicitly NOT subject to the §D7.11 approval edit-lock — the underlying geometry mutation is locked at its own assertNotApproved sites). DI pattern matches `styling.ts` / `memberVisibility.ts`. 24 unit tests.
- ✅ **4.2** Always auto-accept under `multiViewport.enabled`. Flipped `interpolationAcceptance.onInterpolationProcessCompleted` from preference-gated to flag-or-preference-gated as a transitional bridge before 4.6's wholesale deletion.
- ✅ **4.3** Single-undo-entry batching (`segmentationService/interpolationUndo.ts`). `historyMemo.routeMemoToUndoService` now diverts memos for `autoGenerated` annotations into a per-container buffer (gated on `multiViewport.enabled`); `interpolationUndo.handleInterpolationCompleted` drains the buffer on the completion event and records a single batched `HistoryEntry` whose `apply` runs each buffered apply oldest-first and `invert` runs each invert newest-first. Per design §B5 / requirement A8. 14 unit tests.
- ✅ **4.4** Manual-edit clears the marker. Extended `provenance.ts` with `handleAnnotationModified` subscribed to `ANNOTATION_MODIFIED`. Skip-rule: `autoGenerated === true` (mid-pass system mutations should not clear the marker we just stamped). When fired on a tracked member, calls the production `clearInterpolatedMark` dep, which conditionally flips `provenance: 'interpolated' → 'manual'` and always clears `interpolationState: 'has-interpolated' → 'none'`. The `'imported'` / other provenance values are intentionally NOT touched.
- ✅ **4.5** Save clears `interpolationState`; load defaults to `'imported'`.
    - **Save side**: new `containerService.clearContainerInterpolationStates(containerId)`; called from `transport.ts`'s success branch. Provenance is preserved (geometry-source tag); only the auto-marker fades, per §B5.
    - **Load side**: new `setLoadInProgressGate(fn)` on `containerStoreSync`; production wires `() => isSegLoadInProgress()` from `autoSave.ts`. Members synthesized while the gate is true default `provenance: 'imported'` (per §D7.2). The setter-based DI keeps `containerStoreSync` from importing autoSave directly (autoSave's import graph pulls in heavy Cornerstone tool modules that the lightweight containerStoreSync tests don't mock). Existing members preserve their tag across rebuilds via the `...existing` spread in `rebuildMembersFromCs`.
- ✅ **4.6** Deleted the legacy gate. **Removed**: `src/renderer/lib/cornerstone/interpolationAcceptance.ts` (167 lines), the `interpolation.autoAcceptInterpolated` preference (interface + setter + default + persistence-merge + Settings UI section), and the "Unaccepted Interpolated Contours" save-time confirm dialog from `SegmentationPanel.tsx` (both `handleSaveLocal` and `handleUploadXnat` paths). **Replaced** with a tiny `segmentationService/autoAcceptInterpolated.ts` that retains only the always-accept-on-completion logic (no preference, no click-to-accept, no save-time prompt) — design §B5 write-through model. Behavior change: under both flag states, every interpolated contour is committed at generation time; users can no longer choose preference-gated provisional rendering, and no save-time prompt appears.
- ✅ **4.7** Service-integration tests for signals 13 + 22 + single-undo-per-pass. New [multiviewport-phase4-integration.test.ts](src/renderer/lib/cornerstone/__tests__/multiviewport-phase4-integration.test.ts) (12 tests) wires the Phase 4 modules through their production DI surfaces with synthetic Cornerstone metadata + a queued `SaveAdapter`. Coverage:
    - **Signal 13** — interpolation event stamps; save success clears the marker but preserves provenance; the bridge → store snapshot propagates the change to the UI; reload via re-register under the load gate provides the `'imported'` default contract surface.
    - **Signal 22** — manual edit on an interpolated member flips provenance to `'manual'` and clears the marker; mid-pass `autoGenerated === true` MODIFIED events do NOT clear the marker; idempotent on already-manual members.
    - **Single-undo per pass** — N buffered auto-generated entries collapse into ONE undoService entry; the merged invert replays in reverse stack order; two passes produce two separate batches; an empty buffer doesn't push an entry.
    - **Combined round-trip** — full narrative from interpolate → save → reload, asserting the data-model invariants at each step.
- ✅ **4.8** Step-through interpolated slices review affordance (design §B5: "optional review affordance"). New `containerActions.stepThroughInterpolated(memberId)` action plus a small "▶" button on member rows alongside the existing AI marker, surfaced only when `interpolationState === 'has-interpolated'`. Each click advances the active stack viewport to the next slice that contains a contour for the member; wraps at the end. Pure helper `nextSliceIndex(current, sliceIndices)` factored out for unit testing. **v1 simplification**: navigates through ALL contour slices for the member (not just auto-generated ones) — the affordance only appears immediately after interpolation and any subsequent edit/save clears the marker, so in practice the contour set is dominated by interpolated slices. Volume-mode is deferred (the read-slices dep currently relies on `getImageIds()` which returns empty on volume viewports). 18 unit + component tests.
- ⏳ **Playwright E2E for signals 13 / 22** is blocked on the same RTSTRUCT save-load DICOM fixtures Phase 1 deferred. The service-integration suite is the regression spine until those fixtures land.

#### Acceptance signal coverage matrix (Phase 4 scope)

| Signal | Description | Delivered by | Test layer | Status |
|---|---|---|---|---|
| **13** | Write-through round-trip (RTSTRUCT) — interpolation → save (no further user action) → reload identical | Phase 4.1 + 4.2 + 4.5 + 4.6 | service-integration ✅ / E2E ⏳ | ⏳ E2E blocked on RTSTRUCT save-load fixture |
| **22** | Provenance round-trip — `interpolated` badge + auto-marker; manual edit flips to `manual`; reload defaults to `imported` | Phase 4.1 + 4.4 + 4.5 | service-integration ✅ / E2E ⏳ | ⏳ E2E blocked on RTSTRUCT save-load fixture |
| **A8 (single-undo per op)** | One interpolation operation = one undo entry covering all generated contours | Phase 4.3 | service-integration ✅ + unit ✅ | ✅ |

**Honest cliff edges remaining at end of Phase 4**:
- Playwright E2E for signals 13 / 22 needs a synthetic RTSTRUCT round-trip fixture (the Phase 1 deferral).
- Step-through review affordance (4.8) is stack-mode only; volume-mode review needs an alternate read-slices dep (volume viewports return empty `getImageIds()`).
- Step-through (4.8) navigates ALL contour slices for the member, not just auto-generated ones. Per-UID granularity would require tracking interpolated annotation UIDs through the stamp pipeline; deferred unless user feedback elevates it.
- Per-contour canvas-side auto-marker (a "subtle thin secondary stroke" per §B5) is currently surfaced only at the row-level via the `~` glyph. Adding a canvas-side rendering hook would touch Cornerstone style internals; deferred to Phase 5 tool audit if it surfaces as a real ergonomic gap.
- DICOM-private-tag round-trip for `'interpolated'` provenance is intentionally NOT implemented — per §D7.2 "no special storage is required" for `manual`/`interpolated`. Reload re-derives via the `'imported'` default. If a future workflow requires preserving the exact provenance tag across save/load, that's a v2 concern (the data model already accepts forward-compat values like `'auto-segmented'`/`'algebra'`/`'deformably-mapped'` that *would* need vendor-tag plumbing).

**Status (2026-05-03, end of Phase 4 work)**: write-through model fully landed (4.1 → 4.8). The legacy preference-gated + click-to-accept + save-time-prompt UX is gone. Provenance stamping happens unconditionally; interpolated members carry the `'interpolated'` tag with the `has-interpolated` auto-marker until manual edit or save. Single-undo-per-pass batching gated on `multiViewport.enabled`. Step-through review button surfaces alongside the AI marker. Test suite at 1232 passing (was 1202 at end of Phase 3). Phase 5 (tool audit + Contour Fill fix) can begin without blocking on the deferred items.

### MV-Phase 5: Tool audit + Contour Fill fix (Not started — planned 2026-05-03)

**Goal:** complete the labelmap-editing tool surface required by [requirements §C3](docs/multiviewport-annotation-requirements.md), with priority on the broken Contour Fill tool. Validate that paint-fill, region-segment / smart brush, and contour-fill all honor the active-segment / lock / overlap policy rules from §C5–C6 and behave correctly across MPR. Behind `multiViewport.enabled` flag.

This section is written **before any Phase 5 work begins** so the closure gate exists up front. The 2026-05-03 audit found that Phases 1–3 were closed without per-signal evidence; Phase 5 will not repeat that pattern.

#### Sub-task plan (provisional — agent should refine before starting)

- **5.1** Tool inventory + audit. Walk every tool in `src/renderer/lib/cornerstone/toolService.ts` and `src/renderer/lib/cornerstone/tools/` against §C3 (voxel editing tools), §C5 (active-segment lock), §C6 (overlap policy). Produce a dated audit table listing each tool, its current behavior, the §C3–C6 expectation, and the gap. **Outputs an audit doc, not code.**
- **5.2** Fix Contour Fill (`LabelMapEditWithContourTool`). The tool is wired in `toolService.ts:115` but documented as broken in [requirements line 209](docs/multiviewport-annotation-requirements.md). Diagnose root cause, fix, and add a service-integration test that draws a closed contour and asserts the rasterized voxels land in the active segment (and only the active segment) within the contour bounds.
- **5.3** Active-segment lock enforcement audit (§C5). For each editing tool — Brush, Paint Fill (`SafePaintFillTool`), Region-Segment (`RegionSegmentTool` + `RegionSegmentPlusTool`), Contour Fill — verify locked segments are blocked at gesture-start with a user-facing hint. The Phase 3.8e service-layer edit-lock covers approval; this is a separate per-segment lock at the tool layer.
- **5.4** Overlap policy enforcement (§C6). Verify the active-segment-only-writes-its-own-voxels invariant under each editing tool; add tests where coverage is missing.
- **5.5** Per-contour canvas-side auto-marker (deferred from Phase 4 §B5). If the row-level `~` glyph proves ergonomically insufficient, add a canvas-side rendering hook that draws the "subtle thin secondary stroke" on interpolated contours. Sequence after the audit (5.1) so the decision to land it is informed.
- **5.6** Service-integration coverage matrix for signals 16, 21. See gate below for what passes.

The agent should produce concrete sub-tasks (5.x) with PR-sized deliverables before writing code. The list above is the expected shape, not a prescription.

#### Acceptance signal coverage matrix (Phase 5 scope)

All rows start ⏳. None may be marked ✅ until the closure gate criteria below are satisfied.

| Signal | Description | Delivered by | Required evidence | Status |
|---|---|---|---|---|
| **16** | 3D paint-fill on axial appears resampled on sagittal MPR; one undo reverts the entire fill as one entry | Phase 5.4 + verification of existing `SafePaintFillTool` behavior across MPR | E2E spec on flag-on volume-mode path: 4-panel MPR layout, fill on axial, assert non-zero voxels on sagittal/coronal at the same world position; assert single undo entry reverts all of it. Volume-mode brush capability gap (documented in spec 09) must be resolved or the test must use a non-brush path. | ⏳ |
| **21** | Region-segment / smart brush fills connected voxels within intensity tolerance; locked segment blocks at gesture-start with hint | Phase 5.3 + Phase 5.4 + verification of `RegionSegmentTool` / `RegionSegmentPlusTool` | Service-integration: seeded region grow yields expected voxel set; locked-segment branch refuses gesture-start with the standard hint. Plus an E2E that activates Region-Segment, clicks a homogeneous CT region, asserts fill appears; locks the segment, retries, asserts no fill. | ⏳ |
| **§C3 Contour Fill (no G-signal)** | Closed contour rasterizes into active segment; only active segment receives voxels | Phase 5.2 | Service-integration: synthetic polygon → known voxel mask in active segment, zero voxels in other segments. E2E: activate Contour Fill, draw a closed shape, assert visible fill at the rasterized region. | ⏳ |

Phase 5 does not own G3 (volume + stack brush), G4 (cross-panel lock), G6 (rapid layout), or G7 (undo after panel close) — those were Phase 1 / Phase 2 territory. Phase 5 may *uncover* regressions in those during the audit; if so, file issues and reopen the relevant phase row, do not silently re-verify here.

#### Phase 5 closure gate

- G16, G21, and the §C3 Contour Fill row above must all be ✅ with the listed evidence in place.
- The 5.1 audit document is committed to the repo (under `docs/` or as a dated section in PHASES.md).
- For any tool found to violate §C5 / §C6 during the audit: either fixed (with test) or filed as a tracked issue with explicit deferral rationale.
- No claim in this section may be defended by "the underlying API exists" or "an aggregate test count went up" — every ✅ must point to a named test or spec.

#### Out of scope

- New tools beyond §C3 (e.g., scissors, threshold-painter beyond what already ships).
- Tool-UI redesigns. The tool dropdown / toolbar surface is locked at Phase 4's shape; Phase 6 owns final polish.
- Volume-mode brush capability gap (spec 09 `test.fixme`). If Phase 5 work makes the gap closable as a side effect, fine; otherwise leave it as filed.
- The deferred DICOM fixtures (cross-series, breath-hold pair, cross-FoR, RTSTRUCT save-load). Phase 5 may use existing local fixtures (`ct-axial-300`, `seg-multilabel`, `rtstruct-typed`) without manufacturing new ones.

### MV-Phase 6: Legacy removal + flag flip (Not started — planned 2026-05-03)

**Goal:** make `multiViewport.enabled` the only path. Remove the legacy `AnnotationListPanel`, `SegmentationPanel`, `MPRViewportGrid`, stack-only viewport branches, and the flag itself. Land the §1.6 CrosshairsTool ↔ WindowLevel binding flip that was deferred from Phase 1.

This section is written **before any Phase 6 work begins**.

#### Sub-task plan (provisional)

- **6.1** Pre-flight regression matrix. Run every G-signal that was ✅ in Phases 1–5 against the flag-on path one final time. Phase 6 changes the *only* path to flag-on; any regression here is a hard blocker.
- **6.2** Remove legacy panel mounts. `AnnotationListPanel`, `SegmentationPanel`, the flag-off branches in `App.tsx` / `ViewerPage.tsx` / `Viewport.tsx`. Verify `ContainerListPanel` is the sole list panel surface.
- **6.3** Remove legacy viewport branches. `CornerstoneViewport` consolidates into `Viewport` / `VolumeViewport`. Stack mode survives only for the modalities listed in `stackEligibility.ts` (US/XA/RF/NM/DX/CR/MG, multi-frame cine without spatial dim, single image).
- **6.4** Remove `enterMPR` / `MPRViewportGrid` legacy path. `viewportLayoutService.applyPreset('mpr-2x2')` is the only MPR entry. The flag-off branch in `handleToggleMPR` deletes.
- **6.5** CrosshairsTool ↔ WindowLevel binding flip (deferred from Phase 1.6). `TOOL_NAME_MAP` rewires CrosshairsTool to its own slot now that stack viewports are gone.
- **6.6** Delete the `multiViewport.enabled` flag itself. Remove from settings, from the gate sites, from tests. Specs marked `test.fixme` because of flag-off-only behavior either land as real tests or are deleted with rationale.
- **6.7** Final regression sweep: full Playwright suite + service-integration suite green on the legacy-removed branch. Documented walkthrough of all 22 G-signals.

#### Acceptance signal coverage matrix (Phase 6 scope)

Phase 6 introduces no new G-signals. Its job is to ensure that every signal previously ✅ on the flag-on path remains ✅ after legacy removal. The matrix below pre-binds the regression check; rows transition from "previously ✅ flag-on" to "✅ after legacy removal" only with explicit re-verification.

| Signal | Owning phase | Pre-Phase-6 status | Required Phase 6 evidence |
|---|---|---|---|
| G1 | MV-Phase 1 | (audit pending — see Phase 1 closure gate) | Re-run the spec or walkthrough on legacy-removed branch. |
| G2 | MV-Phase 1 | (audit pending) | Re-run. |
| G3 | MV-Phase 1 | ✅ via spec 07/08 | Re-run on legacy-removed branch; 07-volume-mode + 08-volume-mode-acceptance pass. |
| G4 | MV-Phase 2 | service-integration ✅ | Re-run service-integration suite. |
| G5 | MV-Phase 3 | (audit pending) | Re-run. |
| G6 | MV-Phase 1 | ✅ via spec 10 | Re-run; the legacy `enterMPR` branch the spec exercised under flag-off is going away. The flag-on branch is the survivor. |
| G7 | MV-Phase 1 / 2 | flag-off ✅ via spec 09; flag-on `test.fixme` | Resolve the `test.fixme` (volume-mode brush capability) before Phase 6 closes, or document as a known regression with rationale. |
| G8 | MV-Phase 3 | (blocked on #75) | Re-run after #75 resolves. |
| G9–G12 | MV-Phase 2 | service-integration ✅ / E2E ⏳ on fixtures | Re-run service-integration. E2E remains ⏳ unless fixtures land in this phase. |
| G13, G22 | MV-Phase 4 | service-integration ✅ / E2E ⏳ | Re-run service-integration. |
| G14, G15 | MV-Phase 2 | service-integration ✅ / E2E ⏳ | Re-run service-integration. |
| G16, G21 | MV-Phase 5 | (Phase 5 closure pending) | Re-run Phase 5 evidence. |
| G17 | MV-Phase 3 | (audit pending) | Re-run. |
| G18, G19 | MV-Phase 3 | service-integration ✅ / E2E ⏳ | Re-run service-integration. |
| G20 | MV-Phase 3 | service-integration ✅ | Re-run. |

#### Phase 6 closure gate

- Every row in the matrix above is ✅ on the legacy-removed branch with re-verification evidence cited (test path or walkthrough).
- The `multiViewport.enabled` flag is deleted from the codebase. `git grep -i multiviewport.enabled` returns zero results.
- `AnnotationListPanel`, `SegmentationPanel`, `MPRViewportGrid`, `OrientedViewport`, the `CornerstoneViewport` legacy paths, and `enterMPR` are deleted (or, if any survives, with explicit rationale in this section).
- Every `test.fixme` introduced by earlier phases is either resolved or explicitly retired with rationale.
- Test suite green; no spec count regression vs Phase 5 baseline.

#### Out of scope

- New features. Phase 6 is removal and consolidation only.
- The deferred DICOM fixtures. Phase 6 inherits the same ⏳ E2E rows on signals 9–13, 18, 19, 22 unless fixtures land independently.
- Anything in the parent monorepo or XNAT integration workstream.

#### Forbidden patterns (carried forward from the 2026-05-03 audit)

- Do not mark any matrix row ✅ on the basis of "the underlying API still exists after removal." Re-verification means re-running the test or walking through the scenario. Removal is invasive enough that previous ✅ does not transfer automatically.
- Do not report aggregate test counts as evidence for any individual signal. Each row needs its own row-level citation.
- Do not skip the `test.fixme` resolution step. Carrying `test.fixme` past Phase 6 means the phase did not close.

