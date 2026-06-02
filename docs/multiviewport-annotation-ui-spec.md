# XNAT Workstation — Multi-viewport Annotation UI Specification

**Status**: v1 spec — locked
**Audience**: implementing engineers
**Companion artifact**: `docs/mockup-viewer.html` (interactive prototype)
**Source-of-truth for codebase architecture, IPC, DICOM compliance, conventions, and terminology**: [`CLAUDE.md`](../CLAUDE.md). This spec defers to CLAUDE.md for anything not explicitly redefined here.

This document specifies the UI rebuild that follows Phase 6 (commit `3b76e95`), which removed `SegmentationPanel.tsx` and left the viewer non-functional. The rebuild restores annotation functionality with a panel-centric design, promotes measurements to a first-class peer of segmentations and structures, and addresses gaps in the prior implementation.

---

## 1. Terminology

Used consistently throughout this document:

| Term | Meaning |
|---|---|
| **Viewport** | One Cornerstone3D rendering surface — a single image cell. Code IDs are `panel_0`, `panel_1`, etc. for historical reasons; they refer to viewports. |
| **Viewport area** | The center region containing the grid of viewports. |
| **Side panel** | A UI surface alongside the viewport area (Annotations side panel; DICOM Tags is no longer a side panel — see §10). |
| **Sidebar** | The XNAT browser on the left edge of the app. |
| **Toolbar** | The top-of-window strip with viewer controls. |
| **Container** | A SEG, RTSTRUCT, or DICOM-SR top-level annotation file. Owns one or more *members*. |
| **Member** | One segment (SEG), one structure ROI (RTSTRUCT), or one measurement (SR) inside a container. |
| **Annotation type** | One of three peers: **Segmentation** (SEG), **Structure** (RTSTRUCT), **Measurement** (DICOM SR). Singular. |

---

## 2. Architecture

The UI is composed of four surfaces, with one shared modal/toast layer:

```
┌───────────────────────────────────────────────────────────┐
│ Toolbar (§3)                                               │
├──────────────┬────────────────────────┬───────────────────┤
│              │                        │                   │
│  Sidebar     │   Viewport area (§5)   │   Annotation      │
│  (§7)        │   2×2 grid of viewports│   side panel (§4) │
│              │                        │   (resizable)     │
├──────────────┴────────────────────────┴───────────────────┤
│ (No global bottom status bar — sidebar has its own footer) │
└───────────────────────────────────────────────────────────┘

Modal / overlay layer (above all):
- Dialogs (§4.4, §4.5, §11)         - Toast stack (§11)
- DICOM Tags modal (§10)            - Cheatsheet overlay (§6.3)
- ErrorBoundary recovery screen (§13)
```

Container data lives in the existing `containerStore` (session-scoped, not viewport-scoped). Viewport↔container coupling is handled at the **render layer** by Frame-of-Reference matching (existing behavior).

The **Annotations side panel** is the canonical surface for all annotation lifecycle (create, name, edit, save, delete). The toolbar holds only viewer controls; no annotation-specific affordances live in the toolbar.

---

## 3. Toolbar

Order, left to right. Groups separated by thin vertical separators. Some groups use `CollapsibleGroup` (chevron when narrow); marked **(C)** below.

### 3.1 Left slot (App-provided)
- XNAT logo
- Connection chip (server name) when connected
- Login button when disconnected
- Connection-status pill

### 3.2 Data selection — **(C)**
- **Import** — opens local DICOM file picker (target: active viewport). Behavior not yet fully spec'd; treat as a separate import-flow spec.
- **Export** — exports current scan as DICOM/ZIP (existing behavior).
- **Favorites** — uses existing `BookmarksDropdown` implementation (recently-opened + pinned items).

### 3.3 Layout / View — **(C)**
- **LayoutDropdown** — opens an N × M grid picker (1×1 through 4×4). Trigger button shows current layout (e.g., "2×2") + chevron.
- **HangingProtocolDropdown** — modality-specific auto-layout options. Disabled with tooltip when no protocols apply. Trigger shows protocol name or "Hanging".
- **MPR toggle** — per-viewport. Clicking cycles the active viewport's orientation through `STACK → AXIAL → SAGITTAL → CORONAL`. Button is active (blue) when active viewport's orientation ≠ STACK.

### 3.4 Navigation tools — **(C)**
- **Crosshairs** — left-click sync between viewports; Shift+move dynamic sync; drag W/L
- **Pan** — left-click drag
- **Zoom** — left-click drag
- **W/L drag** — left-click drag
- **W/L Presets dropdown** — Trigger shows W/L icon + label:
  - When no preset selected: label = **"Presets"**
  - When preset active: label = preset name (e.g., **"Bone"**). Tooltip shows `W:×× / L:××`.
  - Menu items: Soft tissue, Lung, Bone, Brain, Abdomen, Mediastinum, Custom…

### 3.5 Transform — **(C)**
- Reset viewport · Toggle invert · Rotate 90° · Flip horizontal · Flip vertical

### 3.6 Undo / Redo
- Undo (`⌘Z`) · Redo (`⌘⇧Z`)
- Disabled when nothing in the stack for the active container

### 3.7 Cine playback — **(C)**
- Play / Stop (icon flips with state)
- FPS spinner (1–60)

### 3.8 Display toggles
- **Annotate** — toggles the Annotations side panel. Blue when open.
- **Tags** — opens the DICOM Tags **modal dialog** (see §10).

### 3.9 Right slot (pinned, always visible)
- Connection status / errors slot (transient pill; surfaces network errors, sync warnings)
- **Settings** (gear icon) — always displayed

### 3.10 Collapsing behavior
When the toolbar runs out of horizontal space, groups marked **(C)** collapse to a chevron button. Clicking the chevron opens a popover containing the group's controls. The Annotate / Tags / Undo / Redo / Settings affordances never collapse.

### 3.11 Tooltip hints
Every toolbar button whose action has a default hotkey suffixes the tooltip with the binding in parentheses, e.g., `title="Brush (B)"`. Suffixes are derived live from the current hotkey map so they update after user remaps.

---

## 4. Annotation side panel

The single locus for all annotation interaction.

### 4.1 Layout

```
┌──────────────────────────────┐
│ Annotations    [Save all(N)] │  ← header
├──────────────────────────────┤
│ [+ Segmentation][+ Structure]│  ← three create buttons
│ [+ Measurement]              │     (icons always shown)
├──────────────────────────────┤
│ N total · N on active panel  │  ← list-state header
│                  [All ▾]     │     w/ filter toggle (§5)
├──────────────────────────────┤
│ ▾ [SEG] Tumor study A  ● ⋮ ✕ │  ← container rows
│   ⠿ ■ 👁 🔓 Liver       ✕   │     w/ member rows
│   ⠿ ■ 👁 🔒 Tumor       ✕   │
│   + Add segment              │
│ ▸ [STRUCT] Heart       ⋮ ✕   │
├──────────────────────────────┤
│ TOOLBOX (3×7 grid)           │  ← context-sensitive
│ [Brush][Eraser][Threshold]   │
│  ...                         │
│ CONTROLS (fixed 110px)       │
│  Brush size: ▬▬▬▬▬● 5 px    │
│  Labelmap opacity:    60%   │
├──────────────────────────────┤
│ ✓ Backed up · 2s ago         │  ← autosave row
└──────────────────────────────┘
```

- **Width**: drag-resizable via handle on the left edge. Range **140–600 px**. Default **400 px**.
- **Two narrow-mode thresholds**:
  - **< 270 px** (compact-add): the three create-button labels disappear; `+` and type-icon remain. Save-all button collapses to 💾 + count.
  - **< 210 px** (compact-tools): toolbox button labels disappear; icons only with tooltip showing the full tool name.
- Text labels everywhere truncate with ellipsis before the narrow threshold so nothing spills past button edges.

### 4.2 Header
- **Title**: "Annotations"
- **Save all** button: shows count of dirty containers `Save all (N)`. Hidden when zero dirty. Clicking opens the **Save All preflight dialog** (§4.4.4).

### 4.3 Create buttons
Three side-by-side buttons in a 3-column grid: **+ Segmentation** (blue) · **+ Structure** (emerald) · **+ Measurement** (purple). Each button always shows: `+` symbol + type-specific icon + text label.

Clicking a create button:
1. If the active viewport has no scan loaded → toast (info): "Load a scan in the active panel first" — no container created.
2. Otherwise: immediately creates a container with default name `{TypeLabel} N` and drops the name into **inline rename mode** (input replaces the name span; default text selected). User types or hits Enter to accept.
3. Newly created container is auto-attached to the active viewport and to any other viewport sharing the same scan (mirrors Frame-of-Reference matching).
4. New container is expanded and active. Toolbox switches to that type's tools.

**No naming dialog** — type or accept inline.

### 4.4 Container rows

```
[chevron] [BADGE] {name}    [dirty●] [scanId | recovered] [⋮][✕]
```

- **Chevron** rotates 90° when expanded.
- **Type badge**: `SEG` (blue) / `STRUCT` (emerald) / `MEAS` (purple).
- **Name**: double-click → inline rename. Single-click on name does nothing (clicks bubble to the container header which toggles expansion only when clicked elsewhere on the row).
- **Dirty dot**: small amber circle when `dirty = true`.
- **Scan ID badge** (e.g., `#3004`): shown only when not dirty and not recovered.
- **Recovered badge**: amber "recovered" pill (overrides scan ID).
- **⋮ (kebab)**: opens the kebab menu (§4.4.1).
- **✕**: opens the **DeleteConfirmDialog** (§4.4.2).
- **Active container** styling: blue left border (4px) + `bg-{accent}-900/15`.
- **Recovered** styling: amber left border + `bg-amber-900/15` (overrides active).
- **Off-active-panel dimming** (§5): rows whose container isn't visible on the active viewport are rendered at 50% opacity with a small pill (`↗ panel_2` or `↗ N panels`).

#### 4.4.1 Kebab menu

Common items (all three types):
- Save to file… (no `⌘S` shortcut shown — `⌘S` is reserved for the active container)
- Save to XNAT… *(disabled when not connected)*
- ─
- Rename *(F2)*
- Duplicate
- Reload from XNAT *(disabled if no XNAT origin)*
- Discard local changes *(disabled if not dirty)*
- ─
- Show all members · Hide all members · Lock all members · Unlock all members
- ─
- Delete… *(destructive, red)*

Type-specific additions:
- **MEAS**: between Duplicate and Reload add **Export to CSV**.

**v1.1 deferred kebab items**:
- **SEG**: Statistics… (volume, mean HU per segment)
- **STRUCT**: Edit ROI types… (Organ / GTV / CTV / PTV / Marker / …)

#### 4.4.2 DeleteConfirmDialog

Three forms based on origin and member count:

**No XNAT origin, ≤1 member**:
```
Delete "{name}"?
This cannot be undone.

[Cancel]                [Delete (red)]
```

**No XNAT origin, >1 member**:
```
Delete "{name}"? Contains N {members}.

[Cancel]                [Delete all (red)]
```

**With XNAT origin**:
```
Delete "{name}"?
N {members}. Unsaved changes: ✓

Local copy:  N {members}     On XNAT: scan #####

[Cancel] [Delete on hostname too (red)] [Delete locally only (zinc)]
```

The XNAT-origin form has the destructive "Delete on hostname too" button on the right, NOT as the default focus.

#### 4.4.3 ExistingSaveDialog (single-container upload conflict)

Triggered when the user clicks **Save to XNAT…** on a container whose XNAT origin remote version differs.

**Choose mode**:
```
"{name}" already exists on XNAT
Existing assessor on scan #####.

  Local:  N {members}, edited 2 min ago
  Remote: N {members}, 2 days ago

[Cancel]  [Create new…]  [Overwrite (red)]
```

Overwrite is destructive — red. No keyboard auto-confirm.

**Name mode** (entered from "Create new…"):
```
New name on XNAT:
[ {name} (copy) ]     ← prefilled, selected

[← Back]  [Cancel]  [Create]
```

#### 4.4.4 Save All preflight dialog

Triggered by **Save all (N)** in the panel header. Single dialog listing every dirty container with per-row action:

```
Save all annotations to XNAT
N with unsaved changes — review each, then run the batch.

┌────────────────────────────────────────────────────────────┐
│ [SEG]  Tumor study A                                       │
│        3 segments · existing #3004     [Overwrite ▾]       │
├────────────────────────────────────────────────────────────┤
│ [STRUCT] Heart contours                                    │
│        2 structures · existing #4001   [Save as new copy ▾]│
│                                        [Name: Heart 2025]  │
├────────────────────────────────────────────────────────────┤
│ [MEAS] Lesion measurements                                 │
│        4 measurements · new            [Save as new ▾]     │
└────────────────────────────────────────────────────────────┘

2 overwrite · 1 copy · 1 new · 0 skipped

[Cancel]                              [Save all (4)]
```

Per-row action dropdown:
- **With XNAT origin**: Overwrite existing (default) · Save as new copy · Skip
- **Without XNAT origin**: Save as new on XNAT (default) · Skip

When "Save as new copy" is selected, an inline name input appears next to the dropdown, prefilled with `{name} (copy)`. User edits before running batch — no extra dialog.

Footer summary line updates live as user changes actions. Save All button count reflects non-skipped total. Clicking Save all closes the dialog and runs the batch via SavingOverlay.

#### 4.4.5 SavingOverlay

Modal scrim during in-progress uploads. Appears for any upload >200 ms.

**Single-container**: spinner + `Saving "{name}" to XNAT…`. After 2.2 s, Cancel button appears.

**Batch (from Save All)**: spinner + `Saving N of M — "{name}"…` + thin progress bar.

On batch failure: overlay turns red, lists failed entries with per-row **Retry** + global **Retry all** / **Cancel**. Already-saved entries stay saved.

### 4.5 Member rows

```
[⠿][■ swatch][👁][🔒] {name}              [value][✕]
```

- **⠿ drag handle** (far left): cursor changes to `grab` on hover, `grabbing` while dragging. Drag-and-drop reorders within the container. During drag, source row dims to 35%; drop target shows blue 2px line above or below depending on cursor Y position.
- **Color swatch** (■): single-click opens an inline **Color picker popover** anchored to the swatch: 16 preset colors in a grid + "+ Custom…" row (opens OS color picker).
- **👁 visibility toggle**: plain click toggles. **Shift-click** = solo this member (hide all others in container). **Alt-click** = hide only this member.
- **🔒 lock toggle**: plain click toggles. When locked, name is muted; toolbox tools disabled with banner: "🔒 Active {member} is locked. Unlock to edit."
- **Name**: double-click → inline rename (same UX as container).
- **Value badge** (MEAS only): shows the measurement readout (e.g., "23.4 mm", "42.3°", "142 mm²").
- **✕**: deletes the member (no confirmation; can be undone via Undo).
- **Active member**: blue left border + `bg-{accent}-900/30`.
- **Hidden member**: 40% opacity.

### 4.6 Footer affordances per container

When a container is expanded:
- **SEG / STRUCT**: button **+ Add segment** / **+ Add structure** appended after last member. Click creates a new member with default name `{Type} N`, drops directly into inline rename, makes it active. No dialog.
- **MEAS**: hint text in place of the add button — italic zinc-500: "Draw on the canvas to add measurements". Measurement rows appear automatically when the user commits a drawn measurement.

### 4.7 Context menu on container header

Right-click anywhere on a container row → context menu at cursor position:
- Show all members
- Hide all members
- Lock all members
- Unlock all members
- ─
- Expand
- Collapse

### 4.8 Toolbox (context-sensitive)

Pinned at the bottom of the side panel (above the autosave row).

#### 4.8.1 Header
```
TOOLBOX                   [{TypeLabel} · {ContainerName}]
                          [Editing across N panes]  ← multi-panel pill
```

The "Editing across N panes" pill appears when the active container is attached to more than one viewport (Frame-of-Reference shared).

#### 4.8.2 Empty / locked / off-panel states

- **No active container**: "Select or create an annotation above to enable tools."
- **Active member is locked**: amber banner "🔒 Active {member} is locked. Unlock to edit." — tools hidden.
- **Active container isn't on the active viewport** (per §5): amber banner "⚠ Active annotation isn't on this panel. Switch to {panel_X[, panel_Y]} to edit, or pick a different annotation." — tools hidden.

#### 4.8.3 Tool grid

Strict **3-column grid**, all tools visible at once (no scrolling, no collapsibles), uniform button size (26 px tall, equal width). Like-by-like tools are ordered top-to-bottom but **no formal group labels** are shown — visual grouping by adjacency only.

Each button: small icon + text label. Tooltip shows the full tool name (e.g., "Sphere Brush (3D)" for button labeled "Sph. Brush") and the hotkey if one is bound. Unwired tools (Cornerstone-available but not yet registered in this codebase) get a dashed border + `*` suffix in the tooltip.

**Segmentation toolbox** (21 tools, 3×7 grid):

| Row | Cells |
|---|---|
| 1 | Brush · Eraser · Threshold |
| 2 | Dyn. Thresh* · Sph. Brush* · Sph. Eraser* |
| 3 | Sph. Thresh* · Circle · Rectangle |
| 4 | Sphere · Paint Fill · Rect ROI |
| 5 | Rect Multi* · Circle Multi · Contour Fill |
| 6 | Region · Region+ · Select |
| 7 | Label* · Bidir. · Intersect* |

(* = unwired in Cornerstone code today)

**Structure toolbox** (4 tools, 3×2 grid, 2 empty cells):

| Row | Cells |
|---|---|
| 1 | Freehand · Spline · Livewire |
| 2 | Sculptor · — · — |

**Measurement toolbox** (9 tools, 3×3 grid):

| Row | Cells |
|---|---|
| 1 | Length · Bidir. · Angle |
| 2 | Rectangle · Ellipse · Circle |
| 3 | Freehand · Probe · Arrow |

#### 4.8.4 Controls section (fixed height)

Immediately below the tool grid. **Fixed 110 px height** — layout never reflows when the user switches tools; unused space stays blank.

Header row: `CONTROLS` label + small **color swatch + active-member name** (right-aligned).

Body — context-sensitive based on active tool:

| Active tool family | Controls shown |
|---|---|
| Brush / Eraser / Threshold / Dyn. Threshold | Brush size slider |
| Sphere Brush / Sphere Eraser / Sphere Threshold | Sphere radius slider |
| Threshold-family tools | Threshold range (HU min/max number inputs) |
| Dynamic Threshold Brush | Sensitivity slider |
| Region Segment / Region Segment+ | Strength slider |
| All SEG | Labelmap opacity slider (always) |
| Spline Contour | Spline type dropdown (Catmull-Rom / Cardinal / B-Spline / Linear) |
| All STRUCT | Contour thickness + Contour opacity sliders |
| All MEAS | Hint: "Draw on canvas to add" |
| No tool selected | "Pick a tool above to see its configuration." (vertically centered) |

### 4.9 Autosave row (bottom)

Single line height (~24 px), pinned to the bottom of the panel:
- **Idle**: hidden (row collapses)
- **Saving**: subtle spinner + "Saving…" (zinc-400)
- **Saved**: ✓ + "Backed up Xs ago" (green-400, fades after 3 s)
- **Error**: ⚠ + "Backup failed — retry" (red-400, click to retry, persists)

The Annotations side panel is the only surface for **per-container backup status**. Routine autosave success is never shown as a toast or banner. (See §11 for transient feedback policy.)

---

## 5. Multi-viewport ↔ side panel coupling (Option C)

### 5.1 Model

The container list is **session-scoped**. The panel always renders every container in the session, regardless of which viewport is active. Filtering happens via visual emphasis and an optional explicit toggle.

### 5.2 Visual cues

- **Container on the active viewport**: full opacity, normal styling.
- **Container not on the active viewport**: 50% opacity + small pill on the right side of the row: `↗ panel_2` (single viewport) or `↗ N panels` (multiple). Tooltip lists the actual viewport IDs.

### 5.3 List header counter + filter toggle

Above the container list:
```
N total · N on active panel              [Filter: All panels ▾ ]
```
The toggle button switches between **"All panels"** (default) and **"Active only"** (strict filter). When "Active only" is on and no containers match: empty state with a link to "Show all annotations".

### 5.4 Active container behavior across viewport switches

When the user switches viewports and the active container isn't on the new active viewport:
- Active container **stays** active (no auto-switch).
- Toolbox header shows the warning banner from §4.8.2.
- Tools are hidden until either the user picks another container OR switches back to a viewport where the active one is present.

### 5.5 Active member visibility scope

The 👁 eye toggle is **global** — hiding "Liver" hides it on every viewport that displays the container. (Per-panel visibility is a v1.1 deferral.)

### 5.6 Per-panel state memory (v1.1)

Each viewport remembering its own active container and tool is **deferred**. v1 has one global active container and one global active tool.

### 5.7 New container attachment

When a user creates a new container via the create buttons:
- Attach to the active viewport.
- Auto-attach to every other viewport currently displaying the **same scan** (mirrors FoR matching).
- If the active viewport is empty (no scan), the create button is disabled and shows the info toast (see §4.3).

### 5.8 Editing-across-N-panes pill

Toolbox header pill (blue, small): `Editing across N panes` appears when the active container is attached to >1 viewport. Reassures the user that brush strokes / contour edits propagate.

### 5.9 Empty viewport drop-zone

A viewport with no scan loaded:
- Dashed border styling
- Centered download-arrow icon
- Caption: "Drop a scan here or click in the browser"
- During drag-over (when a scan is being dragged from the sidebar): border turns solid blue, background tints blue-500/8%.

### 5.10 MPR behavior

MPR is a **per-viewport** property, not a layout mode. The toolbar MPR button cycles the active viewport's `panelOrientation` through `STACK → AXIAL → SAGITTAL → CORONAL`. Other viewports retain their own orientations.

The MPR toolbar button is highlighted (blue) when the active viewport's orientation ≠ STACK.

---

## 6. Hotkeys

System already mature (`src/renderer/lib/hotkeys/`, Settings → Hotkeys tab, per-action remap, cross-platform Cmd/Ctrl). This spec specifies the bindings, adds new actions, and adds discoverability.

### 6.1 New default bindings — 12 previously unbound tools

| Action | Default |
|---|---|
| `tool.thresholdBrush` | `Shift+B` |
| `tool.bidirectional` | `Shift+L` |
| `tool.rectangleROI` | `Shift+M` |
| `tool.circleROI` | `Shift+C` |
| `tool.ellipticalROI` | `Shift+O` |
| `tool.freehandROI` | `Shift+H` |
| `tool.freehandContour` | `Shift+F` |
| `tool.splineContour` | `Shift+P` |
| `tool.livewireContour` | `Shift+W` |
| `tool.sculptor` | `Shift+U` |
| `tool.circleScissors` | `Shift+I` |
| `tool.rectangleScissors` | `Shift+X` |

### 6.2 New action bindings

| Action | Default | Notes |
|---|---|---|
| Save active container | `⌘S` | Routes to file save or XNAT save based on origin |
| Save all | `⌘⇧S` | Triple-key, kept by universal Save-As convention |
| Toggle DICOM Tags modal | `Shift+T` | |
| Cycle active viewport orientation | `m` | Same as toolbar MPR button |
| Open Settings | `⌘,` | |
| Show keyboard shortcuts | `?` | See §6.3 |

**New Segmentation / Structure / Measurement** are deliberately **unbound by default** (no clean two-key combo available). Users can assign keys in Settings.

### 6.3 Cheatsheet overlay (`?`)

Pressing `?` outside an input opens a modal overlay listing every binding, grouped by category (Tools · Editing tools · Viewport · Layout · Slice · Brush size · Panels · W/L presets · Edit · Save · App). Three-column responsive layout. Esc / `?` again / click ✕ to close.

Settings → Hotkeys tab also surfaces the same view alongside the remap UI.

### 6.4 Tooltip suffixes

Every button whose action has a default binding suffixes its tooltip with the binding in parens: `Brush (B)`. Suffixes update automatically when the user remaps an action.

### 6.5 Customization

Existing Settings → Hotkeys tab handles remapping. **Conflict detection blocks the assignment** — when a user tries to bind a key that's already in use, the modal shows the conflicting action(s) and requires the user to clear the previous binding before applying.

### 6.6 Default binding policy

- Two-key combos preferred over three-key combos
- Three-key combos accepted only for universally-conventional bindings (e.g., `⌘⇧S`, `⌘⇧Z`)
- Single-letter keys reserved for primary tools; `Shift+letter` for variants
- No chord sequences (`g a`-style) — deferred to v1.1
- No per-tool / per-panel scopes — bindings have one meaning regardless of context

### 6.7 Input-focus guard

Hotkeys do not dispatch when focus is in an `INPUT`, `TEXTAREA`, `SELECT`, or contenteditable element, **except** `Tab` (reserved for viewport cycling).

---

## 7. XNAT browser sidebar

Existing `XnatBrowser.tsx` is largely mature; this spec confirms locked behavior and specifies new additions.

### 7.1 Layout (locked)

- **Width**: 288 px default, drag-resizable
- **Visibility**: toggleable; 3px collapsed strip clickable to reopen
- **Hierarchy**: Projects → Subjects → Sessions → Scans (drill-down) with breadcrumb

### 7.2 Level-dependent controls

Search, filter, and sort controls **change based on the current level**. The mockup shows the scans-level variant. Specifically:

| Level | Search | Filter chips | Sort |
|---|---|---|---|
| Projects | Name | — | Name · Pinned |
| Subjects | Label / ID | — | Label · Pinned |
| Sessions | Label / accession / scanner | **Modality chips** (`CT/MR/PT/CR/…`) | Date desc · Date asc · Label · Scanner |
| Scans | Description / series # | — (modality is uniform within a session) | API order (no UI; defer to v1.1 if needed) |

**PET/CT special case** (mixed-modality session): only at scans-level within a PET/CT session, surface a modality chip row (`PT / CT`) to filter by modality within the single session.

### 7.3 Scan filtering (production behavior)

The scans list shows only **image acquisitions** — `isBrowsableSourceScan` (in `xnatBrowserUtils.ts:100`) filters out SEG, RTSTRUCT, SR, and other derived assessors. Those derived scans are tracked separately in `sessionDerivedIndexStore` and **auto-load as annotations** when their parent image scan is opened.

### 7.4 Derived-annotations footer pill

At the bottom of the scan list, when a session has derived assessors, show a small pill:
```
✓ N annotations auto-load   (2 SEG · 1 RTSTRUCT · 1 SR)
```
Surfaces existence + counts without putting derived scans in the list. They appear in the Annotations side panel as containers when their parent scan loads.

### 7.5 Multi-scan selection

- **Click** scan → loads into active viewport (current behavior)
- **Cmd/Ctrl+click** → toggle inclusion in selection set
- **Shift+click** → range-select from last clicked through this scan
- **Selection ≥ 2** → bulk-load bar appears at the bottom of the scan list:
  ```
  N selected      [Load 1×N (blue)] [2×2] [✕]
  ```
  - `Load 1×N` fills a 1×N layout with the selected scans
  - `2×2` (visible only when N ≤ 4) fills the 2×2 layout
  - ✕ clears selection

### 7.6 Drag-and-drop

Scans are draggable with payload MIME `application/x-xnat-scan` + `text/plain` fallback. Drop targets are viewport cells (`data-droptarget="panel"`). On drop, the dropped scan loads into that specific viewport.

**Multi-select drag**: dragging when ≥2 scans are selected drags the whole set. Drop into a viewport: scans fill the dropped viewport and adjacent viewports sequentially. Loaded viewports become the new state; previously-loaded scans are replaced.

### 7.7 Right-click context menu

Right-clicking a scan opens a menu at cursor:
- Open in active panel
- Open in panel_0 / panel_1 / panel_2 / panel_3 (shows "(replaces)" suffix for loaded viewports)
- ─
- Open in MPR (active panel)
- Pin to favorites
- Copy session URL

### 7.8 Compact mode (narrow sidebar)

Below a sidebar width threshold (~220 px), switch to an icon-rail mode showing only modality icon + scan number per row. Tooltip shows full label.

### 7.9 Visibility default

Sidebar starts **open** by default on each session; not persisted across launches (v1). Users dismiss via the strip toggle.

### 7.10 Bookmarks dropdown

Separate `BookmarksDropdown` above the browser surfaces 5 most-recently-opened sessions + pinned items per server. Existing behavior; no changes.

### 7.11 Status footer

The sidebar footer (bottom 40 px) continues to show ambient connection / load state. Tones: info · loading · success · error. Set via `setBrowserStatusMessage()`.

---

## 8. Settings modal

Existing modal is mature. This spec specifies polish + tab restructure.

### 8.1 Tab order + renames

```
1. Hotkeys
2. Annotation
3. Display              ← renamed from "Overlay"
4. Interpolation
5. Backup               ← renamed from "File Backup"
6. Updates
7. Diagnostics          ← renamed from "Issue Report"
8. About
```

### 8.2 Reset behavior

- Per-tab reset retained where it exists (e.g., "Reset Hotkeys")
- **Global "Reset All Preferences" shows a confirmation dialog** before applying

### 8.3 Hotkey conflict detection

When a user remaps an action to a key already bound to another action, the Settings UI:
- **Blocks the assignment**
- Shows an inline warning listing the conflicting action(s)
- Provides a "Clear conflicting binding" button — user must click it to release the key before the new assignment applies

### 8.4 Backup directory verification

- Settings → Backup tab shows the current cache location
- New **"Verify path"** button checks the directory is readable + writable
- If the path is inside a known cloud-sync root (OneDrive / iCloud / Dropbox), display a **persistent inline warning**: "Backup directory is inside a sync folder. Sync churn may cause backup failures."
- New **"Change directory…"** button opens a folder picker

### 8.5 In-modal search (v1.1 deferred)

No global search across Settings tabs in v1. Each tab is short enough that visual scanning is adequate. Revisit if more tabs are added.

---

## 9. Viewport overlays

Existing system: 4 corners × multi-select fields, configurable in Settings → Display. This spec adds fields and polish.

### 9.1 New overlay fields

Four new entries in the `OverlayFieldKey` enum:

| Key | Renders | Default placement |
|---|---|---|
| `cursorHU` | "HU: 47" (over CT/MR pixel under cursor) — blank when not hovering | Bottom-left (after `windowLevel`) |
| `cursorCoords` | "(132.4, -82.1, 240.5) mm" — LPS patient-space | Bottom-left (after `cursorHU`) |
| `activeTool` | "Tool · Brush" — currently active left-click tool | Bottom-right (after `crosshair`) |
| `activeAnnotation` | "SEG · Liver" — active container · active member | Bottom-right (after `activeTool`) |

Field count: 19 → 23.

### 9.2 Master toggle rename

The "Show viewport context overlay" toggle in Settings → Display is renamed to **"Show corner overlays"** for clarity. Rulers + orientation markers retain their independent toggles.

### 9.3 Drop shadow for legibility

Apply a subtle drop shadow (or text-stroke) to overlay text so it stays readable on bright images (e.g., over-windowed CT, white backgrounds). Style: `text-shadow: 0 1px 2px rgba(0,0,0,0.8)`.

### 9.4 Toast / overlay coexistence

Toasts appear top-right of the viewport area (§11). Brief overlap with the TR overlay corner is accepted — toasts are 3s transient and rare; corner overlays remain readable underneath.

### 9.5 Per-panel overlay config (v1.1)

Per-viewport overlay configuration is **deferred**. v1 uses one global config across all viewports.

---

## 10. DICOM Tags — modal dialog

**Major change**: DICOM Tags is no longer a side panel. It is now a **resizable modal dialog**.

### 10.1 Opening / closing

- Open: toolbar "Tags" button or hotkey `Shift+T`
- Close: ✕ button · Esc · backdrop click
- Resizable: drag the bottom-right corner of the modal to resize (640 × 480 default; 360 × 320 min; up to 90% of viewport)

### 10.2 Layout

- Modal scrim over viewport area (toolbar + sidebars stay clickable behind a translucent background)
- Header: title + search field + close button
- Body: scrollable tag list

### 10.3 Tag display

Grouped by DICOM module (Patient · Study · Series · Equipment · Acquisition · Frame of Reference · Image · Other). Each group is collapsible with item count.

Per row: `(GGGG,EEEE)` tag number (mono) + VR (US/PN/LO/…) + human-readable name (from `dicomTagDictionary.ts`) + value.

Sequences shown as **flat single-level** — display `<sequence: N items>` without expanding. Recursive sequence expansion is a v1.1 item.

### 10.4 Search

Single text search filters across name + keyword + tag number + VR + value. Existing behavior.

### 10.5 Module filter chips

Above the tag list (below the search box), a row of chips: `All · Patient · Study · Series · Equipment · Acquisition · Image · Other`. Single-select; clicking a chip restricts the visible tags to that module. No VR filter (too granular).

### 10.6 Copy-to-clipboard

On hover, the right side of each row reveals a small copy icon. Click → copies the **value** to clipboard. Toast (success): "Copied value to clipboard."

Right-click row → context menu with extended options:
- Copy value
- Copy `(GGGG,EEEE) Name = value`
- Copy as JSON
- Copy whole group as JSON

### 10.7 Per-frame functional groups (v1.1)

Enhanced multi-frame DICOM `PerFrameFunctionalGroupsSequence` is **not surfaced** in v1 — shows as a single sequence count row. Frame selector deferred.

### 10.8 Compare mode (v1.1)

Side-by-side tag diff between two viewports is **deferred**.

### 10.9 Code Sequence dereferencing (v1.1)

Code values shown raw in v1. Lookup → human readable label deferred.

### 10.10 Private tags

Existing private-tag toggle preserved (checkbox to include/exclude tags with odd group numbers).

### 10.11 Data source

`dicom-parser` direct on `wadouri.dataSetCacheManager.get(uri)` for the active viewport's current image. Auto-updates on slice scroll + viewport switch.

---

## 11. Toast / notification system (NEW)

The codebase has no toast system today (status uses sidebar footer, dialogs, and banners). This spec introduces toasts as a new fourth surface.

### 11.1 Scope and position

- **Viewport-area-scoped** — toasts float over the viewport grid, not inside any side panel.
- **Position**: top-right of the viewport area.
- Visible regardless of which side panels are open.

### 11.2 Kinds

Four kinds, each with icon + color:

| Kind | Icon | Style |
|---|---|---|
| Success | ✓ | green-900/90 bg, green-100 text, green-700 border |
| Info | ⓘ | zinc-900/90 bg, zinc-100 text, zinc-600 border |
| Warning | ⚠ | amber-900/90 bg, amber-100 text, amber-700 border |
| Error | ✕ | red-900/90 bg, red-100 text, red-700 border |

### 11.3 Duration + dismissal

- **Success / info**: 3 seconds, then fade
- **Warning**: 5 seconds
- **Error**: persistent until dismissed
- Click toast → dismiss immediately
- Hover toast → pause the auto-dismiss timer; resume on mouseleave

### 11.4 Stacking

Max 3 visible. New toasts push from the top; oldest fades when limit exceeded. Stack direction: top-down (newest at top).

### 11.5 Action buttons

Toasts may include one optional action button: `[Undo]`, `[Retry]`, `[Show]`, etc. The action handler fires when clicked. Clicking the action also dismisses the toast.

### 11.6 Accessibility

- Success / info: `aria-live="polite"`
- Warning / error: `aria-live="assertive"`
- Toasts are keyboard-focusable; Enter triggers the action button if present; Esc dismisses.

### 11.7 When to use which surface

| Situation | Surface |
|---|---|
| Routine background work that succeeded (autosave) | **Silent** — only the panel autosave row (§4.9) |
| User-initiated action succeeded ("Saved Y to XNAT", "Loaded N scans", "Copied URL") | Toast (success) |
| Partial failure in a user-initiated batch (1 of N failed) | Toast (warning or error) + Retry action |
| User-initiated action wholly failed and needs decision | Dialog modal |
| Long-running ambient state (connecting, loading scan list) | Sidebar footer |
| Non-routine, high-stakes events (backup recovery available, app update) | Top-of-app banner |

### 11.8 API

```ts
toastService.notify({
  kind: 'success' | 'info' | 'warning' | 'error',
  message: string,
  detail?: string,           // optional second line
  action?: { label: string; onClick: () => void },
  duration?: number,         // ms; defaults per kind
});
```

### 11.9 Replaces deleted PanelToast

`src/renderer/components/viewer/segmentation/PanelToast.tsx` (deleted in commit `3b76e95`) is **not resurrected**. The new toast surface is viewport-area-scoped (not panel-scoped) and visible whether or not the Annotations side panel is open.

### 11.10 v1.1 deferrals

- Notification center (history of dismissed toasts)
- Sound effects per kind
- Customizable position / duration / kind styling in Settings

---

## 12. Persistence / backup / recovery

Existing backup architecture is mature. This spec adds polish and addresses gaps.

### 12.1 Locked architecture

| Aspect | Behavior |
|---|---|
| Trigger | Event-based, 10s debounce (configurable 5–120s) |
| Storage | `<userData>/backups/<sessionId>/` per OS; configurable via §12.4 |
| Format | DICOM SEG / RTSTRUCT binary; atomic `.tmp → rename` write |
| Per-segmentation | One backup at a time, replaces previous |
| Cross-session | Independent per session |

### 12.2 Auto-pruning (NEW)

Backups older than **30 days** are auto-pruned. Default 30 days; user-configurable in Settings → Backup.

### 12.3 Post-XNAT cleanup (NEW)

When a container is successfully saved to XNAT, its local backup is **auto-deleted**. The container is now safely persisted server-side. (User can disable this in Settings if they want belt-and-suspenders.)

### 12.4 Configurable backup directory (NEW)

Settings → Backup adds:
- "Change directory…" button → folder picker
- Default: Electron's `userData/backups`
- **Sync-folder warning** — if the chosen path is inside a known cloud-sync root (OneDrive / iCloud / Dropbox), display a persistent inline warning: "Backup directory is inside a sync folder. Sync churn may cause backup failures."
- "Verify path" button checks readable + writable

### 12.5 Recovery flow (CHANGED)

When the app loads a session that has recoverable backups, a **single batched recovery dialog** appears (replaces the prior per-entry sequence of modals):

```
Recover unsaved annotations?
This session has N backups newer than the last XNAT save.

┌──────────────────────────────────────────────────────────┐
│ [✓] Tumor study A          3 segments · 2h ago           │
│ [✓] Organs at risk         2 structures · 30m ago        │
│ [ ] Lesion measurements    4 measurements · yesterday    │
└──────────────────────────────────────────────────────────┘

[Skip all]                    [Recover selected (2)]
```

Recovered containers appear in the Annotations side panel with the **amber "recovered" row styling**. Skipped backups remain available in Settings → Backup → Cached Backups for later manual recovery.

### 12.6 Recovery banner (KEPT)

A top-of-app banner appears when the app starts and there are recoverable backups across any session, surfacing the count: "N sessions have unsaved backups." The banner persists until dismissed. This is **not** a routine event — it's data-loss prevention — and warrants the persistent banner per the "no banner for routine events" rule's carve-out.

### 12.7 Quit-time flush (NEW)

When the user quits the app:
1. Trigger a final synchronous autosave for any dirty containers whose last autosave is older than the debounce window
2. If the sync save fails for any container, show a confirm dialog before exit: "Some changes couldn't be backed up. Quit anyway / Cancel / Open Backup folder"
3. Otherwise, quit silently

### 12.8 Hash-based integrity verification (v1.1)

Computing + verifying a hash on each backup write is deferred. Corruption detected lazily during recovery (parse failure → "remove" action).

### 12.9 Settings — Backup tab content

(After §8 renames)

- Master toggle: Enable / disable backup (default: enabled)
- Frequency slider: 5–120 s (default 10 s)
- Auto-prune: 30 days (configurable)
- Auto-delete after XNAT save: on (configurable)
- Directory: path display + Change directory… + Verify path
- Sync-folder warning if applicable
- Cached Backups list: grouped by server, per-session cards with Recover · Delete buttons; size + last-updated; refresh button

---

## 13. Error states

### 13.1 React ErrorBoundary (NEW)

- **Top-level ErrorBoundary** wraps `App.tsx` content
- On crash, render a recovery screen:
  ```
  Something went wrong.
  {error.message}

  [Reload renderer]  [Open Diagnostics]  [Send issue report]
  ```
- Auto-snapshot the diagnostics buffer (existing `mainLogBuffer`) at crash time and persist it under `<userData>/diagnostics/`
- **Per-viewport ErrorBoundary** wraps each viewport cell. A single viewport crash shows "Render error — [Reload viewport]" in that cell only; the rest of the app stays functional.

### 13.2 Catch-block taxonomy (audit + remediate)

Every `try/catch` in the codebase must classify its failure into one of four surfaces:

| Surface | When to use |
|---|---|
| **Silent** (`console.warn` only) | The operation has a working fallback that the user shouldn't be bothered by |
| **Toast** (per §11) | User-initiated action partially failed; recoverable; user may want to retry but doesn't need to |
| **Dialog** | User-initiated action wholly failed and needs decision |
| **Banner** | Non-routine, high-stakes events (recovery prompts, app updates, connection loss mid-session) |

A pre-v1 task is to audit every existing catch block and assign one of these surfaces. The audit identified ~70% are currently silent; most should remain silent or move to toast, with rare dialog escalations.

### 13.3 DICOM validation before upload (NEW)

`xnatUploadService` gains a `validateDicomBeforeUpload(buffer, sopClassUid)` step. Required tags per IOD:

| SOP Class | Required tags |
|---|---|
| SEG (1.2.840.10008.5.1.4.1.1.66.4) | Rows, Columns, NumberOfFrames, SegmentSequence, PixelData, BitsAllocated, BitsStored, HighBit |
| RTSTRUCT (1.2.840.10008.5.1.4.1.1.481.3) | StructureSetROISequence, ROIContourSequence, RTROIObservationsSequence |
| SR Comprehensive (1.2.840.10008.5.1.4.1.1.88.33) | ConceptNameCodeSequence, ContentSequence |

On validation failure: dialog with the specific tag(s) missing + Cancel (block upload). Logged to diagnostics buffer for support.

Mandated by `CLAUDE.md` "DICOM Compliance" section.

### 13.4 Upload retry UX

- **Per-container fail**: toast (error) with a Retry action button. Click → retry the upload with the original action (Overwrite / Create new / Save-new) — no re-prompt.
- **Save-all batch fail**: SavingOverlay turns red, lists failed entries with per-row Retry. "Retry all" + "Cancel" buttons at the bottom. Already-saved entries stay saved.

### 13.5 Scan load errors

- Per-scan failures surface **in the viewport cell itself**: red banner across the cell + "Failed to load #N {label}" + Retry button + Dismiss (✕)
- A "Details…" expander shows the underlying error (transfer syntax not supported, missing pixel data, etc.)
- Session-level failures (no scans accessible) → sidebar status footer message + toast (error)

### 13.6 WebGL / GPU context loss (NEW)

- At viewport creation, register a `webglcontextlost` listener
- On context loss: viewport shows overlay "Rendering paused — restoring…"
- On `webglcontextrestored`: re-attach viewport state, redraw
- If restoration fails twice within 60 s: banner: "Graphics context unstable. Restart app to recover. [Restart] [Diagnostics]"

### 13.7 Backup failure escalation

The per-container autosave row (§4.9) handles routine backup status. Additionally:
- After **3 consecutive backup failures in the same session**, also surface a toast (warning): "Local backup failing. Open Settings → Backup to check the directory."

### 13.8 Auto-snapshot diagnostics (NEW)

- On any unhandled exception caught by ErrorBoundary or unhandled promise rejection: automatically save a diagnostics snapshot to `<userData>/diagnostics/{timestamp}.json` (includes app/runtime info, memory, recent main+renderer logs)
- On next app launch, if unsent snapshots exist: banner "An error report from the previous session is ready. [Review] [Send] [Discard]"
- "Send" copies to clipboard or opens an email draft to `info@xnat.org`

### 13.9 Opt-in telemetry (NEW)

Settings → Diagnostics gains a toggle: **"Send anonymous crash reports automatically"** (default: off). When on, the snapshot auto-uploads via IPC to a configurable endpoint. Off by default for privacy-conscious / clinical environments.

### 13.10 Empty / no-data states

- App opens, no connection → existing login screen (no change)
- Connected, no projects → existing "No accessible projects found" (no change)
- Empty session (no scans) → sidebar status footer "No scans in this session"
- Unsupported file dropped on a viewport → toast (warning) "Unsupported file type for drop"

### 13.11 v1.1 deferrals

- Granular per-error-code retry strategies
- Network connectivity heuristics (offline detection + auto-pause)
- Tool-specific failure recovery (e.g., GrowCut fallback strategy)

---

## 14. v1.1 deferrals — consolidated list

For tracking. Cross-references the sections above.

### Annotation panel
- Statistics… kebab item on SEG containers (§4.4.1)
- Edit ROI types… kebab item on STRUCT containers (§4.4.1)

### Multi-viewport
- Per-panel state memory (each viewport remembers its own active container + tool) (§5.6)
- Per-panel member visibility (eye toggle scoped to one viewport) (§5.5)

### Hotkeys
- Chord sequences (`g a`, leader keys) (§6.6)
- Per-tool / per-panel scopes (§6.6)
- Default bindings for New Segmentation / Structure / Measurement (§6.2)

### XNAT browser sidebar
- Per-scan sort UI at scans level (§7.2)
- Grid-view thumbnail mode (already in production; just not exercised in mockup)

### Settings
- In-modal search (§8.5)

### Viewport overlays
- Per-panel overlay config (§9.5)
- Drawing-in-progress indicator
- Unit-system preference

### DICOM Tags
- Recursive sequence expansion (§10.3)
- Per-frame functional groups (§10.7)
- Compare mode (§10.8)
- Code Sequence dereferencing (§10.9)
- Sequence virtualization (only if perf-needed)

### Toasts
- Notification center / history (§11.10)
- Toast sounds
- Customizable position / duration in Settings

### Backup
- Hash-based integrity verification (§12.8)
- Per-session size cap
- Cloud-synced backup

### Error states
- Granular per-error-code retry strategies (§13.11)
- Network connectivity heuristics
- Tool-specific failure recovery

### Tools
- WholeBodySegmentTool (ML auto-segmentation) — deliberately omitted from v1 per direction; not strictly "deferred"

### App polish
- App-level bottom status bar
- Developer / perf overlay

---

## 15. References

- **Codebase**: `/Users/dan/Library/CloudStorage/OneDrive-WashingtonUniversityinSt.Louis/Projects/XNAT Workstation/`
- **Mockup**: `docs/mockup-viewer.html` (interactive prototype)
- **Project guide**: `CLAUDE.md` (architecture, IPC, DICOM compliance, terminology, conventions)
- **Phase tracking**: `PHASES.md` — this spec corresponds to **MV-Phase 7**. Sub-tasks 7.1–7.11 list the implementation rollout. v1.1 deferrals from this spec's §14 are owned by future phases.
- **Hotkey system**: `src/renderer/lib/hotkeys/`, `src/shared/types/hotkeys.ts`, `src/renderer/components/settings/SettingsModal.tsx`
- **Container/segmentation services**: `src/renderer/lib/cornerstone/` (segmentationService, segmentationManager, containerService, containerActions, xnatUploadService)
- **XNAT browser**: `src/renderer/components/connection/XnatBrowser.tsx`, `xnatBrowserUtils.ts`
- **Viewport overlay**: `src/renderer/components/viewer/ViewportOverlay.tsx`
- **DICOM tags**: `src/renderer/components/viewer/DicomHeaderPanel.tsx` (currently a side panel; convert to modal per §10)
- **Backup**: `src/renderer/lib/cornerstone/segmentationService/autoSave.ts`, `src/main/ipc/backupHandlers.ts`, `src/renderer/lib/backup/backupService.ts`
- **Deleted / to rebuild**: `SegmentationPanel.tsx`, `AnnotationListPanel.tsx`, `PanelToast.tsx`, `DeleteConfirmDialog.tsx`, `ExistingSaveDialog.tsx`, `SavingOverlay.tsx` (all deleted in commit `3b76e95`)
- **DICOM compliance**: `CLAUDE.md` § "DICOM Compliance" — required tag validation, SOP Class UIDs, transfer syntax, encoding rules

---

*End of spec.*
