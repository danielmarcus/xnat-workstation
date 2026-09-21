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
| **Brush** | Paint the active segment on this slice (B) | brushSize |
| **Eraser** | Erase the active segment on this slice (E) | brushSize |
| **Threshold** | Paint only where intensity falls inside the window | brushSize, intensityWindow |
| **Dyn. Thresh** | Paint within a window sampled from the voxel you click, not a preset one | brushSize, samplingRadius |
| **Sph. Brush** | Paint with a 3D kernel — one stroke also reaches neighbouring slices | brushSize |
| **Sph. Eraser** | Erase with a 3D kernel — also clears neighbouring slices | brushSize |
| **Sph. Thresh** | Paint with a 3D kernel, limited to the intensity window | brushSize, intensityWindow |
| **Circle Cut** | Drag a circle; everything inside it joins the segment | — |
| **Rect Cut** | Drag a rectangle; everything inside it joins the segment | — |
| **Sphere Cut** | Drag a sphere; everything inside it joins the segment, across slices | — |
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
