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
- ⏳ **Acceptance — signal 6** (rapid layout switching: 2x2 → 1x1 → MPR → 2x2 with no structures lost): substantial workflow test requiring helpers for layout-toggle + edit interleaving. Deferred to a follow-up commit.
- ⏳ **Acceptance — signal G7** (undo after a brush stroke made on a panel that's been closed): requires test infrastructure for panel-close + undo-stack inspection. Deferred to a follow-up commit.
- ⏳ **Acceptance — performance budget** (4-panel CT load ≤ baseline + 30%): needs an instrumented E2E + comparison run. Deferred.
- ⏳ **Local DICOM fixtures** (e2e/fixtures/dicom/): harness landed (loader + 9 unit tests for discovery), real fixtures pending source-data anonymization or pull from a public test set.

**Status (2026-05-01, end of Phase 1 work)**: Functional Phase 1 cut behind `multiViewport.enabled`. Volume rendering, shared-volume cache, oriented panels, MPR preset routing, full event surface on VolumeViewport, primary-group CrosshairsTool registration, E2E coverage of the headline signal. Remaining items (signals 6 / G7 / performance, real DICOM fixtures) are deferred but tracked. Phase 2 work (cross-series rendering A2b, single-source-of-truth undo, list-panel UX) can begin without blocking on these deferrals.

### MV-Phase 2+: see docs/multiviewport-annotation-design.md §7
