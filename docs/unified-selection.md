# Unified selection — Structures and Segmentations (branch `unified-selection`)

**Status:** in progress (started 2026-10-08). Living doc: the ordered plan below is executed
top-to-bottom; each step lands with a real-UI E2E seen red first, and its own commit.

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
- [ ] **S7 Docs.** Requirements/design/CLAUDE.md updated; this doc marked done.
