# MV-Phase 5 Tool Audit

Dated 2026-05-03. Walks every voxel-editing / contour-editing tool in
[toolService.ts](../src/renderer/lib/cornerstone/toolService.ts) and
[tools/](../src/renderer/lib/cornerstone/tools/) against
[multiviewport-annotation-requirements.md](multiviewport-annotation-requirements.md)
§C3 (voxel editing tools), §C5 (active-segment lock), §C6 (overlap policy).

The audit is intentionally evidence-driven: every "✅" cites a named
production code site or a named test; every "⚠ gap" or "❌ broken" names
the symptom and the planned fix. Phase 5 sub-tasks 5.2 / 5.3 / 5.4 land
the listed fixes; 5.6 lands the corresponding tests.

## Lock-enforcement architecture (§C5)

There are three independent lines of defense between a locked segment
and a write. All three are global (read from the segmentation's lock
state), not per-viewport — locking on any panel blocks edits on all.

1. **UI gating** — [`SegmentationPanel.tsx:1827`](../src/renderer/components/viewer/SegmentationPanel.tsx#L1827)
   disables every entry in `toolPanelTools` (Brush / Eraser /
   ThresholdBrush / Scissors / PaintFill / RegionSegment* /
   *Threshold / **LabelmapEditWithContour**) when
   `segmentationService.isActiveSegmentLocked()` returns true. The
   button title becomes `"<tool> (segment locked)"` and is non-clickable.
2. **Tool-activation refusal** — [`toolService.setActiveTool`](../src/renderer/lib/cornerstone/toolService.ts#L716)
   returns early with a `console.warn` if the active segment is locked
   when the user attempts to switch to any segmentation tool.
3. **Pointerdown capturing-phase guard** — [`toolService.installLockGuard`](../src/renderer/lib/cornerstone/toolService.ts#L158)
   intercepts the gesture before Cornerstone's tool sees the event. Any
   segmentation tool not in `LOCK_EXEMPT_TOOLS` (today: SegmentSelect,
   SegmentBidirectional) is hard-blocked at gesture-start. The captured
   pointer event is `stopImmediatePropagation`'d + `preventDefault`'d.

The pointerdown guard is the load-bearing invariant — even if the user
bypasses the disabled button (devtools, hotkey, dropdown), the gesture
never reaches the tool. Pinned by
[`20-g21-region-segment-audit.e2e.ts`](../e2e/specs/20-g21-region-segment-audit.e2e.ts)
(layer 1 + 3) and reused by every editing tool below.

## Overlap-policy architecture (§C6)

The XNAT Workstation defaults to single-segment-per-voxel for SEG
("multi-label, last-write-wins per voxel"); cross-segment overlap is
not authored. Each editing tool below either writes through Cornerstone
strategies that respect Cornerstone's `getLockedSegmentIndices` mask, or
in our wrapped tools (today: `SafePaintFillTool`) is gated against
writing into voxels that already belong to a locked segment. The
overlap policy itself (whether to permit overlap) is a property of the
segmentation's display config; if/when a future segmentation surfaces
overlap=allowed, the per-tool write code already routes through the
shared `voxelManager.setAtIndex` and will compose correctly.

## Tool inventory

| ToolName | CS class | §C3 mapping | §C5 (lock) | §C6 (overlap) | Status |
|---|---|---|---|---|---|
| Brush | `BrushTool` (FILL_INSIDE_CIRCLE) | 2D circular brush | ✅ via panel + activation + pointerdown guard | ✅ via Cornerstone's brush-strategy (active-segment-only) | ✅ |
| Eraser | `BrushTool` (ERASE_INSIDE_CIRCLE) | Eraser (2D) | ✅ same | ✅ active-segment-only | ✅ |
| ThresholdBrush | `BrushTool` (THRESHOLD_INSIDE_CIRCLE) | Threshold paint | ✅ same | ✅ active-segment-only within range | ✅ |
| CircleScissors | `CircleScissorsTool` | Planar scissors (circle) | ✅ same | ✅ active-segment-only | ✅ |
| RectangleScissors | `RectangleScissorsTool` | Planar scissors (rect) | ✅ same | ✅ active-segment-only | ✅ |
| SphereScissors | `SphereScissorsTool` | Through-volume scissors (sphere) | ✅ same | ✅ active-segment-only | ✅ |
| PaintFill | [`SafePaintFillTool`](../src/renderer/lib/cornerstone/tools/SafePaintFillTool.ts) | Paint Fill (3D flood fill, hole-fill) | ✅ wrapper checks `isSegmentIndexLocked` at preMouseDown ([SafePaintFillTool.ts:111](../src/renderer/lib/cornerstone/tools/SafePaintFillTool.ts#L111)); pointerdown guard backstops | ✅ wrapper refuses fills whose seed-pixel value is in `getLockedSegmentIndices` ([SafePaintFillTool.ts:171](../src/renderer/lib/cornerstone/tools/SafePaintFillTool.ts#L171)); `oldValue === activeSegmentIndex` skipped (no overwrite of own segment); fills flow through `voxelManager.setAtIndex` | ✅ |
| RegionSegment | `RegionSegmentTool` | Region-segment / smart brush | ✅ via panel + activation + pointerdown guard | ✅ Cornerstone tool writes only the active segment | ✅ |
| RegionSegmentPlus | `RegionSegmentPlusTool` | Smart brush (adaptive tolerance) | ✅ same | ✅ same | ✅ |
| RectangleROIThreshold | `RectangleROIThresholdTool` | Threshold-bounded rect | ✅ same | ✅ active-segment-only | ✅ |
| CircleROIThreshold | `CircleROIStartEndThresholdTool` | Threshold-bounded circle | ✅ same | ✅ active-segment-only | ✅ |
| LabelmapEditWithContour | `LabelMapEditWithContourTool` | Contour Fill (rasterize closed contour into active seg) | ✅ panel + activation + pointerdown guard (lock-block layer correct); rasterization layer needs the pre-flight Contour-rep ensure that Phase 5.2 lands | ❌ broken (no rasterization without Contour rep) → fixed in 5.2 | ❌→✅ via 5.2 |
| FreehandContour | `PlanarFreehandContourSegmentationTool` | (RTSTRUCT, not §C3) | ✅ contour-tool branch `ensureContourRepresentation` + lock guard | n/a | ✅ |
| SplineContour | `SplineContourSegmentationTool` | (RTSTRUCT, not §C3) | ✅ same | n/a | ✅ |
| LivewireContour | `LivewireContourSegmentationTool` | (RTSTRUCT, not §C3) | ✅ same | n/a | ✅ |
| Sculptor | `SculptorTool` | Sculptor | ✅ same | n/a (geometry-only on existing contour) | ✅ |
| SegmentSelect | `SegmentSelectTool` | n/a (utility) | n/a — exempt by `LOCK_EXEMPT_TOOLS` (read-only) | n/a | ✅ |
| SegmentBidirectional | `SegmentBidirectionalTool` | n/a (utility) | n/a — exempt by `LOCK_EXEMPT_TOOLS` (read-only) | n/a | ✅ |

## Findings

### Contour Fill (LabelmapEditWithContour) — broken (Phase 5.2)

**Symptom**: activating Contour Fill, drawing a closed shape, and
releasing produces no labelmap voxels.

**Root cause**: the underlying `LabelMapEditWithContourTool` rasterizes
on `ANNOTATION_COMPLETED` via `BrushTool.viewportContoursToLabelmap`,
which depends on the polyline annotation having been correctly
attributed to the active segmentation's Contour representation. The
Cornerstone tool's own `checkContourSegmentation` is supposed to add a
Contour representation to the active labelmap segmentation when the
viewport is added to the tool group, but it relies on the
`TOOLGROUP_VIEWPORT_ADDED` event firing **after** its
`initializeListeners` registers the handler. Our `rebuildToolGroup`
fires viewports first, then runs `applyBindings` → `setToolActive` →
`initializeListeners`, so the event is missed. Subsequent
`SEGMENTATION_MODIFIED` events do trigger the check, but a fresh
activation with no edits never hits that path either.

The downstream consequence: when the underlying
`PlanarFreehandContourSegmentationTool.addNewAnnotation` calls
`addContourSegmentationAnnotation`, the segmentation has no Contour
representation, so the polyline never lands in `annotationUIDsMap` and
the static `annotationsToViewportMap` may not get populated for the
viewport. The completion handler then either no-ops or rasterizes
without a stable segment binding.

**Fix (Phase 5.2)**: in [`toolService.setActiveTool`](../src/renderer/lib/cornerstone/toolService.ts#L700),
treat `ToolName.LabelmapEditWithContour` as needing the same Contour
representation pre-flight as the contour tools. Specifically: after
auto-creating (or selecting) the labelmap segmentation, call
`segmentationService.ensureContourRepresentation(viewportId, segId)`
before `rebuildToolGroup(toolName)`. This makes the contour rep exist
before the Cornerstone tool's listeners get a chance to discover it,
removing the race entirely.

The fix preserves the existing labelmap-tool branch (the segmentation
is still labelmap-typed, default segment is created, etc.) — it only
adds the Contour representation alongside Labelmap so the rasterizer
can write into it.

### G16 (3D paint-fill cross-MPR + single undo) — closed

- **Positive case + single-undo E2E**: [`23-g16-paint-fill-positive.e2e.ts`](../e2e/specs/23-g16-paint-fill-positive.e2e.ts)
  drives the production pipeline — Add seg → Brush four sides of a
  square (closed boundary) → Paint Fill click in the interior pocket
  → Ctrl+Z. Asserts `afterFillNonZero > boundaryNonZero` (the fill
  flooded the enclosed pocket) AND `afterUndoNonZero === boundaryNonZero`
  exactly (one undo reverts only the fill memo, leaving the four brush
  memos intact). The strict equality is the load-bearing G16 invariant
  — a regression that issued one undo per voxel or that re-batched
  into the brush memos would fail this assertion narrowly.
- **Single-undo unit pin**: [`SafePaintFillTool.test.ts`](../src/renderer/lib/cornerstone/tools/SafePaintFillTool.test.ts)
  "G16: a single fill records all voxel changes in one memo" — drives
  a 5-voxel synthetic flood, asserts memo.changes.length === 5, asserts
  `restoreMemo(true)` reverts every voxel.
- **Cross-MPR resampling**: follows from §C1 voxel coherence (sagittal
  / coronal viewports read the same 3D voxel grid the axial fill
  wrote). Already pinned by G1 + G3 — no new spec needed.

Paint Fill is intensity-blind (operates on labelmap voxel values, not
source image HU values), so the spec works on either `ct-axial-300` or
`ct-axial-anatomy`. The spec uses `ct-axial-anatomy` for symmetry with
the rest of the Phase 5 spec set.

### G21 (Region Segment + lock blocks gesture) — closed

- **Lock-block half**: [`20-g21-region-segment-audit.e2e.ts`](../e2e/specs/20-g21-region-segment-audit.e2e.ts)
  pins both layers (panel-disable + pointerdown guard).
- **Positive half**: [`22-g21-region-segment-positive.e2e.ts`](../e2e/specs/22-g21-region-segment-positive.e2e.ts)
  drives the production Region Segment gesture on the new
  [`ct-axial-anatomy`](../e2e/fixtures/dicom/ct-axial-anatomy/) fixture
  (soft-tissue ellipsoid + bone insert with Gaussian noise; smooth
  gradient transitions). Asserts non-zero painted voxels AND a bounded
  grow (< 75% of the slice) — the grow is the load-bearing positive
  invariant, the bound guards against the runaway-flood failure mode
  the binary `ct-axial-300` phantom would exhibit.

The sphere-phantom `ct-axial-300` fixture cannot exercise the positive
half — every voxel inside the sphere is exactly 0 HU, every voxel
outside is exactly −1000 HU, so GrowCut's `positiveSeedVariance × stddev`
tolerance band degenerates (zero stddev inside ⇒ empty grow; huge
stddev across the cliff ⇒ unbounded grow). The new fixture exists
specifically to give intensity-aware tools realistic seed statistics.

### Per-contour canvas-side auto-marker (§B5) — defer

The row-level `~` glyph + the existing `▶` step-through review button
(both Phase 4) are sufficient for the "auto-generated, transient
marker" requirement at the row layer. Adding a canvas-side rendering
hook would touch Cornerstone's contour-rendering style internals (no
public per-annotation style API today), and the row-level surface has
not yet generated user-facing complaints during in-process QA. Defer
unless feedback elevates it.

### Active-segment lock per-tool audit (§C5) — closed by architecture

All editing tools route through the same three-layer guard
(panel-disable / activation-refusal / pointerdown-block). The single
exception that needed dedicated per-tool work is `SafePaintFillTool`
(see table above), which we wrap, and which adds its own
`isSegmentIndexLocked` check at preMouseDown plus a "seed pixel is in a
locked segment" refusal. No additional per-tool fix is required.

### Overlap policy (§C6) — closed by architecture

Cornerstone's brush-strategy / scissors / region-segment all write the
active segment exclusively. `SafePaintFillTool` only writes voxels
whose `oldValue !== activeSegmentIndex` (no self-overwrite). The
"writes are bounded by existing segment boundaries" property holds
because the strategies and our wrapper all consult
`getLockedSegmentIndices` before writing. If a future segmentation
opts into overlap=allowed, the same `voxelManager.setAtIndex` plumbing
composes correctly.

## Out of scope

- New tools beyond §C3 (no scissors variants, no threshold-painter
  beyond what already ships).
- Tool-UI redesigns. Toolbar / dropdown shape locked at Phase 4.
- Volume-mode brush capability gap from spec 09 (`test.fixme`). Phase 5
  changes don't make it closeable as a side effect.
- The deferred DICOM fixtures (cross-series, breath-hold pair, cross-FoR,
  RTSTRUCT save-load). Phase 5 uses existing local fixtures
  (`ct-axial-300`, `seg-multilabel`, `rtstruct-typed`).
