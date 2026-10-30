# Annotation panel: tool families, modes and a calmer layout

Branch `annotation-panel-modes` (from `algorithm-modules` at `00610f0`), started 2026-10-28.

## Why

The Annotations side panel is crowded when a complex tool and a complex operation are both
open. Measured at 1600 × 872 with Level Trace selected and Seeded segmentation open:
the toolbox takes 385 px (the 19-button Segmentation grid 167 px, its controls 186 px and
scrolling), the operation 260 px, and the annotation list is left with ~185 px. The active
segment is named four times.

The wireframes (`docs/mockup/annotation-workspace-wireframes.html`) laid out seven decisions.
The user's picks (2026-10-28) keep everything in the panel:

| # | Decision | Pick |
|---|---|---|
| R1 | Where tools live | **D** — stay in the panel, one row of families |
| R2 | Where a tool's options live | **C** — compact strip at the bottom of the panel |
| R3 | Tool set | **B** — families, variants merged into modes |
| R4 | Picking an operation | **A** — grouped menu (Clean · Fill in · Segment · Check · Modules) + ⌘K |
| R5 | Panel structure | **A** — list + one operation drawer, solid header bands |
| R6 | Naming the edited segment | **A** — the list row + one editing chip (in the options strip) |
| R7 | Settings density | **A** — 2–4 essentials, the rest under More (dot when changed) |

Moving tools out of the panel stays the fallback if this does not buy enough.

## What changes

### Panel, top to bottom

1. Header and the annotation list (takes all remaining height).
2. **Operation drawer** (R5): a solid header band — "Operation" + the grouped picker (R4),
   collapse, close — over the open operation's body. Its height is dragged from the band's
   top edge; collapsed, it is the band plus a one-line summary.
3. **Tools** (R1-D, R3-B): a solid header band ("Segmentation tools" + silent backup status),
   then one row of family buttons.
4. **Options strip** (R2-C, R6, R7): the editing chip (■ Segment 1 · Segmentation 1 — the only
   copy outside the list; clicking it scrolls the list to the row), then the active tool's
   essentials, then More ▾. More shows a dot when anything in it differs from its default.

### Segmentation: 19 buttons → 7 families (R3-B)

| Family | Replaces | Modes |
|---|---|---|
| **Select** | Select | — |
| **Brush** | Brush, Sph. Brush, Threshold, Sph. Thresh, Dyn. Thresh, Smart Brush | Kernel 2D · 3D; Limit None · Window · From click · Edges |
| **Fill** | Paint Fill | — |
| **Shape** | Circle, Rectangle, Sphere, Rectangle Threshold, Circle Threshold | Shape Circle · Rectangle · Sphere; Limit None · Window |
| **Contour** | Contour Fill | Boundary Freehand · Spline · Live wire (unchanged) |
| **Region** | Region, Region+ | Gesture Drag · Click |
| **Trace** | Level Trace | — |

Moved out of the tool set:

- **ROI limit** → a toggle in the tools header band (▭ ROI, with ✕ to clear once drawn). It
  confines Level Trace, Cleanup, Seeded's domain, Region competition, the modules and the
  contour Local ROI / Fit ROI, so it cannot belong to one family: in the header, every tool
  and open operation can reach it. Pressing it again returns to the tool used before.

- **Random Walker** → a method of the Seeded segmentation operation (it already paints into
  the same seed store; ⇧-drag = Background is the Seeded painter's own rule).
- **Seg Bidir.** → the segment row's ⋮ menu. It was always an action on the active segment.
- **Labelmap opacity** → the segmentation row's ⋮ menu. It is not a tool setting.

Rules for modes:

- Each mode is the existing Cornerstone tool, unchanged; only the entry point merges.
- A family remembers the last mode used; clicking the family button activates it.
- Not every combination exists (3D + From click, 3D + Edges, Sphere + Window). Picking a
  value that cannot combine with the current ones selects the nearest tool that has it (Edges
  while 3D → 2D + Edges), so every value is clickable and the pressed buttons always describe
  the active tool. Values that force such a switch say so in their tooltip.
- Hotkeys are unchanged (B, F, O…): the family/mode highlight follows the active tool.

Structure and Measurement keep their tools (5 and 9) in the same family row/grid.

### Essentials (R7-A)

| Tool | Shown | Under More |
|---|---|---|
| Brush | Kernel · Limit · Size · Add/Erase (when the mode has it) · the limit's one control (window range, sample radius, tolerance) | window preset, Smart Brush spacing |
| Shape | Shape · Limit · Add/Erase · window range (Limit = Window) | — |
| Region | Gesture · Size | — |
| Trace | Band · tolerance · Edge guard · ROI limit | everything in today's Advanced fold |
| Contour | Boundary · its essentials | its advanced settings (already folded) |

### Operations (R4-A)

A button showing the open operation (or "Open an operation…") opens a grouped menu:
**Clean** Cleanup · **Fill in** Interpolate, Propagate · **Segment** Seeded segmentation,
Region competition · **Check** 3D QC · **Modules** (installed modules). ⌘K opens a finder
over every tool, mode and operation, matching today's names too ("threshold" → Brush, Limit =
Window).

## Build sequence

Each slice leaves the app working, is verified (unit + E2E in the built app), and is
committed on its own.

1. **Catalog model.** `SEG_FAMILIES`, `familyOf`, `resolveMode`, with unit tests.
2. **Families row + options strip.** Family row; mode rows; editing chip; Controls header and
   the toolbox header's member name removed; remembered mode per family; E2E `clickTool`
   learns the old names (clicks family then modes, as a user does).
3. **Essentials + More** (R7-A) for the SEG tools, with the changed dot.
4. **Moves:** ROI limit into Trace; Seg Bidir. and labelmap opacity into the ⋮ menus.
5. **Random Walker → Seeded method.** The RW tool and its controls are removed.
6. **Operation drawer** (R5-A): header bands, draggable height, the target chip removed (R6).
7. **Grouped operations menu** (R4-A).
8. **⌘K finder.**
9. **Docs + measurement.** Re-measure the worst case; CLAUDE.md, segworks-parity D1/D2, the
   frozen-mockup note; full offline E2E.

## Status

- [x] 1 Catalog model
- [x] 2 Families row + options strip (header band for the tools included)
- [x] 3 Essentials + More
- [x] 4 Moves (ROI limit, Seg Bidir., opacity)
- [x] 5 Random Walker → Seeded
- [x] 6 Operation drawer
- [x] 7 Grouped operations menu
- [x] 8 ⌘K finder
- [x] 9 Docs + measurement

## Measured result (2026-10-28, built app, 1600 × 872)

The worst case from the wireframes — Level Trace active, Seeded segmentation open:

| | Before (`00610f0`) | After |
|---|---|---|
| Toolbox | 385 px (grid 167 + controls 186, scrolling) | 260 px (header band 28 + family row 45 + options 186, no scroll) |
| Operation | 260 px | 260 px (now draggable) |
| Annotation list | ~185 px | 275 px |
| "Segment 1" printed | 4 | 3 (list row, the seed class, the editing chip) |

The options strip keeps a fixed 186 px so the panel never moves as tools change; its
tallest content is Contour Fill's Spline boundary and the Brush with a window. Level Trace
leaves ~40 px of it empty. The full offline E2E suite ran on the slice 1–5 build
(608 passed; the 6 failures were fixed in `0e491cd`); the specs touching slices 3, 6–8 and
those fixes then passed on the final build (142/142).

Still possible if this is not enough: shrink the options strip to the active tool's height
(the panel would then move as tools change), or move the tools out (wireframe R1-A).
