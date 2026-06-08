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
> - [`docs/multiviewport-annotation-requirements.md`](docs/multiviewport-annotation-requirements.md) — functional requirements + 37 acceptance signals (authoritative for behavior).
> - [`docs/multiviewport-annotation-design.md`](docs/multiviewport-annotation-design.md) — architecture, data model, service layout, phasing (§7).
> - [`docs/multiviewport-annotation-architecture.md`](docs/multiviewport-annotation-architecture.md) — layering contract, enforced boundaries, current→target migration map, component architecture (authoritative for structure).
> - [`docs/multiviewport-annotation-current.md`](docs/multiviewport-annotation-current.md) — pre-rewrite baseline audit.
> - [`docs/annotation-xnat-integration-requirements.md`](docs/annotation-xnat-integration-requirements.md) — transport workstream (the old Phase 11), contracted via requirements §H.
> - [`docs/multiviewport-annotation-gaps.md`](docs/multiviewport-annotation-gaps.md) — **spec gap audit (2026-06-05)**: behaviors with no acceptance signal, transport stubs that block Phase 3, and existing app features the rebuild is silent on (regression risk). Work through §4 before/during Phase 0–3.
>
> The phase numbers below are **scoped to this rebuild** and are distinct from the historical product phases 0–12 above. Each phase ships behind the `multiviewport.enabled` flag until verified; tests land in the same PR (design §0.5, §8).
>
> **Why this restarts, and the per-phase gate:** the prior attempt failed because tests were green while the app was broken. The fix is binding test discipline (design §8.0): signals authored as **red** tests first, **red-before-green** on every test, **visual** assertions against an agreed mockup, **no mocked Cornerstone / no skipped acceptance tests**, **vertical slices** (each PR moves a signal end-to-end). A phase is done only when its signals are green as functional tests, all previously-green signals still pass, and a **manual visual checkpoint with proof** is attached to the PR.

### Rebuild Phase 0 — Preparation (✅ **COMPLETE — 2026-06-06**)

Phase 0 is being delivered in reviewable slices. **Slice 1 = additive scaffolding + harness proof** (decided with user: scaffold-first; local DICOM fixtures, no live XNAT; E2E must run in-sandbox). The risky service decomposition and the full fixture/signal suites are deferred to later Phase-0 passes.

**Slice 1 — DONE:**
- ✅ **PolySeg** already pinned at `^4.16.1` across all `@cornerstonejs/*` (validated in `package.json`); pinning to an exact version deferred.
- ✅ **Data-model types** (`Container` / `Member` / `SourceIdentity`; kinds `SEG` / `RTSTRUCT` / `SR`) landed in **`src/shared/types/annotation.ts`** (shared is the project's types home — there is no `src/renderer/types/`), re-exported from the barrel. **Additive only**: reconcile-notes point at the three existing summary layers; no stores modified.
- ✅ **Skeletons** (inert, flag-gated init in `ViewerPage`, + unit tests): `containerService`, `undoService`, `viewportLayoutService` (`src/renderer/lib/cornerstone/`), `transportStore` (`src/renderer/stores/`).
- ✅ **Feature flag** `multiviewport.enabled` (default **off**) on `PreferencesV1.features.multiviewportEnabled` (persisted + merge-safe) with `selectMultiviewportEnabled` / `isMultiviewportEnabled` selectors.
- ✅ **Offline local-fixture E2E path**: `ct-axial-300` synthetic CT sphere phantom + generator (`e2e/fixtures/dicom/`), an offline viewer entry (`__XNAT_E2E__.enterLocalViewer`, no XNAT), and a loader (`e2e/helpers/local-fixture.ts`) driving the app's real local-import path.
- ✅ **Walking skeleton GREEN** through the real stack (Electron + WebGL2 Cornerstone + real fixture), offline, flag on: `e2e/specs/10-walking-skeleton.e2e.ts`. Launch/WebGL2 smoke: `e2e/specs/00-smoke.e2e.ts`.
- ✅ **Red-signal seed**: signals **31 / 32 / 33** authored against the rebuilt panel and **observed red** in `e2e/signals/` (separate `playwright.signals.config.ts`, kept out of the default green suite — no `.skip`).
- ✅ Baseline green bar held: `npm run build` clean, `npm test` 541/541, main + shared tsc clean, **zero new `tsc --noEmit` errors** (renderer baseline 262, all in pre-existing test files; not a project gate).

**Decomposition (decided).** The pure **contour geometry** helpers are extracted (`segmentationService/contourGeometry.ts`, verified, 5614 → 5539). The rest — the ~3,900-line `segmentationService = {…}` object-method bulk + the coupled, behavior-sensitive helper clusters (undo-history, copy/paste, visibility; e.g. lock-aware undo) — need real-Cornerstone E2E to verify and are **carried into Rebuild Phase 1** (which rewrites this area). They are **no longer Phase-0 gate items**. `toolService.ts` left as-is.

**Phase 0 completion sequence** (ordered; execute top-to-bottom, commit per step, no menu — only surface for a genuine blocker, a finding that invalidates the order, or something needing the live XNAT env). Signal→step assignment is approximate; each step authors the signals its fixtures unlock.

Done: scaffolding + harness (Slice 1) · geometry extraction · `ct-axial-300` + `ct-axial-anatomy` · **9/37 signals red** (16, 17, 19, 20, 21, 28, 31, 32, 33).

- **S3 — Offline-authorable signals (no new fixtures).** Author every signal expressible on `ct-axial-300`/`ct-axial-anatomy` via single/multi-panel/MPR layouts of one volume: **1, 2, 3, 4, 5, 6, 7, 8, 13, 22, 23, 29, 34, 35**. Observe red.
- **S4 — SEG/RTSTRUCT fixtures + signals.** ✅ `rtstruct-typed` (4 typed ROIs) + `seg-multilabel` (5-segment BINARY SEG) **hand-built** in `generate.cjs` and **validated in-harness** (`e2e/specs/11`,`12` load them via the real loader). *(Hand-built, not adapter-exported: the app's adapter export reads source study metadata registered only for XNAT-loaded images.)* ◻️ Still: author **24, 30**; tighten 19/20/29/31 against real loaded containers.
- **S5 — Paired / multi-FoR fixtures + signals.** ✅ `mr-t1-t2-sameexam` (same FoR+study), `breath-hold-pair` (same FoR, displaced), `cross-for-ct-mr` (different FoR) hand-built in `generate.cjs` + FoR relationships validated; signals **9, 10, 11, 12, 36** seeded red. **7/9 fixtures, 30/37 signals.**
- **S6 — Temporal fixtures.** ✅ `4dct-phases` (4 phases, shared FoR) + `cine-us` (16-frame US) built + structurally validated. **All 9 design fixtures built.** (No §G signal; back Phase-5 cine; in-app load deferred to Phase 5.)
- **S7 — Lifecycle / transport / perf.** ✅ **14, 15, 25, 26** seeded red (lifecycle + autosave, offline). **27** (save-conflict round-trip) needs **live XNAT** → Transport workstream gate; **37** (perf budget) is a **benchmark**, not pass/fail → perf harness. **34/37 seeded** (18 retired). 27/37 gated externally per the design's coverage note.
- **S8 — ESLint layering enforcement.** ✅ Stood up ESLint (none existed): `eslint@9` + `@typescript-eslint/parser` + `eslint-plugin-react-hooks`; `eslint.config.mjs` encodes the §2.3 boundary zones (boundary rule only, not a style pass). **60 legacy violations quarantined** as tagged `BOUNDARY-DEBT` across 18 files; `lint` script fixed (`eslint src`) + a lint step added to `ci.yml`. `npm run lint` passes (§8 acceptance); build + 541 tests still green.
- **S9 — Phase 0 exit gate.** ✅ Verified: `npm run build` clean · 541 unit tests · `npm run lint` (boundaries) green · offline E2E 5/5 (smoke + WebGL2 + walking skeleton + rtstruct/seg fixture loads) · all 9 fixtures present · **34/37 signals red** (27 → Transport gate, 37 → benchmark, 18 retired) · `multiviewport.enabled` flag off · skeletons inert. **Carried into Phase 1:** the `segmentationService` object-method bulk decomposition + coupled-helper extraction (undo/copy-paste/visibility) — they need real-Cornerstone E2E to verify, which Phase 1 provides.

- **Fully-specified UI mockup (design §8.8)** produced and agreed as the visual acceptance reference — gates Phase 3. ✅ **DONE — frozen & user-approved 2026-06-05** ([`docs/mockup/annotations-panel.html`](docs/mockup/annotations-panel.html) + state matrix [`docs/multiviewport-annotation-mockup.md`](docs/multiviewport-annotation-mockup.md)). Covers **both** the Annotations side panel (§1–§9) **and** the top toolbar (§10) — both are **pixel-match requirements** for §8.0.
- **Phase 0 exit gate (full):** app builds, runs, looks identical; existing tests pass; new types compile; **all 37** signals exist as red tests; the walking-skeleton signal is green; **all** fixtures + mockup in place; ESLint boundaries enforced (S8). (Segmentation-service bulk decomposition is **carried to Phase 1**, not a Phase-0 gate item.)

### Rebuild Phase 1 — Viewport unification (🔧 Remediation in progress — engine done; viewer shell ~half-built; see CORRECTED status below)

**Approach — A/B behind the flag.** Build the new unified viewport path behind `multiviewport.enabled`; the **old path stays untouched** (CornerstoneViewport, OrientedViewport, MPRViewportGrid/MPRViewport, mprService, mprToolService) so the shipping app is safe. Flip the flag default + delete legacy only **after** signals 1/3/6/7 are green through **real Cornerstone** (no mocks). Rendering signals (1, 3) need **visual/screenshot** verification per §8.0. New UI obeys the §2 layering lint (components presentational; wiring in hooks).

Current rendering map (Explore): one shared `RenderingEngine`; STACK via `viewportService`+`CornerstoneViewport`; ORTHOGRAPHIC via `mprService`+`OrientedViewport` (regular) / `MPRViewport`+`mprToolService` (global MPR, separate tool group); stack-vs-volume chosen by `viewerStore.panelOrientationMap` in `ViewportGrid`. `volumeService` has create/load/destroy but **no (scanId,FoR) sharing or ref-counting**.

**Phase 1 completion sequence** (ordered; execute top-to-bottom, commit per slice, no menu):

- **P1.1 — `volumeService` (scanId,FoR) sharing + ref-counting.** Additive `acquire(scanId, FoR, imageIds) → volumeId` (deterministic id from the pair; reuse if cached; refcount++) + `release(volumeId)` (refcount--, destroy at 0). Keep existing create/load/destroy for the old path. Unit-tested (no rendering).
- **P1.2 — stack-eligibility predicate.** Pure `chooseViewportType(meta) → 'volume' | 'stack'` per design §1.1 (US/XA/RF, planar NM, multi-frame cine, single-frame DX/CR/MG → stack; else volume). Unit-tested.
- **P1.3 — `viewportService.createUnifiedViewport(panelId, element, {scanId, FoR, imageIds, meta})`.** Applies P1.2; volume path uses P1.1 (shared, ref-counted) + ORTHOGRAPHIC, stack path = STACK. New method; existing createViewport/loadStack untouched. Verified via off-screen E2E render.
- **P1.4 — unified `Viewport` component + `useViewport(panelId)` hook** (the UI↔service seam, architecture §5). Presentational shell (no service/Cornerstone imports → passes §2 lint); hook owns wiring. Behind the flag. Verified: E2E renders a volume into the unified Viewport off-screen.
- **P1.5 — `viewportLayoutService` presets + flag-gated grid.** Flesh out the Phase-0 skeleton: presets 1×1 / 2×2 / **MPR-2×2** (axial+sagittal+coronal + a volume/3D slot) / custom; a flag-gated grid renders unified Viewports per preset (replaces the MPRViewportGrid-vs-ViewportGrid switch in the new path) + `useViewportLayout` hook.
- **P1.6 — `CrosshairsTool` into the primary tool group** (new path); crosshair sync via the real tool. No mprToolService in the new path.
- **P1.7 — Turn signals 1/3/6/7 green (real-Cornerstone E2E, visual).** Decision 2026-06-08 (user): the four signals all require annotation/segmentation **editing** that pure viewport-unification excludes, so the minimal editing/undo/dirty-save needed to satisfy them is **pulled forward into Phase 1** (rather than re-scoping). Reuse the existing `segmentationService` machinery (brush/contour/SEG/undo via global `DefaultHistoryMemo`/dirty flag/`exportToDicomSeg`) — it uses **viewport-focused** Cornerstone APIs + a **global** history, so it wires onto the unified tool group + viewports with minimal new code. Ordered by capability dependency (each red→green, commit per slice):
  - **P1.7a ✅ (committed 14cf6a9) — drawing/segmentation tools into the unified tool group + active-tool control.** Added `LengthTool`, `PlanarFreehandContourSegmentationTool`, `BrushTool` to `xnatToolGroup_unified`; `unifiedToolService.setActiveTool(toolName)` swaps only the Primary slot (Crosshairs demoted to Passive so reference lines still render). Verified red→green (spec 16).
  - **Reorder 2026-06-08 (user): labelmap signals first.** Empirical finding while attempting signal 1: a planar **contour** segmentation does NOT cross-section onto orthogonal MPR viewports by default — the real freehand gesture draws fine (contour created, structurally verified) but visual propagation to sagittal/coronal needs **live PolySeg contour→labelmap conversion** (PolySeg is registered in init.ts). **Labelmaps** (brush) resample on MPR **natively**, so do those first; tackle signal 1's PolySeg path last. New order ⇒ 3 → 7 → 6 → 1.
  - **P1.7b ✅ (committed 93d7c67) — signal 3: brush SEG → MPR resampled (native labelmap).** New `unifiedSegService` creates a VOLUME labelmap derived from the shared source volume (geometrically aligned), attached to all unified MPR viewports; a real brush gesture paints the 3D labelmap and it renders natively on every plane. Verified red→green (spec 17). **Key finding:** cross-plane MPR editing is NOT a CS3D limitation — the earlier "doesn't propagate" was a small off-centre brush missing the orthogonal planes; a brush spanning the centre resamples on all planes (no manual render trigger). The old stack-labelmap path silently no-ops on offline volume viewports, hence the derived volume labelmap.
  - **P1.7c ✅ (committed 89b5cef) — signal 7: undo a brush stroke from a closed panel.** Wired the `undoService` skeleton to Cornerstone's GLOBAL `DefaultHistoryMemo` (viewport-independent). Brush on panel_3, switch to single (destroys panel_3), undo → painted voxels return to the pre-stroke baseline + the surviving panel reverts. Verified red→green (spec 18).
  - **P1.7d (part 1) ✅ (committed a1f4b57) — signal 6: layout swap loses nothing + single dirty flag.** `unifiedSegService` tracks created segs + re-attaches them to (re)mounting viewports (so a seg created in one layout appears on panels that materialise later); the dirty flag is set natively by the brush. Verified red→green (spec 19): create+paint in single, switch to MPR (new panels), churn layouts → one seg (no dup), same voxel count (no loss), one dirty flag, new sagittal panel attached + rendered.
  - **P1.7d (part 2 — GATED) — signal 6 "save once produces correct file".** The export *plumbing* is wired & confirmed runnable (bridge: `csSegmentation.helpers.convertVolumeToStackLabelmap({segmentationId, options:{viewportId}})` → `sourceImageTracking.setSourceImageIds` → `segmentationService.exportToDicomSeg`). BUT `exportToDicomSeg` requires source **StudyInstanceUID**, read from `generalStudyModule` / the `wadouri.dataSetCacheManager` — neither of which the offline synthetic `dicomfile:` fixtures register. This is the **documented adapter-export limitation** (S4 note: "adapter export reads source study metadata registered only for XNAT-loaded images"). ⇒ **Save verification gated to the Transport/XNAT workstream** (alongside signal 27), OR needs an offline fixture-metadata-registration enhancement (register study/series UIDs for `dicomfile:` images). Plumbing reverted (not committed) since it can't go red→green offline.
  - **P1.7e (capability ✅, committed 02c4feb; cross-plane gated) — signal 1: freehand contour → PolySeg labelmap.** `unifiedSegService.createContourSegmentation` + `syncContourToLabelmap` (PolySeg `computeLabelmapData` rasterizes the contour into a labelmap aligned to the shared volume). Spec 20 verifies red→green the real pipeline: gesture draws a contour → PolySeg rasterizes → non-zero labelmap → renders. **Cross-plane sag/coronal assertion NOT made offline**: that labelmap-on-MPR rendering is the same one already green in signal 3 (spec 17); the only gap is driving a *synthetic* mouse gesture to land on the orthogonal MPR centre planes — the tool's `canvasToWorld` is DPR-inconsistent in the headless window (a harness coordinate-calibration nuisance, NOT a capability gap). Added `getPanelFocalPoint`/`worldToPanelPagePoint` hooks toward a calibration fix.
- **P1.8 — Wire UI → unified, flip default, delete legacy.**
  - **P1.8a ✅ (c9ef46e) — tool routing.** `viewerStore.setActiveTool` flag-branches to `unifiedToolService` on the new path; the real toolbar drives the unified group (red→green spec 21). Undo-button reactivity + layout-preset UI deferred to the Phase-3 annotation-UI rebuild (don't wire soon-obsolete chrome).
  - **P1.8b — SKIPPED (user 2026-06-08).** Don't wire the obsolete `SegmentationPanel`/old annotation UI to the unified path — it's replaced in the Phase-3 rebuild.
  - **P1.8c ✅ (ec57178) — flag default ON.** `DEFAULT_FEATURE_PREFERENCES.multiviewportEnabled = true`; unit suite (556) + offline E2E green (old-path-coupled tests pinned to flag-off until deletion).
  - **P1.8d — delete legacy (staged; user chose migrate-then-delete).** **KEY de-risking finding:** the unified path references NONE of `mprService`/`crosshairSyncService`/`crosshairGeometry`/`ScrollSlider`/`panelOrientationMap` — it's self-sufficient (CrosshairsTool + wheel StackScroll). So those are **pure legacy**, not shared infra; NO unified-path migration is needed and the deletion is clean. Scope: ~13 modules + ~10 test files + reference removal from 5 entry points. Staged (build green after each):
    - **A.** `hotkeyService` — remove the MPR-mode + oriented-viewport slice-nav branches (drop `mprService`); keep stack nav + tool shortcuts. (Unified keyboard slice-nav was already a no-op; wheel scroll unaffected.)
    - **B.** `ViewerPage` — drop the `mprActive ? MPRViewportGrid : ViewportGrid` branch + `mprActive` panel guards; render `UnifiedViewportGrid` unconditionally (remove the flag gate in rendering).
    - **C.** `App` — remove `handleToggleMPR`/`enterMprForPanel`/`mprSource*` + the props.
    - **D.** `Toolbar` — remove the MPR toggle button + `mprActive` reads/guards.
    - **E.** `viewerStore` — remove MPR state + `enterMPR`/`exitMPR`/`_updateMPR*` + the `mprToolService` import.
    - **F.** Delete modules: `MPRViewportGrid`, `MPRViewport`, `OrientedViewport`, `CornerstoneViewport`, `ViewportGrid`, `mprService`, `mprToolService`, `crosshairGeometry`, `crosshairSyncService`, `ScrollSlider` (+ their tests; update the hotkeyService/crosshair/viewerStore test mocks).
    - **G.** Types: remove `MPRViewportState`/`VolumeLoadProgress`/MPR helpers if unused; clear the related `BOUNDARY-DEBT` comments.
    - **✅ DONE (committed f648a82 + 0f04c22).** Unified path is the only viewport path. Deleted 11 legacy modules (MPRViewportGrid/MPRViewport/OrientedViewport/CornerstoneViewport/ViewportGrid/ViewportOverlay/ScrollSlider/mprService/mprToolService/crosshairGeometry/crosshairSyncService) + 11 tests (−6,860 LOC); rerouted `openInMpr` → unified `mpr-2x2` preset; removed MPR state/flow from viewerStore/App/Toolbar/hotkeyService. Build clean · 476 unit tests green · `npm run lint` (boundary gate) green · BOUNDARY-DEBT 18→12 files · offline E2E green (walking skeleton on unified + unified specs).
  - **P1.8e ✅ — `segmentationService` decomposition (3 clean modules; rest deferred per user 2026-06-08).** Behavior-preserving pure extraction of the self-contained, low-coupling helper clusters out of `segmentationService.ts`, following the established `segmentationService/*` dependency-injection convention (each module re-imported/delegated so the public API + `this`/external refs are unchanged). Done:
    - **`segmentationService/undoHistory.ts` (64925f9)** — undo/redo history-memo helpers + push-hook state (`createUndoHistory` factory). ~140 lines.
    - **`segmentationService/visibility.ts` (472739c)** — segment visibility/lock controls (`createVisibilityControls` factory). ~270 lines.
    - **`segmentationService/dicomSegExport.ts` (7b308da)** — DICOM SEG export + group-compositing + `SEGMENTED_PROPERTY_*` codes (`createDicomSegExport` factory). ~1,050 lines.
    - Net: **segmentationService.ts 5,539 → ~4,130 lines (−25%)**; build + lint + **476 unit tests** green + dicom-compliance/loadExport green after each; renderer `tsc --noEmit` error count steady (178→176, never increased).
    - **Deferred to Phase 2/3 (user decision):** `contourTools` (contour copy/paste/delete = Phase-2 *annotation-behavior* surface), `lifecycle`-gates (autosave/dirty/load = Transport workstream), `representation` (mostly already delegated — low value). All need new shared-mutable-state plumbing **and** touch the exact subsystems Phase 2/3 rebuilds → extracting now is churn on soon-reworked code (same rationale as P1.8b). They are **not** Phase-1 gate items.

**Acceptance:** signals 1, 3, 6, 7 green with flag on (editing pulled into Phase 1 per the 2026-06-08 decision). Perf: 4-panel volume load ≤ baseline + 30%.

> ### ⚠️ Phase 1 status CORRECTED (2026-06-08 gap audit — retracts the earlier "COMPLETE")
> The earlier "Phase 1 COMPLETE" claim was **wrong**. It rested on acceptance signals driven by **e2e hooks** (`createUnifiedLabelmapSegmentation`, `setLayoutPreset`, `triggerUnifiedUndo`) + unit tests that set stores directly — **neither exercised the real viewer UX**, so a large swath of the viewport shell was never built or was dropped in the P1.8d legacy deletion and went undetected until real-CNDA review. A spec-grounded, code-verified audit found:
>
> **The engine works** (verified): shared ref-counted volume, stack-vs-volume predicate, `createUnifiedViewport`, SEG/RTSTRUCT load+overlay, tool group + editing tools, tool switching, crosshair-crash-stop, click-to-select, layout single+2×2. (Several of these were post-audit fixes: crash-stop, `markReady` overlay-load, tool-routing, Pan/Zoom binding leak, click-to-select, layout-2×2 bridge — each with a real-affordance E2E, specs 22/23/24.)
>
> **❌ Spec-required but missing/broken:** info overlay (slice N/M, W/L, zoom, metadata); event→store sync + ResizeObserver (reverted; readouts stale, volume slice-index "257/21" unfixed); generic grid layouts 1×2/2×1/3×3/custom (collapse to single — Req I2 says *preserve*); multi-scan per panel (grid forces all panels to `panel_0`); world-point crosshair (native disabled, button is a no-op); scrollbar; orientation markers; rulers; brush-size control; error/loading overlay; MPR 4th-panel-as-3D.
>
> **⚠️ Partial:** `_initPanel`/`_destroyPanel`/cine/preload (methods exist, never called → store/interval leaks); undo button on legacy path; hanging protocols can't assign per-panel scans.
>
> **🔒 Gated (legit):** DICOM SEG export / save-file (needs source StudyInstanceUID; → Transport workstream).
>
> **🔜 Deferred (legit, later phase):** toolbar §10 redesign + side panel (Phase 3); per-container undo, autosave/queue, cross-series/FoR rules, dashed rendering (Phase 2); contourTools/lifecycle decomposition (Phase 2/3).
>
> **❓ Never verified:** perf budget (never measured); cross-plane visual for signals 1/3 (only voxel counts asserted); multi-scan-per-session retention.
>
> **Real Phase-1 completion checklist (P1.9 — remediation, in progress):**
> - [x] **B1** Info overlay + event→store sync + ResizeObserver + lifecycle restored, with the volume slice-index FIXED (`readViewportState` keys off `viewport.type`; volume→`getSliceIndex`/`getNumberOfSlices`, metadata from source `imageIds[0]`). ✅ `876ad59` — verified by a conflicting-API readState unit test (total 256, not the native 21) + real-load E2E (overlay shows correct "N / 16" + W/L + zoom + series-desc corner).
> - [x] **B2** Generic grid layouts (1×1/1×2/2×1/2×2/custom) + per-panel multi-scan. ✅ `a472e85` — layout descriptor (single | mpr-2x2 | grid), `gridPanels`, per-panel `sourcePanelId`; the dropdown drives generic grids, MPR stays a separate preset (openInMpr). Verified by `gridPanels` unit test + e2e/26 (real dropdown → 1×2→2 / 2×2→4 panels; ct-axial-300 in panel_0 + ct-axial-anatomy in panel_1 = two independent canvases). ⚠️ Behavior change: dropdown "2×2" is now a generic 4-panel grid, not MPR.
> - [ ] **B3** World-point crosshair (reticle + same-plane nearest-slice sync + volume jumpToWorld); route `ToolName.Crosshairs` to it. **NOT STARTED** — the click→world mapping is DPR-inconsistent in headless Playwright (documented harness gap), so the interactive part can't be reliably verified offline; needs real-data confirmation. Geometry/reticle/sync *logic* is unit-testable, but I held off building it unverified while the user is away.
> - [ ] **B4** Slice-nav scrollbar. **NOT STARTED** — `viewportService.scroll`/`scrollToIndex` are stack-only; a unified scrollbar needs a volume-capable scroll-to-slice, and the StackScroll tool already covers wheel-scroll. Deferred pending a confident verification path / real-data review.
> - [ ] Measure the 4-panel perf budget; assert cross-plane visual for signals 1/3 (or document the harness limit). **NOT DONE.**
> - [x] Verify every remediation through the **real affordance** (real fixture + real click), not e2e hooks — applied to all P1.9 fixes (e2e specs 22/23/24/25/26 drive real toolbar/dropdown/clicks).
> - **Discipline going forward:** no "complete" without a real-affordance test that fails on the broken state; legacy deletion requires a behavioral-parity checklist; real-data visual review before any "done".

**Now in Phase 1 (pulled forward for P1.7):** the *minimal* drawing routing + brush/contour editing + per-container undo + dirty flag + local SEG save needed for signals 1/3/6/7. **Still Phase 2–3:** cross-series rules (A2a–d), non-native dashed rendering, gesture-start blocking/lock enforcement, the list panel, approval workflow, queue-next-save/debounced autosave, save-to-XNAT round-trip.

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
