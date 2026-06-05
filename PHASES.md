# XNAT Workstation — Development Phases

> **Current focus:** the **Multi-Viewport Annotation Rebuild** — restarting from scratch on branch `annotation-cleanup`. The historical product phases 0–12 below are complete/in-progress as marked. The active rebuild and its own phase plan live in the **Active Work** section (after Phase 12); its phase numbers are scoped to the rebuild and are distinct from the product phases here. Specs are in `docs/`.

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
- **Deferred:** Undo/redo and contour-to-labelmap conversion — now folded into the Multi-Viewport Annotation Rebuild (see Active Work below): per-container undo lands in Rebuild Phase 2; representation conversion is handled by PolySeg.

## Phase 11: Save to XNAT (Superseded → Annotation Transport workstream)

> Now driven by [`docs/annotation-xnat-integration-requirements.md`](docs/annotation-xnat-integration-requirements.md) and contracted via section H of the rebuild requirements. The bullets below remain the target capability set; the rebuild's transport workstream is how they land. Note: per-container, debounced, silent autosave with queue-next-save is the decided model (rebuild requirements E2 / design §3.4).

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

## Active Work: Multi-Viewport Annotation Rebuild

> **Status: restarting from scratch.** The earlier multi-viewport annotation attempt (prior `multiviewport-annotation` branch) is being discarded. This workstream rebuilds coherent multi-viewport handling of **structures (RTSTRUCT)**, **segmentations (SEG)**, and **measurements (DICOM-SR)** starting from the pre-rewrite app, against the refined specs in `docs/`. **No implementation has landed yet on `annotation-cleanup`** — only the specs and this plan.
>
> **Specs (authoritative):**
> - [`docs/multiviewport-annotation-requirements.md`](docs/multiviewport-annotation-requirements.md) — functional requirements + 27 acceptance signals (authoritative for behavior).
> - [`docs/multiviewport-annotation-design.md`](docs/multiviewport-annotation-design.md) — architecture, data model, service layout, phasing (§7).
> - [`docs/multiviewport-annotation-architecture.md`](docs/multiviewport-annotation-architecture.md) — layering contract, enforced boundaries, current→target migration map, component architecture (authoritative for structure).
> - [`docs/multiviewport-annotation-current.md`](docs/multiviewport-annotation-current.md) — pre-rewrite baseline audit.
> - [`docs/annotation-xnat-integration-requirements.md`](docs/annotation-xnat-integration-requirements.md) — transport workstream (the old Phase 11), contracted via requirements §H.
> - [`docs/multiviewport-annotation-gaps.md`](docs/multiviewport-annotation-gaps.md) — **spec gap audit (2026-06-05)**: behaviors with no acceptance signal, transport stubs that block Phase 3, and existing app features the rebuild is silent on (regression risk). Work through §4 before/during Phase 0–3.
>
> The phase numbers below are **scoped to this rebuild** and are distinct from the historical product phases 0–12 above. Each phase ships behind the `multiviewport.enabled` flag until verified; tests land in the same PR (design §0.5, §8).
>
> **Why this restarts, and the per-phase gate:** the prior attempt failed because tests were green while the app was broken. The fix is binding test discipline (design §8.0): signals authored as **red** tests first, **red-before-green** on every test, **visual** assertions against an agreed mockup, **no mocked Cornerstone / no skipped acceptance tests**, **vertical slices** (each PR moves a signal end-to-end). A phase is done only when its signals are green as functional tests, all previously-green signals still pass, and a **manual visual checkpoint with proof** is attached to the PR.

### Rebuild Phase 0 — Preparation (Not started)
- Validate PolySeg `^4.16.1` against known open regressions; pin a known-good version.
- Land the data-model types (`Container` / `Member` / `SourceIdentity`; kinds `RTSTRUCT` / `SEG` / `SR`) in `src/renderer/types/annotation.ts`; wire into stores as **additions only** (no deletions yet).
- Decompose `segmentationService.ts` (5614 lines) and `toolService.ts` (1047 lines) by **pure extraction** — no logic change.
- Skeletons (no consumers): `containerService`, `undoService`, `viewportLayoutService`, `transportStore`.
- **Layering contract + ESLint enforcement** (architecture doc §2): boundary zones wired into `lint`/`ci.yml` from day one; current violations quarantined as tracked `BOUNDARY-DEBT`; produce `docs/multiviewport-annotation-architecture.md` (done).
- Add feature flag `multiviewport.enabled` (default off).
- **Test harness up front (binding — design §8.0):** build the `e2e/fixtures/` DICOM datasets (incl. `ct-axial-anatomy`) — fixtures are a Phase 0 **exit gate**; author all **27 acceptance signals as failing E2E tests** (full suite, red); **walking skeleton** — drive one signal fully green through the real stack (Electron + Cornerstone + real fixture) to validate the harness.
- **Fully-specified UI mockup (design §8.8)** produced and agreed as the visual acceptance reference — gates Phase 3. ✅ **DONE — frozen & user-approved 2026-06-05** ([`docs/mockup/annotations-panel.html`](docs/mockup/annotations-panel.html) + state matrix [`docs/multiviewport-annotation-mockup.md`](docs/multiviewport-annotation-mockup.md)). Covers **both** the Annotations side panel (§1–§9) **and** the top toolbar (§10) — both are **pixel-match requirements** for §8.0. Drove several rounds of review; specs (requirements/design/transport) updated to match the agreed UI.
- **Acceptance:** app builds, runs, looks identical; existing tests pass; new types compile; the 27 signals exist as red tests; the walking-skeleton signal is green; fixtures + mockup in place.

### Rebuild Phase 1 — Viewport unification (Not started)
- Volume (`ORTHOGRAPHIC`) is the default for volumetric data; stack reserved for the non-volumetric predicate (volume mode is **not** user-selectable for volumetric data).
- `(scanId, FoR)` volume sharing, reference-counted in `volumeService`.
- Collapse `OrientedViewport` + `CornerstoneViewport` into one `Viewport`; delete `mprService` / `mprToolService` / `MPRViewportGrid` / `MPRViewport`; MPR becomes a layout preset; one tool group; `CrosshairsTool` moved in.
- **Acceptance:** signals 3, 6, 7 (with flag on); signal 1 lights up via PolySeg + volume default.

### Rebuild Phase 2 — Annotation behavior (Not started)
- FoR-eligibility (A2a/b/c/d); **A2c defaults to *show* when uncertain** — `AcquisitionNumber` difference alone never hides.
- Non-native rendering style (dashed stroke / hatch fill); drawing routing + gesture-start blocking.
- Per-container undo via `undoService` (viewport-independent, bounded-delta); queue-next-save; silent debounced autosave.
- **Acceptance:** signals 1, 2, 8, 9, 10, 11, 14, 15, 23 (contour copy/paste); signal-12 block logic verified at the service layer (full E2E in Rebuild Phase 3).

### Rebuild Phase 3 — List panel (Not started)
- Container + member hierarchy; per-row metadata; 3-state visibility; lock; active vs. selection; cross-series / different-FoR / interpolated / empty markers.
- Approval workflow (persistent, DICOM `ApprovalStatus`); filter / search / sort; hover sync; empty / loading / parse-error states.
- Session actions: create new structure-set / SEG / **measurement (SR)**; load from XNAT; save all.
- **Acceptance:** signals 4, 5, 8, 12 (full E2E), 17, 18, 19, 20, 22.

### Rebuild Phase 4 — Interpolation cleanup (Not started)
- Delete `interpolationAcceptance.ts`; write-through auto-accept; provenance stamping (interpolated → manual on edit); single undo entry per interpolation op.
- **Acceptance:** signal 13.

### Rebuild Phase 5 — Tool audit + Contour Fill fix (Not started)
- Audit `SafePaintFillTool` vs. stock `PaintFillTool` against requirements C3 behavior (preview / commit / cancel); fix `LabelMapEditWithContourTool` (Contour Fill); verify smart-brush + Sculptor on the container model; meet the D8 performance budget (≥ 30 fps, 4 panels).
- **Acceptance:** signals 16, 21, 24, and the voxel-region portion of 23.

### Rebuild Phase 6 — Flag removal & cleanup (Not started)
- Remove `multiviewport.enabled`; delete legacy `!enabled` code paths; dead-code / stale-import / docs pass.
- **Acceptance:** clean codebase, no flag remnants.

### Transport workstream — parallel track (sequencing) (Not started)
> The XNAT transport/persistence layer ([`docs/annotation-xnat-integration-requirements.md`](docs/annotation-xnat-integration-requirements.md)) is a **separate workstream** behind the requirements **§H boundary**. The rebuild Phases 0–6 build against §H using an in-memory transport double (design §8); they do **not** block on the 33 transport-internal stubs. This track gives that workstream an explicit slot so it stops being unscheduled. (Much of it formalizes/hardens transport that **already exists in code** — save/load SEG+RTSTRUCT, autosave, local backup/recovery — rather than greenfield.)
>
> - **T-spec (parallel with Rebuild Phases 0–2):** fill the 33 "to fill in" stubs (A1–A4, B1–B6, C1–C8, D1–D4, E1–E5, F1–F5). The **§H boundary itself** + the Phase-3-blocking *result semantics* (C7 save-error taxonomy, D3 conflict dialog, and the result-only slivers A4/B3/C4/C5/D4/B6/C8/E5 — see [gaps doc §2](docs/multiviewport-annotation-gaps.md)) are filled **first**, as part of the rebuild spec work, because Phase 3 reacts to them. ✅ §H H5–H7 + the clean-container branch defined + signal 27 added (2026-06-05).
> - **T-build (around Rebuild Phase 3):** implement the real XNAT serialize/upload/version/conflict against the now-complete spec, replacing the in-memory double behind §H. Add the transport workstream's own round-trip/conflict E2E tests (separate from the 27 multi-viewport signals).
> - **T-gate (must complete before Rebuild Phase 6 / production):** flag removal = real production saving, so the transport build must be done and round-trip-proven (F5) before the rebuild ships for real.

---

## Future Enhancements (Beyond Phase 12)

### Hanging Protocol Definition UI + Server Storage
- Visual protocol editor for creating custom hanging protocols
- Cross-session comparison workflows
- XNAT REST storage for protocol definitions
- Shared protocols across users within a project

### Segmentation Enhancements
- Segment statistics & measurements (volume, HU stats, CSV export)
- Lazy labelmap creation for large series performance
- ~~Segmentation interpolation between slices~~ and ~~Multi-viewport segmentation sync~~ — **now part of the Active Work: Multi-Viewport Annotation Rebuild** (interpolation cleanup in Rebuild Phase 4; multi-viewport coherence is the rebuild's core).

### XNAT Integration Enhancements
- Assessment forms (RECIST 1.1, RANO-BM)
- Worklist system

### Advanced Features
- Fusion overlays (PET/CT)
- Packaging & distribution (Electron-builder, auto-update, installers)
