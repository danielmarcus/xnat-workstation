# Multi-Viewport Annotation: Functional Requirements

Functional requirements for coherent handling of **RTSTRUCT contours (structures)**, **DICOM SEG labelmaps (segmentations)**, and **DICOM-SR measurements** when multiple viewports are open simultaneously. Written from the perspective of an experienced radiologist or expert annotator working with mature commercial tools (Eclipse, MIM, Velocity, RayStation, 3D Slicer, OHIF).

> **Coverage of the three types.** Sections A–C and the acceptance signals are written primarily against structures (RTSTRUCT) and segmentations (SEG). **Measurement (DICOM-SR)** is a recognized first-class peer container type — it has its own row hierarchy (D7.1) and its own create action (D7.6), and the foundational principles in A apply to it. But **measurement-specific in-memory requirements (which SR template, per-measurement round-trip fidelity, editing semantics, cross-plane display) are a skeleton to be filled before measurement implementation begins** — see the note in D7.1. Do not treat the absence of measurement-specific acceptance signals as "measurements are done."

These are *requirements*, not a design. They describe the behavior the system must produce, not how to implement it.

## Scope

This document covers in-memory behavior across multiple viewports — rendering, editing, selection, undo, dirty state, list-panel UX, geometry coherence, and round-trip fidelity within a session.

**Out of this document's scope** (covered in companion docs):
- **Transport / persistence to XNAT and other backends** — load, save, upload, version, conflict detection, multi-user, auth, asset model, scan ID conventions, browse-and-load UX. See [`annotation-xnat-integration-requirements.md`](annotation-xnat-integration-requirements.md).
- **Cross-FoR display via deformable registration**, **real-time collaborative multi-user editing**, **3D volume-rendered editing as primary interaction**, **streaming partial loads of very large segs** — see section F.

The boundary between this doc and the transport doc is the **transport contract** in section H below.

---

## A. Foundational principles

These apply equally to RTSTRUCT and SEG.

### A1. Single source of truth
A structure or segmentation is **one object**, regardless of how many viewports display it. Edits made in any viewport mutate the same underlying object. Two panels never hold divergent copies of the same structure.

### A2. Frame-of-Reference coherence
Visibility on a viewport is determined by **`FrameOfReferenceUID` match** (strict UID equality, per DICOM PS3.3 C.7.4.1) or by an explicit registered transform (DICOM Spatial Registration object), not by panel ID or by which viewport "owns" the structure. If a viewport's image volume shares the FoR of a structure, the structure is *eligible* to display there. Display is then gated by:

1. **Native vs cross-series rule (A2a, A2b below).** Whether the displayed series is the structure's native series or a different series sharing the same FoR.
2. **Per-viewport visibility (A5).**

A "registered transform" for v1 means an in-session, explicit registration the user has loaded or computed; deformable cross-FoR mapping is out of scope (see F).

### A2a. Native series — render unconditionally
When the active series in the viewport is the structure's native series (the series the contour was drawn on, identified by `referencedImageId` lineage / `ReferencedSeriesInstanceUID` for RTSTRUCT, or matching seg-grid-to-image geometry for SEG), structures render normally with full styling, full edit affordances on the source slice, and no special indicator.

### A2b. Cross-series, same FoR — render with visual flag, by default
When two series share an FoR but are different series (typical: T1 + T2 in one MR exam, multi-phase contrast CT), structures from one series **render by default** on the other series' viewport, subject to the geometric projection rules in A3 (plane intersection for contours; voxel resample for labelmaps). Rendering uses the **non-native visual style** (see UX section D9) and is **read-only on that viewport** — handles and brush edits are not allowed against a non-native series.

A viewport's **active series** is the series whose images it is currently displaying (one series per viewport in v1; multi-volume layered display is out of scope). A structure is "native" to a viewport when the structure's source series matches the viewport's active series. Drawing routing for non-native viewports is governed by B3 and D10 (blocked, with a hint to switch container or viewport).

This default reflects expected behavior for in-exam multi-sequence work where the patient was stationary and the user reasonably expects contours from one sequence to be a valid spatial reference on a sibling sequence.

### A2c. Same FoR but anatomically inconsistent (breath-hold / 4D-CT phases) — off by default
When two series share an FoR but the equipment or protocol indicates the patient pose differs (separate breath-holds, distinct 4D-CT phase bins, or any acquisition where the FoR is preserved but anatomy has demonstrably moved), cross-series rendering is **off by default**. The user may opt-in per structure-set / per session via an explicit "show structures from related series" toggle.

Detection heuristic for "off by default": separate `AcquisitionNumber` with same FoR plus large bulk-anatomy displacement is suggestive but not conclusive; when uncertain, prefer A2b (render with flag) over A2c (hide). The user always has explicit control.

### A2d. Different FoR — do not render unless registered
When the structure's FoR does not match the viewport's FoR and no Spatial Registration object bridges them, the structure is not displayed. The annotation list panel must still expose the structure with a clear "different frame of reference — not viewable here" indicator so the user is not confused about why it isn't drawing.

### A3. Geometric projection across orientations
Structures must render correctly in any anatomically valid view of an FoR-matched volume:

- **Axial / sagittal / coronal MPR**: contours rendered as their intersection curve with the current slice plane; labelmaps as resampled voxels on the slice.
- **Oblique / reformatted views**: same rule — intersection of the 3D structure with the current plane.
- **3D / volume rendering**: structures shown as surface/volume overlays.
- **Stack viewports** (native acquisition slices): contours shown on the slice they were drawn on; labelmap voxels at native resolution.

A contour drawn on an axial slice must immediately appear as the correct line/point in sagittal and coronal panels viewing the same volume, without a save/reload step.

### A4. Live propagation
Edits propagate to all eligible viewports in real time (within one render frame, < ~50 ms perceived). No manual "refresh," "sync," or "reload" action is required. This includes: create, modify (handle drag, brush stroke, polyline edit), delete, segment-index change, color/visibility change, smoothing, interpolation between slices.

### A5. Per-viewport visibility, independent of existence
The user can hide a structure or seg on a specific viewport (e.g., to declutter sagittal while editing on axial) **without deleting it** and without affecting its visibility on other viewports. Default for FoR-eligible viewports is *visible*.

Per-viewport visibility is **session-only and transient**: closing a viewport (removing it from the layout) discards its per-viewport visibility overrides; reopening a viewport — even with the same panelId, even in the same orientation — starts from the global default (D7.3) plus any list-panel toggles. Persisting per-viewport visibility across close/reopen is intentionally not supported. The list-panel toggle (D7.3) is the right tool for "hide everywhere"; per-viewport hide is for in-the-moment decluttering only.

### A6. Global active structure / active segment
The "currently selected" structure or segment-index (the "pen" the user is painting with) is a **single global state**. Switching panels does not change which segment is active. Visual indication of the active structure is consistent across all panels.

### A7. One edit target at a time
At any moment exactly one viewport is the **edit target** — the viewport whose geometry determines new strokes and brush footprints. Rules:

- The edit target is the **active viewport** (per A6) — set by explicit user click-to-focus on a viewport. Hover alone does not change the edit target.
- A drawing gesture (mouse-down through mouse-up, or stylus-on through stylus-off) is **bound to the viewport it began on**. If the cursor or stylus crosses into another viewport mid-gesture, the gesture continues to apply to the original viewport's geometry until release. This includes brush strokes, polyline draws, handle drags, and scissor cuts.
- Switching the active viewport during a gesture is not allowed; programmatic attempts (e.g., a hotkey to focus another panel) are deferred until gesture end.
- Edits propagate live to all eligible viewports as they happen (A4 / B4) — only the *origination plane* is bound, not the *visible result*.
- Drawing on a viewport with no FoR-matched series, or on a non-native viewport (D10), is blocked at gesture-start. The gesture does not transfer to a different viewport; the user is shown the appropriate hint.

### A8. Atomic, global undo/redo
Undo and redo operate on the structure-set / segmentation object, not the viewport. An action performed in panel A is undone identically whether the user invokes undo while focused on A, B, or C.

- **Granularity**: one user-visible action = one undo entry.
  - One completed drawing gesture (one mouse-down to mouse-up brush stroke, one polyline-completion, one handle drag) = one entry.
  - One interpolation operation across N slices (B5) = one entry — interpolated contours undo as a group.
  - One delete (per-member or bulk) = one entry.
  - One paint-fill or scissors operation = one entry per completed action.
  - One persisted-metadata change (color, name, member visibility default, structure-set rename) = one entry. Pure UI state (selection, hover, expand/collapse, scroll, per-viewport visibility overrides) does not enter the undo stack.
  - One container-level operation (rename, delete, reorder) = one entry.
- **Scope**: undo history is per-container. Undoing in container A does not affect container B. Switching the active container does not clear either's history.
- **Cross-viewport identity**: an action originating in viewport X is undone correctly even if X has since been closed (per acceptance signal G7).
- **Save is not a barrier**: saving does not clear undo history. The user can undo past a save point; the next save reflects the post-undo state.
- **External-change reload** (E3 / H6) clears that container's undo history — the in-memory state is replaced and pre-reload entries no longer apply.
- **Redo**: a fresh edit after an undo invalidates the redo stack for that container, in standard editor convention.
- **History depth**: at least 100 entries per container; exceeding the limit drops the oldest entry, never the newest.

### A9. Unified dirty state and save
Dirty state is a property of the structure-set / segmentation, not the panel. Editing the same object in two panels produces one dirty flag and one save.

- **Dirty flag**: set on any persisted-state mutation (geometry, name, color, member add/delete, structure-set rename, member reorder where persisted, approval state change). Cleared only on successful save (H5).
- **Auto-save trigger**: debounced after a user-visible idle period following any dirty event. Default debounce period is short (a few seconds; exact value is a design-phase decision). Auto-save **never fires mid-gesture** (mouse held down, stylus on, polyline incomplete, handle drag in progress).
- **Manual save**: the user can save explicitly per-container or globally; manual save flushes any pending debounced auto-save and serializes immediately.
- The dirty flag and the auto-save signal are emitted to the transport layer per the H3 contract.

**Intentional divergence from RayStation**: RayStation uses explicit save (no continuous autosave) and a global dirty indicator. This app uses debounced autosave by deliberate choice — the workflow assumption is fewer manual saves, faster recovery from a forgotten save, and per-container granularity instead of a single global commit. This trade-off should be made explicit to users coming from RayStation. The autosave behavior is **not** a candidate for replacement with explicit-only save in v1.

**Approved containers do not autosave on edit attempts** — edits to an approved container are blocked at gesture-start (D7.11), so there is nothing to save. The dirty flag remains clear on an approved container until the user explicitly revokes approval, at which point edits and autosaves resume normally.

### A10. No phantom state on layout change
Adding, removing, splitting, or rearranging viewports must not create, destroy, or modify any structure or segmentation. Layout is purely presentational.

### A11. Selection consistency
Selecting a structure (click, list-panel pick) selects it globally. All eligible viewports show the selection highlight on the same object simultaneously.

Selection is a **set**, not a single value: multi-select via shift/ctrl-click in the list panel adds to the set (per D7.5); each selected member is highlighted on all eligible viewports. Single-click in the list or single-click on canvas replaces the selection. Selection is independent of the active member (D7.5).

### A12. Concurrency safety on rapid layout churn
Mounting/unmounting viewports rapidly (orientation toggles, MPR ↔ stack, layout grid changes) must not lose attachments, leak representations, or produce stale "ghost" structures. The end state is determined solely by the current set of mounted viewports and the FoR-eligibility rule.

### A13. Annotation lifecycle — load, navigate, switch session, unload
The list panel's contents are driven by what is **loaded**, not by static UI. This principle defines the dynamics that the static mockup cannot show; it is verified by signals 25–26.

- **Scope = the loaded study/session, not a single scan or viewport.** The panel shows **every** annotation container associated with the session currently loaded in the viewport area — across all its scans/series — subject only to FoR-eligibility for *rendering* (A2). A container is never hidden from the *list* because the active viewport happens to show a different series (it dims / shows a cross-series or "not viewable here" marker per D9 / A2d / D7.4, but stays listed).

- **Populate (load).** Containers enter the panel two ways only: (1) **auto-load** when the user selects a session/scan in the XNAT Browser — the transport loads that session's RTSTRUCT/SEG/SR containers (transport B5; there is no manual "load" affordance); and (2) **create** via the panel's create buttons (D7.6). On load, each container's clean/dirty/approval state is restored from its source (E4 / D7.11).

- **Navigate to a different scan within the same loaded session/study.** The panel is **unchanged** — no container is added or removed. Only **rendering-eligibility re-evaluates** against the new active viewport's series: native members render normally; same-FoR sibling-series members render dimmed (cross-series, D9); different-FoR members show "not viewable here" (A2d). Active member, selection, dirty, and approval state are untouched (A6/A9/A11). No phantom state (A10).

- **Switch to a different session/study.** Loading a scan from a *different* session **re-scopes** the panel to that session (replace, not accumulate — the panel shows one study's annotations at a time). However, **unsaved work is never silently discarded**: any **dirty** container in the session being left is **retained in memory** (not unloaded) and surfaced via the unsaved-work banner (below); **clean** containers from the prior session unload. Returning to a session re-shows its containers, including any retained unsaved ones, with their dirty state intact. *(Decision — confirm: "one study at a time, retain unsaved, swap on switch." Alternative would be accumulating multiple sessions in one list; rejected for clarity.)*

- **Unload.** A container leaves panel + memory only when: its session is no longer loaded **and** it is clean; **or** the user explicitly deletes it (D7.6 row "✕"); **or** the user discards its unsaved changes (revert / explicit discard, with confirmation). Dirty containers are retained until saved or explicitly discarded — preventing accidental data loss.

- **Unsaved-work retention + banner.** Unsaved (dirty) containers across **all** visited sessions are tracked for the app session. A persistent **banner** — "*N sessions with annotations that have not been saved · Review now*" — surfaces them (the one routine-adjacent banner, justified as data-loss prevention per the CLAUDE.md surface taxonomy). "Review now" lists those sessions and lets the user save or discard. On app **restart** with unsaved work, recovery applies (transport E3 / backup).

- **No phantom state across all of the above (A10/A12).** Navigation and session switches never leave stale highlights, orphaned selections, duplicate containers, or leaked representations.

---

## B. RTSTRUCT (contour) requirements

### B1. Slice-plane semantics
Contours are stored as planar polygons with a `ContourGeometricType` and a reference plane (typically a `referencedImageId` for native slices, or a plane equation for reformatted contours). Display rules:

- **On the source slice** (panel showing the exact `referencedImageId`): full polygon rendered.
- **On a different slice of the same FoR**: rendered as the intersection of the polygon's plane with the current slice plane — typically a line segment, point, or nothing.
- **On a parallel slice within slice-thickness/2**: optionally shown with reduced opacity ("nearby slice" hint), per user preference.
- **On orthogonal/oblique slices**: rendered as the slice/plane intersection.

### B2. Source-slice editing
A contour can only be **edited as a polygon** on its source slice (or in a 3D editor). On orthogonal / non-source slices it is read-only (handles not exposed). This matches Eclipse / MIM behavior: a sagittal view of an axial contour shows the line but does not let you drag handles on it.

### B3. Drawing routing
The user creates a new contour by drawing on a viewport. Routing rules:

- **Target container**: always the **active container** (D7.5). Drawing always writes to it. The user changes the active container via the list panel.
- **Target member**: the active member within the active container. If the active container has no members, drawing creates a new one (with a default name) and makes it active. Otherwise, drawing appends to the active member — drawing tools never silently create new members. To start a new ROI, the user creates one in the list panel (D7.6) and makes it active.
- **Plane of the new contour**:
  - Volume / oriented viewport → the plane equation of that view at draw time, expressed in world space.
  - Stack viewport (where retained per the design proposal) → `referencedImageId` of the visible slice.
- **Source-series tagging**: the new geometry is tagged to the active viewport's currently displayed series.
  - If that series matches the active container's native series, the new geometry is native (B1, full polygon, edits in-place).
  - If it differs but shares the FoR (per A2b), drawing is **blocked** if A2b applies and the active container is non-native to the active viewport (per D10). New structures are not silently appended into a visiting structure-set. The user must either focus a viewport that is native to the active container, or activate a different (compatible) container, or create a new container tagged to the current viewport's series.
- **No FoR-matched viewport open**: if no open viewport's series shares the FoR of the active container, drawing is blocked everywhere. The cursor on every viewport changes to a not-allowed indicator and a hint directs the user to load a compatible series or to switch the active container.
- **Contour visibility after creation**: the new contour appears immediately on all FoR-eligible viewports per B1 / A4.

### B4. Slice-by-slice tracing across panels
A radiologist tracing a structure axially while watching the propagating shape on sagittal and coronal is a core workflow. As each new axial polygon is finished, the sagittal/coronal panels must update within the same animation frame to show the new intersection point/line.

### B5. Inter-slice interpolation (write-through, no promotion gate)
When the system interpolates between manually drawn slices (e.g., draw on every 5th slice, fill in between), the generated contours are written **directly into the structure-set as real geometries** at the moment of interpolation. They appear immediately on all FoR-eligible viewports per B1. They are saved as part of the RTSTRUCT without any further user action.

This matches the dominant convention in production radiotherapy tools (Eclipse, MIM, RayStation, Pinnacle, Velocity) and the current OHIF/Cornerstone3D default (auto-accept on completion, [PR #5555](https://github.com/OHIF/Viewers/pull/5555)). Per-contour click-to-promote-before-save is **explicitly not** the model — it is unusual among production tools and adds friction without commensurate safety value (a forgotten promotion silently drops geometry, a worse failure mode than a wrong interpolation that's visible and editable).

**Visual distinction is transient, not gating.** Until the user has manually edited any of the structure's interpolated slices or saved the structure-set, interpolated contours render with a subtle marker — a small "auto" badge near the contour or a thin secondary stroke is the natural choice. The marker fades after manual edit or save. The marker must **not** reuse the dashed-stroke style reserved for cross-series rendering (D9), since those convey different meanings.

**Editing is unrestricted.** Editing a handle on an interpolated contour mutates it like any manual contour and clears its "interpolated" mark. Deleting an interpolated contour deletes it. There is no separate state machine.

**No save gate.** Save writes whatever is currently in the structure-set; interpolation status is not a save-time consideration.

**Optional review affordance** (nice-to-have, not required): a per-structure "step through interpolated slices" action that scrolls through interpolated slices in sequence for post-hoc QA, without being a save gate. This borrows lightly from 3D Slicer's "Fill Between Slices" review pattern but does not adopt its commit gate.

### B6. Structure set membership
A contour belongs to exactly one ROI/structure within one structure-set. Membership is global; renaming, recoloring, or deleting the structure affects all viewports identically.

### B7. Ordering / Z-order
When multiple structures overlap on a viewport, a consistent Z-order is applied across all viewports.

- **Default order**: containers stack back-to-front in load order. Within an RTSTRUCT, members order by ROI Number; within a SEG, members order by Segment Number.
- **Container layering**: SEG fills draw behind RTSTRUCT contour outlines by default (so contour outlines remain visible on top of fills). Per-session override allowed.
- **User reorder**: the user can drag-reorder members within a container in the list panel (D7.6). The new order persists in the saved DICOM object where the standard supports it (RTSTRUCT structure-set order; SEG segment order); otherwise it is session state and reverts on reload.
- **Selection brings to top**: the selected structure (D7.5) renders above its peers on all viewports while selected. The Z-bump is transient — on deselect, normal order resumes. It does not modify the persisted order.
- **Per-segment Z within a SEG**: same model as RTSTRUCT — segment number gives default order; user can drag-reorder; selection bumps to top.

### B8. Closed vs open contours
Both types render consistently across viewports per B1. Open contours render their intersection naturally (a point or short segment) without spurious closure.

---

## C. DICOM SEG (labelmap) requirements

### C1. Voxel coherence
A SEG is a 3D voxel grid in the FoR. Editing a voxel mutates the single shared grid; all viewports re-render that region on the next frame (A4). No per-viewport copy.

### C2. Resampling for non-native views
On MPR / reformatted / oblique views, the labelmap is resampled to the view's slice plane on the fly.

- **Method**: nearest-neighbor for label values. Trilinear interpolation across labels is **not acceptable** — it would invent intermediate label values that don't correspond to any segment.
- **Multi-label segs**: resample is performed independently per segment as a binary mask (1 = present, 0 = absent), then composited per the overlap policy (C6). This avoids the "label 1 + label 2 / 2 = label 1.5" failure mode.
- **Sub-voxel jitter on slice scroll**: the resampled image must not flicker as the camera moves a fraction of a voxel. The resample target plane snaps to the source labelmap's voxel grid for edit operations; for display, fractional positions are smoothly handled.
- **Edge antialiasing**: edges of resampled segments may use fractional-coverage outlines (anti-aliased boundary) for display only. The underlying labelmap remains binary per segment; antialiasing is purely a render-time artifact and is never written back.

### C3. Voxel editing tools
Voxel-editing tools operate in the **edit target** viewport's frame (per A7) but mutate the shared 3D labelmap (per C1). Edits are visible on all eligible viewports during the gesture (A4). Required tool semantics:

- **2D circular brush**: paints a disk of voxels in the edit target's current slice plane. Brush radius is specified in **physical units (mm)** so it is consistent across zoom level and across viewports of different in-plane resolution; a pixel approximation is shown on canvas.
- **3D spherical brush**: paints a sphere of voxels in world space, centered at the cursor's world position. Footprint shows on all eligible viewports as the appropriate cross-section circle; on slices outside the sphere, no footprint is shown.
- **Eraser** (2D and 3D variants matching the brushes): clears voxels of the active segment within the footprint. A modifier (e.g., shift) clears voxels of all segments, not just the active one.
- **Threshold paint**: within the brush footprint, only voxels whose source-image intensity falls within a user-specified range are written. Default range is unrestricted (paint everything). Surfaced in the toolbox as **distinct buttons** (Threshold, Dynamic Threshold, and their spherical 3D variants) — all backed by the same `BrushTool` with different brush strategies, not separate tool classes.
- **Paint Fill (3D flood fill)**: from a seed click, fills connected voxels into the active segment, bounded by an optional intensity range and by existing segment boundaries. Connectivity is 6-connected by default. Implemented by `SafePaintFillTool` ([SafePaintFillTool.ts](../src/renderer/lib/cornerstone/tools/SafePaintFillTool.ts), bound to hotkey `f` per [defaultHotkeyMap.ts:27](../src/renderer/lib/hotkeys/defaultHotkeyMap.ts:27)). This tool serves the **hole-filling** workflow — clicking inside an enclosed unfilled region fills it with the active segment, equivalent to RayStation's hole fill / fill-region operation. The operation previews while computing and commits on release; cancellation discards.
- **Planar scissors**: user draws a closed polygon on the edit target's slice plane. Voxels of the active segment inside the polygon, on that slice only, are cleared. A modifier inverts the operation (keep-inside / clear-outside).
- **Through-volume scissors**: same polygon, but applies through every slice perpendicular to the slice plane (extruded along the view normal). This is a distinct tool from planar scissors.
- **Region-segment / smart brush**: an intensity-aware region-grow brush. The user clicks (or drags) on a seed location; the tool grows a region within an intensity tolerance into the active segment, bounded by the brush footprint. Two variants are required, matching the existing `RegionSegmentTool` and `RegionSegmentPlusTool`: a basic mode that grows from the seed within a fixed tolerance, and a "plus" mode with adaptive tolerance based on local image gradients. This is the closest in-house equivalent to RayStation's "Smart Brush." Same active-segment / lock / overlap policy rules apply.
- **Sculptor**: a contour-pushing tool that locally deforms an existing contour outline (RTSTRUCT) toward or away from the cursor. Operates on the active member only; does not create new geometry, only modifies existing. Matches the existing `SculptorTool`. Useful for fine-tuning a contour boundary without redrawing.
- **Contour Fill (`LabelmapEditWithContour`)**: the user draws a freehand or polygon contour and the tool rasterizes the enclosed region into the active segment as voxels (a "draw the boundary, fill the interior" workflow distinct from voxel-by-voxel brushing). Implemented by Cornerstone's `LabelMapEditWithContourTool` ([toolService.ts:115](../src/renderer/lib/cornerstone/toolService.ts:115)). Currently surfaced in the segmentation tool dropdown but **broken in the current implementation** — must be fixed for v1. Same active-segment / lock / overlap policy rules apply once functional.
- **Copy / paste contour to slice**: keyboard-driven contour duplication. The user selects a contour, navigates to a target slice (any slice in the FoR), and pastes — the contour replicates at the target slice's plane in world coordinates. Implemented via Ctrl-C / Ctrl-V → `segmentationService.copySelectedContourAnnotation()` / `pasteCopiedContourAnnotationToActiveSlice()` ([hotkeyService.ts:221-224](../src/renderer/lib/hotkeys/hotkeyService.ts:221), [defaultHotkeyMap.ts:70-71](../src/renderer/lib/hotkeys/defaultHotkeyMap.ts:70)). Behavior follows D6 (paste preserves world geometry, lands in the active container's active member). The "navigate then paste" pattern is preferred over RayStation's "copy to adjacent" because it lets the user paste to any slice without an extra modifier; both adjacent-slice and far-slice cases are one keystroke pair. **Copy/paste is a keyboard-driven viewport action, NOT a toolbox tool** — it does not appear in the tool grid.

#### Toolbox scope and presentation
- **In scope = every registered Cornerstone3D tool for the active kind**, grouped by the three peer types:
  - **Segmentation (SEG):** Brush, Eraser, Threshold, Dynamic Threshold, and Spherical (3D) Brush/Eraser/Threshold (all `BrushTool` strategies); Circle / Rectangle / Sphere scissors; Paint Fill (`SafePaintFillTool`); Region & Region+ (`RegionSegmentTool` / `RegionSegmentPlusTool`); Rect-Multi & Circle-Multi threshold (`RectangleROIThresholdTool` / `CircleROIStartEndThresholdTool`); Contour Fill (`LabelMapEditWithContourTool`); Select (`SegmentSelectTool`); Segment Bidirectional (`SegmentBidirectionalTool`).
  - **Structure (RTSTRUCT):** Freehand, Spline, Livewire contour tools; Sculptor.
  - **Measurement (SR):** Length, Angle, Bidirectional, Elliptical/Rectangle/Circle ROI, Probe, Arrow, Freehand ROI.
- **Deferred (not in v1):** AI / auto-segmentation tools (model-based, smart-fill-by-AI, etc.) — implemented later; the grid leaves room for them.
- **Planned (shown greyed):** a small set of registered-but-not-yet-wired tools (currently Dynamic Threshold, Spherical Brush / Eraser / Threshold, Rectangle-Multi threshold) render **greyed/disabled with a "planned" tooltip**. This is a **temporary** state — they are slated for implementation immediately after this project. Greyed-flat (planned) is visually distinct from the D3 dashed-and-slashed "no FoR-matched viewport" disable.
- **Not toolbox tools:** view tools (Pan, Zoom, Stack Scroll, Window/Level, Crosshairs) live in the **toolbar**; **copy/paste** is a keyboard viewport action; **interpolation** is a **setting/behavior** (auto-accept of interpolated contours, B5 / Rebuild Phase 4), surfaced as a toggle in controls — never a tool button.
- **Presentation:** a **3-column grid of icon + label** buttons at full panel width; as the panel narrows the labels truncate, then hide entirely, leaving an **icon-only** grid. Active tool highlighted; tools with no FoR-matched viewport are disabled (D3). A **Controls** strip below the grid holds kind-specific settings (e.g. active segment + labelmap opacity for SEG), and the silent in-place backup status (§3.4) sits at the foot.

All tools respect:

- **Active segment** (D7.5) — writes target the active segment unless a tool explicitly addresses all segments.
- **Active segment lock** (C5) — writes to a locked segment are blocked at gesture-start with a hint; the gesture does not start.
- **Overlap policy** (C6) — writes that would overlap another segment are resolved per the policy.
- **Edit target rules** (A7) — the gesture is bound to the originating viewport.
- **Non-native viewport rule** (D10) — if the edit target's series is not native to the active container's segmentation, drawing is blocked at gesture-start.

### C4. Multi-segment labelmaps
Multiple segments share one labelmap (one label value per segment, BitPackedSegmentation if needed). Per-segment visibility, color, opacity, and lock state are global; changes propagate to all panels.

### C5. Active-segment lock
Locking a segment prevents edits to its voxels in **any** viewport, not just the one where the lock was toggled. The lock-guard pointer-block must be applied per viewport but driven by global lock state.

### C6. Overlap policy
Whether segments may overlap (multi-label vs winner-takes-all) is a property of the segmentation, not the viewport. Display and editing both honor this policy uniformly.

### C7. Resolution and geometry mismatch
If a SEG's grid does not match the displayed volume's geometry exactly (different spacing, origin, or extent within the same FoR), the system resamples for display per C2 and tracks edits in the **SEG's native grid** (not the viewport's). Edits round-trip without progressive degradation across many save/load cycles.

**Oblique SEG over straight-axial display** (or vice versa): a SEG whose grid orientation is rotated relative to the displayed volume's grid, both within the same FoR, is supported. Resampling for display follows C2 (per-segment binary nearest-neighbor). Edits made in the displayed plane back-project into the SEG's native oblique grid using the same per-segment binary method. The SEG's native orientation is preserved through save/load — the SEG is never silently re-axialized to match a viewport's orientation.

### C8. 3D continuity guarantees
A single brush stroke that crosses slice boundaries (because the brush has 3D extent or because the user scrolls mid-stroke) produces a connected 3D modification, visible coherently on all panels.

---

## D. Interaction & UX requirements

### D1. Active viewport indication
The currently focused viewport is visually distinguished (border, badge). The user always knows which panel is the edit target.

### D2. Hover and selection feedback
Hover and selection are distinct visual states with consistent rules across the canvas and the list panel.

- **Hover on canvas**: pointing at a structure on a viewport emphasizes it on **all eligible viewports** (per A11) with a stroke-width increase or subtle glow. The corresponding row in the list panel is also emphasized (D7.8).
- **Hover in list panel**: hovering a member row applies the same emphasis on all eligible viewports.
- **Selection** (distinct from hover): selecting a structure (per D7.5) applies a more prominent treatment — typically the hover emphasis plus a visible selection ring or highlight color — that persists until selection changes. Selection also Z-bumps the structure (per B7).
- **Hover does not change the active member** (D7.5) and does not change selection. It is purely visual.
- **Conflict resolution**: when hover and selection apply to the same structure, the selection treatment wins (no double treatment). When they apply to different structures, both are emphasized; the selection treatment is more prominent.
- **Performance**: hover redraws must respect the D8 budget; throttle as needed. Hover emphasis must not flicker on small mouse movements within a single structure.

### D3. Tool affordance per viewport
A tool that is not meaningful on a given viewport (e.g., spline contour tool on a viewport with no FoR-matched volume) must be visibly disabled or no-op on that viewport, not silently dropped or misapplied.

### D4. Drag continuity across panels
A handle drag started in one panel completes in that panel. The user cannot accidentally hand off a drag mid-gesture by moving the cursor over another panel.

### D5. Keyboard shortcut scoping
Shortcuts that affect global state (active segment, active tool, undo/redo, save) are not panel-scoped — pressing them in any focused panel triggers the same global action. Shortcuts that affect view (slice, zoom, W/L, rotate) are scoped to the active panel.

The "global" framing applies to the **keystroke**, not the **target**: undo/redo always operates on the active container (per A8); save targets the active container or all containers per A9. The user does not have to focus the list panel or a specific viewport to use these shortcuts.

### D6. Copy/paste across viewports
Copy a contour or seg region in one panel, paste into any FoR-compatible target — including a panel showing a different orientation or a different (registered) volume. The paste preserves world geometry, not pixel coordinates.

**Clipboard scope:**

- **Contour clipboard**: a single contour (one polygon on one slice) or a range of contours (the same ROI's polygons across consecutive slices). The clipboard carries geometry in world coordinates plus the source ROI's color and name (the latter for reference; not auto-applied on paste).
- **Voxel-region clipboard**: a 3D bounding-box copy of one segment's voxels, as a small labelmap with its own world-space transform. Segment identity is preserved on the clipboard for reference.

**Paste rules:**

- **Target FoR**: the paste target's FoR must match the clipboard's source FoR (or be reachable via a registered transform). Cross-FoR paste without registration is blocked with a clear error.
- **World geometry preserved**: a contour copied at world point P pastes at world point P regardless of the target viewport's resolution, slice positions, or orientation.
- **Paste target**: the **active container and active member** (D7.5). Paste never silently creates a new member. To paste into a different ROI/segment, the user activates that member first.
- **Resolution / spacing differences**: voxel paste resamples into the target SEG's grid using nearest-neighbor (per C2), preserving segment identity per the per-segment binary rule.
- **Conflict with existing voxels**: paste behavior follows the segmentation's overlap policy (C6). For multi-label segs, paste is additive (paste voxels become the active segment; existing other-segment voxels follow C6). For winner-takes-all segs, paste replaces. A modifier (e.g., alt) inverts to "subtract" — paste region clears existing voxels of the active segment.
- **Cross-container paste**: allowed for compatible types (RTSTRUCT→RTSTRUCT, SEG→SEG). Cross-type paste is not supported in v1.
- **Multi-slice contour paste with translation**: when the user navigates to a different slice before pasting a multi-slice contour range, the contours translate together; relative slice spacing is preserved.
- **Paste outside target geometry**: voxels or contour points falling outside the target's grid extent are clipped silently (no error). The user is shown a brief toast indicating partial paste if any clipping occurred.

**Keyboard bindings**: Ctrl-C copies the selected contour annotation; Ctrl-V pastes onto the active slice of the active viewport. Bindings live in [defaultHotkeyMap.ts](../src/renderer/lib/hotkeys/defaultHotkeyMap.ts:70) under `edit.copy` / `edit.paste`. Same-slice paste is a no-op (the source is already there); cross-slice paste lands at the target slice's plane.

### D7. Annotation list panel
The annotation list panel is the single global view of all structures and segmentations in the session. It is authoritative for non-spatial state (names, colors, visibility, lock state, ordering) and is the primary navigation and selection surface complementing direct manipulation on the viewports.

#### D7.1 Hierarchy
The panel displays a two-level hierarchy:

1. **Container** — one entry per loaded annotation object. Container types:
   - **RTSTRUCT structure-set** — members are ROIs (contour-based).
   - **DICOM SEG segmentation** — members are segments (voxel-based).
   - **DICOM-SR measurement report** — members are individual measurements (Length, Angle, Bidirectional, Elliptical/Rectangle/Circle ROI, Probe, Arrow). Serialized as a DICOM Structured Report (TID 1500 Measurement Report). This is the third peer container type (Segmentation · Structure · Measurement), with its own create action in D7.6. **Detailed measurement-specific in-memory requirements are a skeleton to be filled before measurement implementation begins** (which SR template, per-measurement round-trip fidelity, cross-plane display per design §5.5, editing semantics) — but the data model and panel must accommodate measurement containers as a first-class type now. Point / fiducial markers (the former "POI" concept — isocenters, localization points) are deferred; a point is a future measurement subtype and does not require a schema change to add.
   Containers carry: container name, source series identity, dirty indicator, approval indicator (D7.11), provenance summary, count of children, expand/collapse control, and container-level actions (rename, delete, export, hide all, lock all, approve / revoke approval).
2. **Member** — one entry per ROI / segment / measurement. Members carry the row-level metadata listed in D7.2.

A single session can hold multiple containers — typically one per loaded RTSTRUCT or SEG, plus any new ones created in-session. Containers from different source series coexist.

There is exactly one **active container** at any time, defined implicitly as the active member's container (D7.5). Drawing tools always write to the active container (B3). The user does not need to think about "active container" as a separate concept — picking an active member implicitly picks its container. A user with no active member has no active container and cannot draw until they activate (or create) a member.

**ROI Algebra forward-compatibility**: future versions are expected to add **derived members** — ROIs whose geometry is computed from a stored expression over other ROIs (union, intersection, subtraction, anisotropic margins; "PTV = CTV + 5 mm"). Derived members re-evaluate when their sources change and carry an "out-of-date" flag when stale. v1 does not implement this, but the container and member data model must reserve fields for: a derivation expression (string or AST, nullable), a list of source-member references, an out-of-date flag, and a "manual override" flag (true if the derived geometry has been manually edited and is no longer pure-derived). Saved DICOM does not need to carry the expression in v1, but the in-memory model must round-trip the fields without loss. Provenance (D7.2) gains an `algebra` source value when this lands.

#### D7.2 Per-row data shown
Every member row shows, at a glance:

- **Color swatch** matching the structure's render color.
- **Name** (RTROIObservation Label for RTSTRUCT; SegmentLabel for SEG).
- **ROI type** (`RTROIInterpretedType`): **not tracked, not shown, not editable** (removed per review — the workflow doesn't need it). It is not a field on the member model, there is no badge, and there is no type editor. It is **not special-cased** for preservation either: like the many other tags that ride along in a source DICOM file, it is simply left untouched by general round-trip fidelity — not singled out for handling.
- **Visibility toggle** (eye icon). Tri-state at the container level (all / some / none).
- **Visibility mode** (per D7.3): filled, outlined, or hidden. The eye icon cycles between three states (off / outline / filled) or exposes a small mode selector.
- **Lock toggle** (padlock icon). Locked structures cannot be edited in any viewport (per C5).
- **Approval indicator** at the row level if the container is approved (per D7.11) — implies edit-locked and visually distinct from a session-only lock.
- **Active indicator** if this member is the current "pen" — the structure or segment that drawing tools will write to. Exactly one member is active at a time across all containers (per A6).
- **Selection indicator** if this member is currently selected (clicked-to-focus, distinct from "active" — see D7.5).
- **Cross-series indicator** if the member's native series differs from the active viewport's series (per D9), with the source-series description.
- **Provenance indicator**: source of the geometry — `manual`, `interpolated`, `imported`, or (future) `auto-segmented`, `algebra`, `deformably-mapped`. Distinct visual per source. Manual is the default; the absence of a provenance badge implies manual. This metadata is preserved through save/load where DICOM permits (private tags or vendor extensions for non-standard sources); for standard `manual` and `interpolated` no special storage is required.
- **Geometry summary**: number of contoured slices for RTSTRUCT structures; voxel count or volume in cm³ for SEG segments; "(empty)" if neither.

Hovering a row reveals a tooltip with extended metadata: SOPInstanceUID of the source RTSTRUCT/SEG, structure-set name, ROI number / segment index, approval state, provenance, volume calculation, last-modified time.

#### D7.3 Visibility and lock semantics
- **Per-member visibility**: three states — **hidden** (not rendered), **outlined** (boundary only — for SEG, this is the segment's outline; for RTSTRUCT, the contour stroke), and **filled** (boundary plus filled interior — for SEG, the labelmap fill; for RTSTRUCT, a translucent fill bounded by the polygon). The eye icon (D7.2) cycles or exposes a mode selector. Default for FoR-eligible viewports is **filled** for SEG, **outlined** for RTSTRUCT (contours don't fill by default — closed contours can opt in).
- **Visibility mode is global per member, not per-viewport.** Per-viewport visibility overrides (A5) are binary (visible or not) and modulate the global default — they don't change the mode.
- **Per-container visibility**: toggles all members of the container together. Tri-state visual on the container row (all / some / none); the global mode is preserved per member when the container is hidden and restored when re-shown.
- **Per-member lock**: blocks edits in all viewports (per C5 for SEG, equivalent rule for RTSTRUCT contours). Session-only.
- **Per-container lock**: blocks edits to all members. Session-only — distinct from approval (D7.11), which is persistent.
- Visibility-mode and visibility-toggle state are session state; they are not persisted to the saved DICOM object.

#### D7.4 Indicators carried on rows and containers
- **Dirty marker** at the container level when any member has unsaved edits (per A9, E1). Clicking the marker triggers a save of that container only.
- **Cross-series icon** at the row level when the member is non-native to the active viewport (per D9).
- **Different-FoR indicator** at the row level when the member's FoR does not match the active viewport's FoR and no registration bridges them (per A2d). Distinct visual from the cross-series icon. A row in this state is *not* hidden — it remains listed, with a clear "not viewable here" treatment, so the user is not confused by its absence on canvas.
- **Locked indicator** at row and container level.
- **Auto-interpolated marker** at the row level (per B5) until manual edit or save clears it.
- **Empty marker** for members with no geometry (e.g., a freshly created ROI before the first stroke).
- **Conflict marker** when an external change (E3) is detected for the container.

#### D7.5 Selection vs active
The panel distinguishes two states a member can be in:

- **Active**: the structure/segment that drawing tools will write to. Setting active is an explicit click on a "make active" affordance (e.g., color swatch, or a dedicated radio control). Exactly one member is active globally at all times (per A6).
- **Selected**: the member is highlighted for inspection — its row is visually emphasized in the list, and its rendering on all eligible viewports gets the selection treatment (per A11). Multiple members can be selected simultaneously (multi-select via shift/ctrl click) for bulk operations. The selection set is independent of which member is active.

Single-clicking a row selects it (replacing any prior selection). Double-clicking activates it (and selects it). Clicking the active indicator on a different row activates it without changing the selection set.

#### D7.6 Actions available from the list

**Renaming (containers and members).** Names are edited **inline by double-clicking** the name: the label becomes a text field with the current name pre-selected. **Enter** commits, **Esc** cancels; blur commits. A "Rename" item in the kebab is the discoverable alternative for the same inline edit. (Renaming is blocked on approved/locked containers, per D7.11.)

**Create starts in edit mode.** Creating a container (via the header create buttons) or a member (via the container-row "+", below) gives it a **default name** and drops it **immediately into inline-edit mode with the default text pre-selected**, so the user can type a name right away without a separate rename step. Pressing Enter or clicking away keeps the default if untouched. Proposed default names (open to change): containers → `Structure set N` / `Segmentation N` / `Measurement set N`; members → `ROI N` (RTSTRUCT) / `Segment N` (SEG) / measurement named by its tool (e.g. `Length N`) for SR.

**Delete is a row action (the "✕").** Every row — container and member — carries a **delete "✕"** as its right-most control. Deleting prompts for confirmation when there is geometry/content to lose, and triggers the **local-vs-XNAT** removal logic: a never-saved item is dropped from the session; a saved item additionally requires removing/derecognizing it on XNAT (the delete contract lives in the transport workstream — deleting an assessor, or removing a member and re-saving the parent). Delete is **disabled on approved (locked) containers and their members** — revoke first.

**Approve is a row action (the "✓"), not a kebab item.** Each container row has an **approve toggle** ("✓"): on an unapproved container it approves (with the confirm dialog, D7.11); on an approved container it renders filled/green and revokes (with confirm). It is **not** in the kebab.

Per member (via row controls):
- Toggle visibility, toggle lock, set active.
- Rename (double-click, see above), change color, change opacity.
- **Delete** — the row "✕" (with confirmation if the member has geometry; local-vs-XNAT per above). Disabled when the container is approved.
- Jump-to-first-slice: viewport navigation jumps to the first slice containing this member's geometry, on whichever viewport is set as the navigation target.
- Show only this (hide siblings within the container).

Per container (row controls, left→right: **approve ✓ · add-member + · save · kebab ⋮ · delete ✕**):
- Rename (double-click, see above), set container color scheme.
- **Approve / revoke** — the row "✓" toggle (see above).
- **Add new member** — the **"+" button on the container row** (creates an empty ROI / segment, in edit mode per above). Disabled on approved/locked containers.
- **Delete** — the row "✕" (removes the whole container; confirmation + local-vs-XNAT per above). Disabled when approved.
- Hide all / show all, lock all / unlock all.
- **Save now** — surfaced as a **save icon on the container row, immediately left of the kebab**. Enabled only when the container is dirty; disabled (greyed) when clean or approved. (This is the per-container counterpart to the header **Save-all** icon; routine autosave still happens silently per §3.4.)
- **Revert** (if dirty) — discards local changes back to the last-saved version, with confirmation. **Export to DICOM file** — serializes this container to a standalone DICOM file (SEG / RTSTRUCT / SR) and writes it to local disk; this is a *local file export*, distinct from saving to XNAT. **Export to CSV** — writes this container's **per-member metrics** to a CSV file: name + (RTSTRUCT) contoured-slice count / enclosed volume; (SEG) voxel count / volume / mean·min·max HU; (SR) each measurement's value and unit. (Surfaces the segment-statistics capability tracked in PHASES "Segmentation Enhancements"; a local file export like Export-to-DICOM.) All live in the kebab.
- Reorder members (Z-order, per B7).

**Kebab (per-container "⋮") contents** (after de-duplication): Hide all/show all · Lock all/unlock all · Export to DICOM… · **Export to CSV…** · Revert changes. The frequent/primary actions are **row buttons, not kebab items**: Rename (double-click), Add member ("+"), Save (save icon), Approve ("✓"), Delete ("✕"). The kebab holds only the less-frequent bulk/export/revert actions.

Session-level (the three create actions + save-all; create actions are **present in every state** but **disabled when the active viewport has no scan loaded** — they tag to the active viewport's series, so with nothing loaded there is no FoR target. Disabled rendering follows D3; a tooltip explains why):
- Create new structure-set (RTSTRUCT container, tagged to the active viewport's series; requires an open FoR-matched viewport).
- Create new segmentation (SEG container, similarly tagged; same FoR-matched-viewport requirement).
- Create new measurement set (SR container, similarly tagged; same FoR-matched-viewport requirement) — the third create action, matching the three peer types (D7.1).
- Save all dirty containers.
- **Loading is automatic, not a panel action.** Existing annotation containers for the selected session/scan load into the panel via the transport layer when the user selects that scan in the XNAT Browser (auto-load — formalized in transport B5). There is **no** separate manual "load from XNAT" affordance in the panel.

Bulk (on multi-selected members):
- Toggle visibility / lock together.
- Delete together.
- Recolor together.
- Move to a different container (RTSTRUCT-to-RTSTRUCT, SEG-to-SEG; cross-type moves not supported in v1).

#### D7.7 Ordering
- **No free-text filter / search, no "Active only" toggle, and no sort control** — all removed per review. Annotation counts per session are small; the active-viewport state is already conveyed by row dimming + the cross-panel pill (D9).
- Members keep their **creation / Z-order** (per B7); containers are listed in **load order**. The user can drag to reorder members within a container, and containers within the list. There is no separate sort UI.

#### D7.8 Hover and click sync with viewports
- Hovering a row in the list previews the structure on all eligible viewports — emphasized stroke, plus optional auto-scroll on the active viewport to the structure's first slice if the user has enabled "scroll-to-on-hover."
- Hovering a structure on canvas (per D2) emphasizes its row in the list.
- Clicking a row selects globally (per A11); the selection treatment shows on all eligible viewports.

#### D7.9 Empty, loading, and error states
- **Empty session**: panel shows a clear "no annotations yet" affordance with the three create actions (create new structure-set / segmentation / measurement). It does **not** offer a manual "load from XNAT" action — existing annotations for a selected scan load automatically (D7.6, transport B5).
  - **No scan loaded**: when the active viewport has no scan, the three create actions are **disabled** (greyed, per D3) with a tooltip ("load a scan to start annotating") — there is no FoR-matched series to tag a new container to (D7.6). They enable as soon as a scan is loaded in the active viewport.
- **Loading**: container appears in a loading state with a spinner; members appear as they parse. The container is not interactable until parse completes.
- **Parse error**: container shows an error banner with the failure reason and a retry/remove control. Other containers are unaffected.
- **Empty container**: shows "no members" with an "add new" action.

#### D7.10 Saved-object fidelity
Every state shown in the panel that maps to a DICOM tag (name, color, structure-set name, segment label, ROI number, segment index, segment description) round-trips through save/load (per E4). State that is purely UI (selection, hover, expand/collapse, filter, scroll position, per-viewport visibility overrides, the auto-interpolated marker) does not.

#### D7.11 Approval state (container-level, persistent)
A container can be **approved** — a regulatory-grade lock equivalent to the workflow in RayStation and similar TPS contouring tools.

- **Effect**: an approved container is fully edit-locked. No member adds, deletes, geometry edits, name changes, color changes, type changes, or reorderings are allowed. The user must explicitly **revoke approval** before editing.
- **Scope**: at the container (structure-set or segmentation) level, not per member. Partial approval (some members approved, others not) is not supported in v1.
- **Control + visual indicator**: approve/revoke is a **row toggle ("✓")** on the container row (not a kebab item, and **no separate "APPROVED" text badge** — the toggle itself is the state). Outline "✓" = unapproved (approves on click); **filled green "✓"** = approved (revokes on click). Members show their own approved-lock indicator (D7.2). While approved, the container's add-member, save, and delete row controls are disabled. The green toggle is visually distinct from session-only locks.
- **Persistence**: approval state is persisted to the saved DICOM object (RTSTRUCT `ApprovalStatus (300E,0002)`, SEG via the General Series `ApprovalStatus (300E,0002)` element). Round-trips through save/load (E4).
- **Audit trail**: an approval action records who approved (current user identity, if available from the transport layer) and when (timestamp). Recorded in DICOM where the standard supports it (`ReviewerName`, `ReviewDate`, `ReviewTime`); session-only otherwise.
- **Revoke**: explicit user action with confirmation. Revoking does not delete the audit record; subsequent re-approval creates a new record.
- **Loaded already-approved containers**: editing affordances are disabled at load. The user must revoke to edit.

### D8. Performance budget
With four open viewports of a typical CT volume (~300 slices) and a structure set of ~20 ROIs plus one multi-segment SEG, edits must propagate at ≥ 30 fps. Layout changes must not stall the UI for more than ~250 ms.

### D9. Non-native rendering style (cross-series indicator)
When a structure is displayed on a viewport whose active series is **not** the structure's native series (per A2b), it must be visually distinguishable from a natively-rendered structure. The user must be able to tell at a glance that "this contour came from a different series" without having to consult the annotation list.

**Required visual treatment** (applies to RTSTRUCT contours and to SEG outlines/fills when shown on a sibling series):

- **Stroke pattern**: dashed for contour outlines (suggested cadence: long dash 6 px, gap 3 px, scaled with stroke width). Native contours remain solid.
- **Fill** (for filled labelmap renders): cross-hatched or stippled pattern overlay at the same color, with reduced fill opacity (~50% of native). Outlines on labelmaps follow the dashed-stroke rule.
- **Stroke width and color**: unchanged from native — legibility on dark medical-imaging backgrounds is paramount; do not dim or desaturate.
- **Selection**: when a non-native structure is selected (e.g., from the annotation list), its stroke becomes solid + selection ring while it remains read-only. This signals "you have it picked, but you can't edit it from here."
- **Hover affordance**: tooltip identifies the source series — e.g. "T1 SAG · series 4 · slice 12". Same content on the annotation list row.
- **Annotation list panel**: each non-native row carries a small "linked-series" icon and the source series description; the structure-set badge indicates how many of its members are native to the active viewport vs. cross-series. Toggling visibility from the list affects all eligible viewports as usual (D7).
- **3D / volume rendering panels**: non-native structures render with the same dashed/hatched style transferred to the 3D representation (e.g., wireframe instead of solid surface).

The styling must not leak into the saved object — dashes, hatching, and source-series tooltips are *display* state, never persisted to RTSTRUCT or SEG.

### D10. Edit affordances on non-native viewports
A non-native structure on a viewport is read-only on that viewport (no handles, brush blocked, scissor blocked). Attempting to edit a non-native structure produces a brief, non-modal hint: "This structure is on \<series name\>. Switch to that series to edit."

**Drawing a new structure on a non-native viewport is also blocked**, per B3 — the same blocking rule applies regardless of whether the user clicks on an existing structure or starts a fresh stroke. The hint directs the user to either focus a viewport native to the active container, activate a different (compatible) container, or explicitly create a new container tagged to the current viewport's series. The system never silently auto-creates a container, never auto-switches the active container, and never appends to the visiting structure-set.

### D11. Cross-series enable/disable control
The user can toggle "show structures from related series" globally and per structure-set. Default per A2b is **on** for same-FoR, same-exam siblings; default per A2c is **off** for breath-hold / phase-binned siblings. The toggle state is per session; it does not persist into saved DICOM objects.

---

## E. Persistence requirements

### E1. Save once, not per-panel
Auto-save and manual save target the structure-set / segmentation as a whole. Open panels are not part of the saved state.

### E2. Edit-during-save safety: queue-next-save
A save in progress must not block edits, and edits during save must not be lost. The selected model is **queue-next-save**:

- When a save is in flight for container C, additional edits to C set the dirty flag and **do not** start a second concurrent save.
- When the in-flight save completes:
  - **Success** (H5) → dirty flag is checked; if dirty (because edits arrived during the save), a new save is scheduled immediately. The user sees one continuous "saving" state.
  - **Conflict** (H7) → the conflict-resolution flow runs. Local edits are preserved.
  - **Transient failure** → dirty flag remains set; auto-save resumes its debounce timer; the container row surfaces a transient-failure indicator.
- Save-then-amend (let two concurrent saves go and reconcile after) is rejected because it can produce partial applied state on the server when the second save lands first.

### E3. Conflict detection
"External change" for a container means: a change to the container's server-side state (per H6) **or** any other source modifying the container outside the current session. Silent overwrite is not acceptable in either direction.

- If an external change arrives while the container is **clean**, the multi-viewport layer surfaces a **"newer version · reload"** indicator on the row and reloads **on the user's action** (not silently — decided per H6, to avoid the displayed annotations changing unexpectedly). No edits are at risk, so no conflict prompt is shown.
- If an external change arrives while the container is **dirty**, the multi-viewport layer surfaces the conflict marker (D7.4) and triggers the H7 conflict-resolution prompt before any reload.
- A save attempt that returns Conflict (H5) triggers the same H7 prompt with the same options.

### E4. Round-trip fidelity
Geometry, segment labels, colors, naming, and metadata round-trip through save/load with no loss, including across multi-viewport edit sessions.

**Note on RTSTRUCT non-axial contours**: contours drawn on reformatted (sagittal/coronal/oblique) planes per B3 are stored as DICOM `CLOSED_PLANAR` or `OPEN_PLANAR` polygons in their native plane. The DICOM standard supports this. However, downstream treatment planning systems vary in how well they ingest non-axial RTSTRUCT contours; some TPS implementations expect axial-only authoring. Round-trip fidelity in *this* app is required (we read back what we wrote); compatibility with a downstream TPS is a transport-layer concern (G of the XNAT integration doc), not a multi-viewport requirement.

---

## F. Out of scope (explicitly)

The following are *not* requirements for this work — listed to bound the design:

- **Transport / persistence to XNAT and other backends.** Load, save, upload, version, conflict detection, multi-user, auth, asset model, scan ID conventions, browse-and-load UX. Covered in [`annotation-xnat-integration-requirements.md`](annotation-xnat-integration-requirements.md). The interface between this doc and that one is the transport contract (H).
- Cross-FoR display via deformable registration (rigid registration may be considered later).
- Real-time collaborative multi-user editing of the same structure.
- 3D volume-rendered editing as a primary interaction (read-only 3D view is sufficient).
- Streaming partial loads of very large segs (full in-memory grid assumed).
- **ROI Algebra execution** — Boolean operations (union, intersection, subtraction), anisotropic margins, and live derived ROIs. Planned for a future version. The v1 data model **must reserve fields** for derivation expression, source-member references, out-of-date flag, and manual-override flag (per D7.1 forward-compatibility note), so that v2 work does not require breaking schema changes. UI affordances for algebra operations are not required in v1.
- **Point / fiducial (former "POI") detailed UX** — first-class point annotations (isocenter, fiducials, localization). A point is treated as a future subtype of the Measurement (SR) container; the container type is recognized in the v1 data model and panel hierarchy (D7.1) so future work does not require schema changes; dedicated point-editing UX is deferred.
- **Slab / MIP / MinIP / Average projection rendering** — per-viewport projection mode with adjustable slab thickness. Standard in commercial tools but viewing-only and orthogonal to annotation behavior.
- **Atlas / model-based / Deep-Learning auto-segmentation execution.** Generated contours' provenance is tracked (D7.2) so future-version output integrates cleanly, but the segmentation execution itself is not in scope.
- **Structure templates** (named ROI lists with type/color/algebra preloaded for clinic standardization).
- **Plan, dose, DVH, beams** — this is a viewer/contouring app, not a TPS.

---

## G. Acceptance signals

A successful implementation passes these expert-user smoke tests:

1. Open axial + sagittal + coronal of one CT. Draw a freehand contour on three axial slices. Sagittal and coronal show three correctly placed line segments updating live as you draw.
2. Open the same volumetric series in two volume panels scrolled to different slice indices (volume is the default per design §1.1; stack mode is not user-selectable for volumetric data). Edit a contour on panel A's current slice; panel B, parked on a different slice, shows no change there. Scroll panel B to the edited slice; the edit is present. Because both panels share one `ImageVolume` (design §1.5), this also confirms shared-volume editing.
3. Open one volume in axial-MPR and stack. Brush-paint a SEG segment on stack. MPR shows the painted voxels resampled, live.
4. Lock a segment on panel A. Try to brush on panel B → blocked.
5. Hide structure "GTV" on panel A only. Other panels still show it. Close panel A and reopen — GTV is visible again, the per-viewport hide reset to the global default per A5.
6. Open four panels, edit, switch layouts (2×2 → 1×1 → MPR → 2×2) rapidly. No structures lost, no duplicates, no stale highlights, single dirty flag, save once produces correct file.
7. Undo after a brush stroke made on a panel that has since been closed — the stroke is undone correctly.
8. Two panels on the same scan. Click contour in panel A → highlighted in both. Click in list panel → highlighted in both. Click empty space in panel B → cleared in both.
9. Open T1 + T2 of the same MR exam in two panels (same FoR, slightly different slice positions). Draw a contour on T1. T2 panel renders the contour with **dashed stroke** at the same world coordinate, snapped to the nearest T2 slice within ±half slice spacing. Hovering it on T2 shows a tooltip naming the T1 series. Attempting to drag a handle on T2 produces the read-only hint and does not modify the contour. Switching T2's active series to T1 (or focusing the T1 panel) changes the stroke to solid and re-enables handles on the source slice.
10. Open two breath-hold CTs of the same patient (shared FoR, anatomy displaced). Draw a contour on breath-hold #1. Breath-hold #2 panel does **not** display it by default. Toggle "show structures from related series" → contour appears on #2 with dashed stroke at its original world position (visibly displaced from anatomy, as expected). Toggle off → hidden again.
11. Open a CT and an unregistered MR (different FoR, no SRO). The structure-set from the CT does not display on the MR viewport. The annotation list panel still lists the structures with a "different frame of reference" indicator, not silently empty.
12. Active container is structure-set S1 (native to series A). Focus a viewport showing series B (same FoR, different series). Try to draw a contour. Drawing is blocked at gesture-start with a hint pointing the user to focus a series-A viewport, switch active container, or create a new structure-set tagged to series B. No partial geometry is created; no auto-container is created.
13. Draw on every fifth axial slice and trigger inter-slice interpolation. Interpolated contours appear immediately on all eligible viewports with the auto-marker (per B5). Save the structure-set without any further user action; the saved RTSTRUCT contains all interpolated contours alongside the manually drawn ones. Reload the saved file; geometry is identical.
14. With autosave enabled, draw rapidly on multiple slices while a save is in flight (queue-next-save, E2). No edits are lost; the user sees one continuous "saving" state; on completion, a follow-up save fires for the queued edits and the final saved file matches the in-memory state.
15. Make several edits, save, then continue editing. Press undo enough times to cross the save point. The state reverts past the save point; the dirty flag becomes set; a new save flushes the post-undo state.
16. Use the 3D paint-fill tool to fill a connected region on an axial viewport. The same filled voxels appear correctly resampled on a sagittal MPR of the same volume. Undo once: the entire fill operation reverts as one entry.
17. The active member is currently empty. The "active" indicator in the list panel shows on its row, the panel shows the "empty" marker. Drawing on the active viewport appends to this empty member, not to a new one; the empty marker clears.
18. **Retired (per review).** ROI type (`RTROIInterpretedType`) is not tracked, shown, or edited, and is not special-cased among DICOM tags — so there is no dedicated acceptance signal for it. (General source-DICOM round-trip fidelity, which leaves untouched tags alone, is a transport concern, not a panel feature.) Signal number kept to preserve the numbering of 19–24.
19. Approve a structure-set in the panel. All members become edit-locked: handles are not exposed, brush is blocked, delete actions disabled; an approval badge shows on the container and members. Save and reload — the approval state persists (DICOM `ApprovalStatus`). Revoke approval with explicit confirmation — editing affordances return.
20. Toggle a member's visibility from filled to outlined to hidden via the panel. On viewports the rendering switches accordingly: filled showed an opacity-blended fill plus boundary stroke; outlined shows boundary only; hidden shows nothing. Other members are unaffected. Reload the saved file — visibility mode is not persisted (returns to default per D7.3).
21. Use the region-segment (smart brush) tool on a CT slice. Click a seed point inside a homogeneous region; the tool fills connected voxels within the intensity tolerance into the active segment. Lock a segment then attempt the same — the tool is blocked at gesture-start with a hint.
22. Run inter-slice interpolation on an ROI on every fifth slice. Each interpolated contour shows the `interpolated` provenance badge and the auto-marker. Manually edit one interpolated contour — its badge changes from `interpolated` to `manual`, the auto-marker clears for that contour. Save and reload; provenance survives where DICOM permits.
23. **Copy/paste, world-geometry-preserving (D6).** Draw a contour on an axial slice and copy it (Ctrl-C). Scroll a coronal panel of the same volume to a target slice and paste (Ctrl-V): the contour lands at the copied world geometry on the target slice's plane, in the active container's **active member** — not a new member. Copy a 3D voxel region of one SEG segment and paste it into the same segment at a translated slice; voxels resample nearest-neighbor into the SEG grid with segment identity preserved. Attempt a paste into a viewport whose FoR differs from the clipboard's source — it is blocked with a clear error. (Regression guard for prior copy/paste-of-interpolated-contour defects.)
24. **Oblique SEG round-trip + 3D continuity (C7, C8).** Load a SEG whose grid is oblique relative to a straight-axial display volume (same FoR). It resamples correctly per-segment (nearest-neighbor, no invented intermediate labels). Paint a 3D spherical-brush stroke that crosses slice boundaries; the modification is connected in 3D and renders coherently on axial + sagittal + coronal. Save and reload; the SEG's native oblique orientation is preserved (never silently re-axialized) and geometry round-trips without progressive degradation.
25. **Lifecycle: auto-load + navigate within a session (A13, B5).** Select a session in the XNAT Browser that has a saved RTSTRUCT and two SEGs. With no further action they **auto-load** into the panel (no manual "load"). The active viewport shows series A: members native to A render normally; members native to a same-FoR sibling series render **dimmed** with the cross-series marker; a different-FoR member shows **"not viewable here"** — all three remain **listed**. Navigate the active viewport to the sibling series: the panel's container/member **set is unchanged**; only the rendering markers flip (the sibling's members are now native, A's now cross-series). No phantom highlights, no duplicates, dirty/active/selection state unchanged.
26. **Lifecycle: session switch + unsaved retention (A13, E3).** In session 1, edit a structure-set so it is **dirty**. Without saving, select a scan from session 2 in the browser: the panel **re-scopes** to session 2's annotations; session 1's **clean** containers unload, but its **dirty** structure-set is **retained** and the "*N sessions with annotations that have not been saved*" banner reflects it. Return to session 1: its dirty structure-set **reappears intact** (geometry + dirty state preserved), ready to save. (Restart mid-edit → recovery per E3.)
27. **Conflict + save-failure workflow (E3, H5–H7).** Verifies the stateful flow behind the mockup's conflict/retry states (§3 row states, §5 dialog) across every branch: **(a) dirty + external change** — while a container is dirty, the same container changes on the server; the row shows the **conflict marker** and a prompt offers **Keep local · Discard local · Inspect**. *Keep local* uploads the local state as the new server version; *Discard local* reloads the server version and drops local edits (after confirm). **(b) save → Conflict** — a manual/auto save returns Conflict; the same prompt appears (no silent overwrite). **(c) save → transient failure** — dirty flag stays set, the row shows a **retry** affordance, retry succeeds. **(d) save → permanent failure** (e.g., no write permission) — the row shows the failure reason + remove control; the container stays in memory and editable. **(e) clean + external change** — a non-intrusive **"newer version · reload"** indicator appears (no silent swap, no prompt); reload happens only on user action.

28. **Undo/redo state machine (A8).** Edit container A and container B. Undo on the active container reverts only **A's** last op; B is untouched (per-container history isolation). After an undo, make a fresh edit → A's **redo stack is invalidated** (redo unavailable). Drive undo past the configured history depth → oldest entries evict cleanly (no corruption). Reload A from source → A's undo history **clears** (no undo across a reload). (Complements 7/15/16.)
29. **Voxel-tool roster (C3).** Each segmentation tool writes/erases correctly and respects active-segment + lock + overlap: 2D circular brush and **3D spherical brush** paint the active segment; **eraser** (2D/3D) clears it and the **all-segment modifier** clears all; **threshold** and **dynamic-threshold** brushes write only in-range voxels; **planar scissors** clear inside the drawn polygon on the slice and **through-volume scissors** extrude through the volume; **sculptor** deforms an existing contour boundary without creating new geometry. Locking the active segment blocks each at gesture-start with a hint. (Complements 16 paint-fill, 21 region-segment.)
30. **Contour Fill — must-fix (C3).** With `LabelMapEditWithContourTool`, draw a freehand/polygon boundary on a slice; the enclosed region **rasterizes into the active segment** (boundary-then-fill, not voxel-by-voxel). Respects active-segment lock + overlap policy; undo reverts the fill as **one** entry. (This tool is currently broken; the signal is its Phase-5 fix gate.)
31. **List-panel actions (D7.6).** From the panel: **double-click** a container/member name → inline edit (Enter commits, Esc cancels); **create** lands in edit mode with the default name pre-selected; the per-container **save-now** icon is enabled only when dirty and clears dirty on success; **revert** (dirty) discards to last-saved after confirm; **hide-all/show-all** drives the container's tri-state visibility (all/some/none); **jump-to-first-slice** navigates the target viewport to the member's first geometry; **show-only-this** hides siblings; **move-to-container** relocates a member (SEG→SEG / RTSTRUCT→RTSTRUCT only); **Export to DICOM** writes a standalone file and **Export to CSV** writes per-member metrics. An **approved** container disables add/delete/rename/move/save.
32. **Measurement (SR) container — first-class peer (D7.1).** Create a Measurement container; draw measurements (length/angle/bidirectional/ROI/probe/arrow). Each appears as a **member row** with value + unit, color swatch, and the standard visibility/lock/select/active/delete controls; the active measurement is the draw target. Save as DICOM-SR (TID 1500) and reload — measurements round-trip (value + geometry). *(Scope: panel/container behavior + basic SR round-trip; detailed SR-template / per-measurement fidelity is the D7.1 skeleton, filled before measurement implementation.)*
33. **Selection model (A11, D7.5).** Single-click a member (list or canvas) selects it globally — highlighted on **all** eligible viewports; clicking another **replaces** the selection; shift/ctrl-click builds a selection **set** (all highlighted). **Double-click activates** a member (the draw target) **without** disturbing the selection; selection and active are independent. Clicking empty canvas clears selection on all panels. (Complements 8, 17.)
34. **Drag & gesture continuity (D4, A7).** Start a handle drag (or brush/scissor gesture) in panel A and move the cursor across panel B before release — the gesture **completes in A**; B never hijacks it. A hotkey that would switch the active viewport mid-gesture is **deferred** until gesture end. No partial geometry, no stale edit target.
35. **Tool affordance + keyboard scoping (D1, D3, D5).** The active (focused) viewport shows its indicator. A tool not meaningful on the active viewport (e.g., a contour tool with no FoR-matched volume) renders **disabled / no-op**, not silently misapplied. **Global** shortcuts (undo/redo, save, active-segment, active-tool) fire the same action regardless of which panel/the list is focused; **view** shortcuts (slice, zoom, W/L, rotate) act on the active panel only.
36. **A2c auto-classification (A2c).** Two same-FoR series differing only in `AcquisitionNumber`, no anatomical displacement → structures from one **render by default** on the other (A2b); `AcquisitionNumber` alone never hides. Two same-FoR series where a bulk-anatomy displacement is detected (breath-hold / 4D phases) → structures are **off by default** (A2c), toggleable on. When the displacement check is inconclusive, the decision **defaults to show**.
37. **Performance budget (D8).** With four open volume viewports of a ~300-slice CT, a structure set of ~20 ROIs plus one multi-segment SEG: brush edits propagate across eligible panels at **≥ 30 fps**, and a layout change (2×2 → MPR) does not stall the UI beyond **~250 ms**. (Measured regression guard; benchmarked, not pixel-pass/fail.)

> **Coverage note.** A few service-level behaviors are verified through service-integration tests + the manual QA matrix (design §8.5) rather than headline E2E signals: D2 (hover-emphasis sync, beyond the click-select of signals 8/33), B7 (Z-order / selection-bring-to-top), the per-structure-set variant of the D11 cross-series toggle, B6 (container-membership propagation), B8 (open-contour rendering), and C4 (per-segment property propagation across panels). Measurement (SR) now has **signal 32** for panel/container behavior + basic SR round-trip; deeper SR-template fidelity remains pending the D7.1 fill-in.

---

## H. Transport contract (boundary with the XNAT integration workstream)

This section defines the interface between in-memory annotation behavior (this doc) and persistence/transport (the XNAT integration doc). Both docs reference H by name; changes to H should be coordinated.

The contract is symmetric: the multi-viewport layer makes guarantees the transport layer can rely on, and the multi-viewport layer makes assumptions about the transport layer that the transport layer must satisfy.

### H1. Container as the unit of transport
The unit of save/load is a **container** (one RTSTRUCT structure-set or one DICOM SEG segmentation), per D7.1. Members within a container are not independently transported. The transport layer never sees individual ROIs or segments as separate objects.

### H2. Source identity attached at load
When the transport layer delivers a parsed container into the session, it provides a **source identity** record carrying:

- A stable URI or handle the transport understands (opaque to the multi-viewport layer).
- The container's modality (`RTSTRUCT` or `SEG`).
- The referenced source-series UIDs the container was authored against (RTSTRUCT `ReferencedFrameOfReferenceSequence` / SEG `ReferencedSeriesSequence`).
- A version token (ETag, hash, timestamp, or whatever the transport uses) for conflict detection.

The multi-viewport layer surfaces source identity in container metadata (D7.2 tooltip) and in the cross-series indicator logic (D9 source-series description). It is never modified by the multi-viewport layer; it is opaque.

### H3. Dirty signal
The multi-viewport layer emits a **per-container dirty event** when the container's state diverges from its last-saved state (per A9 / E1). The event payload is the container ID. The multi-viewport layer is silent about what to do with the signal; the transport layer decides whether to autosave, debounce, queue, or wait for explicit user save.

The dirty flag is cleared only when the transport layer reports a successful save with a new version token.

### H4. Save serialization
The multi-viewport layer exposes a **serialize** call on each container that returns a DICOM-ready dataset matching the container's modality. The serialized output is lossless for everything claimed in D7.10 (round-trip fidelity).

The multi-viewport layer does not perform the upload, does not retry, does not handle network failures. It hands a complete dataset to the transport layer and awaits a result.

### H5. Save result
The transport layer reports save outcomes per container as one of:

- **Success** with a new version token. The multi-viewport layer clears the container's dirty flag and stores the new token.
- **Conflict** (server has a newer version). Triggers the H7 flow.
- **Transient failure** (network, retryable). The multi-viewport layer keeps the dirty flag set; the container row in the list panel surfaces a transient-failure indicator (per D7.4 conflict-marker mechanism, distinct visual). User can retry.
- **Permanent failure** (auth, permissions, malformed). The multi-viewport layer surfaces the error on the container row with the failure reason and a remove control. The container remains in memory and editable.

### H6. External change notification
The transport layer may push a **version-changed** event for a container when it learns the server's version differs from the in-memory token. The multi-viewport layer responds:

- If the container is **clean**, the multi-viewport layer surfaces a non-intrusive **"newer version on server · reload"** indicator on the container row and reloads **only on the user's action** — it does **not** silently swap the data under the user (decided: a silent reload could change the displayed annotations unexpectedly). No local edits are at risk, so no conflict prompt is shown — just the reload affordance.
- If the container is **dirty**, the multi-viewport layer surfaces the conflict marker (D7.4) and prompts the user before reload (per E3 — no silent overwrite of local edits).

### H7. Conflict resolution flow
When a save attempt returns Conflict (H5) or an external change arrives while dirty (H6), the multi-viewport layer triggers a user prompt with three options:

- **Keep local** (overwrite server with current state — only available if the user has permission).
- **Discard local** (reload server version, lose local edits).
- **Inspect** (open a diff or side-by-side view — optional, may be deferred to a later iteration).

The multi-viewport layer is responsible for the prompt UX; the transport layer executes the chosen action.

### H8. New container creation
When the user creates a new container in-session (e.g., starts a new structure-set or segmentation), the multi-viewport layer assigns a session-local container ID. The transport layer does not see the container until first save. On first save, the transport layer assigns a permanent source identity (H2) and reports it back; the multi-viewport layer updates the container.

### H9. Loading lifecycle
The transport layer is responsible for fetching, parsing, and validating DICOM bytes. It hands the multi-viewport layer a fully parsed container ready to display. Parse failures stay on the transport side and are surfaced via the H5 permanent-failure mechanism on a placeholder container row (per D7.9 parse-error state).

The multi-viewport layer does not read DICOM bytes directly. It does not retry. It does not negotiate transfer syntax.

### H10. What does not cross the boundary
- **Auth, sessions, project/subject/experiment/scan hierarchy, scan ID conventions, REST endpoints**: transport's concern, never visible to the multi-viewport layer.
- **Selection, hover, expand/collapse, filter, scroll, per-viewport visibility overrides, undo history, dirty flag itself, the auto-interpolated marker**: multi-viewport's concern, never sent to the server.
- **Container source identity (H2)**: provided by transport, opaque to multi-viewport, displayed but never modified.
- **Version tokens**: provided by transport, opaque to multi-viewport, used only as input to H5/H6.

---

## I. Viewer-chrome & toolbar behaviors (preserved from the current app)

These are **existing, working viewer features** the rebuild touches (the toolbar is rebuilt) and must **preserve**, not drop. They were surfaced by the gap audit ([`multiviewport-annotation-gaps.md`](multiviewport-annotation-gaps.md) §3/§5) because the frozen toolbar mockup (§10) shows several of them by label only. The contract is "**match the current implementation**" unless noted; cited files are the source of truth. Confirmed/dispositioned 2026-06-05.

- **I1. Toolbar = viewer controls only.** The toolbar holds layout/navigation/transform/undo-redo/cine/tags/export/panel-toggles/settings; the annotation lifecycle stays in the side panel (CLAUDE.md UI arch, mockup §10).
- **I2. Layout & hanging protocols.** The Layout control offers fixed presets (1×1/1×2/2×1/2×2), **MPR** (as a preset), **and custom rows×cols** (`viewerStore.setCustomLayout`, `Toolbar.tsx`). The **"Hanging ▾"** control applies built-in hanging protocols (CT Pre/Post, MR Brain, Tomo/Mammo 4-Up — `shared/types/hangingProtocol.ts`) with metadata-based matching + manual select. Preserve.
- **I3. Window/Level presets.** The W/L-preset control is a **dropdown of all five presets** — Soft Tissue / Lung / Bone / Brain / Abdomen (`WL_PRESETS`) — with Ctrl+1–5 hotkeys. The mockup's single "Soft tissue" label is the dropdown's current value, not the only preset. Preserve all five + hotkeys.
- **I4. Configurable viewport overlay.** Four-corner DICOM overlay with user-configurable fields per corner, plus rulers and orientation markers (`ViewportOverlay.tsx`, Settings "Overlay" tab, ~20 fields). Per-frame metadata reads via `volumeViewport.getCurrentImageId()`. Preserve the configurability.
- **I5. DICOM Tags panel.** The toolbar **"Tags"** button opens the header inspector — tags grouped by module, text search, private-tag toggle (`DicomHeaderPanel.tsx`). Preserve.
- **I6. Cine — on volume.** Cine runs on volume viewports via CS3D `utilities.cine.playClip` (scroll-cine + dynamic 4D). Implement via `playClip`, not the legacy stack `setInterval`. The stack-eligibility predicate (US/XA/RF…) chooses viewport *type*, not cine availability (design §1.1, risk register).
- **I7. Two distinct "Export" surfaces.** (a) **Toolbar Export** = the *viewport image* export — PNG/JPEG, copy-to-clipboard, save-all-slices, save raw DICOM of the current slice (`ExportDropdown.tsx`). (b) **Per-container panel kebab Export** = the *annotation* export — Export-to-DICOM and Export-to-CSV (D7.6). These are different features; keep both.
- **I8. Favorites (Bookmarks).** Toolbar **"Favorites"** dropdown of **pinned items** (projects/subjects/sessions the user pins) + auto-tracked **recent sessions**, scoped per XNAT server, persisted in localStorage (`lib/pinnedItems.ts`, `lib/app/useBookmarks.ts`, `components/app/BookmarksDropdown.tsx`). Clicking navigates the XNAT browser to the item (`NavigateToTarget`, optional skip-auto-load) and loads the session; recents are promotable to pinned. Works well — preserve as-is.
- **I9. Import (local DICOM).** Toolbar **"Import"** loads DICOM **from the local drive** (distinct from XNAT load): drag-and-drop files/folders (always available) + an open-file button, via Cornerstone's file manager / wadouri (`App.tsx loadLocalFiles`). **Basic — works well enough for now; flagged for later development** (robustness / large-folder / series-grouping).
- **I10. Delete safety — trash vs permanent.** Server-side delete offers a **soft "trash"** path (move to a trash resource) vs. permanent, gated by the `trashOnServerDelete` preference + trash-resource name (`preferencesStore.ts`). Fold into the delete contract (transport C8): the delete "✕" honors this preference. Preserve.
- **I11. Settings (gear).** The toolbar **Settings** gear opens the global settings modal with tabs: Hotkeys (rebind), Overlay, Annotation (brush/contour/opacity/colors/scissors), Updates (auto-update enable + auto-download), Interpolation, File Backup (enable/interval + recover sessions), Issue Report, About (`SettingsModal.tsx`). Preserve these tabs (this is where the removed panel-settings kebab's options live).
- **I12. Connection lifecycle.** XNAT login, 5-minute `/data/JSESSION` keepalive, session-expiry → store reset + reconnect, logout (`main/xnat/sessionManager.ts`, `connectionStore.ts`). **Ownership:** this is connection/auth, not annotation — it belongs to the transport/integration layer (or a connection spec); recorded here only so it doesn't fall between docs. Preserve.
- **I13. Phase-5-gated tools.** Sculptor, Region / Region+ (smart brush), and **Contour Fill** are preserved; their behavior is verified by the Rebuild Phase 5 audit (Contour Fill is currently broken and is **must-fix** for v1, per C3 / design §0.2).
