# Annotation tool reference

Generated from `src/renderer/components/annotations/toolCatalog.tsx` on 2026-09-21.
`toolCatalog.test` enforces the rules this table depends on: labels and icons unique
across the whole catalog, no tooltip that merely repeats its label, a hotkey advertised
if and only if `defaultHotkeyMap` defines one, and every declared control renderable.

**Controls** are what the toolbox shows while the tool is active — nothing else. A tool
listing no control needs none.


## Segmentation

| Tool | Tooltip | Controls |
|---|---|---|
| **Brush** | Add to or remove from the active segment on this slice; hold Shift to invert (B) | brushSize, editMode |
| **Threshold** | Paint only where intensity falls inside the window | brushSize, intensityWindow |
| **Dyn. Thresh** | Paint within a window sampled from the voxel you click, not a preset one | brushSize, samplingRadius |
| **Sph. Brush** | Add or remove with a 3D kernel — one stroke also reaches neighbouring slices; hold Shift to invert | brushSize, editMode |
| **Sph. Thresh** | Paint with a 3D kernel, limited to the intensity window | brushSize, intensityWindow |
| **Circle** | Drag a circle; everything inside it is added to or removed from the segment (hold Shift to invert) | editMode |
| **Rect** | Drag a rectangle; everything inside it is added to or removed from the segment (hold Shift to invert) | editMode |
| **Sphere** | Drag a sphere; everything inside it is added to or removed from the segment, across slices (hold Shift to invert) | editMode |
| **Paint Fill** | Flood-fill the enclosed region under the cursor (F) | — |
| **Region** | Grow a region outward from the voxel you click | brushSize |
| **Region+** | Grow a region outward, adapting the boundary as it goes | brushSize |
| **Rect Multi** | Drag a rectangle; everything inside it within the intensity window joins the segment | intensityWindow |
| **Contour Fill** | Draw a boundary; the area it encloses joins the segment | — |
| **Select** | Click a painted region to make its segment the active one | — |
| **Seg Bidir.** | Measure the active segment’s longest axis and its perpendicular | — |

## Structure

| Tool | Tooltip | Controls |
|---|---|---|
| **Freehand** | Trace a boundary freehand | — |
| **Spline** | Place points; a smooth curve is fitted through them | — |
| **Livewire** | Trace a boundary that snaps to the nearest image edge | — |
| **Sculptor** | Push or pull an existing boundary into shape | brushSize |

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

The separate **Eraser** and **Sph. Eraser** tools were retired into this mode.

The threshold family (`Threshold`, `Sph. Thresh`, `Dyn. Thresh`) is **fill-only** and does
not show the toggle: Cornerstone ships `THRESHOLD_INSIDE_*` with no erase counterpart.

### Cursors

One function (`cursorSpecFor`) decides the pointer per (tool, mode), and it names every
cursor **exactly**:

| Tool | Fill | Erase |
|---|---|---|
| Brush, Sph. Brush | `crosshair` | `Eraser` |
| Threshold, Sph. Thresh, Dyn. Thresh | `crosshair` | — (fill-only) |
| Circle, Sphere | `CircleScissor` | `Eraser` |
| Rect | `RectangleScissor` | `Eraser` |
| Paint Fill / Region / Rect Multi / Contour Fill / Select | `cell` / `crosshair` / `crosshair` / `crosshair` / `pointer` | — |

Erase is the same glyph everywhere on purpose: one symbol means "this stroke removes",
whatever shape is drawing.

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
