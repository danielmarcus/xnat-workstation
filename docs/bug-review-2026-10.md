# Bug review — tools, operations and modules (2026-10-13)

The user reported that many tools "don't function in a coherent way" in a plain single
viewport, though every E2E spec was green. The specs had each tested their own feature's happy
path on tiny noise-free phantoms with identity rescale. This ledger collects what the review
found, from two sources:

- **Sweep** — `e2e/specs/sweep/` drives every tool and operation on realistic data
  (`ct-body-512`: 512², noise, real-CT rescale) against invariants that hold for any tool.
- **Review** — five code reviews by area (mask ops, review/interpolation, solvers/QC, contours,
  modules), each finding traced through the code.

Priority: **P1** breaks basic single-viewport use or loses / corrupts data · **P2** wrong in a
common situation · **P3** edge case, hardening, performance on large data.
Status: open · fixed (commit) · won't fix (reason). Open items are tracked as GitHub issues (#91–#103).

## Cross-cutting

| ID | P | Finding | Source | Status |
|---|---|---|---|---|
| X1 | P1 | Stack source reader applies rescale slope/intercept twice (loader pre-scales): every absolute-HU feature reads HU−1024 on real CT — Seeded gate, Level Trace guard, Region clip, module input | review + sweep (HU test, red in all orientations) | fixed |
| X2 | P1 | A pending preview survives switching operation, active segment, container, viewport or scan; the next Commit / ⏎ writes the old preview | review (mask ops 3, 4; interp 14) | fixed |
| X3 | P2 | Operations don't check the active viewport shows the active container (wrong plane / slices) | review | fixed — #91 |
| X4 | P3 | Full-volume copies of every member per mask op, per brush move (Cleanup All smart plan, Interpolate gap table undebounced) | review | fixed (smart plan and gap table debounced; stack grids read per slice from the labelmap images, copied only when `data` is asked for; placement cached per image-id list; a volume-backed labelmap is still read whole, once per grid) — #95 |
| X5 | P3 | Transactions stage per-voxel Map entries: > 16.7M writes throws (V8 Map limit) | review | fixed — #96 |

## Segmentation tools (toolbox)

| ID | P | Finding | Source | Status |
|---|---|---|---|---|
| T1 | P1 | Region: a click does nothing — it needs a drag (radius); tooltip said "click"; 3D, no undo step, wrote locked segments | sweep | fixed |
| T2 | P1 | Region+: a click does nothing unless the mouse rested 500 ms first; no feedback; no undo step | sweep | fixed |
| T3 | P1 | Rect Multi pushes no undo step — Ctrl+Z undoes the previous edit (erased another segment) | sweep | fixed |
| T4 | P1 | Spline / Live Wire / Contour Fill: Escape or a tool switch mid-draw leaves the drawing live and freezes navigation (also: Cornerstone replays a click held 400 ms for double-click detection, so Escape soon after a click started a new drawing) | review (contours 2) | fixed |
| T5 | P1 | Backspace/Delete while drawing a spline deletes the selection instead of the last point | review (contours 3) | fixed |
| T6 | P2 | Smart Brush live overlay never grows past the first dab (preview bucket cache) | review (mask ops 5) | fixed |
| T7 | P2 | Advanced Live Wire costs exceed 1 → bucket queue disorder → paths not shortest | review (contours 4) | fixed |
| T8 | P2 | Locked / approved Structure members editable through Copy nearby, Propagate, Undo & edit, ⏎ commit | review (contours 1) | fixed |
| T9 | P2 | Undo & edit can undo an unrelated edit; ignores member / viewport | review (contours 5, 6) | fixed |
| T10 | P2 | Copy nearby / Propagate use stale remembered splines, other planes, holes | review (contours 7, 8) | fixed |
| T11 | P2 | On an oblique reformat (e.g. coronal of an oblique scan) the plane tools edited a grid slice that is not the one shown — Level Trace 12 mm off the plane, Rect Multi 6 mm; Region / Region+ did nothing, Region+ threw on hover | sweep (world-space invariant) | fixed (refused with a message; Volume-scope operations still work) |
| T12 | P3 | Double-click close bypasses No crossing; spline in hand marks container dirty; render-time shape depends on globals; Fit ROI jumps slice; RTSTRUCT plane from camera | review (contours 9–13) | fixed (item 3: the ROI active spline's per-annotation plane cache across viewports has no dedicated test) — #99 |

## Operations

| ID | P | Finding | Source | Status |
|---|---|---|---|---|
| O1 | P1 | Interpolate A → B with All erases segments empty on the anchors | review (interp 2) | fixed |
| O2 | P2 | All segments + any locked member → whole op read-only; message names the wrong segment | review (mask ops 6, interp 13) | fixed |
| O3 | P2 | Copy into / Magnet bridge refuse a locked *source* | review (mask ops 7) | fixed |
| O4 | P2 | Interpolate gap-table row previews the active segment, not the row's | review (mask ops 8, interp 7) | fixed |
| O5 | P2 | Slice-track range shows / drags on every viewport, for every op; drag doesn't discard the preview | review (interp 5, 6; mask ops 11) | fixed |
| O6 | P2 | Interpolation anchors, Cleanup range, ROI limit, smart-plan overrides never reset per scan / container / orientation | review | fixed |
| O7 | P2 | Slice track and gap table stale after an orientation change | review (interp 4) | fixed |
| O8 | P3 | Volume / All cleanup synchronous on the UI thread: tens of seconds on 512² × 300 | review (mask ops 1) | fixed (empty slices skipped without reading planes, each slice's member planes read once and shared, Fill holes / smoothing cropped to the mask, separable Gaussian: 5 members × 100 × 512² Fill holes All 22–116 s → ~2.5 s in a loaded unit run. Volume runs, and Ranges of ≥ 8 slices, now run on a Cleanup worker of their own (`cleanupComputeClient`, never cancelling a solve or QC build nor cancelled by one): the UI thread gathers the planes cropped to the targets' box + each op's reach, the worker runs the same `runPlaneOpOn` runner, the result is staged as the usual preview (⏎ = one undo step) — voxel-identical (scopeEquivalence.test, every op × flat/layered × 3 axes, locks, claims, ROI). Progress + Cancel in the viewport bar, Cancel run in the sheet, ⎋; a result is dropped if the operation, parameters, scope, segment, container, viewport, scan, locks or ROI change (silently) or the segmentation is edited (stale notice). Longest frame gap of a 40 × 512² Volume Fill holes in E2E: 3.2 s → ~0.4–0.5 s (the rest is swiftshader rendering). Staging a large result and the preview overlay were sped up too. Remains: Slice scope, short Ranges and the two-segment operations stay synchronous, by design) — #97 |
| O9 | P3 | Ctrl+V lands displaced after panning | review (mask ops 13) | fixed |

## Found by the regression tests while fixing

| ID | P | Finding | Source | Status |
|---|---|---|---|---|
| F1 | P1 | Every drag-following tool (Smart Brush, Random Walker seeds, the Seeded painter) lost its stroke's first movement — Cornerstone releases a held mouse-down on the move that a window listener added at press time had already missed (a quick flick painted one dab) | S9 regression test | fixed |
| F3 | P3 | Rect Multi writes nothing where the intensity equals the window's upper bound exactly (binary 300 HU phantom vs −100…300) — not reproduced on realistic data | sweep (binary phantom) | fixed — #98 |
| F2 | P2 | Cornerstone replays a click held 400 ms for double-click detection: Escape just after a click restarted the drawing and froze navigation | T4 regression test | fixed |
| F4 | P2 | A local RTSTRUCT (or SEG) imported with its images loaded after a fixed 200 ms, not when the viewport existed: on a slow host its ROIDisplayColors fell back to the default palette, its locked members came out unlocked (the presentation restore toggled locks), and its contours carried no view plane, so nothing interpolated with them | contour-copy-paste E2E | fixed |

## Solvers, compute, 3D QC

The pure solvers (BK max-flow, α-expansion, Graph Cut, region competition) checked out against
reference implementations; the defects are in the services around them.

| ID | P | Finding | Source | Status |
|---|---|---|---|---|
| S1 | P1 | A finished solve replaces whatever preview is pending; a Smart Brush release can then commit the solver result unreviewed; closing the sheet doesn't cancel the job | review (solvers 1) | fixed |
| S2 | P1 | α-expansion with no Background seeds paints the whole box | review (solvers 2, script) | fixed |
| S3 | P2 | Seed / Smart Brush / Random Walker brush round in voxels, not mm — ~7× tall on sagittal/coronal of thick-slice data | review (solvers 4) | fixed — #92 |
| S4 | P2 | Seeds painted in another orientation silently reduced to a few voxels | review (solvers 3) | fixed — #93 |
| S5 | P2 | Erasing seed points re-bridges the stroke with straight lines | review (solvers 5, script) | fixed |
| S6 | P2 | Replaced jobs: old job's cleanup hides the new job's progress bar (fixed: job ids); QC builds and solves cancel each other silently; overlapping QC builds corrupt state | review (solvers 9–11) | fixed — #94 |
| S7 | P2 | 3D scissor cuts the active segmentation, not the one shown | review (solvers 14) | fixed |
| S8 | P2 | Seeds of a deleted member break α after the solve; paintClass survives container change; a failed stroke start extends the previous stroke | review (solvers 15, 16) | fixed |
| S9 | P2 | Smart Brush leaves gaps on fast drags; Level Trace with simplify loses its bottom row | review (solvers 17, 18) | fixed |
| S10 | P3 | Whole-volume copies per seed-paint move and per QC row; QC staleness misses edits during a build; QC opens empty from non-panel_0 MPR; surfaces overstate thick slices; Delete component on a stale report; progress stuck; Restore seeds clobbers other containers | review (solvers 6–8, 12, 13, 19–22) | fixed — #100 |

## Review ergonomics

| ID | P | Finding | Source | Status |
|---|---|---|---|---|
| R1 | P2 | Hide PHI back on doesn't re-mask tags revealed earlier | review (interp 10) | fixed |
| R2 | P2 | Imported checkpoint can be deleted by retention at once | review (interp 11) | fixed |
| R3 | P2 | Flythrough segment filter leaks between containers | review (interp 9) | fixed |
| R5 | P3 | Settings › File Backup does not list a checkpoint just imported (stale list) | sweep (R2 test) | fixed — #101 |
| R4 | P3 | Checkpoint identity: session from last load, label in key, unsafe-name collisions | review (interp 12) | fixed — #102 |

## Modules

| ID | P | Finding | Source | Status |
|---|---|---|---|---|
| M1 | P1 | WebRTC (STUN) escapes the sandbox | review (modules 1, reproduced) | fixed |
| M2 | P1 | A crashed / timed-out / quit-killed run never settles (sheet stuck "Running…") | review (modules 2) | fixed |
| M3 | P1 | Cancel ignored when the module finishes within 2 s; Commit then writes it | review (modules 3) | fixed |
| M4 | P2 | Results in WebAssembly memory fail (non-transferable buffer) | review (modules 4, reproduced) | fixed |
| M5 | P2 | One broken install folder breaks Settings and the catalog | review (modules 8, reproduced) | fixed |
| M6 | P2 | Community modules still listed as runnable with Allow community off | review (modules 9) | fixed |
| M7 | P2 | Numeric last id label (org.x.2024) installs but can never run | review (modules 10, reproduced) | fixed |
| M8 | P2 | Module table not validated — can crash the panel | review (modules 7) | fixed |
| M9 | P2 | A run writes into whichever sheet is open; two runs can overlap | review (modules 12) | fixed |
| M10 | P2 | Dropping a module on Settings also triggers the DICOM loader | review (modules 13) | fixed |
| M11 | P2 | E2E bundled-folder override honoured in packaged builds | review (modules 14) | fixed |
| M12 | P3 | Per-run session / files leak; runs survive a page reload (fixed with M2); new segments stay after undo; stale params after upgrade; unvalidated postSteps; token reuse; signer text unsigned; key id 64-bit only; sync scans | review (modules 5, 6, 15) | fixed — #103 (one shared sandbox session, per-run origin forgotten on stop; undo/redo removes/re-creates created members; postSteps validated against the mask-only Cleanup ops; install token idempotent; Verified shows the trusted key's name; trust matches the whole key; listing cached by size+mtime, bundled load inflates one package; `:` / Windows device names / case-only duplicates refused at install. Unsigned-module disk check: docs corrected, not signed) |
