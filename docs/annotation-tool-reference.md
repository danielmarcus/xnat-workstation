# Annotation tool reference

Generated from `src/renderer/components/annotations/toolCatalog.tsx` on 2026-09-21; Segmentation operations added 2026-10-10; Segmentation tool families and the Operations section 2026-10-12.
`toolCatalog.test` enforces the rules this table depends on: labels and icons unique
across the whole catalog, no tooltip that merely repeats its label, a hotkey advertised
if and only if `defaultHotkeyMap` defines one, and every declared control renderable.

**Controls** are what the toolbox shows while the tool is active — nothing else. A tool
listing no control needs none.


## Segmentation

| Tool | Family | Tooltip | Controls |
|---|---|---|---|
| **Select** | general | Click a painted region to make its segment the active one | — |
| **Seg Bidir.** | general | Measure the active segment’s longest axis and its perpendicular | — |
| **Brush** | Paint | Add to or remove from the active segment on this slice; hold Shift to invert (B) | brushSize, editMode |
| **Threshold** | Paint | Paint only where intensity falls inside the window | brushSize, intensityWindow |
| **Dyn. Thresh** | Paint | Paint within a window sampled from the voxel you click, not a preset one | brushSize, samplingRadius |
| **Sph. Brush** | Paint | Add or remove with a 3D kernel — one stroke also reaches neighbouring slices; hold Shift to invert | brushSize, editMode |
| **Sph. Thresh** | Paint | Paint with a 3D kernel, limited to the intensity window | brushSize, intensityWindow |
| **Paint Fill** | Paint | Flood-fill the enclosed region under the cursor (F) | — |
| **Smart Brush** | Paint | Paint only the tissue under the brush — it does not spill across boundaries. One undo step per stroke; refuses a locked segment | radius (mm), tolerance, spacing |
| **Circle** | Shape | Drag a circle; everything inside it is added to or removed from the segment (hold Shift to invert) | editMode |
| **Rect** | Shape | Drag a rectangle; everything inside it is added to or removed from the segment (hold Shift to invert) | editMode |
| **Sphere** | Shape | Drag a sphere; everything inside it is added to or removed from the segment, across slices (hold Shift to invert) | editMode |
| **Rect Multi** | Shape | Drag a rectangle; everything inside it within the intensity window joins the segment | intensityWindow |
| **Contour Fill** | Shape | Draw a boundary; the area it encloses joins the segment (one undo step; a locked segment is refused). **O** picks it, and pressed again cycles the boundary | Boundary: Freehand · Spline · Live Wire (remembered), then that boundary's controls (see *Spline and Live Wire* below) |
| **Region** | Smart | Grow a region outward from the voxel you click | brushSize |
| **Region+** | Smart | Grow a region outward, adapting the boundary as it goes | brushSize |
| **Level Trace** | Smart | Click a structure: the connected region of similar intensity is previewed; ⏎ adds it (a locked segment previews read-only) | band (from scan · CT HU tolerance · MR k·σ over a 7/11/15 window), growth (binary · fuzzy + affinity), edge guard (off · gentle · strong; Sobel/Scharr; polarity), smoothing, simplify, round corners, intensity guard (min–max, or *From ROI*), fill holes, stop at air |
| **Rnd. Walker** | Smart | Drag foreground seeds; ⇧-drag background seeds (green / red on the image); Run previews the segmentation between them | β (edge sensitivity), seed size, Run, Clear seeds |
| **ROI limit** | Smart | Drag a rectangle (dashed amber on the image) that Level Trace, Random Walker and Cleanup stay inside | Clear |

The Segmentation toolbox shows **every tool at once, with no tabs**, family by family in the
order above — four columns at the default panel width, three when narrower, icons only when
very narrow (SegWorks parity D2, amended 2026-10-12). It keeps **one height whatever tool is
active**: the Controls area is sized to the tallest tool with its **Advanced** settings folded
(Level Trace keeps band, tolerance and edge guard in view; sample size, smoothing, growth,
edge operator, polarity, simplify, round corners, the intensity guard and the hole / air checks
are under Advanced; the tallest is Contour Fill with its Spline boundary), and the local-backup
status sits in the toolbox header.

## Segmentation operations (Operations section)

Operations are not tools. They open from the **Operation** picker in the panel's
**Operations** section, between the member list and the toolbox (SegWorks parity D1, amended
2026-10-12), and **stay open while tools change** — paint, then preview again. The header
shows the target segment; **▾** collapses the operation to one line without ending it or its
preview; **✕** closes it (asking first, inline, if a preview is pending). If the segment
changes under a pending preview — a stroke, an undo — the preview is discarded and the
operation's status line says so. An operation runs on the
panel's active segment, over a **scope** — Slice (the one on screen) · Range (in the
viewport's own slice numbers; also draggable on the scrollbar's slice track) · Volume, ×
Active segment · All segments — and shows a **preview** before anything is written: added
voxels hatched in the segment's colour, removed voxels dimmed. **⏎** commits (one undo step
across every segment touched), **⎋** discards, hold **\\** to compare with the current mask.
A locked segment previews read-only. **X** opens (or expands) Cleanup.

| Operation | Group | What it does | Parameters |
|---|---|---|---|
| **Fill holes** | Clean | Fill enclosed empty regions | largest hole (mm², 0 = all) |
| **Keep largest** | Clean | Keep only the largest island per slice | also keep ≥ % of largest |
| **Remove speckles** | Clean | Remove islands below an area | min area (mm²) |
| **Remove strays** | Clean | Remove islands far from the largest | distance (mm), protect ≥ % |
| **Median smooth** | Clean | Majority vote | radius (px) |
| **Gaussian smooth** | Clean | Blur and re-threshold | σ (px), threshold |
| **Smooth edges** | Clean | Light 3×3 vote | strength |
| **Morph open / close** | Clean | Erode→dilate / dilate→erode | radius (px) |
| **Anisotropic diffusion** | Clean | Edge-preserving, image-guided smoothing | iterations, κ, conduction |
| **Snake refine** | Clean | Move the boundary onto the image edges nearby (active contour) | variant (Edge · Gradient vector flow — reaches edges farther away · Balloon — also inflates · Morphological — robust to noise), iterations, edge weight, neighbours (Keep · Replace shared boundary — a touching segment's pixels along the shared boundary may be taken, never a locked one's); Advanced: GVF μ, GVF iterations, balloon force |
| **Clear** | Segments | Erase the segment over the scope | — |
| **Move into…** | Segments | Relabel as another segment (merge) | Into |
| **Copy into…** | Segments | Add to another segment, keeping both | Into |
| **Magnet bridge…** | Segments | Grow another segment across a gap to meet this one | Into, max gap (px), fill / overwrite |

**Interpolate** fills empty slices between painted ones — every gap (listed, each previewable),
the slice on screen, or between anchors **A** and **B** (⌥A / ⌥B set one at the slice on
screen while Interpolate is open; ⌥⇧A / ⌥⇧B / ⌥⇧C clear — chords, so A and B still pick Angle
and Brush while painting keyframes) — with Linear SDF, Area-preserving SDF, Morphology, Component matching,
Volume-accurate morphology or Image-guided snap. **Propagate** grows the segment from the
slice on screen into its neighbours (backward / both / forward), keeping to voxels whose
intensity matches (±HU on CT, kσ on MR) and stopping where the structure ends or leaks.
Neither ever runs on its own.

**3D QC** switches to the **2D + 3D QC** layout (the active viewport beside a 3D view of
its scan; collapsing 3D QC keeps that layout, and your own comes back when it closes) and builds a surface for every
connected component of every segment. The **report** lists each component — Main, Fragment,
Stray (≤ the stray threshold, voxels) or Speck (≤ the speck threshold) — with its volume,
voxel count and slices. Click a row or a surface to select it: it turns white in 3D and the
2D viewport moves to it; **Delete component** (or ⌫) removes it, one undo step. **✂ Scissor**:
draw a lasso on the 3D view to remove the active segment's voxels inside it (or keep only
those inside) through the whole volume along the view; ⏎ applies. Display: per-segment
visibility, highlight strays, hide largest, brightness, ambient, auto-rotate, reset view,
expand 3D. Surfaces: resolution (128 / 192 / 256), smooth or voxel renderer, smoothing,
thicken thin structures (display only). In the 3D view: drag rotates, ⇧-drag pans, the wheel
zooms. An edit marks the surfaces out of date — **Rebuild** updates them.

With **All segments**, a Clean operation first proposes a **per-segment plan** (Smart
Cleanup): small and thin segments are withheld from operations that would erode them; each
row's action can be edited before running.

## Review and display (Segmentation)

| Control | Where | What it does |
|---|---|---|
| **Review flythrough** | container menu · **⇧Space** | Steps the viewport through the slices the segments occupy (gaps included), showing the anatomy then the mask on each. Space pauses, ⎋ stops; settings (segments, direction, start, flicker, dwell) behind ▾ on the player |
| **Save checkpoint…** | container menu | Saves every segment's voxels under a name, or as the Baseline (one per segmentation, kept until replaced). The newest four named checkpoints are kept |
| **Restore checkpoint ▸** | container menu | Writes a checkpoint back as one undo step; refused if a segment is locked |
| **Checkpoint files** | Settings › File Backup | Export a checkpoint to a `.wscheckpoint` file; import one made from the same series |
| **M** | viewport | Hide / show the active segmentation's masks |
| **Hold Q** | viewport | Intensity under the cursor (HU on CT) and voxel index, whatever the tool |
| **PHI** · **⇧H** | toolbar | Hide patient-identifying fields in the overlay and the Tags panel (persisted) |

Hotkey changes (tool, Fill/Erase, brush size, masks, PHI) show a brief readout on the active viewport.

## Structure

| Tool | Tooltip | Controls |
|---|---|---|
| **Freehand** | Trace a boundary freehand | — |
| **Spline** | Place points; a smooth curve is fitted through them | see *Spline and Live Wire* |
| **Livewire** | Trace a boundary that snaps to the nearest image edge | see *Spline and Live Wire* |
| **Sculptor** | Push or pull an existing boundary into shape | brushSize |

The Structure toolbox, like the Segmentation one, keeps one height whatever tool is active.

## Spline and Live Wire

The same controls serve the Structure **Spline** / **Livewire** tools and Contour Fill's
Spline / Live Wire boundaries (SegWorks parity branch 6).

**Live Wire** — **Edge cost**: Basic (Cornerstone's) or Advanced (gradient weight, direction
weight, pre-smoothing σ, Laplacian zero-crossing cue, Scharr / Sobel); **Close within** — how
near the first point (screen px) a click closes the contour; **Smooth commit** — Chaikin passes
on the committed contour (off, 1–3).

**Spline** — **Algorithm**: Centripetal Catmull-Rom, Cubic B-spline, Monotone cubic, Akima,
Local Catmull-Rom+, Tension spline, ROI active spline (pulls the curve onto image edges inside
the ROI limit), Linear; **▸ Options**: density, tension, *No crossing* (refuses a point or drag
that makes the curve cross itself), propagation **Track**. **Edit**: Global, or Local ROI
(points are added and moved only inside the ROI limit; **Fit ROI** zooms to it). **Spline**:
Undo point (also ⌫), Clear, and Commit while a spline is held.

**Slice** — the spline slice workflow. Each action puts a spline **in hand**: a closed,
editable spline on the slice, nothing written yet; **⏎** commits it (one undo step), **⎋** or
Clear drops it.

| Action | What it does |
|---|---|
| **Undo & edit** | Undo the last spline and hold its points again to adjust them — only while it is still the newest edit |
| **Copy nearby** | Hold the outline from the nearest slice that has one (up to 10 away): its own control points if it was drawn as a spline, otherwise its outline as an editable spline |
| **◀ ▶** | Commit the spline in hand (or take the outline on this slice) and carry it to the previous / next slice, moving there. Track: **Deform spline** (points pulled onto that slice's edges), **Mask** (propagated by intensity — stops if the area would jump by more than 60 %), **Mask + snake** (then the morphological snake) |

## Measurement

| Tool | Tooltip | Controls |
|---|---|---|
| **Length** | Measure a straight-line distance (L) | — |
| **Angle** | Measure the angle between two lines (A) | — |
| **Bidir.** | Measure a long axis and its perpendicular | — |
| **Ellipse** | Measure an elliptical region and its statistics | — |
| **Rect ROI** | Measure a rectangular region and its statistics | — |
| **Circle ROI** | Measure a circular region and its statistics | — |
| **Probe** | Read the intensity at a single point (D) | — |
| **Arrow** | Point at a feature and label it (T) | — |
| **Freehand ROI** | Measure a freehand region and its statistics | — |

## Cursors

| Tool group | Cursor |
|---|---|
| Brush family (Brush, Eraser, Threshold, and the sphere variants) | Cornerstone's circle, sized to the brush radius |
| Dyn. Thresh | Two rings — brush radius plus the sampling radius it will read |
| Scissors, Rect Multi, Region, Contour Fill | `crosshair` |
| Paint Fill | `cell` |
| Select | `pointer` |
| Region+ | its own, as live feedback: `copy` when it can proceed, `not-allowed` when its seed heuristic is unsatisfied, `wait` while computing |

The app owns the viewport cursor and re-asserts the active tool's on every pointer move.
That is not tidiness: Region+ debounces its seed evaluation behind a timer with no mode
guard, so it used to write `not-allowed` some hundreds of milliseconds after the user had
already switched to a tool that worked. The timer is now cancelled when the tool is left.

Two other cursor defects fixed at the same time:

- Every brush variant is the same Cornerstone `BrushTool` — only the strategy differs — so
  Cornerstone's clear-on-deactivate never fired between them and a Brush→Sph. Brush switch
  left two cursor circles on screen.
- Leaving Dyn. Thresh did not clear `dynamicRadiusInCanvas`, and the cursor composition
  draws its second ring whenever that value is set, so every later brush kept showing it.

`annotations/tool-cursor` and `annotations/tool-controls` pin all of the above.

## Add/remove mode

The three shape tools (Circle, Rect, Sphere) are Cornerstone's *scissors* tools. Each
registers exactly two strategies:

| Strategy | Available | Notes |
|---|---|---|
| `FILL_INSIDE` | yes (default) | voxels inside the shape join the active segment |
| `ERASE_INSIDE` | yes | voxels inside the shape are removed from it |
| `FILL_OUTSIDE` | **no** | `fillOutsideCircle` / `fillOutsideSphere` throw `'Not yet implemented'`; no rectangle version exists |
| `ERASE_OUTSIDE` | **no** | `eraseOutsideRectangle` exists but ignores its own `inside` flag and erases *inside*; circle and sphere have no version |

So add/remove is the whole of the choice. The same is true of the brush: `Brush` and the
former `Eraser` were one Cornerstone `BrushTool` with `FILL_INSIDE_CIRCLE` or
`ERASE_INSIDE_CIRCLE`, exactly as the shape tools are one scissors tool apiece.

Because it is a property of the edit rather than a kind of tool, it is **one shared
`Mode` toggle** in the context toolbox — not a doubled set of buttons — persisted in
Settings (`annotation.scissors.defaultStrategy`, whose key keeps its historical name).
Holding **Shift** inverts it for the duration of the press, the `e` hotkey toggles it for
whichever tool is active, and the cursor follows in both cases.

The toolbox toggle shows the **effective** mode, not the stored preference, so it can
never disagree with what a stroke will do. Shift state is read from `shiftKey` on every
keyboard event and cleared on window blur, rather than latched on Shift press/release:
losing the window while Shift is held means the keyup is never delivered, and a latch
stayed inverted forever — the app then filled while the toggle read "Erase".

Creating an annotation does **not** open the name editor. It used to, and the editor
called `.focus()` + `.select()`, pulling the keyboard into the side panel so viewport
shortcuts typed into the label. Rename is double-click (or the kebab).

The separate **Eraser** and **Sph. Eraser** tools were retired into this mode.

The threshold family (`Threshold`, `Sph. Thresh`, `Dyn. Thresh`) is **fill-only** and does
not show the toggle: Cornerstone ships `THRESHOLD_INSIDE_*` with no erase counterpart.

### Cursors

One function (`cursorSpecFor`) decides the pointer per (tool, mode), and it names every
cursor **exactly**:

| Tool | Fill | Erase |
|---|---|---|
| Brush, Sph. Brush, Circle, Rect, Sphere | `XnatEditFill` | `XnatEditErase` |
| Threshold, Sph. Thresh, Dyn. Thresh | `crosshair` | — (fill-only) |
| Paint Fill / Region / Rect Multi / Contour Fill / Select | `cell` / `crosshair` / `crosshair` / `crosshair` / `pointer` | — |

`XnatEditFill` and `XnatEditErase` are a **matched pair we register ourselves**. Mixing a
CSS keyword for one mode with a shipped SVG cursor for the other made the pointer change
size, style AND hotspot as the mode flipped. `registerCursor` extends a BASE that fixes
iconSize 16, a 16×16 viewBox, a (8,8) mousePoint and a shared crosshair pointer group, so
the two are pixel-identical apart from the mark — a plus for fill, a minus for erase.
One pair serves every edit-mode tool: the toolbox already says which tool is active, so
the pointer's job is position and mode.

**`registerCursor` does not record the name on the descriptor**, and `createSVGIconUrl`
then stamps every such cursor's blob fragment as `#unknown-pointer` — which would make two
registered cursors indistinguishable from the DOM and hide a regression that swapped them.
We set `CursorSVG[name].name` after registering.

Two rules this exists to enforce, both learned from real bugs:

- **Never resolve a cursor as `${tool}.${strategy}`.** Cornerstone's `_getCursor` tries
  that, then falls back to `${tool}`, then to `default`, and it registers the
  per-strategy variants lazily — so the same state resolves differently depending on what
  ran before. Measured: the first Circle selection gave `CircleScissor`, a later
  identical one gave `CircleScissor.FILL_INSIDE`, and Sphere gave the OS arrow.
- **One writer.** A CSS map and an edit-mode writer once fought; the CSS one re-asserted
  on every mousemove and wiped the other, so erase showed the arrow except while Shift
  was held (which emits no mousemove).

The brush's own SVG ring shows RADIUS, not mode — Cornerstone dashes it off what lies
under the pointer, not off the active strategy — so it cannot serve as the indicator.

`Region+` is the only tool exempt from the authority: its cursor IS its state
(copy / not-allowed / wait). It therefore shows the OS arrow when idle.

Every combination is pinned in `e2e/specs/annotations/cursor-matrix.e2e.ts`.

Two Cornerstone quirks the cursor mapping has to absorb: there is a
`CircleScissor.ERASE_OUTSIDE` cursor SVG but no `ERASE_INSIDE` one, and `SphereScissor`
ships no cursor family at all (it borrows the circle's). See `scissorCursorFor` in
`unifiedToolService.ts`.
