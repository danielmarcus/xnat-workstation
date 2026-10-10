# SegWorks Parity — Overview & Proposed Workplan

Status: **Plan + UI decisions approved 2026-10-10** (branch `segworks-parity`, 2026-10-10)

Source: SegWorks v2.0.610 *User-Facing Feature Inventory* (342 features, 13 sections), plus
the add-on modules shipped alongside it (Worklist Builder, Mask Relabel by Name, MR lesion
seg ×3, Lung Segmentation, Batch Stats Collector, LatestMask). Older bundles (2.0.588,
2.0.609, the Chrome-extension zip) are earlier copies of the same code and were used only
to cross-check. Numbers like `#152` below refer to the v2.0.610 inventory.

---

## 1. Triage of the 342 SegWorks features

| Bucket | ~Count | What it is |
|---|---|---|
| **Not applicable** | ~45 | Exists only because SegWorks is a Chrome extension injected into OHIF |
| **Already in Workstation** | ~35 | Equivalent exists (possibly with a different UX) |
| **Partial — extend** | ~30 | Workstation has the base; SegWorks adds options or workflow on top |
| **Additive — new** | ~230 | Net-new capability that fits Workstation's architecture |

### 1a. Not applicable (drop)
- Toolbar/menu injection, compact OHIF menu, draggable/resizable shadow-DOM panel, radial
  menu self-healing remounts (#1–8). Workstation owns its own UI.
- Chrome site permissions, popup, active-site list, apex-domain grants, version display
  (#284–290). Popup worklist mirror and last-case shortcut (#336–337).
- OHIF SEG metadata registration/repair, Quick Finalize, DOM automation of OHIF export
  (#17–19, #264's export half). Workstation already writes DICOM SEG/RTSTRUCT itself.
- Self-healing Hide-PHI MutationObserver (#270). The *feature* (Hide PHI) is kept; the
  self-healing part is a workaround for not owning the DOM.
- Session-expired banner/relay (609 list). Workstation has its own auth handling.
- LatestMask module (it automates OHIF's Import Mask dialog). The intent ("open the newest
  mask by keyword") can be folded into the Worklist branch.
- Microscopy Annotation Lab. It isn't part of SegWorks and targets slide microscopy.

### 1b. Already present
- Brush, threshold brushes, sphere brush, circle/rect/sphere scissors, paint fill, and
  Cornerstone region grow (GrowCut-based RegionSegment/RegionSegmentPlus).
- Live Wire (basic), Spline contour (basic), freehand contour, and Sculptor.
- Contour interpolation with accept/auto-accept.
- Undo/redo: per-container history that respects locks. Ctrl+Z / Ctrl+Shift+Z.
- Remappable hotkey system, including `[`/`]` brush size and tool keys.
- Per-segment stats (volume, intensity) and CSV export.
- Disk-backed autosave and crash recovery; opt-in XNAT autosave.
- Reviewer approval (RT Approval tags plus lock).
- Per-segment visibility and lock; the context-overlay toggle; configurable corner fields.

### 1c. Gaps that matter, by theme
1. **Mask cleanup & mask math.** Workstation has essentially none of it: fill holes, keep
   largest, remove speckles/strays, smoothing (median/gaussian/anisotropic), open/close,
   magnet bridge, clear/move/merge/relabel segments, and Smart Cleanup batch planning.
   This is the largest daily-use gap.
2. **Labelmap interpolation & propagation.** It was removed in `7a33519` because it ran
   automatically on every edit and the math was wrong (it computed a union, not an
   interpolation). SegWorks does it right: explicit and user-triggered, with a gap table,
   A/B anchors, preview, and several algorithms (SDF, area-preserving, morphology,
   component matching, image-guided snap). Propagation adds forward/backward/bidirectional
   with HU/σ tolerance and auto-stop.
3. **Semi-automatic seeded segmentation.** Level Trace, Smart Brush, Random Walker, 3D
   Fast GrowCut with seeds, binary Graph Cut, multi-label α-expansion, and Chan-Vese with
   clinical presets. They all depend on shared infrastructure Workstation lacks: a
   **preview-then-commit layer**, **ROI constraints**, and **Web Worker compute with
   progress and cancel**.
4. **Contour refinement.** Advanced Live Wire cost terms, more spline families
   (Catmull-Rom, B-spline, Akima, tension…), copying or propagating a spline to the
   adjacent slice, local ROI spline edit, and Snake refine.
5. **Review ergonomics.** Auto Review flythrough (cine limited to the segmented range, with
   overlay flicker and timing), mask-visibility hotkey, Hide-PHI display mode, hold-Q
   HU hover probe, spring-loaded eraser, baseline snapshot and reset, and named checkpoints
   with backup-file export and import.
6. **3D segmentation QC.** Surface rendering of segments in the 3D viewport (PolySeg is
   registered but unused for this), a 3D connected-component report, jump-to-component,
   delete component, stray/speck thresholds, and a 3D scissor cut.
7. **Worklist / Capture / Review.** Absent today (listed under PHASES "Future"). It covers
   spreadsheet import/export, XNAT id resolution, project fetch, Next & Open,
   Capture/Review/View-Only modes, skip with reason, comments, filters, report workbooks,
   and the Worklist Builder.
8. **Module extensibility.** User-loadable algorithm modules with a small API
   (`getPixelData`, `getLabelmap`, `pushUndo`, `progress`, `cancelled`, `log`) and
   schema-driven parameter UI. This would let Workstation run SegWorks' existing modules
   (lung, glioma lesions, relabel, batch stats).

---

## 2. Proposed branches

Each branch is a self-contained, testable unit that merges to `main`.
`segworks-parity` is the umbrella branch for this plan doc. Feature branches will be cut
from `main` as each one starts, following the existing kebab-case convention.

| # | Branch | Scope (inventory refs) | Depends on | Size |
|---|---|---|---|---|
| **1** | `mask-ops` | **Foundation:** a `LabelmapTransaction` (snapshot → undo memo → write → render), operation scope (slice / range / volume × active / all labels × optional ROI), and a pure-function `maskOps` library. **Ops:** fill holes, keep largest, remove speckles/strays, median/gaussian smooth, smooth edges, open/close, anisotropic diffusion, magnet bridge, clear on slice, clear/move/merge segment, relabel-by-name. A Cleanup panel and the "S" fill-holes quick panel. (#182–212, #29, #209–210, Relabel module) | — | L |
| **2** | `review-ergonomics` | Auto Review flythrough (#213–221), mask-visibility hotkey (#340–341), Hide-PHI mode for viewport overlay and header panel (#269), hold-key HU hover probe (#25), spring-loaded eraser and eraser toggle (#23–24), mask-mode HUD (#28), baseline set/reset (#15–16), named checkpoints and backup-file export/import (#258–268, mapped onto the existing disk backup) | 1 (baseline uses the transaction) | M |
| **3** | `labelmap-interpolation` | Explicit, user-triggered interpolation only: gap scan and gap table, current-slice / gap / all-gaps / all-labels, A/B anchors and hotkeys, preview vs commit, SDF linear / area-preserving / morphology / component-matching / image-guided snap, exact vs chamfer DT (#152–168, #30–31). **Propagation:** fwd/back/bidir, CT HU and MR σ tolerance, max slices, area auto-stop, stable modes, fill-holes / snap / z-smooth (#169–181). Index-space only, so it survives oblique series. | 1 | L |
| **4** | `seg-compute-infra` + 2D tools | **Infra:** preview layer (transient labelmap overlay plus commit/discard), ROI-constraint tool, and a Worker pool with progress and cancel. **Tools:** Level Trace (#32–51), Smart Brush (#59–62), Random Walker (#63–71), region-grow guards beyond Cornerstone's (#52–58) | 1 | L |
| **5** | `seg-3d-solvers` | 3D seeded solvers on the #4 infra: Fast GrowCut with fg/bg seeds and slice range (#101–115), binary Graph Cut (#116–123), α-expansion multi-label (#124–135), Chan-Vese multiphase with presets (#136–151) | 4 | XL |
| **6** | `contour-refine` | Live Wire advanced cost (Scharr, Laplacian, direction, pre-smooth, close tolerance, commit smoothing) (#75–81). Spline families, point undo, commit-undo-reload, copy/propagate to adjacent slice, local ROI edit, self-intersection guard (#82–100). Snake refine (#200–201). Extend Cornerstone's tools where possible and fork only where necessary. | 4 (preview) | L |
| **7** | `seg-3d-qc` | Segment surfaces in the 3D viewport via PolySeg, per-label visibility, resolution and smoothing, 3D component report with stray/speck thresholds, jump to slice, delete component, 3D scissor, undo (#230–257) | 1 | L |
| **8** | `worklist` | **Own reviewed plan first; XNAT-backed.** Requirements input from SegWorks: XLSX/CSV import, XNAT id resolution, project fetch, Worklist Builder generation, Next & Open, cursor sync, Capture / Review / View-Only modes, exact series and annotation capture, skip with reason, comments, filters, report workbooks, recovery, dirty flag, XLSX export, segment preset keys (#291–342) | — (benefits from 2) | XL |
| **9** | `algorithm-modules` | Workstation-native module API and loader, run in a sandboxed Worker (not the renderer, which has Electron privileges). Schema-driven param UI, logs (copy/download), cancel, cached modules. Validate by re-authoring one SegWorks module (e.g. Glioma enhancing lesion) against the native API. (#271–283) | 1, 4 | M |

**Recommended order:** 1 → 2 → 3 → 4 → 7 → 6 → 5 → 9 → 8

Branch 8 is independent of the segmentation work and can run in parallel at any time. Put
it earlier if case throughput is the bigger pain than tooling.

### Cross-cutting rules (from past lessons in this repo)
- Nothing runs automatically on `onSegmentationDataModified`. Every algorithm is
  user-triggered and previews before it commits. This is the lesson of `7a33519`.
- Operations work in index space, not world space, so oblique acquisitions are safe. Test
  with the `ct-oblique` fixture as well as axial.
- Resolve multi-layer group ids (`_layer_N`) before touching labelmaps.
- Respect locks: no algorithm writes to a locked segment.
- No toast spam; progress and status show up in the panel itself.
- **Testing:** unit tests for the pure `maskOps`/solver functions against synthetic
  volumes. E2E drives the actual button or hotkey and asserts labelmap voxels. Use the
  `ct-axial-anatomy` fixture for intensity-aware tools.

---

## 3. Decisions (2026-10-10)

1. **Order** — confirmed: 1 → 2 → 3 → 4 → 7 → 6 → 5 → 9 → 8.
2. **SegWorks code is reference, not source.** Every feature is implemented natively in
   Workstation's architecture (service layer, Zustand stores, typed IPC, Vitest + Playwright
   discipline). SegWorks `.js` files and modules are read for algorithm behaviour and
   parameter ranges only — no compat shim, no ported page-global code. Branch 9 defines a
   Workstation-native module API; SegWorks modules may be *re-authored* against it as
   validation, not run unchanged.
3. **Worklist is XNAT-backed** and engineered on its own merits, not modelled on the
   SegWorks spreadsheet workflow. It gets its **own carefully reviewed implementation plan**
   (data model, XNAT storage, concurrency, permissions, migration) before any code. The
   SegWorks feature list is an input to requirements only.
4. **Domain-specific items deferred** to a secondary project after the main features ship:
   pancreas mode / duct joining / plausibility flags (#245–246, #254), Lung Mode auto-click
   (#222–229), Chan-Vese clinical preset library (#137 — the generic Chan-Vese ships), and
   pre/post-op worklist filters (#312, #314).
5. **Port every algorithm variant.** Each variant ships behind the same UI affordance;
   variants that do not prove useful in review may be dropped later. Keep variants
   pluggable (one strategy interface per family) so dropping one is a deletion, not a refactor.
6. **UI wireframes before implementation.** A holistic wireframe set covering every
   extension point — with alternatives where a decision is needed — is produced and
   approved *before* branch 1 starts, so layout conflicts surface now rather than mid-project.
   See [`docs/mockup/segworks-wireframes.html`](mockup/segworks-wireframes.html) and §4.

## 4. UI wireframe decisions (approved 2026-10-10)

All recommended options in [`mockup/segworks-wireframes.html`](mockup/segworks-wireframes.html)
are adopted:

| # | Decision |
|---|---|
| D1 | Run-style operations open an **operation sheet** inside the side panel, between the member list and the toolbox; the active container/member stay visible |
| D2 | SEG toolbox gets **Paint · Shape · Smart · Process** tabs; Select + Seg Bidir. pinned above the tabs; hotkeys switch tab |
| D3 | Spline / Livewire mask fills are a **boundary mode on Contour Fill** (Freehand · Spline · Livewire), not new tools |
| D4 | **Viewport preview bar** (top-centre; ⏎ commit, ⎋ discard, hold `\` compare) + sheet footer. Preview = target segment colour, hatched + dashed; never blue, never solid |
| D5 | The viewport scrollbar becomes a **slice track** (active-segment occupancy, gaps, A/B anchors, draggable range) when a SEG member is active |
| D6 | **Flythrough mini-player** on the viewport, launched from the container kebab or ⇧Space |
| D7 | **Hide PHI** toolbar toggle beside Tags (⇧H). Scope: viewport overlay PHI fields + DICOM header PHI values (per-tag reveal) + window title; orientation markers, active ring and XNAT labels kept; exports unaffected |
| D8 | **Checkpoints in the container kebab** (Review flythrough · Save checkpoint… · Restore checkpoint ▸); “baseline” is a reserved-name checkpoint; file export/import in Settings › File Backup |
| D9 | **“2D + 3D QC” layout preset** + QC operation sheet; layout restored when the sheet closes |
| D10 | Worklist space reserved: sidebar **Browse · Worklist** tab + toolbar **case bar** + full-window table view |
| D11 | Modules run from **Process › Modules** sheets; installed/managed in **Settings › Modules** |
| D12 | **Sheet-scoped hotkeys** take precedence while a sheet is open; new globals: hold-Q probe, M mask visibility, ⇧Space flythrough, ⇧H PHI, X cleanup, N/⇧N next/prev case, O contour fill, ⏎/⎋ preview, hold-`\` compare |

Shared rules from the wireframe doc (§5 “Sheet rules”) are binding for every branch.

**Separately reviewed plans required** before implementation: branch 8 (worklist) **and**
branch 9 (algorithm modules). Neither starts until its own plan is reviewed with the user.

---

## 5. Branch 1 — `mask-ops` (ordered plan)

Cut from `segworks-parity`. Slices land as separate verified commits (`Mask ops S<n>: …`),
executed top to bottom. Every slice follows the repo's red-before-green discipline; E2E drives
the real affordance (tab → sheet → Preview → ⏎) and asserts **labelmap voxels**, not store state.

**Ground truth this builds on** (verified in code 2026-10-10):
- `readSegmentVoxelGrid(containerId, segmentIndex)` (`lib/cornerstone/segmentVoxelGrid.ts`) gives
  one segment as a world-oriented grid with a live `write()`. In a multi-layer group (what
  "New Segmentation" creates) **each segment is its own sub-seg stored as value 1**, so
  multi-segment ops touch several Cornerstone segmentations and segments may overlap.
- `pushVoxelHistoryMemo` / `isSegmentLockedHere` / `notifyLabelmapChanged`
  (`unifiedSegService.ts`) are the existing undoable-write path used by island delete/move/paste.
- Per-slice work happens in the **viewing plane** (`sliceAxisFor`), like island selection, so
  oblique and MPR views stay index-space correct.

| Slice | Content | Acceptance |
|---|---|---|
| **S1** | `lib/segmentation/maskOps/` — pure functions on binary planes (`Uint8Array` + dims + spacing): connected components (4/8), fill holes, keep largest, remove speckles (min area mm²), remove strays (centroid distance mm), median/majority, Gaussian smooth (σ mm, re-threshold), smooth edges (3×3 weighted vote), open/close (radius), anisotropic diffusion (Perona-Malik exp/quadratic, κ, iterations; image-guided), magnet bridge (source→target, max gap, fill-only/overwrite) | Vitest on synthetic planes, each seen red first |
| **S2** | **Labelmap transaction**: one undo step spanning N members of a container; lock check up-front (refuse whole op, existing lock warning); stage → diff → write → `notifyLabelmapChanged`. **Scope resolver**: `{slices: current \| range \| volume, labels: active \| all \| pick, roi?}` → member grids × plane indices. Refactor island delete/move/paste onto the transaction (structure before features) | Existing island/paste/undo E2E still green; new unit tests for multi-member undo/redo |
| **S3** | **Preview layer**: staged result rendered on every viewport showing the scan as hatched fill + dashed outline in the target segment colour (SVG layer, like island selection outlines); labelmap untouched until commit. **Viewport preview bar** (top-centre): ⏎ commit · ⎋ discard · hold `\` compare. Preview-scoped key capture | E2E: preview pixels present, labelmap unchanged; ⏎ writes; ⎋ leaves no trace; one Ctrl+Z reverts commit |
| **S4** | **Toolbox tabs (D2)**: Select + Seg Bidir. pinned; Paint · Shape · Smart · Process; tool hotkeys switch tab; existing tool E2E updated to tab-aware helpers | Pixel/visual check of toolbox; tool-controls & tool-affordance specs green |
| **S5** | **Operation sheet (D1)** shell + **Cleanup sheet**: op dropdown, params, scope bar, Advanced collapse, footer; back / discard-confirm; locked → Commit disabled with reason; sheet-scoped hotkey hook (D12); `X` opens last-used cleanup op | E2E per op: Process → Cleanup → op → Preview → ⏎ → voxels match the pure-function result on `ct-axial-anatomy` (+ `ct-oblique` for one op) |
| **S6** | **Slice track (D5)**: scrollbar shows active-segment occupancy when a SEG member is active; draggable range bracket bound to Range scope; click band to jump | E2E: occupancy pixels at painted slices; dragging bracket updates the sheet range |
| **S7** | **Segment ops**: clear segment (scope), clear active / all labels on slice, move to segment, merge into, duplicate, relabel-by-name (rename + optional merge into an existing same-named member, metadata from donor); magnet bridge two-member UI | E2E on multi-member containers; undo restores both members |
| **S8** | **Smart Cleanup**: per-label stats → proposed plan table (op per label, thin/small-structure protection) → review/edit → one transaction | E2E: plan shown, edited, committed as one undo step |
| **S9** | Docs (`annotation-tool-reference.md`, hotkeys), full offline E2E run, dev-app visual sweep against wireframes, merge to `main` | CLAUDE.md self-check answered |

### Branch 1 progress log

- **S1** `f881920` — pure cleanup ops. Magnet bridge zone redefined (SegWorks' rule never joined the segments).
- **S2** `f125dc5` — labelmap transaction + scope + runner; island delete/move/paste refactored onto it.
- **S3** — preview layer, viewport preview bar, key layers (D12 mechanism), cleanup catalog + service.
  Deviations from the wireframe found by looking at the running app: the bar sits **below**
  the two-line corner readouts (top-centre covered a long series description); slice numbers
  shown to the user use the **viewport's numbering** (`sliceNumbering.ts`) — grid order is
  often reversed relative to the stack ("slice 9" was printed while the overlay said 8).
- **S4+S5** — toolbox tabs (D2) and the operation sheet (D1) + Cleanup sheet, landed together
  (a Process tab with no sheet would be a dead end). X opens Cleanup. A locked target previews
  read-only. Deviations: the sheet's **ROI scope is deferred to branch 4**, where the ROI-limit
  tool that draws it arrives; the Controls strip stays visible under the Process tab (the active
  tool is still in effect). E2E specs that click tools now go through `e2e/helpers/toolbox.ts`
  (`clickTool` opens the tool's tab first, as a user would).
- **S6** — slice track (D5): active-segment occupancy bands on the scrollbar in the viewport's
  numbering, drawn over the thumb (inset) so the current slice's band is never hidden; the
  Cleanup Range is a teal bracket whose ends drag to edit the range. Gaps and A/B anchors come
  with branch 3.
- **S7** — segment operations in the Cleanup sheet's "Segments" group: Clear (with scope it
  covers #206/#209/#210), Move into (= SegWorks Merge — they were the same relabel), Copy into,
  Magnet bridge (fill / overwrite; locked members are never crossed or claimed). One "Into"
  selector; one undo step across every segment touched (verified in-app: without the history
  grouper one Ctrl+Z restored only one segment). Decisions: **Duplicate** = add a member with
  "+" then Copy into it (a "new segment" target would leave an empty member behind on
  Discard); **relabel-by-name** is covered by rename + Move into.
- **S8** — Smart Cleanup: a cleanup op over All segments shows a per-segment plan (voxels,
  small/thin flags, editable action); small (<1500 vox volume / 150 slice) and thin (boundary/area
  ≥ 0.62 on 3 sampled slices) segments are withheld from eroding ops. Deviation: protected
  segments default to **Skip** (SegWorks: Median — which also erases 1-px structures); Median is
  selectable. The plan runs as one undo step.
- **S9** — `docs/annotation-tool-reference.md` gains the toolbox tabs and the Process-tab
  operations; full offline E2E 242/242 green on the built app. **Branch 1 complete; awaiting
  the user's go-ahead to merge to `main`.**

---

## 6. Branch 2 — `review-ergonomics` (ordered plan)

Cut from `mask-ops` (it reuses the labelmap transaction, slice numbering/occupancy and key
layers) in a separate worktree, so `mask-ops` can be evaluated in parallel. Fixes found in
that evaluation land on `mask-ops` and are merged forward here.

| Slice | Content | Acceptance |
|---|---|---|
| **R1** | **Hide PHI (D7)** — toolbar toggle beside Tags + ⇧H; persisted preference (a restart must not silently re-expose PHI). Hides PHI fields in the viewport overlay corners, masks PHI tag values in the DICOM header panel (per-tag reveal), strips PHI from the window title. Orientation markers, active ring, XNAT labels and exports unchanged | E2E: overlay text and header values absent in pixels/DOM when on; present when off; survives reload |
| **R2** | **M** toggles the active container's mask visibility; **mask-mode HUD** — a ~1.2 s bottom-centre readout (above the ruler) when a hotkey changes tool, mode or brush size | E2E: M hides/shows labelmap pixels; HUD appears on `[`/`]`/E/B and fades |
| **R3** | **Hold-Q intensity probe** — cursor-adjacent readout (modality value + voxel ijk) while Q is held, without changing tools; "hold" bindings in the hotkey system (keyup ends) | E2E: value shown matches the Probe tool's at the same point; gone on keyup |
| **R4** | **Auto Review flythrough (D6)** — viewport mini-player from the container kebab or ⇧Space: segments to review, direction, start at bounds/current, anatomy and mask dwell (overlay flicker), pause/stop, collapsed by default; bounds from slice occupancy in the viewport's numbering | E2E: visits exactly the occupied range in order; mask hidden during anatomy dwell (pixels); stop restores visibility |
| **R5** | **Checkpoints (D8)** — kebab: Save checkpoint… · Restore checkpoint ▸ (named, timestamped; "baseline" reserved); restore = one undo step through the labelmap transaction; persisted on disk beside autosave (retention 4 per container + baseline); Settings › File Backup: export/import a checkpoint file, guarded by study/series identity | E2E: save → edit → restore returns exact voxels; undo of restore; survives reload; import refuses a different series |
| **R6** | Docs, full offline E2E, visual sweep vs wireframes §8–§11 | CLAUDE.md self-check |

### Branch 2 progress log

- **R1** — Hide PHI: toolbar "PHI" toggle (struck eye + amber tint when on; label constant so the
  toolbar does not reflow) + ⇧H; persisted. Overlay leaves out patient name/ID, study date,
  institution; DICOM header masks PHI values (Patient group + PS3.15-style identifiers, `shared/phi.ts`)
  with per-tag Reveal, and masked values are not searchable. The window title is a fixed
  "XNAT Workstation" — nothing to strip. **Found:** for locally imported files the overlay's
  patient/study fields and the Tags panel are empty (metadata modules / wadouri cache not
  populated) — pre-existing, so overlay/header masking is verified by component tests, not E2E.
- **R2** — M toggles the active segmentation's masks; a ~1.2 s readout on the active viewport
  after hotkey changes (tool, Fill/Erase, brush size, masks, PHI). The spec caught two bugs on
  the way: visibility syncs to the stores asynchronously (the readout said "Masks shown" after
  hiding — the action now states its own result), and the summary's `visible` flag does not
  follow a hide (the second M hid again — it now reads the manager's presentation override,
  as the member rows do).
- **R3** — hold Q: intensity beside the cursor ("HU 70 · (88, 64, 8)" — value with the modality
  unit, and the voxel index), any tool, gone on key-up; nothing shown off the image. The hotkey
  system gains HOLD actions (key repeat ignored; released on key-up or window blur, so a key let
  go elsewhere never leaves one stuck). Verified against the anatomy phantom's known regions.
- **R4** — Auto Review flythrough: kebab "Review flythrough" or ⇧Space; steps through the bounds
  of the chosen segments in the viewport's numbering (gaps included), flickering the masks
  (anatomy → mask) on that viewport only without touching the panel's visibility; Space pauses,
  ⎋ stops and restores. Player sits top-centre (the preview bar's slot — bottom-left, as
  wireframed, is where the slice/position/W-L readouts are); a review discards any preview.
  An unstable zustand selector (`?? []`) in the first draft re-rendered forever (React #185)
  and broke every viewport — caught by the E2E run.
- **R5a** — checkpoints: container menu "Save checkpoint…" (name, or "Use as baseline") and
  "Restore checkpoint ▸" (Baseline first, newest first, delete per row). Voxels stored as
  gzip'd runs on disk (`<userData>/checkpoints/<session__series__label>/`), so they survive
  reloads and match a re-created segmentation of the same scan; restore = one undo step through
  the labelmap transaction, refused (toast) if a segment is locked; retention 4 named + 1
  baseline. Remaining: **R5b** checkpoint file export/import in Settings › File Backup.
- **R5b** — Settings › File Backup › "Segmentation checkpoints · <active segmentation>": Export…
  per checkpoint (save dialog, `.wscheckpoint` JSON) and Import checkpoint file… (validated shape;
  refused unless same series and grid; stored as a new checkpoint). Status in place, not a toast.
- **R6** — tool reference documents the review/display controls; full offline E2E run on the
  built app: 260/260. **Branch 2 complete.**

---

## 7. Branch 3 — `labelmap-interpolation` (ordered plan)

Cut from `review-ergonomics` (same worktree). Nothing ever runs on a labelmap edit — the
lesson of `7a33519` — every interpolation/propagation is user-triggered and previewed.

| Slice | Content | Acceptance |
|---|---|---|
| **I1** | Pure algorithms (`lib/segmentation/interpolation/`): exact EDT (Felzenszwalb) + chamfer DT, signed distance; SDF linear; area-preserving SDF; morphology (Schenk 2000) — **fixed** for non-overlapping anchors (SegWorks returns empty intermediates when A ∩ B = ∅); component matching (Lee & Wang 2000); volume-accurate morphology; image-guided boundary snap (Sobel). Gap finding | Unit tests on synthetic anchors, seen red; mutation-checked |
| **I2** | Interpolate service + sheet (Process › Interpolate): method, gap table (Preview per gap · Fill all), A/B anchors (Set A/B; sheet-scoped keys A, B, ⇧A, ⇧B, ⇧C), Active/All segments, Advanced (DT quality); slice track shows gaps (amber) and anchors; preview → ⏎ | E2E: gap filled between two painted slices, intermediate areas monotone, one undo; nothing happens without the user (labelmap-no-interpolation stays green); oblique fixture |
| **I3** | Propagation (pure + sheet): from the current slice forward/backward/both, CT HU tolerance or MR σ, max slices, auto-stop on area change, stable (median) mode, fill holes, boundary snap, z-smoothing | E2E on `ct-axial-anatomy`: propagates through the bone core and stops at its end |
| **I4** | Docs, full offline E2E, visual sweep | CLAUDE.md self-check |

### Branch 3 progress log

- **I1** `0203fdd` — interpolation algorithms; Schenk fixed for non-overlapping anchors (centroid
  alignment — the shape moves across; SegWorks went empty, and no SDF blend can move a shape).
- **I2** — Process › Interpolate: method (6), fill All gaps / This slice / A → B, Active/All segments,
  gap table (Preview gap per row), sheet-scoped A/B/⇧A/⇧B/⇧C, Advanced distance transform; gaps
  (amber) and anchors on the slice track; preview → ⏎, one undo. Never automatic
  (labelmap-no-interpolation green).
- **I3** — Process › Propagate: from the slice on screen backward / both / forward, up to N slices;
  CT ±HU or MR σ (auto from the series' modality); stable median reference; optional growth limit,
  area-change stop, fill holes, edge guard, z-smoothing. Each slice takes the in-window region
  connected to the previous mask; the first step's runaway check compares with the structure on
  the seed slice (a partial seed is not a leak). Added to what is painted; other segments protected.
- **I4** — tool reference documents Interpolate and Propagate. Full offline E2E: 268/269 — the one
  failure is `contour-copy-paste` ("…the paste interpolates with it"), which is **flaky on `main`
  itself** (measured: main 3/45, review-ergonomics 5/45, this branch ~3/18 with `--repeat-each`);
  it alternated between its two interpolation tests across runs. Not caused by this work; flagged
  as a separate task. **Branch 3 complete.**

---

## 8. Branch 4 — `seg-compute-infra` (ordered plan)

Cut from `labelmap-interpolation`. Interactive semi-automatic tools on the Smart tab, the
compute infrastructure they need, and the ROI limit.

| Slice | Content | Acceptance |
|---|---|---|
| **C1** | Pure algorithms (`lib/segmentation/semiauto/`): Random Walker (Grady 2006 — standardised 8-connected weights, Jacobi-PCG, label-flip stop), Level Trace (CT HU band / MR adaptive band with 7·11·15 windows; binary growth or Udupa fuzzy connectedness; Sobel/Scharr edge guard with strength and polarity; CT air guard; fill holes; Gaussian smoothing; RDP simplification + Chaikin rounding), Smart Brush (connected, in-tolerance dabs along the drag) | Unit tests with known answers, mutation-checked |
| **C2** | Compute worker: a module Web Worker that runs a named algorithm on transferred buffers, reports progress, and can be cancelled; Random Walker runs there. Progress + Cancel in the preview bar's slot while running (no toast) | Unit: worker protocol; E2E: a long solve shows progress and Cancel leaves nothing behind |
| **C3** | Smart tab tools (custom Cornerstone tools, like Select): **Level Trace** (click → preview; Controls: band, growth, edge guard, smoothing, outline), **Smart Brush** (drag paints directly, one undo per stroke; Controls: radius, tolerance, spacing), **Random Walker** (left-drag foreground seeds, right/⇧-drag background; Controls: seed size, β, Run, Clear seeds; seeds drawn as an overlay; Run → preview), **ROI limit** (drag a rectangle; confines Level Trace, Random Walker and Cleanup's scope; Clear) | E2E per tool on `ct-axial-anatomy` against the phantom's known regions; one undo; locked segment refused |
| **C4** | Region-grow guards (#52–58) are delivered by Level Trace's binary mode plus the ROI limit (intensity guard read from the ROI, edge protection) — document the mapping; docs, full offline E2E (unloaded), visual sweep | CLAUDE.md self-check |

### Branch 4 progress log

- **C1** (c140893) — pure algorithms with known-answer unit tests, mutation-checked.
- **C3** — the four Smart-tab tools, built before C2 so that the worker has a real caller to
  move. Tools are BaseTool subclasses that take the press in `preMouseDownCallback` (like
  Select) and reach `semiAutoService` through `tools/semiAutoBridge` — importing the service
  from the tool classes pulled the stores and the tool service into `init`. Controls render
  in the toolbox's Controls strip (`SmartToolControls`, via `useSemiAutoControls`); the ROI
  rectangle and seed strokes are an SVG layer per viewport (`semiAutoOverlay`). Random Walker
  binds ⇧+Primary (Cornerstone dispatches on an exact modifier match), crops to the seeds'
  box + padding or to the ROI limit, and runs on the main thread for now (C2 moves it).
  Cleanup's scope honours the ROI limit.
  - Two Random Walker defects found by the E2E, fixed red-first in C1's code: the label-flip
    stop fired after ~20 CG iterations (few labels flip early because CG starts every
    probability at 0.5 — now gated on a small residual), and regions walled off from every
    seed by strong edges (air in the crop's corners) came back as foreground (now only
    foreground connected to a foreground seed is kept). β is standardised by the crop's σ,
    so a 30 HU lesion beside bone needs β ≈ 2000; the slider runs 10–4000.
  - The `worldToPanelPagePoint` E2E hook divided by devicePixelRatio, but Cornerstone's
    `worldToCanvas` is already in CSS pixels; no spec used it before.
  - E2E `annotations/smart-tools` (6 tests) on `ct-axial-anatomy`; five mutants (ROI ignored
    by Level Trace / by Cleanup, Smart Brush tolerance ignored, no ⇧ binding for Random
    Walker, Smart Brush ignoring the lock) each killed by its own test. Tools + annotations
    E2E groups 216/216.
- **C2** — `lib/compute/`: `protocol.ts` (request → progress… → result | error; the
  worker's body, `handleComputeRequest`, is plain code so unit tests run it), `compute.worker.ts`
  (a module worker), `computeClient.ts` (one job at a time; a new job or Cancel terminates the
  worker — a solve in a tight loop cannot read a cancel message — and the next job starts a
  fresh one). Random Walker runs there: the crop and seeds are prepared on the main thread with
  no transaction held open across the solve; the result is applied through a new transaction
  on the same member. While it runs, the preview bar's slot shows *Running · Random Walker*,
  a progress bar (the residual's fall on a log scale) and Cancel; ⎋ cancels too. An E2E-only
  throttle (`setComputeThrottle`) slows each progress step so the run can be watched and
  cancelled. Unit 8 tests (4 client mutants killed); E2E 2 more (Escape / Cancel button
  mutants killed). Tools + annotations E2E 217/218 — the miss is the known
  `contour-copy-paste` flake (3/3 on rerun).
