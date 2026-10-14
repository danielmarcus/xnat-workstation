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
| **9** | `algorithm-modules` | *Re-scoped 2026-10-13 — see §12:* the open-source module host for community and commercial (signed) modules. Workstation-native module API and loader, run in a sandboxed Worker (not the renderer, which has Electron privileges). Schema-driven param UI, logs (copy/download), cancel, installed modules. Validate by re-authoring one SegWorks add-on against the native API. (#271–283) | 1, 4 | L |

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
| D1 | *Amended 2026-10-12, see below.* Run-style operations live in an **Operations section** of the side panel, its own peer between the member list and the toolbox; the active container/member stay visible |
| D2 | *Amended 2026-10-12, see below.* The SEG toolbox is **one flat grid, no tabs**, at a fixed height |
| D3 | Spline / Livewire mask fills are a **boundary mode on Contour Fill** (Freehand · Spline · Livewire), not new tools |
| D4 | **Viewport preview bar** (top-centre; ⏎ commit, ⎋ discard, hold `\` compare) + sheet footer. Preview = target segment colour, hatched + dashed; never blue, never solid |
| D5 | The viewport scrollbar becomes a **slice track** (active-segment occupancy, gaps, A/B anchors, draggable range) when a SEG member is active |
| D6 | **Flythrough mini-player** on the viewport, launched from the container kebab or ⇧Space |
| D7 | **Hide PHI** toolbar toggle beside Tags (⇧H). Scope: viewport overlay PHI fields + DICOM header PHI values (per-tag reveal) + window title; orientation markers, active ring and XNAT labels kept; exports unaffected |
| D8 | **Checkpoints in the container kebab** (Review flythrough · Save checkpoint… · Restore checkpoint ▸); “baseline” is a reserved-name checkpoint; file export/import in Settings › File Backup |
| D9 | **“2D + 3D QC” layout preset** + QC operation sheet; layout restored when the sheet closes |
| D10 | Worklist space reserved: sidebar **Browse · Worklist** tab + toolbar **case bar** + full-window table view |
| D11 | Modules run from **Process › Modules** sheets; installed/managed in **Settings › Modules** |
| D12 | *Narrowed 2026-10-12, see below.* **Sheet-scoped hotkeys** take precedence while a sheet is open; new globals: hold-Q probe, M mask visibility, ⇧Space flythrough, ⇧H PHI, X cleanup, N/⇧N next/prev case, O contour fill, ⏎/⎋ preview, hold-`\` compare |

Shared rules from the wireframe doc (§5 “Sheet rules”) are binding for every branch.

### D1 / D2 amendment (2026-10-12)

Built as first decided, the sheet sat **above** the toolbox but was opened from the toolbox's
Process tab, so it read as a function of the selected tool. It also made the panel jump: the
toolbox height followed the active tool (202–283 px), and with the sheet open the member list
fell to ~180 px. The layouts compared are in
[`mockup/tools-operations-layout.html`](mockup/tools-operations-layout.html) (A as built ·
B op inside the Process tab · **C separate section**). **C, no tabs** is adopted:

- **Tools and operations are separate.** A tool is a pointer mode (one active, writes on each
  stroke); an operation is a job (parameters + scope → preview → commit). Most later
  operations (Interpolate, Propagate, the solvers, QC) are iterative and used *while* painting,
  so an operation must stay open and usable whatever tool is active. A tab that hides one or
  the other cannot do that.
- **Operations section** (replaces the Process tab + sheet): a 28 px header row — an
  *Operation* picker; when one is open, the target chip, collapse ▾ and close ✕. Open, it has a
  fixed-height body (scrolls) and a footer that stays visible (Preview · Commit · Discard, the
  in-sheet status on its left). Collapsing keeps the operation and any preview alive and leaves a
  one-line summary. Closing with a preview pending asks inline, as before. **X** opens Cleanup
  (or expands it). Sheet rules (§5 of the wireframes) otherwise unchanged; the back arrow goes,
  since there is no list to go back to.
- **Toolbox: no tabs, fixed height.** Every tool in one grid, in group order (Select, Seg Bidir.,
  then Paint, Shape, Smart): **4 columns** at ≥ 360 px panel width (with 4 px button padding, labels up to
  ~66 px fit at the default 400 px; the widest today is 63 px), 3 below that, icon-only below the existing compact width. The Controls area
  has a fixed height per kind, sized to that kind's tallest tool (Segmentation: Threshold), and
  scrolls only on very short windows. The backup status moves into the toolbox header so it
  cannot change the height. Measured target at the default window: toolbox ≈ 290 px (34%);
  ≈ 323 px once branch 4's three tools arrive.
- **Short windows:** the member list keeps ≥ 120 px; the operation body shrinks first, then the
  tool controls scroll.
- **Stale previews:** a preview is still discarded the moment its segment changes underneath it
  (a stroke, an undo). Because painting with an operation open is now normal, the section says
  so — “Preview discarded: the segment changed” — instead of the preview silently vanishing.
- **D12 narrowed:** with an operation open for long stretches beside the tools, operations get
  **no bare-letter keys** of their own; only the preview keys (⏎ ⎋ hold-`\`), which exist only
  while a preview does.
- **Later branches:** solver seed painters live inside their operation's body and share the one
  active pointer mode with the toolbox (picking one clears the toolbox highlight and vice versa).
  If the grid outgrows ~20 tools, revisit grouping.

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
| **S10** | **D1/D2 amendment**: Operations section (picker header, target chip, collapse/close, fixed body, pinned footer with status) replaces the Process tab + sheet; flat no-tab toolbox (4/3 columns, group order); fixed-height Controls per kind; backup status in the toolbox header; stale-discard message; list ≥ 120 px; docs updated | E2E (seen red on the S9 build): every SEG tool on screen with no tabs; toolbox height identical for every tool and no tool's controls scroll; Cleanup opened from the Operations row stays usable while tools change and does not move the toolbox; collapse keeps the preview; painting under a preview discards it and says so. Existing cleanup / segment-ops / smart-cleanup / slice-track E2E green through the new affordance |

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
- **S10** — D1/D2 amendment, on branch `mask-ops-ops-section` (cut from `mask-ops` in a separate
  worktree: the main checkout held someone's uncommitted focus-handling work). Operations section +
  flat no-tab toolbox as specified above; in the built app the toolbox is 291 px for every tool and
  an open operation 260 px (panel 832 px). Deviations found by running it: the 4-column buttons use
  4 px padding (with 6 px, "Dyn. Thresh" clipped by 0.3 px at 400 px — panel-resize E2E caught
  it); the open operation's picker is 96 px so a collapsed "Preview pending" summary fits. New
  `operations-section` E2E (6) red on the S9 build, green now; the stale-notice and collapse
  assertions also seen red against built mutants. Annotations + tools E2E 190/192 on the first
  run: panel-resize (fixed above) and `contour-copy-paste` "loaded Structure contour … paste
  interpolates", which passes 3/3 alone — the known flake another session is fixing.
  After merging S10 into `mask-ops` with the focus-handling and loaded-contour commits: full offline
  E2E on the built app **250/250**, unit 981/981, typecheck clean. Merged to `main` and pushed
  2026-10-12 (`3103649`; full offline E2E 252/252 on the merge). Branches 2–7 were cut from S9 and need S10 merged forward (their Process-tab sheets
  and tabbed tools move to the Operations section and the flat grid).

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
- **Forward merge of S10 (2026-10-12)** — `mask-ops` (Operations section, flat toolbox, focus
  handling) merged in; only the hotkey files conflicted (hold-Q / M kept beside the new
  `holdsKeyboard` guard). Unit 993/993; full offline E2E on the built app **268/268**.

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
- **Forward merge of S10 (2026-10-12)** — Interpolate and Propagate move from Process-tab sheets
  into the Operations section (picker: Cleanup · Propagate · Interpolate) in its compact row style,
  sharing one close / confirm / stale-notice path (`hooks/operationLifecycle.ts`) and one footer.
  **Anchor keys are now chords** — ⌥A / ⌥B set, ⌥⇧A / ⌥⇧B / ⌥⇧C clear (matched on `e.code`;
  ⌥A types "å" on a Mac): with the operation open while painting keyframes, bare A / B would
  have taken Angle and Brush away (D12 as narrowed). The bare-letter mutant fails the new “B still picks the Brush” E2E.
  Unit 1013/1013; full offline E2E on the built app **277/277**.

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
- **C4** — region-grow guards (#52–58). Six of the seven were already delivered by Level
  Trace's binary mode, the ROI limit and the edge/air guards; the explicit intensity guard
  (#56) and reading it from an ROI (#57) were missing and were added (red-first unit tests;
  E2E with two killed mutants).

  | # | SegWorks feature | Workstation |
  |---|---|---|
  | 52 | Seeded region grow | Level Trace, binary growth: the connected region inside the band around the clicked pixel (and Cornerstone's Region / Region+) |
  | 53 | Seed placement, reposition / clear before running | The click previews; clicking again replaces the preview, ⎋ clears it, ⏎ commits — nothing is written until then |
  | 54 | HU tolerance | Level Trace › HU tolerance |
  | 55 | Modality detection | Level Trace › Band: *From scan* reads the series modality (CT → HU band, otherwise MR σ band) |
  | 56 | Intensity guard | Level Trace › Intensity guard: only [min, max] is taken, whatever the band allows |
  | 57 | Read intensity guard from ROI | Intensity guard › *From ROI*: the 2nd–98th percentile of the image inside the ROI limit, on the slice shown |
  | 58 | Body / edge protection | Edge guard (Sobel/Scharr, gentle/strong, polarity) and *Stop at air* (CT); the ROI limit as a hard boundary |

  Full offline E2E (unloaded): 279/279. Unit 1040/1040. Branch 4 complete.
- **Forward merge of S10 (2026-10-12)** — the four Smart tools join the flat grid in their
  families (Smart Brush with Paint; Level Trace, Random Walker, ROI limit with Smart): 19 tools,
  5 rows. Their controls stay in the toolbox's Controls area, which is now **180 px** — sized to
  the tallest tool with Advanced folded, measured in the built app (Level Trace with band "From
  scan" and an ROI limit, Random Walker with its Run row and ROI chip). Level Trace gains an
  **Advanced ▸** toggle on its Band row: band, tolerance and edge guard stay in view; sample size,
  smoothing, growth, edge operator, polarity, simplify, round corners, the intensity guard and the
  hole / air checks fold away (329 px when open; the area scrolls). Toolbox **379 px** (46% of
  the default panel; the amendment's 323 px estimate assumed Threshold stayed the tallest).
  "Rand. Walker" became **"Rnd. Walker"** — 68.7 px clipped the 66.75 px four-column label (the
  panel-resize E2E caught it). A Smart Brush stroke that replaces an operation's preview now
  raises the same "Preview discarded: the segment changed" notice as any other edit
  (`discardPreviewForEdit` at stroke start; the stroke's own silent commit no longer clears it)
  — new E2E, seen red against a built mutant. Unit 1042/1042; full offline E2E on the built app **288/288**.

---

## 9. Branch 7 — `seg-3d-qc` (ordered plan)

Cut from `seg-compute-infra` (meshing runs in its compute worker). Wireframe D9-A: a
**“2D + 3D QC” layout** (the active 2D viewport beside a 3D one) opened by a **3D QC sheet**
in Process; the user's layout comes back when the sheet closes. Domain items #245–246 and
#254 (pancreas) stay deferred (decision 4).

**Approach change from §2:** surfaces are built by our own pipeline, not Cornerstone's
PolySeg `Surface` representation. QC needs per-component colour and picking, a chosen
resolution (#239), blocky vs marching-cubes extraction (#247), Taubin smoothing (#240),
stray highlighting (#242) and hide-largest (#248) — PolySeg exposes none of these. The
pipeline: labelmap → (max-pool) resample → 3D connected components → mesh per component
(voxel faces, or marching cubes) → Taubin → vtk.js actors added to the existing VOLUME_3D
viewport (its volume rendering hidden while QC is open). Meshing runs in the compute worker.
Nothing rebuilds automatically on edits (cross-cutting rule): the sheet marks the surfaces
**stale** and offers Rebuild (#235).

| Slice | Content | Acceptance |
|---|---|---|
| **Q1** | Pure algorithms (`lib/segmentation/qc3d/`): 3D connected components (26-connected) with voxel count, volume (cc), bounding box, centroid; size bands main · fragment · stray · speck from the stray/speck thresholds (#243–244, #252); max-pool resampling to 128 / 192 / 256 on the longest axis (a one-voxel speck stays visible); surface extraction — voxel-face (“blocky”) and naive Surface Nets for the smooth renderer (#247; VTK's SurfaceNets3D method — closed, oriented, no 256-case tables, fewer triangles than marching cubes); Taubin λ/μ smoothing (#240) | Unit tests with known answers (sphere area/volume, component counts and bands, speck survives resampling, Taubin keeps volume while reducing roughness); mutation-checked |
| **Q2** | `qc3dService` + worker job `surfaceMesh`: build per component on demand, vtk actors in the 3D viewport, colours from the segment (strays/specks highlighted when *Show strays* is on), per-label visibility and hide/show all (#237–238), hide largest (#248), thin-structure boost (#249: components whose thickness is below 2 voxels are meshed one voxel dilated for display only), brightness and ambient (#250), auto-rotate (#241), reset view (#251), rotate / ⇧-drag pan / wheel zoom (#231–233), fullscreen = maximise the 3D panel (#236), stale flag + Rebuild (#235) | E2E: surfaces appear for a painted segment (pixel check on the 3D canvas), visibility and hide-largest change the pixels, Rebuild after an edit |
| **Q3** | “2D + 3D QC” layout preset and the **3D QC sheet** (Process › 3D QC): render settings, label list, component report (category, cc, voxels, slice range) with stray/speck thresholds; row ↗ jumps the 2D viewport to the component (#253); select by row or by clicking it in 3D (#234) — highlighted in 3D and in the report, and the 2D viewport jumps to it; **Delete component** through a LabelmapTransaction, one undo step (#255, #257); the user's layout restored on close | E2E on `ct-axial-anatomy` with a main region plus strays: report counts/bands, jump moves the 2D slice, delete removes exactly that component and undoes, lock refused, layout restored |
| **Q4** | **3D scissor** (#256): a lasso drawn on the 3D view removes the active segment's voxels whose projection falls inside it (or keeps only those inside), along the view direction through the whole volume; preview → ⏎ commit, one undo (#257) | E2E: a lasso over half of a region removes that half; undo restores; locked segment refused |
| **Q5** | Docs (tool reference, this log), full offline E2E (unloaded), visual sweep | CLAUDE.md self-check |

### Branch 7 progress log

- **Q1** — `lib/segmentation/qc3d/`: `components.ts` (26-connected labelling, largest first,
  bands), `resample.ts` (max-pool), `mesh.ts` (voxel faces, Surface Nets, volume/area),
  `smooth.ts` (Taubin). 11 unit tests (closed-and-oriented checks, sphere volume/area within
  8%/10%, Taubin halves roughness at < 5% volume change); six mutants killed — one survived
  at first because the resampling test's speck sat at the one in-block offset the mutant
  kept, so the test now places specks at every offset.
- **Q2** (with Q3's layout and sheet shell) — `qc3d/build.ts` (components at full resolution,
  each meshed from its own crop with one volume-wide max-pool factor, thin boost, world
  coordinates, outward normals), worker job `qcSurfaces`, `qc3dService` (vtk.js actors in the
  QC layout's 3D view; its volume rendering hidden meanwhile), `qc3dStore`, `useQc3dSheet`,
  `Qc3dSheet` (Process › 3D QC). `@kitware/vtk.js` is now a direct dependency, pinned to the
  version Cornerstone uses. The camera opens on a three-quarter view fitted to the surfaces
  (`parallelScale` is half the view's *height*, so a tall narrow view is fitted by width).
  3D view: wheel zoom and ⇧-drag pan added to the 3D tool group. *Expand 3D* lays the 3D
  panel over the whole viewport area; the 2D viewport stays mounted beneath it.
  - Test lessons: the overlay text drawn over the 3D canvas made a brightness count pass on
    an empty view — the E2E counts *coloured* pixels; and Surface Nets is dual to the voxel
    faces (same triangle count, and for a one-slice region the same vertex count), so the
    renderer test compares vertex positions.
  - E2E `annotations/qc-3d` (6 tests); five mutants (hide largest, stale watch, volume left
    visible, layout not restored, build settings not rebuilding) each killed.
- **Q3** — select a component by its report row or by clicking its surface (a click, not a
  drag — that rotates; ray-picked against the visible meshes, `qc3d/pick.ts`): it turns white
  in 3D, its row highlights, and the 2D viewport moves to the slice through it (stack: by
  the viewport's own slice numbering; volume viewport: `jumpToWorld`). The report shows each
  component's slices in that numbering. **Delete component** (button, or ⌫ while the sheet is
  open) flood-fills from the component's seed voxel through a LabelmapTransaction — one undo
  step — and rebuilds; a locked segment refuses. Four mutants killed (no jump, ray reversed,
  delete only the seed, delete ignoring the lock).
- **Q4** — 3D scissor: with ✂ Scissor on, a drag on the 3D view draws a lasso (the press is
  taken as a capture-phase pointer event and cancelled, so the rotate tool never sees it).
  Under parallel projection a voxel's canvas position is affine in its index, so four
  projected points place every voxel (`qc3d/scissor.ts`); the active member's voxels inside
  the lasso (or outside — *Keep inside*) are removed through the whole volume, as a preview
  on the 2D viewport (⏎ applies, one undo step; a locked segment previews read-only). The 3D
  surfaces rebuild when the cut is applied.
  - Found while testing: with a locked segment, something on the viewport cancels
    `pointerdown`, which suppresses the compatibility `mousedown` — a mouse-event lasso never
    started. Pointer events fix it.
  - Mutants: press not taken from the rotate tool, *Keep inside* ignored, locked refused
    instead of previewed — each killed by an E2E; the slice axis ignored in the projection
    survived the unit tests until a side-view test that selects by k was added (the even–odd
    ray direction mutant is equivalent).
- **Q5** — tool reference updated; full offline E2E (unloaded) 292/292; unit 1067/1067.
  Branch 7 complete. Known, not fixed here: switching to the QC layout narrows the 2D
  viewport and Cornerstone keeps its vertical fit, so the 2D image is cropped at the sides
  until the user zooms out (the same happens for any layout that narrows a viewport).
- **Forward merge of S10 (2026-10-12)** — 3D QC moves from a Process-tab sheet into the
  Operations section (picker: Cleanup · Propagate · Interpolate · 3D QC); its sections scroll in
  the operation's body above its own footer (Rebuild · Reset view · Expand 3D · Done). Collapsing
  it keeps the 2D + 3D layout; Done or ✕ closes it and restores the user's layout (new E2E). Its
  collapsed summary reads "N stray · N speck" (or the build progress). Unit 1069/1069; full
  offline E2E on the built app **302/302**; checked in the built app with Interpolate open beside
  Level Trace and with 3D QC open (toolbox 379 px, operation 260 px, Controls 180 px).

---

## 10. Branch 6 — `contour-refine` (ordered plan — for review)

Cut from `main` after branches 1–4 and 7 merged (2026-10-12). Scope: SegWorks #72–100 (Live
Wire and Spline Contour) and #200–201 (Snake Refine), read from the v2.0.610 inventory and the
reference source (`segworks_livewire_core.js`, `segworks_spline_core.js`, `segworks_core.js`).

**What the inventory changes about the scope.** In SegWorks, Live Wire and Spline Contour are
*mask* tools: the closed contour is committed into the active segment (#74, #82). Snake Refine
is a Cleanup operation on the active segment's boundary (#200, inside the Cleanup range
#182–212). So this branch is mainly **D3** — Contour Fill gains *Spline* and *Live Wire*
boundary modes for Segmentations — and its refinements also reach Workstation's existing
Structure Spline and Livewire tools through the same controls (D3, wireframes §4).

### Design points (decided in this plan; flag any to change)

1. **Snake Refine is a Cleanup operation**, in the Operations section's Clean group, on the
   active segment with the usual scope. No Operations section is needed for Structures.
2. **The Structure toolbox gets a fixed-height Controls area**, like Segmentation's (D2 as
   amended): Spline and Live Wire now have settings, so Structure controls change with the
   tool. Sized to the tallest Structure tool with Advanced folded; the
   `operations-section` height E2E is extended to the Structure toolbox.
3. **Extend Cornerstone, do not fork.** Live Wire: subclass `LivewireContourSegmentationTool`
   (and the labelmap variant used by Contour Fill) to supply our own cost map; Cornerstone's
   built-in cost stays as the *Basic* mode. Spline: Cornerstone's spline configuration takes a
   class per type, so the new families are `Spline` subclasses registered there (Centripetal
   Catmull-Rom, Cubic B-spline and Linear already exist).
4. **Local ROI spline editing uses branch 4's ROI limit** rectangle, not a second ROI concept.
5. **Every variant ships** (decision 5): seven spline algorithms; Live Wire Basic and Advanced;
   Snake edge-only, GVF, balloon, and the morphological snake.
6. **No new toolbox buttons** (D3). **O** cycles Contour Fill Freehand → Spline → Live Wire
   (D12 global). Spline-only actions (undo commit and reload, copy from a nearby slice,
   propagate) appear only in Spline mode.
7. **Index space throughout** — every boundary is rasterized through Contour Fill's index-space
   rasterizer inside the labelmap transaction (one undo step, locks respected), so `ct-oblique`
   works (see the oblique contour limits). Each slice's E2E includes an oblique case.

### Slices

| Slice | Content | Acceptance |
|---|---|---|
| **F1** | Pure algorithms (`lib/segmentation/contours/`): spline families — centripetal Catmull-Rom (#93), cubic B-spline (#94), monotone cubic, Fritsch-Carlson (#95), Akima (#96), local Catmull-Rom+ (#97), tension spline (#98), ROI active spline = local CR+ nudged toward image gradients inside the ROI (#99); self-intersection test (#100); Chaikin smoothing (#81). Live Wire cost builder: Gaussian pre-smoothing σ (#78), Scharr or Sobel gradient (#76), gradient weight (#75), direction term (#77), Laplacian zero-crossing cue (#79) — SegWorks defaults 0.85 / 0.15 / σ 0.8 / 0.12. Snake on binary planes: Kass edge-snap, optional GVF external force (μ 0.2, 40 iterations), optional balloon force (0.15), morphological snake; label-aware boundary competition (#201) | Vitest on synthetic planes and curves, each seen red first; interpolating families pass through every control point, approximating ones do not; Akima / monotone show no overshoot on a step; mutation-checked |
| **F2** | **Live Wire** with the new cost: Basic (Cornerstone's) and **Advanced** mode; Controls — gradient weight, close tolerance (#80), commit smoothing (#81); Advanced folds direction weight, pre-smoothing, Laplacian cue, edge kernel. Applies to the Structure Livewire tool. **Structure toolbox fixed Controls height** (design point 2) | E2E on `ct-axial-anatomy`: an Advanced path between two anchors on the lesion follows its edge (pixel distance to the known boundary below a bound) where Basic cuts across; close tolerance governs when the contour closes; Structure toolbox height identical for every Structure tool and no controls overflow (seen red first) |
| **F3** | **Spline** families and editing in the Spline tool: algorithm picker (all seven + Cornerstone's Cardinal/Linear); point undo (#83) and clear (#84) as visible actions beside the keys; self-intersection protection toggle (#100); **global vs local-ROI edit** (#90–91) — local edits change only the part of the contour inside the ROI limit; ROI viewport fit with multiplier and margin (#92); ROI active spline (#99) | E2E: switching algorithm changes the drawn curve through the same points (control points unchanged); a local-ROI edit leaves every contour point outside the ROI where it was; a crossing edit is refused with the toggle on; oblique case |
| **F4** | **D3 — Contour Fill boundary modes** Freehand · Spline · Live Wire for Segmentations, **O** cycles; Spline and Live Wire boundaries are drawn with F2/F3's tools and their controls (one shared controls component), then rasterized into the active segment through the index-space rasterizer and the labelmap transaction | E2E: each mode fills the lesion on `ct-axial-anatomy` and on `ct-oblique` (voxels inside the drawn boundary, one undo step); a locked segment is refused with the existing warning; O cycles the mode (the cursor follows) |
| **F5** | **Spline slice workflow** (Spline mode, Segmentations and Structures): undo the last commit and reload its control points for adjustment (#85); copy a spline from a nearby slice as an editable contour (#86); **propagate** backward / forward (#87–88) with preview tracks — spline deformation, mask propagation (branch 3's propagation), propagation + morphological snake (#89) — previewed, ⏎ commits | E2E: commit → undo-and-reload restores the voxels and the same control points; copy lands an editable contour on the current slice with no voxels written; each propagation track previews on the next slice and commits as one undo step |
| **F6** | **Snake Refine** (#200–201): a Cleanup operation (Clean group) — iterations, edge weight, variant (edge · GVF · balloon · morphological), **Replace boundary with neighbours** off by default; Advanced folds GVF μ / iterations and balloon strength; scope Slice / Range | E2E on `ct-axial-anatomy`: a deliberately loose mask around the lesion moves toward its edge (Dice with the known lesion rises); neighbours untouched by default and only shared-boundary pixels reassigned when allowed; preview → ⏎, one undo; oblique case |
| **F7** | Docs (`annotation-tool-reference.md`: Live Wire and Spline settings, Contour Fill modes, Snake Refine), full offline E2E, visual sweep in the built app, merge to `main` | CLAUDE.md self-check answered |

**F5 design (worked out before building it, 2026-10-12).** One mechanism serves all three
actions and both annotation types: the **spline in hand** — a closed spline on the current
slice, created by the mode's own tool exactly as its first click would create it (Structure:
the Spline tool on the active member; Segmentation: Contour Fill's Spline boundary), with the
chosen family, and editable by its handles. It is the preview: **⏎ commits** it through the
path a drawn spline takes when it closes (Cornerstone's completion → union into the member for
a Structure, F4's fill for a Segmentation — one undo step either way), **⎋ discards** it. Its
edits record no history; only the commit does.

1. **Undo & edit** (#85): enabled after a spline commit; it acts only while that commit is
   still the newest entry of the active container's undo history (the entry's identity is
   captured when the commit settles) and otherwise says so and undoes nothing. It undoes the
   commit through the normal undo path and puts the same control points back in hand, on
   their slice.
2. **Copy nearby** (#86): the active member's content on the nearest other slice (up to 10
   away; the previous slice wins a tie), projected onto this slice and put in hand — nothing is
   written. The control points are that slice's remembered spline when it was drawn as one,
   otherwise its outline resampled to control points (a Structure's contour; a Segmentation's
   largest island boundary).
3. **Propagate ◀ ▶** (#87–89): the spline in hand (committed first) — or else the member's
   outline here — is carried to the previous / next slice, the viewport moves there, and the
   result is put in hand. Track (in ▸ Options): **Deform** (control points pulled onto edges on
   the new slice, `refineTowardEdges`), **Mask** (branch 3's `propagateStep` from this slice's
   region, outline → control points), **Mask + snake** (then the morphological snake). Slice by
   slice: adjust, ▶, adjust, ▶ — each slice one undo step.

Shown only in Spline mode: a **Slice** row (Undo & edit · Copy nearby · ◀ ▶), and **Commit**
beside Undo point / Clear while a spline is in hand. The Controls height grows to fit if
needed; the height E2E keeps it fixed across tools.

### Branch 6 progress log

- **Plan** — written 2026-10-12; approved to proceed through all slices.
- **F1** — `lib/segmentation/contours/`: `splines.ts` (seven families + `refineTowardEdges`),
  `polygon.ts` (self-intersection; Chaikin and rasterize re-exported from Level Trace),
  `livewireCost.ts` (pre-smoothing, Scharr/Sobel, Laplacian zero-crossing, direction term,
  weighted link cost in Cornerstone's scissors form), `snake.ts` (edge, GVF, balloon,
  morphological; neighbour / lock / ROI rules). Two deviations from SegWorks, both fixes:
  its morphological snake could only grow (the retract step was a no-op), so this is the
  published MorphGAC; and its area guard is applied, as SegWorks does, **per step**
  (+15 % / −30 %) — applied to the original area it stopped deflation short of the edge.
  SegWorks' "Local Catmull-Rom+" and "Tension spline" are the same cardinal curve with
  different tension caps (0.95 / 0.98); both ship. 39 unit tests; 20 mutants, all killed
  (four survived the first round and the tests were strengthened — a circular reference
  ring, a missing local-extreme case, and two morph cases that could not tell the variants
  apart).
- **F2** — `AppLivewireContourTool` extends Cornerstone's Live Wire under the **same tool name**
  (RTSTRUCT export, the tool group and annotations unchanged). Advanced mode rebuilds the
  scissors on the same normalised image with F1's cost (the private blend is replaced on the
  instance); close tolerance adjusts only the click's canvas position that Cornerstone's
  close test reads (its own threshold is a fixed 10 px); commit smoothing runs Chaikin on the
  closed path. Settings live in a dependency-free module (`contourToolSettings`) the tool
  reads at click time; `ContourToolControls` renders them (Edge cost Basic/Advanced, Edge
  weight, ▸ Weights: direction / Laplacian / pre-smooth / kernel, Close within, Smooth
  commit). Structure Controls area fixed at **176 px** (Live Wire Advanced, folded).
  **Found on the way:** a Live Wire contour whose anchors are far apart (120°) can take the
  long way round and close by retracing it — a zero-area contour that Cornerstone's contour
  union rightly drops (the stroke vanishes). Not a code bug; the E2E anchors are 45° apart.
  The first wrapper copied the click event onto Event's prototype, whose accessors throw on a
  non-Event (the click died silently); it is now a plain object. E2E `contour-refine` (4):
  height test red before the fixed height; the three behaviour tests red against a build with
  Cornerstone's own Live Wire. Unit 1109/1109.
- **F3** — `AppSplineContourTool` extends Cornerstone's Spline under the same tool name. Each
  family is a Cornerstone `Spline` subclass (`FamilySpline`, curve pieces from F1's new
  `splineSegments`; Cornerstone evaluates splines in canvas coordinates) registered as a
  spline type (`SW_*`); the chosen family applies when a spline is created. Self-intersection
  protection: a crossing close is refused before Cornerstone closes (closing completes the
  drawing there); any other crossing edit is undone at the render-time rebuild every edit goes
  through. Undo point removes one point (Cornerstone's own delete is for finished splines and
  drops the whole spline at three points); Clear cancels. Local ROI mode (with the ROI limit
  drawn): points are added and moved only inside it — **the acceptance was narrowed** from
  "every contour point outside the ROI stays put", which no interpolating spline can promise
  (the pieces next to a moved point change). Fit ROI zooms and centres the ROI limit's viewport
  (`contourToolService`). ROI active spline refines the curve toward edges inside the ROI in
  image index space (stack and volume). Controls: Algorithm (+ ▸ Options: density, tension,
  no-crossing), Edit Global / Local ROI (+ Fit ROI), Undo point / Clear.
  **Found on the way:** (1) the self-intersection test counted only strict crossings, so a
  symmetric curve passing through the same sample point twice was missed — signs are now
  compared with zero as a value of its own (new unit test, strict-sign mutant killed);
  (2) Cornerstone holds a canvas mousedown back while it waits for a possible double-click, so a
  reading right after a click lags by one — a `poll` for a refused click could pass on the
  in-between count, which let a guard-off mutant survive; refused-click tests now read the
  settled state. E2E +6 (red against a build with Cornerstone's own Spline and a no-op Fit ROI;
  the guard test against a guard-off mutant). Unit 1116/1116.
- **F4** — Contour Fill's boundary (D3) is a "Boundary" control — Freehand · Spline · Live
  Wire — remembered across tool switches; **O** picks Contour Fill, and pressed again cycles
  the boundary (HUD `Contour Fill · <mode>`). Freehand stays Cornerstone's
  LabelMapEditWithContour with its own undo bridge. Spline and Live Wire are two plain
  (non-segmentation) contour tools — `ContourFillSpline` / `ContourFillLivewire`, the same F2/F3
  mixins on Cornerstone's `SplineROITool` / `LivewireContourTool`, so every setting applies —
  whose closed outline `fillOutlineIntoActiveSegment` rasterizes in image index space (oblique
  safe) and unions into the active segment through the labelmap transaction (one undo step),
  then removes the outline. A locked segment is refused twice over: the draw-gesture guard
  stops the gesture (the fill tools are SEGMENTATION_TOOLS), and the fill service refuses with
  the same lock warning as a backstop. **Found on the way:** the locked test first asserted
  only "nothing filled", which the transaction guarantees on its own — it survived a
  lock-bypass mutant; it now asserts the lock warning, and is red only when BOTH the guard and
  the service check are removed (each alone keeps it green — verified as two mutants). The new
  tool classes reach Cornerstone by deep import, which the unit tests' `@cornerstonejs/tools`
  mock does not cover, so the two suites that load `unifiedToolService` mock those modules (as
  they already did SafePaintFillTool). E2E +8 (`contour-fill-modes`; red against mutants of
  the boundary switch, the tool selection and O cycling). Unit 1116/1116.
- **F5** — the spline slice workflow, as designed above (`splineSliceService`; the spline in
  hand is `placeInHand` / `commitInHand` / `discardInHand` on the F3 Spline mixin, so both
  annotation types share it). Controls: a **Slice** row (Undo & edit · Copy nearby · ◀ ▶),
  **Commit** beside Undo point / Clear while a spline is held, and **Track** in ▸ Options; the
  Controls heights grow to 186 (Segmentation) / 182 (Structure) px. Copy nearby's control points
  are the remembered spline when that slice was drawn as one, else its outline resampled
  (`outlineControlPoints`: the LARGEST island — Level Trace's `traceBoundary` takes the first
  one in scan order). **Found on the way:** (1) Cornerstone gives an annotation its UID only
  when it is added, so a spline placed in hand was never found again — it now gets one first;
  (2) ⏎ straight after a spline is placed came before its first render, which is where its
  outline is built — commit builds it when it is missing; (3) F3's `slicePlane` read volumes
  through Cornerstone's `getCurrentVolumeViewportSlice`, which refuses oblique views — it now
  reads the volume in its own index space (also fixes the ROI active spline on oblique
  series); (4) a Segmentation's outlines are located by the grid's own slice index (an oblique
  outline is not in the view plane); (5) two first guesses about the tracks were wrong and
  the tests now say what they do: Deform walks a point a pixel per pass and so reaches an
  edge several pixels away, and Mask from a ring inside the bone is refused by propagation's
  leak guard (area change > 60 %). The operations-section height test now also counts
  Contour Fill's three boundaries. E2E +17 (`spline-slice-workflow`), red against mutants of:
  the track switch (each way), the stale-commit check, the remembered control points, the
  commit-time outline, the oblique slice reader, and a held spline's edits recording history
  (pinned on Cornerstone's own ring — the per-container history never sees those entries).
  Not pinned: Mask + snake vs Mask (on the phantom's crisp edges the snake leaves the mask
  where it is). Annotations + tools E2E 271/271; unit 1121/1121.
- **F6** — **Snake refine** is a Cleanup operation (Clean group): Variant (Edge · Gradient
  vector flow · Balloon · Morphological), Iterations, Edge weight, **Neighbours** (Keep — the
  default — or Replace shared boundary); Advanced folds GVF μ / iterations and Balloon force;
  the usual Slice / Range / Volume scope, preview, ⏎, one undo step. #201 is built on the
  plane runner: `runPlaneOp` now hands an operation its neighbours' and the locked members'
  pixels and lets it CLAIM pixels, which leave their unlocked owners first (the pair runner's
  mechanism, generalised); an operation declares when it claims, so the service opens the
  unlocked neighbours for writing. **Deviation from the plan:** the E2E uses the bone (1000 vs
  40 HU) rather than the lesion, whose 30 HU edge is too faint to be a dependable target.
  **Found on the way:** the neighbour test first placed Segment 2 one pixel clear of the seed
  (pixel centres fall on the half millimetre), so "shared boundary" rightly claimed nothing —
  it now touches; a redundant lock check in the claim loop was an equivalent mutant and was
  removed. Unit +7 (runner claims, catalog wiring; mutants: variant, claimed set, claims flag,
  always-replace); E2E +5 (`snake-refine`; mutants: neighbours not opened for writing, locked
  members not passed, snake never running, variant ignored — each red). Checked in the built
  app: the preview dims exactly the loose band, the sheet fits the Operations section.
- **F7** — `annotation-tool-reference.md`: Contour Fill's boundaries and **O**, a *Spline and Live
  Wire* section (settings, the Slice workflow and its tracks), Snake refine in the operations
  table. Checks on the built app: typecheck, lint, unit **1128/1128**; full offline E2E
  **342/342** on the second run. The first full run had one failure outside this branch's
  area — `transport/sr-scan-click-reload` hung to its 2-minute timeout — which passed alone
  (3.7 s), with the transport folder (19/19) and in the full rerun: intermittent, not
  reproduced. Visual sweep done slice by slice in the built app (F2–F6 screenshots: Live Wire
  and Spline controls, Contour Fill's three boundaries, the Slice row with a spline in hand
  on the propagated slice, the Structure toolbox, Snake refine's preview and sheet). Branch 6
  complete.

---

## 11. Branch 5 — `seg-3d-solvers` (ordered plan — for review)

Cut from `main` after branch 6 merged (2026-10-13). Scope: SegWorks #101–151 — Fast GrowCut
(#101–115), binary Graph Cut (#116–123), multi-label α-expansion (#124–135) and multiphase
Chan-Vese (#136–151, the clinical preset library #137 deferred by decision 4). Read from the
v2.0.610 inventory and its reference source (`segworks_core.js` GrowCut / Graph Cut,
`segworks_graphcut_ml_*.js`, `segworks_chanvese_*.js`).

**What the reference source changes about the scope.** The SegWorks code does not implement
what its labels say, and a faithful port would carry its defects:

| SegWorks feature | What the code actually does | This branch |
|---|---|---|
| "Fast GrowCut" | The original cellular-automaton GrowCut, swept in place (order-dependent), full volume per iteration; ±x/±y neighbours **wrap across row and slice ends** (its bounds check is never called) | True **Fast GrowCut** (Zhu et al. 2014: Dijkstra-style shortest-path propagation from the seeds, one pass); 6-connected with real bounds |
| Binary Graph Cut | Boykov–Jolly energy solved by Dinic with a **recursive** DFS (stack overflow on large ROIs); a 3 M-voxel cap | Same energy, solved by **Boykov–Kolmogorov** (iterative, the standard for image grids) on typed arrays |
| α-Expansion | "one-vs-rest expansion" (`exactAlphaExpansion: false`): no pairwise term between two non-α labels; every ROI voxel is forced into a seeded label, so the **whole ROI box is painted** unless background is seeded | True **α-expansion** for the Potts model (Boykov–Veksler–Zabih), with **Background as a label of its own** |
| "Multiphase Chan-Vese" | ICM region competition (piecewise-constant means + Potts) swept in place, order-dependent | The same model, named honestly ("Region competition (Chan-Vese)"), updated in **checkerboard** order so the result does not depend on scan order |
| Parameters | `Number(x \|\| default)` — **0 silently becomes the default** (island cleanup cannot be turned off; Keep 0 → 0.05) | 0 means 0 |
| Commit | Writes the label into every voxel, **overwriting other segments**; Chan-Vese overwrites its whole ROI box, zeros included | The labelmap transaction: written members only, other members preserved, locks respected, one undo step |
| Memory guards | Inconsistent (`confirm()` dialogs; a UI guard the run-time cap always pre-empts; none for GrowCut or α-expansion) | One guard for every solver: estimate line → amber warning → disabled Run with a reason (wireframes §5). Never a modal |

Defaults and ranges are SegWorks' wherever its controls carry over (listed per slice).

### Design points (decided in this plan; flag any to change)

1. **Two operations, variants in a dropdown** (sheet rule). **Seeded segmentation** — Method:
   Fast GrowCut · Graph Cut · Multi-label graph cut (α-expansion) — and **Region competition**
   (Chan-Vese), which starts from the existing segmentation and needs no seeds. Both join the
   Operations picker (Cleanup · Propagate · Interpolate · Seeded segmentation · Region
   competition · 3D QC).
2. **One seed model for every seeded method.** Seeds are classes: each member of the active
   segmentation, plus **Background**. The binary methods solve the active member against
   Background *and every other member's seeds*; α-expansion solves all seeded classes at once.
   So switching Method never loses seeds. Seeds are world-space strokes kept per slice
   (multi-slice, #105), drawn as an overlay in the class's colour (Background grey), with a
   brush radius in mm.
3. **The seed painter is a pointer mode owned by the operation** (wireframe rule): the
   operation's *Paint seeds* toggle takes the one active pointer mode (the toolbox highlight
   clears; picking a tool ends seeding). Left-drag paints the selected class, **right-drag (or
   ⇧) paints Background** — for the binary methods the "opposite class" (#104); Erase removes
   seed under the brush. **Restore seeds** brings back the seeds of the last run (#115).
   Branch 4's Random Walker seeds move onto the same model (single slice, two classes), so
   there is one seed store and one overlay, not two.
4. **Domain**: *Seeded range* (seeds' slice extent ± Z pad, XY = seeds' box ± XY pad — the
   α-expansion defaults, 24 px / 2 slices), *ROI limit* (branch 4's rectangle, over the seeded
   or a chosen slice range), *Volume*. Shown as the box it will solve, with its voxel count and
   memory estimate. Index space throughout (`ct-oblique` works).
5. **Compute in the worker** (branch 4's protocol): progress, Cancel, one job at a time. A
   cancelled α-expansion keeps nothing (no partial commit) — simpler than SegWorks' checkpoints
   and consistent with the other operations.
6. **Memory guard** from each solver's measured peak bytes per voxel (measured in G1, not
   guessed): amber above the warning level, Run disabled above the limit, with the reason.
   A test seam lowers the limits so the E2E can show both states on the small fixtures.
7. **Post-processing is shared and 3D** (Graph Cut #123, α-expansion #132, region competition
   #148): keep the seeded component (or the largest), remove islands below N voxels (never one
   holding a seed), majority smoothing, shrink–grow — 6-connected, in
   `lib/segmentation/maskOps` beside the 2D cleanup. Off by default, as in SegWorks.
8. **Preview and commit are the existing ones** (D4): the hatched preview on every viewport
   showing the segment, ⏎ / ⎋ / hold-`\`, one undo step across every member written. A
   multi-label preview has a **label selector** (All · one member, #133) that filters the
   overlay. A locked member previews read-only and is never written.

### Slices

| Slice | Content | Acceptance |
|---|---|---|
| **G1** | Pure solvers (`lib/segmentation/solvers/`): seed rasterisation (3D, disc per slice); **Fast GrowCut** (heap-ordered shortest paths, 6-connected, intensity constraint #110 applied as a gate during growth; one pass, so #108–109's iteration cap and early stop have nothing to bound); **Boykov–Kolmogorov** max-flow on typed arrays; binary energy (Gaussian NLL unary, λ·exp(−ΔI²/2σ²) n-links, hard seeds); **α-expansion** (Potts, Background a label, sweeps cap, early stop); **region competition** (checkerboard ICM, 2D / 3D with Z coupling, edge gate, stay bias, HU clip); 3D post-processing; memory estimators | Vitest on synthetic volumes, each seen red first: a two-intensity sphere is recovered from two seeds by each seeded method (Dice > 0.95); a wrap-around regression (a seed on the last column never reaches the next row); BK equals a brute-force min cut on small random graphs; α-expansion energy never rises between sweeps and Background stays background; region competition is the same in any scan order; 0 parameters stay 0; mutation-checked |
| **G2** | **Seeded segmentation** operation with **Fast GrowCut**: shared seed store + overlay (Random Walker migrated onto it), seed painter mode from the operation, class palette (members + Background, Erase), right-drag opposite class, brush (mm), Domain + box + estimate line, worker run with progress / Cancel, preview → ⏎ (one undo step), Restore seeds; slice track shows the domain's range | E2E on `ct-axial-anatomy`: seeds in the lesion (+70 HU) and the tissue round it on two slices → the preview covers the 3D lesion (Dice with the known sphere > 0.85, via a new E2E hook) and nothing is written until ⏎; Cancel leaves nothing; Restore seeds; Random Walker unchanged (its E2E green); oblique case |
| **G3** | **Graph Cut** (binary): λ 50 (5–200), σ 30 HU (5–150), Domain, post-processing; memory guard on all seeded methods | E2E: seeds → lesion preview (Dice > 0.85); λ high vs low changes the boundary's smoothness; keep-seeded-component removes a disconnected false region; the guard's amber line and disabled Run with the test seam |
| **G4** | **Multi-label graph cut (α-expansion)**: one class per member + Background; ROI pads (XY 24 px, Z 2), locality / intensity / seed-bias initialisation, smooth 6, σ 30, sweeps 2 (1–4), post-processing; multi-member commit; preview **label selector** | E2E: bone, lesion and tissue-as-Background seeded → each member previews its own structure (Dice > 0.85 each) and unseeded voxels stay unlabelled; the selector shows one member's preview; commit writes both members in one undo step; a locked member is not written |
| **G5** | **Region competition (Chan-Vese)** operation: modes Current slice · Bounded (± Z pad) · Segmentation extent ± 10 / ± 20 · Volume; labels (members) + include Background; iterations 18 (1–200), smoothness XY 2.4, data weight 0.002, stay bias 0.35, edge assist 0.012 / gate 35, cleanup below 24 voxels (0 = off), HU clip −150 / 250 (CT only), Z pad 2, Z smoothness 1.1, Z coupling 0.9; ROI limit optional; members not selected (and locked ones) are not changed (#149) | E2E: a mask drawn 3 mm loose round the lesion on three slices is pulled onto it (Dice rises above 0.85); current-slice mode changes only that slice; a member not selected keeps every voxel; cleanup 0 keeps a 2-voxel island; oblique case |
| **G6** | Docs (`annotation-tool-reference.md`: both operations, seeds, domain, guard), full offline E2E, visual sweep in the built app, merge to `main` | CLAUDE.md self-check answered |

**Deferred (decision 4):** the Chan-Vese clinical preset library (#137) — the parameters a
preset would set are all exposed, so presets can be added later as data.

### Branch 5 progress log

- **Plan** — written 2026-10-13, approved to proceed through all slices.
- **G1** — `lib/segmentation/solvers/`: `maxflow.ts` (Boykov–Kolmogorov on typed arrays,
  iterative), `energy.ts` (Kolmogorov–Zabih binary energies), `volume.ts` (6-neighbours with
  real bounds, seed rasterisation, Gaussian seed models with a σ ≥ 5 floor and a capped NLL),
  `fastGrowCut.ts`, `graphCut.ts`, `alphaExpansion.ts`, `regionCompetition.ts`, `memory.ts`;
  `maskOps/volumeCleanup.ts` (keep component, islands, 3×3×3 majority, shrink–grow). Bytes per
  voxel in the guard are counted from each solver's allocations (GrowCut 22, Graph Cut 141,
  α-expansion 172 + 4·classes, region competition 24); limits 512 MB amber / 1.5 GB blocked.
  **Deviations from the plan:** Fast GrowCut has no iterations (#108–109 do not apply), and
  SegWorks' α-expansion "switch bonus" / "keep" terms are dropped — they patched its
  one-vs-rest approximation and mean nothing in true α-expansion. Unit +30: max-flow and
  binary energies against brute force on 600 random problems; a 200 000-node chain (no
  recursion); recovery of known spheres (Dice > 0.95) by each solver; the wrap-around
  regression; mirror-symmetry (scan-order independence) of region competition; cleanup 0 =
  off. Mutants killed: the bottleneck, the orphans' neighbours, re-activation after an
  augment, submodularity, both wrap-around bounds, GrowCut's edge cost and gate, λ, hard
  seeds, the in-place sweep, 0 read as default, locked labels moving, seeded islands, seeds
  in smoothing, and smoothness removed from α-expansion. Survivors, each equivalent or
  compensated: re-adopting orphans (only speed — a freed orphan is regrown), α-expansion's
  energy check (a move's minimum can never exceed the current energy), and the move graph's
  pairwise term alone (the energy check still rejects moves that roughen the labelling).
- **G2** — **Seeded segmentation** joins the Operations picker (before 3D QC). One seed store
  (`seedStore`) serves Random Walker and the solvers: strokes of a class (a member, or
  Background = 0) in world space, with the brush radius fixed when drawn; the overlay draws them
  on their slice in the class's colour, as wide as the brush. Random Walker moved onto it (its
  foreground = the active member's strokes, background = everything else) and now solves the
  slice on screen. The seed painter is the operation's pointer mode (`SolverSeeds` tool): drag
  lays the chosen class (palette: members, Background, Erase), ⇧-drag lays Background — **not
  right-drag** as in #104: the right button zooms in every viewport. `solverService` builds the
  box (around seeds ± pads, ROI limit, or volume) in the grid's index space along the viewing
  plane, rasterises the seeds, runs `seededSolve` in the worker (progress, ⎋ / Cancel run),
  stages the result additively (other members keep their voxels; a locked member previews
  read-only) and previews it. The progress bar's Cancel now cancels whatever job runs
  (`computeClient.cancelCurrent`) — it was wired to Random Walker's only. The estimate line
  shows voxels and MB, amber, then blocked with the reason. **Found on the way:** SegWorks'
  default 8 px brush is a 17 mm stroke on the phantom's 1 mm pixels — wider than the lesion —
  so Background seeds painted over it; the E2E uses a 2 px brush (the default stays SegWorks').
  The oblique sphere fills the whole stack, so its test solves the Volume. E2E +6
  (`seeded-segmentation`: the 3D lesion Dice > 0.85 from two seeded slices, one undo step;
  Cancel and Restore seeds; the pointer mode; Erase; the guard; oblique), red against
  mutants of: the box's axes, the class mapping, the seed snapshot, ⇧, Erase, the guard and
  the painter's activation. Related E2E 52/52 (Random Walker unchanged).
- **G3** — **Graph Cut** in the Seeded segmentation operation: λ (5–200, SegWorks 50), σ
  (5–150, 30), and the shared clean-up under Advanced (off by default; keep the seeded / the
  largest component, remove islands, smoothing and shrink–grow passes); the memory guard covers
  every method (Graph Cut's estimate is ≈ 6× Fast GrowCut's for the same box). **Found on the
  way:** on the noise-free phantom the lesion's 30 HU edge is not an edge at σ 30, so at
  λ 50 the cheapest cut is a small surface round the seeds (72 voxels) — Boykov–Jolly's
  trade-off, not a fault; with σ matched to the edge (10) it takes the lesion exactly (712).
  The E2E says so: λ 5 vs λ 200 at σ 30. A planned test of "keep the seeded component" with a
  stray seed was dropped: a stray seed does not make a separate blob here, it pulls the
  foreground intensity model toward the tissue round it (component choice stays unit-tested).
  E2E +4, red against: λ not passed, σ not passed, clean-up not passed, and the method ignored
  (caught by the λ test — Fast GrowCut has no λ).
- **G4** — **Multi-label graph cut (α-expansion)**: the palette's classes are the members plus
  Background, so one run segments several structures; smoothness, σ and sweeps in view, the
  pads, unary weights, initialiser weights and clean-up under Advanced (SegWorks defaults).
  Commit writes every solved member in one undo step; a locked member is simply not written
  (its seeds still shape the solve; the preview bar says which), and the preview has a
  **Show** selector (All · one member, #133) that filters the hatched overlay
  (`showPreviewMember`). **Found on the way:** air in the box matched none of the seed models,
  every class's intensity cost hit the same cap, and the locality term handed it to the
  nearest structure — Segment 1 took 19 000 voxels of air. Background is now "everything
  else": its intensity cost is capped at half the others' (unit test: an unseeded fourth
  intensity goes to Background). E2E +3 (each member's own structure, Dice > 0.85, unseeded
  tissue unlabelled, one undo step; the selector; a locked member) — all red before the code;
  mutants of the selector's filter and of the locked-member skip each red.
- **G5** — **Region competition** (SegWorks' "Chan-Vese") joins the Operations picker: Run on
  the slice on screen · ± Z pad · the segmentation's slices ± 10 / ± 20 · the volume; labels
  that compete (members, Background); iterations; under Parameters every field a SegWorks
  preset sets (smoothness in-plane / through slices, data weight, stay bias, edge assist and
  gate, island clean-up with 0 = off, CT clip, Z pad, Z coupling). The result is written both
  ways (voxels gained and lost) through the transaction, one undo step; unselected and locked
  members never change. **Decisions on the way:** (1) the **ROI limit is required**, as in
  SegWorks — two-phase competition assumes Background is roughly one intensity, and over a
  whole slice (air, tissue, bone) its mean lands near −50 HU, so the body floods into the
  segment; (2) in the 3D modes a mask on one slice among empty ones is smoothed away by the
  through-slice coupling — the model wants a 3D mask, and the tool reference says so. E2E +5
  (`region-competition`: a 3D loose mask pulled onto the lesion, ±15 % of its area on the
  slice, one undo step; slice mode leaves the next slice alone; an unselected member keeps
  every voxel; no ROI → the reason, Run disabled; oblique), red against mutants of: the
  selection, the mode, the ROI requirement, writing removals. Survivor: swapping the box's
  in-plane dimensions — image and labels are misread together and the per-voxel data term
  still decides (the box layout itself is pinned by Seeded segmentation's axes mutant).
- **G6** — tool reference (both operations, seeds, domain, the guard); checks on the built app:
  typecheck, lint, unit **1157/1157**, full offline E2E **360/360** first time. Visual sweep in
  the built app: Fast GrowCut's sheet and seed overlay (G2), the multi-label preview with its
  Show selector — bone and lesion each hatched in their segment's colour, tissue unlabelled —
  and Region competition's preview inside the ROI limit with its Parameters open. Branch 5
  complete. CLAUDE.md self-check: seen in the built app (screenshots); the mockup's solver
  sheet (wireframes §5: seeds palette, brush, domain, estimate line, Cancel run, restore
  seeds) is what renders, with Run in place of Preview; no legacy chrome replaced; nothing
  deferred except the Chan-Vese preset library (decision 4); every acceptance test was seen
  red (before the code, or against a built mutant) and drives the real affordances.

---

## 12. Branch 9 — `algorithm-modules` (ordered plan — for review)

Cut from `main` after branch 5 and the licence files merged (2026-10-13). Scope: SegWorks
#271–283, re-scoped (2026-10-13) from a SegWorks port to a **product feature**: Workstation
is released as an open-source viewer, and a **separate commercial edition — its own shipped,
signed application** — adds value, including the SegWorks add-on algorithms (MR lesion,
post-op edema, lung, batch statistics). So:

- **The module host is part of the open-source app,** and both editions use it.
- **The commercial edition is a build, not a set of add-ons.** It is the open-source core plus
  **bundled modules** and its own edition configuration (product name, app id, branding), built
  and signed as its own product. Its modules ship *inside* its signed bundle — covered by that
  signature — so licensing, distribution and updates are the commercial edition's own business;
  the open-source host needs no licence mechanism.
- **Unsigned and community modules are accepted** in either edition. Anyone can write, sign
  with their own key and share a module; users can install one that is unsigned.
- **Installed modules never touch the signed application bundle.** They go in the user's data
  folder and are JavaScript / WebAssembly only — data to the operating system — so installing
  one never breaks the app's code signature or notarisation, and needs no re-signing.

**What SegWorks did, and what changes.** SegWorks injected each module's script into the viewer
page: it ran on the UI thread with the page's full privileges, wrote the labelmap directly and
managed undo itself (`pushUndo`, `finalize`). Workstation's renderer has Electron privileges and
XNAT session state, so a module here is a **pure function in a sandbox**: the host hands it the
data, it returns masks, and the host applies them through the path every operation uses
(transaction, preview, locks, one undo step). SegWorks' API maps across: `rows / cols /
sliceCount / modality / activeSegId` → the context; `getPixelData / getImageMeta` → the image
box in modality units (HU on CT); `getLabelmap` → the requested member masks;
`progress / cancelled / log / warn / error` → the same; `pushUndo / finalize` → gone (the host
owns undo and display).

| SegWorks # | Feature | Here |
|---|---|---|
| 271 | Import a module | Install from a module package (Settings › Modules, or drag-drop); or bundled with an edition |
| 272–273 | Cached modules; load or skip | Installed modules persist; each has an **Enabled** switch |
| 274, 283 | Flush cache; delete | **Remove** (installed modules; bundled ones can only be disabled) |
| 275 | Schema-driven parameters | The manifest's parameters, rendered by the controls the Cleanup operations already use |
| 276–277 | Run; cancel | An operation per module: Run → preview → ⏎; Cancel (cooperative, then the worker is terminated) |
| 278–279 | Module cleanup / gap fill hooks | **Post steps** the manifest names from the built-in Cleanup operations (Fill holes, Keep largest, 3D clean-up …) — no module-defined hooks |
| 280–282 | Log; copy; download | The operation's Log panel: Copy, Download (.txt) |

### Design points (decided in this plan; flag any to change)

1. **Package.** A module is one file, `*.xwmodule` — a zip holding `manifest.json`, an ES-module
   entry script, optional `.wasm` files and an optional `signature.json`. The manifest declares:
   id (reverse-DNS), name, version (semver), **API version** (`1.x`), **runtime**, publisher,
   licence, description, parameters (the Cleanup schema: number · select · boolean · …), what it reads
   (image; the active member / named members / all members; seeds; ROI limit), what it writes
   (the active member, named members, or new members it creates — name and colour), the scopes
   it supports (slice · range · volume · ROI), optional post steps, and an optional memory
   estimate (bytes per voxel) for the guard.
   **Runtime** names where the module's code runs. API 1.0 supports one: `wasm-worker`
   (JavaScript and WebAssembly in the sandboxed worker — C, C++ and Rust code compiled to
   WebAssembly included). Any other value is refused with the reason. The field exists from the
   start so that a later runtime is a new runtime, not a new API version: the API is messages
   (data in, masks out), so the same messages can travel to a worker, a pipe or a server. Trust
   rules attach per runtime (see Out of scope for the candidates).
2. **Trust tiers.**
   - **Bundled** — shipped inside the application bundle (`resources/modules/`), covered by the
     app's own code signature, so no module signature is needed or checked. Listed in Settings ›
     Modules; can be disabled, not removed. This is how an edition (the commercial one, or the
     open-source app's examples) carries its modules.
   - **Verified** — signed (Ed25519, over a canonical hash of every file in the package) by a
     key the app trusts. The open-source build trusts Washington University's publishing key;
     users can add trusted publisher keys in Settings › Modules.
   - **Community** — unsigned, or signed by a key the user has not trusted. **Accepted**: the
     install shows who signed it (if anyone) and what it reads and writes, and asks for
     confirmation; the module carries a Community badge wherever it appears. A setting
     **Allow community modules** (on by default) lets an organisation turn this off.
   - **Refused** — a signature that does not verify (tampered), a package that fails validation,
     or an API version the host does not support. Never installable, never loaded.
   Signatures are checked at install **and at every load** (the installed files are hashed again),
   so a module altered on disk afterwards is refused.
3. **Sandbox.** *(Amended in M3: a sandboxed process, not a Web Worker — a worker must share the
   app page's origin, and one made from a blob would inherit the page's access, the DICOMweb
   proxy included.)* Each run is a fresh, hidden, sandboxed renderer process with its own
   in-memory session (no cookies, nothing persisted), destroyed at the end of the run. Module
   files are served by a custom `xnat-module://` protocol from the re-checked package, with a
   Content-Security-Policy of `default-src 'none'; script-src 'self' 'wasm-unsafe-eval';
   connect-src 'self'; …`, and the session cancels every request that is not for the module's
   own files — two independent layers. No Node, no API, no navigation, no popups, no
   permissions: the module sees only the data the app page posts on its message port, and only
   what its manifest declared. Native code (`.node`, dylib, DLL) is not supported.
4. **The host owns writing.** A module returns masks (and optionally new members and a
   measurement table); the host stages them in a LabelmapTransaction: written members gain (or,
   if the manifest says *replace*, become) the mask; other members keep their voxels unless the
   manifest declares claims (as Snake refine does); locked members are never written; the result
   is previewed (D4) and ⏎ commits one undo step.
5. **Where modules appear.** Each enabled module is an operation in the **Operations picker**,
   in a **Modules** group below the built-in operations (amends D11, written when operations
   lived on a Process tab that the D1 amendment removed). Installing, enabling, removing and
   trusting publishers live in **Settings › Modules** (D11 unchanged).
6. **API versioning.** The host implements API `1.x`; a module declares the major it was built
   for. Minor versions only add. A future `2.x` host may keep a `1.x` adapter.
7. **Editions.** An edition is chosen at build time by an edition configuration
   (`edition.config.*`: product name, app id, branding, the bundled-modules folder, trusted
   publisher keys); electron-builder packages that folder into `resources/modules/`. The
   open-source repo ships the default edition (its example modules) and documents how another
   repository builds an edition on the core — which is how the commercial edition is made. The
   open-source host has no licence mechanism: the commercial edition handles licensing in its own
   build.
8. **Authoring tools ship in the open-source repo**: `npm run module:keygen`, `module:pack`,
   `module:sign`, `module:verify`; an example module; and `docs/module-authoring.md` (API
   reference, manifest schema, signing, testing a module).

### Slices

| Slice | Content | Acceptance |
|---|---|---|
| **M1** | **Package format and verification** (pure + main process): manifest schema and validation; zip reading with guards (path traversal, size and file-count limits, no symlinks); canonical hashing; Ed25519 verification (Node crypto); trust classification; the `module:*` CLI scripts | Unit, each seen red first: a valid package parses; every malformed manifest and unsafe zip is refused with a reason; a signature verifies, and one changed byte in any file fails it; unsigned → Community, unknown key → Community, trusted key → Verified, bad signature → Refused; an unsupported API major or runtime is refused, naming it |
| **M2** | **Install and manage**: main-process store under `userData/modules/<id>/<version>/`, IPC (list, inspect, install, remove, enable, trust key); **Settings › Modules** — installed list (name, version, publisher, badge, Enabled), Install from file (and drag-drop) with the trust dialog (who signed it, what it reads / writes; confirmation for Community), Remove, trusted publishers, Allow community modules | E2E on the built app with fixture packages (generated and signed with a test key in the test setup): a Verified install has no warning; a Community install needs confirmation and shows its badge; a tampered package is refused with the reason; the allow-community setting off refuses Community; removing deletes the files; a module altered on disk after install is refused at load |
| **M3** | **Sandbox runtime**: the `xnat-module://` protocol and its CSP; the run worker; the host ↔ worker protocol (API 1.0: context, image box, member masks, seeds, ROI; progress, cancelled, log / warn / error; result); cooperative cancel then terminate; a run time-out; the log buffer | E2E with a deliberately hostile fixture module: `fetch`, `importScripts` from another origin, `XMLHttpRequest` and WebSocket are all blocked (and logged); it cannot see `window`, `require` or `electronAPI`; a module that ignores Cancel is terminated; unit tests of the protocol |
| **M4** | **Module operations**, on **one operation registry** for built-ins and modules: the Operations picker, parameter controls (from a schema), the memory guard and the preview / commit path are driven by a shared operation descriptor, so a module's operation is built exactly as a built-in one is and the two cannot drift. The Modules group in the Operations picker; the operation body — parameters rendered from the manifest, scope (slice · range · volume · ROI, as the manifest allows), the memory estimate, trust badge, Run / Commit / Discard, Cancel, the Log (Copy · Download); the result staged, previewed and committed through the transaction (locks, other members, claims, new members); post steps from the built-in Cleanup operations | Unit: the built-in operations are listed from the registry (no picker regression — the operations-section E2E stays green). E2E with the example module (an intensity threshold — SegWorks' template, re-authored): parameters render from its manifest; Run previews; ⏎ commits one undo step; a locked member is not written; Cancel leaves nothing; the log copies and downloads; a module creating a new member adds it with its name and colour; oblique case |
| **M5** | **Validation modules**: (a) re-author one SegWorks add-on algorithm against API 1.0 — the post-op edema segmentation (its source is in the v2.0.610 bundle) — as a signed example, built and tested outside the host's source tree; (b) **a built-in as a module** — Fast GrowCut, packaged as a module from the same pure solver, to prove API 1.0 can express a real Workstation operation | E2E: (a) installed from its package, it segments on a fixture built for it (a synthetic MR-like phantom with a known region), Dice above a stated bound; (b) on the same seeds and box, the module's result equals the built-in Fast GrowCut's **voxel for voxel**. Neither needs anything the API does not offer (any gap found is an API change, made here) |
| **M6** | **Editions and authoring**: bundled modules (`resources/modules/`, the Bundled tier, disable-not-remove) and the edition configuration electron-builder reads; `docs/editions.md` (how a separate repository builds an edition on the core — the commercial edition's route); `docs/module-authoring.md`; a threat model (`docs/module-security.md`: what a module can and cannot reach, and why) | E2E: a bundled module (the example) is listed as Bundled, runs, can be disabled and cannot be removed; a packaged build with a test edition configuration carries its bundled module and its name. The authoring guide's example builds, signs and installs as written |
| **M7** | Docs (tool reference: Modules in the Operations section; Settings › Modules), full offline E2E, visual sweep in the built app, merge to `main` | CLAUDE.md self-check answered |

**Out of scope:** a module marketplace or update feed (install is from a file; updating is
installing a newer version); licensing (the commercial edition's own build); the commercial
edition itself (another repository, built on this core); porting the
other SegWorks add-ons (each is its own module, built after the API is proven); runtimes other
than `wasm-worker`. Candidate later runtimes, recorded so the design keeps room for them:

- **`onnx`** — machine-learning models (nnU-Net / MONAI exports) run by ONNX Runtime Web in the
  sandboxed worker, on WebGPU or WebAssembly; the model ships as data in the module. Needed only
  if the runtime is better provided by the host than bundled per module.
- **`xnat-container`** — the module names a container image that XNAT's Container Service runs
  server-side on the session; the result returns as a DICOM SEG through the usual preview and
  commit. The home for heavy or GPU work in any language (nnU-Net, TotalSegmentator, Python
  pipelines); trust lies with the server's administrators, who control which images may run.
- **`native-process`** — a per-platform executable the main process launches, speaking the same
  messages over a pipe. Last resort: the operating systems quarantine or flag unsigned
  downloaded executables, so the publisher must sign (and on macOS notarise) every build;
  sandboxing native code differs per OS and is weak; so it would be **Verified only**, never
  Community. In-process native addons (`.node`) are ruled out — full privileges, and a crash
  takes the app down.

### Branch 9 progress log

- **Plan** — written 2026-10-13. Amended the same day: the commercial edition is its own shipped
  build carrying bundled modules (not modules installed into the open-source app), so the
  licence-provider hook is dropped and M6 becomes editions; a manifest `runtime` field; one
  operation registry for built-ins and modules (M4); a built-in as a module, equal voxel for
  voxel (M5). Approved to proceed through all slices.
- **M1** — `src/shared/modules/manifest.ts` (schema, validation reporting every problem,
  compatibility: API major and runtime, refused by name); `src/main/modules/zip.ts` (a small zip
  reader / writer on Node's zlib — no third-party zip code handles untrusted packages: stored or
  deflated only; no encryption, zip64 or symlinks; no absolute, `..` or backslash paths; entry,
  size and total limits checked before inflating; inflate capped at the declared size; CRC
  checked); `src/main/modules/modulePackage.ts` (canonical digest, Ed25519 sign / verify with
  Node crypto, key ids, tiers: Bundled · Verified · Community · Refused, `readPackage` /
  `checkFiles` — the same checks at install and at every load); `src/main/modules/cli.ts` with
  `npm run module:keygen | pack | sign | verify` (private keys written owner-only). Unit +18,
  mutation-checked (14 mutants: the path, symlink, encryption, CRC, entry-count, size and
  stored-size guards; the digest covering every file; the key-id check; trust needing a trusted
  key; invalid signatures refused; the entry check; API major; runtime). **Found on the way:** a
  deflated entry lying about its size is already stopped by the capped inflate, so the
  size-mismatch check guards only stored entries — a test for that case was added.
- **M2** — `ModuleStore` (`userData/modules`: settings, `installed/<id>/files`, an install
  record with the digest; bundled packages read from the edition's folder): install (Community
  needs the confirmation; refused while Allow community modules is off; bundled ids cannot be
  replaced), list and load re-check every module — the M1 checks plus the digest recorded at
  install, so a module changed on disk is refused **even when unsigned**; enable, remove
  (bundled: disable only), trust / untrust publisher keys (the id must match the key).
  `moduleHandlers` (IPC): a picked or dropped package is checked in the main process and held
  under a short-lived token, and is installed **by token** — the renderer never hands the
  installer a path. **Settings › Modules**: Install module… (and drop), an inline confirmation
  for Community modules (publisher, signature, what it reads and writes), the installed list
  with tier badges, Enabled and Remove, refused modules in red with their reason, trusted
  publishers, Allow community modules. **Found on the way:** the switches are controlled and
  waited for the IPC round trip, so they lagged a click — they now update at once and the
  refresh confirms. Unit +9 (store, temp folders); E2E +7 (`modules/module-install`: Verified
  installs at once; Community asks, shows its signer and access, carries its badge; an untrusted
  key is named; a tampered package is refused; community off; altered on disk → Refused, Remove
  deletes; an unsupported runtime refused by name), red against mutants of the digest check, the
  confirmation, the community-off check and the trusted keys. Checked in the built app
  (screenshot).
- **M3** — the sandbox, as design point 3 now reads (`moduleRuntime.ts`: `xnat-module://`
  scheme, per-run in-memory session, CSP, request filter, hidden sandboxed window with a preload
  that only relays its port; a MessagePort pair between the app page and the module, data
  transferred; a 30-minute limit; destroyed when the run ends, the page goes, or the app quits).
  API 1.0's runner (`moduleRunner.ts`): `run(input, api)` with `progress`, `cancelled`, `log` /
  `warn` / `error` (and the module's own console, relayed); Cancel asks, then after 2 s
  destroys. **Found on the way:** (1) the run's port reaches the page before the `runStart`
  reply, so ports are caught by one listener and kept by run id; (2) the first hostile test
  aimed at addresses that refused connections anyway, so "blocked" proved nothing — removing
  both network layers passed it. It now targets a local server the test knows is reachable and
  asserts the server saw **no** request. With both layers removed it fails; with either layer
  alone it still passes — each layer suffices by itself (defence in depth, as designed). E2E +5
  (`modules/module-sandbox`: input, progress, logs, result, own files reachable, process gone
  afterwards; the hostile module — reachable server, internet, the app's proxy, file://, XHR,
  WebSocket, remote import, eval, Function, require, process, the app's API, cookies,
  window.open; cooperative and forced Cancel; a module that throws or exports no `run`; a
  disabled or missing module), red against mutants of: both network layers, the sandbox / Node,
  eval in the CSP, popups, and destroying the run.
- **M4** — modules as operations, through **one registry** (`useOperationsSection`): the
  built-ins, then a **Modules** group of every enabled, valid module (`module:<id>`), refreshed
  when Settings › Modules changes; a module operation that disappears closes. One parameter
  control (`OperationParam`) serves Cleanup and module manifests alike. `ModuleSheet` /
  `useModuleSheet`: tier and publisher, parameters (Advanced folded), the manifest's scopes, the
  memory estimate (`bytesPerVoxel`), Run → preview → ⏎ / Commit / Discard, Cancel run (also from
  the progress bar, now that a compute job can carry its own cancel), a result table, and the
  log with Copy and Download (`MODULES_SAVE_LOG`, a save dialog). `moduleOperationService`
  builds only what the manifest reads (image, members, seeds, ROI) over the scope's box
  (`gridBox`, extracted from `solverService`, index space — oblique-safe), checks the result,
  applies post steps (Cleanup ops), and stages it like a built-in: add or replace, claims, other
  members keep theirs, a locked target previews read-only; `writes.target: "new"` creates the
  member (name, colour) and removes it again if the preview is discarded. Example module
  `modules/examples/threshold`. **Found on the way:** (1) the validator accepted a number
  default off its slider's grid (min −1024, step 10, default 200 → the slider showed 196) — it
  now requires default = min + k·step, and the example uses min −1000; (2) Cornerstone's first
  render of a just-created member reports its labelmap modified, so a preview staged at once was
  discarded as stale — the operation now waits for that member's first render (soft 2 s
  timeout); (3) M2/M3 had left the main-process bootstrap and preload unit tests red (no
  `protocol` in the Electron mock; the run-port listener counted as an unknown subscription) —
  fixed, with a test of the port relay. Unit +2; E2E +8 (`modules/module-operations`: picker
  group and manifest parameters; Run → ⏎ as one undo step; locked read-only; Cancel leaves
  nothing; log Copy / Download; a new member with its name and colour, Discard removes it;
  disabled in Settings leaves the picker; oblique sphere Dice > 0.95), red against mutants of:
  the image read, the locked read-only, new-member creation, the first-render wait, Cancel, the
  Modules group, Copy, Download and the enabled filter (Cancel and Copy first survived — the
  test checked before the module would have finished, and the system clipboard held an earlier
  run's text — both tests strengthened). Operations / solver / cleanup E2E (115) green. Checked
  in the built app (screenshot).
