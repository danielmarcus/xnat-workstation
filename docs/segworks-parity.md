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
