# Multi-Viewport Annotation: Design Proposal

> **Status: scaffold.** Captures the architectural decisions and required behavior changes that came out of the requirements phase. These are the decisions to preserve going into the full design — record of what we've decided and what's still open.

Companion to:
- [Current behavior audit](multiviewport-annotation-current.md)
- [Functional requirements](multiviewport-annotation-requirements.md)

---

## 1. Lead architectural question — contour MPR rendering path

**Decision needed before any implementation.** All other choices (state model, edit routing, performance work) flow from this.

Three candidate paths to satisfy A3 / B1 (contours render on orthogonal/cross-prescription views):

### Path A — Volume-viewport native filter, accept the 2.56° cutoff
Use Cornerstone's built-in [filterAnnotationsWithinSlice](../node_modules/@cornerstonejs/tools/dist/esm/utilities/planar/filterAnnotationsWithinSlice.js) world-space test. Plain annotations render on volume viewports when slice normals are parallel within `1 - EPSILON` (`EPSILON = 1e-3` → ~2.56° tolerance) and the world point falls within `spacingInNormalDirection / 2`.

- **Pros**: zero new dependencies; current Cornerstone code does it; well-understood.
- **Cons**: hard 2.56° silent cutoff. Oblique acquisitions, tilted MR prescriptions, and most reformatted views fail silently. Doesn't help **stack viewports** at all (those use SOP-UID lookup and don't fall back to FoR+plane unless `asNearbyProjection`/`asVolume` flags are set).
- **What it doesn't solve**: arbitrary MPR (sagittal/coronal of an axial-drawn contour), oblique reformats, the T1/T2-with-slight-angulation case.

### Path B — PolySeg surface-clip path
Register `@cornerstonejs/polymorphic-segmentation`. Bind every contour annotation to a contour segmentation. Cornerstone builds a 3D surface from the contours and re-clips it against each viewport plane on the fly ([contourDisplay.js:54-95](../node_modules/@cornerstonejs/tools/dist/esm/tools/displayTools/Contour/contourDisplay.js)).

- **Pros**: angle-agnostic; the canonical Cornerstone3D answer for MPR contour display; works for arbitrary oblique reformats. Aligns with how OHIF does it.
- **Cons**: depends on a less-stable add-on with three known open upstream issues — [#1288 contour→closed-surface](https://github.com/cornerstonejs/cornerstone3D/issues/1288), [#1837 contour→labelmap WASM error](https://github.com/cornerstonejs/cornerstone3D/issues/1837), [#1188 seg MPR mismatch](https://github.com/cornerstonejs/cornerstone3D/issues/1188). Performance under heavy structure sets unproven in our app. Surface synthesis can produce incomplete cross-sections for non-closed contours (Slicer documents the same caveat).
- **What it doesn't solve on its own**: stack-viewport SOP-UID strictness for cross-series display.

### Path C — Hybrid: PolySeg as default, native filter as fallback for performance
PolySeg path for any MPR / oblique / cross-series rendering. Native filter for the same-series-same-orientation common case where it's cheaper and bulletproof.

- **Pros**: ceiling of Path B with floor of Path A.
- **Cons**: two code paths to maintain. Need a clear runtime predicate for "use which path." Risk of subtle inconsistencies (a contour drawn on slice N renders fine via path A, then user rotates the camera 3°, suddenly path B kicks in and the visual is slightly different).

### Recommendation (preliminary)

Path C, with PolySeg adoption non-negotiable. Justification:

- A3/B1 require true MPR rendering (axial-drawn contours visible on sagittal/coronal). Path A cannot deliver this.
- The 2.56° cutoff is unacceptable as a silent failure mode for an expert tool — too many real-world prescriptions sit just outside it.
- Path B's open issues are real but tractable: we can pin a known-good version, add app-level workarounds, and contribute upstream fixes if needed. The alternative (write our own surface clipper) is a much larger commitment.

**Open subquestions for the full design:**
- Which PolySeg version do we pin? (Verify against #1288/#1837/#1188 fix status at design time.)
- For loose (non-segmentation) annotations — Length, Angle, Bidirectional, ROI, simple freehand — do we put them through PolySeg too (probably no; they aren't surfaces) or accept that those don't render on MPR? Commercial tools generally do show measurements on MPR. Decision needed.

---

## 2. Flip the viewport default from stack to volume

**Current**: every panel is created as `ViewportType.STACK` by default ([viewportService.ts:62](../src/renderer/lib/cornerstone/viewportService.ts:62)). Volume viewports (`ViewportType.ORTHOGRAPHIC`) are only used when the user explicitly chooses an orientation per panel, or when global MPR mode is entered. The stack-as-default appears to be historical (volume support came later, layered on) rather than a deliberate clinical choice.

**Target**: volume viewport per panel by default. Stack mode reserved for genuinely stack-only situations: single-frame DX/CR, multi-frame US cine, anything where there is no 3D volume to be had. The decision is driven by the data, not the UI.

**Why**: stack mode actively blocks the requirements we've signed up for. Specifically:

- A2b cross-series rendering (T1/T2 case) silently fails on stack viewports because Cornerstone uses SOP-UID lookup with no FoR fallback unless `asNearbyProjection`/`asVolume` flags are set ([StackViewport.js:1816-1867](../node_modules/@cornerstonejs/core/dist/esm/RenderingEngine/StackViewport.js)).
- A3/B1 orthogonal contour rendering requires world-space slice geometry, which only volume viewports provide.
- The PolySeg path from §1 needs volume viewports to work cleanly.
- Mode-switch destroy/recreate (orient → stack → orient again) is a recurring source of layout-churn bugs because the two paths exist; one path eliminates them.
- Lazy stack→volume labelmap conversion ([segmentationService.ts:380-399](../src/renderer/lib/cornerstone/segmentationService.ts:380)) goes away — segs are created in volume form to start.

**Costs to address in the full design:**
- Volume mode has higher initial load cost and memory footprint than stack mode. Need to confirm performance at typical scan sizes (CT 300–500 slices, MR 100–250 slices) before committing.
- Cine playback semantics — stack mode supports frame-by-frame cine naturally; in volume mode this becomes "step through slices along the acquisition axis." Need explicit handling for multi-frame cine series (US, dynamic MR, cardiac).
- Per-frame metadata overlay — stack mode overlays per-image metadata directly; volume mode requires a per-slice lookup. Not hard, but explicit work.
- Volume sharing across panels reformatting the same source scan must be the default — keyed by `(scanId, FoR)`, not by `panelId`. The current per-panel oriented mode wastefully creates one volume per panel ([OrientedViewport.tsx:56-58](../src/renderer/components/viewer/OrientedViewport.tsx:56)).
- Initial load latency for the user's first interaction — even if the volume is needed eventually, today's stack mode lets the user scroll one frame immediately. Need a strategy: progressive load, frame-first preview, or accept the wait.

**Implementation scope**: this is a meaningful refactor. [`viewportService.ts`](../src/renderer/lib/cornerstone/viewportService.ts), [`CornerstoneViewport.tsx`](../src/renderer/components/viewer/CornerstoneViewport.tsx), [`OrientedViewport.tsx`](../src/renderer/components/viewer/OrientedViewport.tsx), [`ViewportGrid.tsx`](../src/renderer/components/viewer/ViewportGrid.tsx), and the segmentation attachment paths in [`segmentationService.ts`](../src/renderer/lib/cornerstone/segmentationService.ts) all change. But it consolidates code, not multiplies it: the end state has fewer paths, not more.

---

## 3. Consolidate MPR mode into the standard grid

**Current**: two parallel viewport architectures coexist — `ViewportGrid` (standard, supports per-panel orientation) and `MPRViewportGrid` (dedicated 2×2 MPR layout, separate `mprToolService` tool group, no annotation tools, single shared volume across the three reformatted panels). Entered via a global "MPR mode" toggle.

**Target**: one viewport-grid system. `MPRViewportGrid` and `mprToolService` go away. The MPR layout becomes a **layout preset** in the standard grid:

- Preset arranges 2×2 with Axial / Sagittal / Coronal oriented panels plus an optional reference stack panel (or fourth oriented view).
- Crosshair sync is enabled across panels keyed off the same source scan + FoR — already the right default once volumes are shared (§2).
- The single primary tool group serves all viewports. The "no annotation in MPR" rule is dropped — radiologists routinely want to drop measurements on a reformatted plane.
- "Link panels" affordance in the standard grid replicates MPR mode's always-synced semantics for any layout, not just 2×2.

**Why**: the parallel architecture exists for narrow reasons that are mostly UX presets, not technical capabilities:
- **Volume sharing** is the one real architectural advantage of the dedicated MPR mode today — and §2 fixes that for the standard grid universally.
- **Always-on crosshair sync** is a UX guarantee, not a unique capability. A "link these panels" toggle replicates it.
- **Restricted tool set** (no annotations) is artificial — users frequently want to draw on reformatted planes; forcing them to leave MPR mode for that is friction, not safety.
- **Fixed 2×2 layout with native reference** is a layout preset, expressible in the standard grid.
- **Dedicated loading-progress overlay** can be generalized to any oriented panel set.

**Costs to address in the full design:**
- `mprToolService` currently owns the `CrosshairsTool` wiring; primary tool group does not include it. Crosshair tool needs to move into the primary group, with care about default bindings (left-click is taken).
- Existing keyboard shortcuts and UI affordances tied to the `mprActive` boolean need to be remapped to "is the current layout an MPR preset?" or simply rethought.
- The current MPR mode's three-plane volume-loading progress overlay ([MPRViewportGrid.tsx:115-135](../src/renderer/components/viewer/MPRViewportGrid.tsx:115)) is useful UX — needs a replacement at the per-scan level on the standard grid.
- The "reference panel" (stack viewport of the source acquisition) is the only thing the standard grid can't currently express atomically — once volumes are the default (§2), the user sees reformatted axial there too. We should decide: drop the native-stack reference, or add a per-panel "show as native stack" toggle that overrides the volume default for that panel only.
- Annotation continuity across the mode boundary: today, annotations made in MPR live in a different tool group's state and are invisible outside MPR. This is a defect that this consolidation fixes, but it does mean that whatever workflow today depended on MPR-mode annotations being invisible elsewhere has to change.

**Implementation scope**: removes [`MPRViewportGrid.tsx`](../src/renderer/components/viewer/MPRViewportGrid.tsx), [`MPRViewport.tsx`](../src/renderer/components/viewer/MPRViewport.tsx), and [`mprToolService.ts`](../src/renderer/lib/cornerstone/mprToolService.ts). Layout preset logic is added to [`ViewportGrid.tsx`](../src/renderer/components/viewer/ViewportGrid.tsx). Crosshair tool wiring moves to [`toolService.ts`](../src/renderer/lib/cornerstone/toolService.ts).

---

## 4. Required behavior changes

These deviations from current behavior are decided and feed directly into the design.

### 4.1 Deprecate per-contour promote-before-save for inter-slice interpolation
**Current**: interpolated contours are visually distinct and require user click-to-promote each one before save; unpromoted interpolated geometry is dropped.

**Target (per requirements B5, Model A)**: interpolated contours are written directly into the structure-set on creation; they are saved as part of the RTSTRUCT with no promotion step; visual distinction is a transient marker (auto-badge or thin secondary stroke) that fades after manual edit or save; editing/deleting works like any other contour; **no save gate**.

**Why**: industry-standard behavior across Eclipse/MIM/RayStation/Pinnacle/Velocity and the current Cornerstone3D default ([PR #5555](https://github.com/OHIF/Viewers/pull/5555)). Promote-before-save is unusual, friction-heavy, and the failure mode (silent drop on forgotten promotion) is worse than the failure mode of write-through (visible wrong interpolation, easily edited).

**Implementation impact**: remove promotion-required-before-save logic; auto-save path treats interpolated contours as savable; visual marker style chosen so it does not collide with the cross-series dashed-stroke convention (D9).

**No migration concern** — no existing users.

### 4.2 Cross-series rendering with non-native visual style (per A2b, D9)
**Current**: contours generally don't render across sibling series due to stack-viewport SOP-UID strictness; users see "nothing" with no explanation.

**Target**: same-FoR sibling series render contours by default with dashed stroke / hatched fill, read-only on the non-native viewport, with hover tooltip naming the source series. Save state never carries the non-native styling.

**Implementation impact**: drives the Path B/C decision above. Also requires app-level series-identity tracking (since Cornerstone has no native concept of "this annotation's source series differs from this viewport's active series") — likely a thin extension of existing FoR-stamping in [segmentationService.ts:1102-1106](../src/renderer/lib/cornerstone/segmentationService.ts:1102).

### 4.3 Same-FoR-but-anatomy-moved off by default (per A2c)
**Current**: no notion of this distinction. Cornerstone treats all same-FoR pairs identically.

**Target**: detect breath-hold / 4D-CT / repeat-acquisition pairs and default to "off" with an explicit opt-in toggle.

**Implementation impact**: requires a heuristic (separate `AcquisitionNumber` + same FoR + bulk anatomy displacement signal, exact rule TBD in design). When uncertain, prefer A2b (render with flag) over A2c (hide). Toggle state is per session.

### 4.4 Single source of truth + global undo (per A1, A8)
**Current**: undo/redo and dirty-state behavior across panels is uneven; auto-save can race with concurrent edits in two panels.

**Target**: undo/redo is per-structure-set (or per-segmentation), not per-panel; single global dirty flag per object; auto-save debounce per object, never mid-stroke.

**Implementation impact**: refactor undo stack from viewport-scoped to structure-set-scoped. Audit auto-save code path in [segmentationService.ts:1305-1395](../src/renderer/lib/cornerstone/segmentationService.ts:1305).

### 4.5 Annotation list panel as global view (per A11, D7)
**Current**: list panel is roughly global already, but selection sync across viewports is incomplete.

**Target**: clicking, hovering, and toggling visibility in the list panel affects all eligible viewports consistently. Non-native list rows show source-series identity and a "linked-series" icon. Different-FoR rows show a "not viewable here" indicator instead of being silently empty.

---

## 5. Open questions still to resolve before full design

- **Loose-annotation MPR support** — do Length/Angle/Bidirectional/ROI/freehand render on orthogonal views? Commercial tools generally do; PolySeg path doesn't apply naturally to non-surface annotations. Possibly extend Cornerstone's `EPSILON` for a wider parallel cone, or accept the limitation for v1.
- **A2c heuristic rule** — exact criteria for distinguishing breath-hold/phase-binned pairs from in-exam siblings. Probably needs sample data review.
- **PolySeg version pinning** — confirm fix status of [#1288](https://github.com/cornerstonejs/cornerstone3D/issues/1288), [#1837](https://github.com/cornerstonejs/cornerstone3D/issues/1837), [#1188](https://github.com/cornerstonejs/cornerstone3D/issues/1188) at design time.
- **Reference panel in MPR layout preset** — drop the native-stack reference, or add a per-panel "show as native stack" override that lets one panel opt out of the volume default? See §3 costs.
- **Cine and per-frame metadata in volume default** — strategy for multi-frame cine series and per-slice metadata overlay once stack mode is no longer the default. See §2 costs.
- **Initial-load latency in volume default** — progressive load, frame-first preview, or accept the wait? See §2 costs.
- **Auto-save debounce period** (A9) — exact value. Requirement says "a few seconds, never mid-gesture" but the precise number is design-phase.

---

## 6. Out of scope (carried from requirements F)

- Cross-FoR display via deformable registration. (Rigid registration via DICOM SRO ingestion may be considered later.)
- Real-time collaborative multi-user editing.
- 3D volume-rendered editing as a primary interaction.
- Streaming partial loads of very large segs.
