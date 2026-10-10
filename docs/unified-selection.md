# Unified selection — Structures and Segmentations (branch `unified-selection`)

**Status:** done (2026-10-08), on branch `unified-selection`. Each step landed with a real-UI
E2E seen red first, its own commit, and mutation checks that the spec fails without the change.

**Implementation notes.** Copy with nothing selected falls back to the active member's components
on the slice (so paint → Ctrl+C keeps working); Delete has no fallback. A locked segment can be
selected (and copied) but not pasted into or deleted from. Found and fixed on the way: the panel
did not follow a contour selected on the image (now `segmentationService.activateMemberFromImage`);
Shift-click never reached the Select tool (Cornerstone binds by exact modifier); per-container
undo/redo — the normal path — skipped the locked-segment guard; contour delete and mask paste
recorded no undo at all; v5's union dropped selected neighbours of a stroke from the selection.
Specs: `annotations/select-tool`, `contour-components`, `mask-islands`; units `maskIslands`,
`perContainerHistory` (groups). Island outlines assume an acquisition-plane view (the slice is a
constant grid index); on an oblique MPR reformat the island is taken along the closest grid axis.

## Decisions (user, 2026-10-08)

1. **Selection lives inside the active object.** The panel keeps its one row state — the
   active member (D7.5, revised the same day). On the image you select *components of the
   active member*; there is no panel multi-select and no second row marking. Selecting a
   component of a *different* member makes that member active (and selects that component).
2. **A component** is one top-level contour of the active ROI (Structure), or one island —
   a connected painted region — of the active segment (Segmentation), **on the current
   slice**.
3. **Current slice only.** The selection is the active member's components on the slice you
   are on; changing slice clears it, so nothing invisible is ever acted on.
4. **One Select tool** in both toolboxes: same label, same arrow icon, and the cursor is the
   same glyph. Click a component → select it; Shift-click → add/remove it; click empty image
   → clear. It never draws. Replaces "Select ROI" and Cornerstone's hover-based Segment
   Select (whose silent active-segment change the panel never learned of).
5. **Act on the selection:** Ctrl+C copies the selected components; Ctrl+V pastes them onto
   the current slice, into the same member. **Delete** removes them — contours (as today) and
   mask islands (new; undoable).
6. **Selected look:** the component drawn with a thicker outline in its own colour (contours:
   already; mask islands: an outline drawn around the island).
7. Drawing tools still edit a contour you click on (Cornerstone builds that in); selecting
   is the Select tool's job.

## Plan (execute in order)

- [x] **S1 One Select tool.** Shared catalog entry in both toolboxes; icon and cursor drawn
      from one arrow glyph; Segment Select removed. E2E: both toolboxes offer "Select" with
      the same icon path as the cursor; the cursor is the named arrow.
- [x] **S2 Contour components.** Select tool on a contour of the active ROI selects it;
      Shift-click adds; a contour of another ROI makes that ROI active (panel row) and selects
      it; click empty clears; changing slice clears. Row click selects the member's
      components on this slice.
- [x] **S3 Multi-contour copy/paste/delete.** Ctrl+C copies every selected contour; Ctrl+V
      pastes them all; Delete removes them all (one undo step).
- [x] **S4 Mask islands.** Select tool inside an island of the active segment selects it
      (outline drawn); Shift adds; another segment's island activates that segment; empty
      clears; slice change clears.
- [x] **S5 Mask copy/paste.** Ctrl+C copies the selected islands of this slice (2D, not the
      whole 3D segment as before); Ctrl+V pastes them onto the current slice; undoable.
- [x] **S6 Mask delete.** Delete erases the selected islands; undoable.
- [x] **S7 Docs.** Requirements/design/CLAUDE.md updated; this doc marked done.
- [x] **S8 Drag to move contours** (added 2026-10-10). With Select, pressing on a selected
      contour and dragging moves the whole selection in the slice plane; a press on one of
      several selected keeps the group (a click without a drag narrows to it); a drag from
      empty image does nothing; one undo step; a locked member does not move (warning).
      Cornerstone moves whole contours only on its spline/livewire tools, and v5 makes every
      finished contour freehand — so the Select tool moves them itself (`contourMove`).
- [ ] **S9 Drag to move mask islands** — the same for selected islands (voxel-grid snapped).
