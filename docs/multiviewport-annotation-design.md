# Multi-Viewport Annotation: Design

> **Status: ready for implementation.** Translates [`multiviewport-annotation-requirements.md`](multiviewport-annotation-requirements.md) into an architectural plan, data model, service layout, and phased implementation strategy.

Companion to:
- [Current behavior audit](multiviewport-annotation-current.md) — baseline.
- [Functional requirements](multiviewport-annotation-requirements.md) — what we're building (authoritative for behavior).
- [Architecture & migration](multiviewport-annotation-architecture.md) — the layering contract, enforced module boundaries, current→target migration map, component architecture (**authoritative for structure**).
- [XNAT integration requirements](annotation-xnat-integration-requirements.md) — transport workstream, separate but contracted via section H of the requirements doc.

This is a major revision to the existing implementation. The design is structured around minimizing brittleness, maximizing maintainability, and explicitly preferring standard Cornerstone3D capabilities over custom replacements.

---

## 0. Engineering principles

These principles bind every decision below. Where a principle and a clever shortcut conflict, the principle wins.

### 0.1 Cornerstone is the authority for geometry, viewport, and annotation state
Cornerstone3D owns all imaging data: image volumes, viewports, annotation state, segmentation representations, tool state. The app layer mirrors selected Cornerstone state into Zustand stores for reactive UI but **never** maintains a parallel source of truth for geometry. When Cornerstone state and a Zustand store disagree, Cornerstone wins; the store is reconciled from Cornerstone, not the reverse.

### 0.2 Use Cornerstone APIs as published; do not subclass or monkey-patch
If a published Cornerstone API does what we need, we use it directly. We do not subclass tools, override internal methods, or reach into private state. Every existing custom Tool wrapper is presumed deprecated until a specific, documented Cornerstone bug or missing capability justifies keeping it. The rule is "use the standard tool unless we can name the exact reason we can't."

The current codebase has one custom tool ([SafePaintFillTool.ts](../src/renderer/lib/cornerstone/tools/SafePaintFillTool.ts), a substantial reimplementation with its own flood-fill and memo machinery). This design schedules an audit of whether that wrapper is still required against the current PolySeg / Cornerstone version (Phase 5).

### 0.3 Boundary discipline between services, stores, and components
The layering contract is **enforced** and specified in full — dependency matrix, the hooks seam, ESLint rules, and the current→target migration map — in [`multiviewport-annotation-architecture.md`](multiviewport-annotation-architecture.md) §2, which is authoritative for structure. In brief:
- **Services** (`src/renderer/lib/**`) own all Cornerstone interactions and all orchestration. They may write summaries to stores; they never import React, components, or hooks.
- **Stores** (`src/renderer/stores/*`) are **pure reactive state** — state, selectors, setters. They import nothing from services or Cornerstone and never trigger a side effect. (This corrects today's `viewerStore`, which calls services directly; that orchestration moves to services + hooks — see the architecture doc's migration map.)
- **Hooks** (`src/renderer/hooks/*`) are the only layer that both reads stores and calls services — the seam the UI depends on.
- **Components** are presentational: they read store selectors and dispatch service calls **through hooks**, never importing a service or Cornerstone directly.

### 0.4 Feature-flag in-flight refactors
The design ships in phases (§7). Each phase that changes user-visible behavior lands behind a runtime feature flag (a preference) until the new behavior is verified end-to-end. Flags are removed once the prior code path is deleted; they are not permanent configuration.

### 0.5 Tests land with the change, not after
Every phase has acceptance tests landed in the same PR as the implementation. The 37 acceptance signals from requirements section G are the primary regression suite; design phases map to specific signals.

### 0.6 No partial implementations
Reserved fields (e.g., ROI Algebra schema) ship with explicit `null`/empty defaults and serialize/deserialize correctly, but **no half-built features**. We do not ship partially-functional ROI Algebra, partially-working point/measurement editing, or partially-implemented approval workflow. A feature is in or it is fully out.

### 0.7 Phased PRs, not big-bang
Each phase is a sequence of small PRs, each individually reviewable and revertable. No PR exceeds ~800 lines diff except for pure deletions (which can be larger).

### 0.8 Naming consistency
Terminology in this doc, the requirements doc, and the code matches: `container`, `member`, `active member`, `edit target`, `selection set`, `source identity`, `non-native`, `provenance`. Drift produces bugs and onboarding pain.

### 0.9 No silent failures
Every blocked operation produces a user-visible hint (per requirements D10, B3, A7). Every transport error is surfaced (per H5). Every detected inconsistency is logged with a `[serviceName]` prefix per existing CLAUDE.md convention.

### 0.10 Refactor by extraction, not rewrite
Large services (`segmentationService.ts` at 5614 lines, `toolService.ts` at 1047 lines) decompose by extraction — pull cohesive responsibilities into smaller modules behind the same public API, leaving call sites unchanged. The existing `segmentationService/` subfolder ([dicomContext.ts](../src/renderer/lib/cornerstone/segmentationService/dicomContext.ts), [eventBindings.ts](../src/renderer/lib/cornerstone/segmentationService/eventBindings.ts), [interpolation.ts](../src/renderer/lib/cornerstone/segmentationService/interpolation.ts), [segmentationHelpers.ts](../src/renderer/lib/cornerstone/segmentationService/segmentationHelpers.ts)) is the model.

---

## 1. Architectural pillars

The five decisions that shape everything else. Each is binding for the implementation.

### 1.1 Volume viewport is the universal default
Every panel is created as `ViewportType.ORTHOGRAPHIC` unless the data is genuinely non-volumetric. The decision is driven by the data, not by user UI choice.

**Stack-eligibility predicate** (the only cases where stack mode is created):
- Modality in `{US, XA, RF}` (ultrasound, X-ray angiography, fluoroscopy), or **planar** `NM` (nuclear-medicine planar) — but volumetric NM/SPECT and PET (`PT`) stay volume.
- DICOM `NumberOfFrames > 1` AND no spatial-dimension indicator in `MultiFrameDimensionSequence` (multi-frame cine series).
- Single-frame DX/CR/MG (digital radiography, mammography).

Anything else → volume viewport.

**Why**: A2b cross-series rendering, A3 orthogonal contour rendering, and the PolySeg path (1.2) all require volume viewports. Stack-as-default actively blocks these requirements (cf. [StackViewport.js:1816-1867](../node_modules/@cornerstonejs/core/dist/esm/RenderingEngine/StackViewport.js)). The current default is historical.

**Initial-load latency**: handled by Cornerstone's `StreamingImageVolume` (already in use via [`@cornerstonejs/dicom-image-loader`](../node_modules/@cornerstonejs/dicom-image-loader)). Slices stream into the volume as they arrive and become visible incrementally — first paint is fast, full volume completes in the background while the user is already interacting. No app-level work needed beyond ensuring the streaming loader stays the default. Phase 1 verifies *first-paint* latency does not regress vs. stack mode by more than 10% — a tighter, perception-driven bound than the ≤30% cap on *full 4-panel load* in §7 / §8.6. The two measure different things and are not in conflict.

**Per-frame metadata in volume mode**: `volumeViewport.getCurrentImageId()` returns the source `imageId` for the visible slice; metadata overlay reads from that. Cornerstone API; no custom logic.

**Consequence**: `OrientedViewport` and `CornerstoneViewport` collapse into a single `Viewport` component with viewport-type chosen by the stack-eligibility predicate above, not by per-panel orientation state.

### 1.2 PolySeg-first contour rendering, with native-filter fallback only where measured
PolySeg ([@cornerstonejs/polymorphic-segmentation](https://github.com/cornerstonejs/cornerstone3D/tree/main/packages/polymorphic-segmentation)) handles contour rendering on all viewports — same plane, MPR, oblique, cross-series. Already installed and registered ([init.ts:61](../src/renderer/lib/cornerstone/init.ts:61)). The native parallel-normal filter is **not** used as a separate code path; PolySeg's own internals decide when it's safe to short-circuit.

**Why**: §0.2 — use Cornerstone as-is. The hybrid Path C from prior scaffolding introduced a second code path; the simpler model is "trust PolySeg." If performance turns out to require a fast-path for the common same-plane case, that fast-path lands inside the rendering service as a measured optimization, not as a parallel architecture.

**Required validation in Phase 0**: confirm PolySeg version `^4.16.1` (currently installed) does not regress the open issues [#1288](https://github.com/cornerstonejs/cornerstone3D/issues/1288), [#1837](https://github.com/cornerstonejs/cornerstone3D/issues/1837), [#1188](https://github.com/cornerstonejs/cornerstone3D/issues/1188). If it does, pin or upgrade.

### 1.3 One viewport-grid system; one tool group
`MPRViewportGrid`, `MPRViewport`, `mprService`, and `mprToolService` are removed. The standard `ViewportGrid` handles all layouts via layout presets (§4). The single primary tool group serves all viewports. `CrosshairsTool` moves into the primary tool group.

**MPR layout preset shape**: 2×2 with axial / sagittal / coronal oriented panels plus a **3D volume rendering** panel in the fourth slot. The native-stack reference panel that exists today is dropped — once volume viewports are the default (1.1), the axial reformat is the same voxels as the source acquisition, eliminating the QA-vs-stack rationale. Stack mode is **not** user-selectable for volumetric data (1.1); the 3D slot's contents are chosen from volume-based layout options only.

**Why**: §3 of prior scaffolding. The parallel architecture exists for narrow UX reasons (volume sharing, always-on crosshair sync, restricted tool set) that all collapse once 1.1 takes effect.

**Migration**: any annotation made in MPR mode today lives in a separate tool group's state; consolidation makes them visible everywhere. No existing-user data to migrate.

### 1.4 Container-centric data model
The unit of annotation work is the **container** (RTSTRUCT structure-set, DICOM SEG, or DICOM-SR measurement report). Members are owned by their container. Save/load, undo, dirty, approval, and source identity attach to containers, never to individual members or to viewports. This is the H1 transport-contract unit and the requirements D7.1 hierarchy.

**Why**: clarity. Without a defined unit, save semantics, conflict detection, undo scoping, and the active-state model fracture.

### 1.5 Volume sharing keyed on `(scanId, FoR)`
Two panels reformatting the same source scan share the same `ImageVolume` instance. Volume identity is derived from `(scanId, FrameOfReferenceUID)`, not from `panelId`. Today's per-panel oriented mode wastefully creates one volume per panel ([OrientedViewport.tsx:56-58](../src/renderer/components/viewer/OrientedViewport.tsx:56)); after this change, a 2×2 MPR layout of one CT loads the volume once.

**Why**: memory and performance — one volume instead of three. Also enables crosshair sync to "just work" since linked panels share state.

---

## 2. Data model

Concrete types for the in-memory model. TypeScript-shaped — exact field names may shift in implementation, but the shape is binding.

### 2.1 Container types

```typescript
type ContainerKind = 'RTSTRUCT' | 'SEG' | 'SR';   // SR = DICOM Structured Report (measurements)

interface Container {
  id: string;                          // session-local unique ID
  kind: ContainerKind;
  name: string;                        // RTSTRUCT StructureSetLabel / SEG SeriesDescription / SR measurement-report title
  members: Member[];                   // ordered; default order = ROI Number / Segment Number
  sourceIdentity: SourceIdentity | null; // null until first save (per H8)
  approval: ApprovalState;             // persistent; see 2.6
  dirty: boolean;                      // see 2.7
  saveInFlight: boolean;               // for queue-next-save (E2)
  versionToken: VersionToken | null;   // opaque, from transport (H2)
  parseError: ParseError | null;       // for D7.9 error states
}
```

Measurement containers carry the `Container` shape with `kind: 'SR'`; each member is one measurement (Length, Angle, ROI, etc.) authored by the corresponding Cornerstone tool and serialized into a DICOM-SR measurement report (TID 1500). Point/fiducial markers (the former "POI" concept) are deferred — a point is treatable as a future measurement subtype and is out of scope per requirements F.

### 2.2 Member shape

```typescript
interface Member {
  id: string;                          // session-local unique ID
  name: string;                        // RTROIObservationLabel / SegmentLabel
  color: RGB;                          // [r, g, b], 0-255
  visibility: VisibilityMode;          // 'hidden' | 'outlined' | 'filled' (per D7.3)
  locked: boolean;                     // session-only lock (per C5)
  provenance: Provenance;              // per D7.2
  geometry: MemberGeometry;            // kind-specific; see below

  // RTSTRUCT-only:
  // (no roiType field — RTROIInterpretedType is not tracked; removed per review, D7.2)
  roiNumber: number | null;            // for default ordering and DICOM round-trip
  interpolationState: 'none' | 'has-interpolated' | null;  // per B5

  // SEG-only:
  segmentIndex: number | null;
  segmentDescription: string | null;
  segmentedPropertyCategory: CodedConcept | null;
  segmentedPropertyType: CodedConcept | null;

  // SR / Measurement-only:
  measurementType: MeasurementToolType | null;  // 'Length' | 'Angle' | 'Bidirectional' | 'EllipticalROI' | 'RectangleROI' | 'CircleROI' | 'Probe' | 'ArrowAnnotate'
  measuredValue: { value: number; unit: string } | null;  // display cache, e.g. { value: 42.3, unit: 'mm' }; Cornerstone recomputes from geometry
  measurementImageId: string | null;            // the referencedImageId / frame the measurement was taken on

  // ROI Algebra reserved (1.6 forward-compat) — null in v1 always:
  algebra: AlgebraExpression | null;   // null = manual; non-null = derived
  algebraSources: string[] | null;     // member IDs this expression depends on
  algebraOutOfDate: boolean;           // true if a source has changed since last evaluation
  algebraManualOverride: boolean;      // true if a derived ROI has been manually edited

  // Cornerstone bridge fields (mirror of Cornerstone state, never authoritative):
  csAnnotationUIDs: string[] | null;   // for RTSTRUCT contours — UIDs in Cornerstone annotation state
  csSegmentationId: string | null;     // for SEG segments — Cornerstone segmentation ID

  createdAt: number;                   // session timestamp
  modifiedAt: number;                  // session timestamp
}

type Provenance =
  | 'manual'
  | 'interpolated'
  | 'imported'
  | 'auto-segmented'    // future
  | 'algebra'            // future
  | 'deformably-mapped'; // future
```

`MemberGeometry` is `kind`-specific:

- **RTSTRUCT contour**: not stored on the Member — Cornerstone owns the geometry via `csAnnotationUIDs`. The Member is a metadata wrapper.
- **SEG segment**: not stored on the Member — Cornerstone owns the labelmap via `csSegmentationId`. The Member is a metadata wrapper.
- **SR measurement**: not stored on the Member — Cornerstone owns the measurement annotation geometry via `csAnnotationUIDs`, exactly like an RTSTRUCT contour. The Member is a metadata wrapper carrying the cached `measuredValue` for list display; Cornerstone stays authoritative for the geometry the value derives from.

### 2.3 Source identity (matches H2 contract)

```typescript
interface SourceIdentity {
  uri: string;                         // opaque to multi-viewport layer
  modality: 'RTSTRUCT' | 'SEG' | 'SR';
  referencedSeriesUIDs: string[];      // RTSTRUCT ReferencedFrameOfReferenceSequence series / SEG ReferencedSeriesSequence
  referencedFrameOfReferenceUID: string;
  loadedAt: number;
}

type VersionToken = string;            // opaque
```

### 2.4 Active-state model

```typescript
interface ActiveState {
  activeMemberId: string | null;       // single global; null = nothing to draw into (B3, A6)
  // activeContainerId is implicit: containers.find(c => c.members.some(m => m.id === activeMemberId))?.id

  selectionSet: Set<string>;           // multi-select; member IDs (per A11, D7.5)

  activeViewportId: string | null;     // edit target (A7); null = no panel focused
  activeToolId: ToolId | null;         // single global (A6)

  hoverMemberId: string | null;        // transient; for D2 hover sync
}
```

Setting `activeMemberId` implicitly sets the active container. The "active container" is never stored separately — a derived selector reads it from the member. This eliminates the entire class of bugs where two state fields could diverge.

### 2.5 Visibility model

Per-member visibility is one of three states (per D7.3): `hidden`, `outlined`, `filled`. Per-viewport visibility overrides (per A5) are layered on top — they can hide a structure on a single viewport but cannot change its mode.

```typescript
interface PerViewportVisibility {
  // viewportId → set of memberIds hidden on that viewport
  // session-only; reset when a viewport is closed (per A5)
  overrides: Map<string, Set<string>>;
}
```

The effective rendering for `(viewport V, member M)` is:
1. If `M` is in `overrides[V]` → not rendered.
2. Else `M.visibility` → renders accordingly.

### 2.6 Approval state (persistent, per D7.11)

```typescript
interface ApprovalState {
  approved: boolean;
  reviewerName: string | null;         // DICOM ReviewerName, if available
  reviewedAt: number | null;           // DICOM ReviewDate + ReviewTime → timestamp
  history: ApprovalEvent[];            // session-only audit trail; not all persisted to DICOM
}

interface ApprovalEvent {
  action: 'approve' | 'revoke';
  by: string | null;
  at: number;
}
```

DICOM mapping: `ApprovalStatus (300E,0002)`. RTSTRUCT and SEG both expose this via the General Series module. When set to `APPROVED`, the entire container is edit-locked. `UNAPPROVED` is the default. `REJECTED` exists in DICOM but is not used by this app.

### 2.7 Dirty / undo / redo state shape

Dirty is a single boolean per container (2.1). Undo/redo is per-container (per A8):

```typescript
interface ContainerHistory {
  containerId: string;
  undoStack: HistoryEntry[];           // ≥ 100 entries; oldest dropped on overflow (A8)
  redoStack: HistoryEntry[];
}

interface HistoryEntry {
  description: string;                 // user-readable, e.g., "Brush stroke on PTV slice 42"
  apply: () => void;                   // invoked on redo
  invert: () => void;                  // invoked on undo
  scopeMemberIds: string[];            // for invalidation when container is reloaded externally
}
```

Save is **not** an undo barrier (A8). External reload clears the affected container's history.

**Storage strategy (binding).** `apply`/`invert` must be expressed in **viewport-independent** terms — they operate on the container's Cornerstone state (segmentation labelmap, annotation geometry, keyed by `segmentationId` / annotation UID / FoR) and re-resolve target viewports at invoke time. They must **never** capture a viewport, rendering-engine, or DOM-element handle, or undo will dangle once that panel is closed — the exact failure acceptance signal 7 / G7 guards against. For voxel edits, a `HistoryEntry` stores a **bounded delta** (the changed-voxel region as a sparse patch), not a full-volume snapshot: ≥100 full snapshots of a 300-slice multi-segment SEG is not viable within the D8 memory/perf envelope. Contour and measurement edits store prior + next geometry for the affected member(s).

### 2.8 Container-level forward-compat for ROI Algebra

The `algebra*` fields on `Member` are present and serialize correctly even when always-null in v1. This means **in-session / session-serialization** round-trip preserves them — **not** DICOM save/load, which does not carry the derivation expression in v1 (per requirements D7.1). A DICOM save→load cycle legitimately drops these fields; they are reconstructed as null on load. This is the §0.6 "no partial implementations" rule applied to forward compatibility — fields are reserved, no UI exists, no evaluation runs.

---

## 3. State architecture

Where state lives, who owns what, and how data flows.

### 3.1 Cornerstone-authoritative state
- **Image data** (volumes, stack image lists, metadata).
- **Viewport state** (camera, slice index, W/L, zoom, pan).
- **Annotation state** (contour polygons, points, plane equations) — accessed via `cornerstoneTools.annotation.state`.
- **Segmentation representations** (labelmap voxels, contour-segmentation indexing) — accessed via `cornerstoneTools.segmentation`.
- **Tool state** (active tool, tool group membership, tool bindings).

App-layer reads but **never** mutates these directly except through Cornerstone APIs. Direct mutation of Cornerstone internal state is forbidden.

### 3.2 Zustand-authoritative state
- **`viewerStore`** — panel layout, active panel, layout preset, scan→panel mapping.
- **`segmentationStore`** — container summaries (Member shape from §2.2), per-viewport visibility overrides, dirty flags, approval state, undo histories.
- **`annotationStore`** — **render-bridge only**: the Cornerstone annotation-UID ↔ member mapping and interpolation flags for RTSTRUCT/SR members. It is *not* an authoritative store of member metadata — `segmentationStore` owns the `Member` model for **every** container kind (§2.2). `annotationStore` holds only the transient Cornerstone-UID bridge, so the two never carry divergent copies of name/color/visibility (per §0.1, §2.4).
- **`preferencesStore`** — user preferences (autosave debounce, hover scroll-to behavior, default visibility mode).
- **`segmentationManagerStore`** — cross-panel segmentation attachment state.
- **`metadataStore`** — DICOM metadata cache.
- **`sessionDerivedIndexStore`** — derived per-session indices. (Currently reaches into Cornerstone `metaData`/`wadouri`/`rtStructService` directly — a §0.3 violation; the derivation moves into a service per the architecture doc's migration map.)
- **`connectionStore`** — XNAT session.
- **`dialogStore`** — modal/dialog state.
- **`transportStore`** — version tokens, save-in-flight flags, and transient/permanent transport-failure indicators per container (§3.4). Reads H5/H6 events; feeds D7 list-panel row state.

These are the **only** sources of UI-reactive state. Components never derive state from Cornerstone events directly.

### 3.3 Sync rules

- **Cornerstone → Zustand**: services subscribe to Cornerstone events (`SEGMENTATION_DATA_MODIFIED`, `ANNOTATION_ADDED`, etc.) and push lightweight summaries to stores. The summary is a derived view, not a copy of geometry.
- **Component → Service → Cornerstone**: components call service methods; services translate to Cornerstone API calls; Cornerstone emits events; the loop closes via Cornerstone → Zustand.
- **Component → Zustand (direct)**: only for pure UI state with no Cornerstone equivalent (selection set, hover, expand/collapse, scroll, dialog open).

### 3.4 New stores or store changes

| Store | Change |
|---|---|
| `segmentationStore` | Extend `Member` shape per §2.2 (add `roiType`, `provenance`, `visibility` mode, `algebra*` reserved fields, `csAnnotationUIDs`/`csSegmentationId` bridge fields). Migrate existing single-bool `visible` to `visibility: VisibilityMode`. |
| `segmentationStore` | Add `approval` state per container. Replace any per-segment `locked` semantic that doubles as approval. |
| `segmentationStore` | Add per-container `undoStack` and `redoStack`. Move undo logic out of `segmentationService.ts` into a dedicated `undoService.ts` reading/writing this store. |
| `viewerStore` | Add `activeMemberId` (replaces any current "active segment" / "active structure" pattern); make active container derived. |
| `viewerStore` | Add `selectionSet` (Set of member IDs). |
| `viewerStore` | Add `perViewportVisibilityOverrides` map; clear on viewport close (per A5). |
| `viewerStore` | Add the remaining `ActiveState` fields from §2.4: `activeViewportId` (edit target, A7), `activeToolId` (single global, A6), `hoverMemberId` (transient, D2). These live here alongside `activeMemberId`/`selectionSet` so there is a single home for the active-state model. |
| New: `transportStore` | Holds version tokens, save-in-flight flags, transient-failure indicators per container. Reads from H5/H6 events, exposes to D7 list panel rows. |
| `preferencesStore` | Add `autosaveEnabled` (default `true`), `autosaveDebounceMs` (default 3000), `defaultRTSTRUCTVisibility` ('outlined'), `defaultSEGVisibility` ('filled'), `crossSeriesRenderingDefault` ('on' for in-exam siblings, 'off' for breath-hold per A2c). Both `autosaveEnabled` and `autosaveDebounceMs` are user-configurable. **Autosave is silent** — no banner / toast notification. State is surfaced in-place on the affected container row in the list panel (per D7.4 dirty marker, plus a transient "saving" indicator while a save is in flight). Reserve banner / dialog UX for blocking conditions only (auth expired, conflict requiring user choice). |

---

## 4. Service architecture

### 4.1 Existing services and their fate

| Service | Lines | Fate |
|---|---|---|
| [`viewportService.ts`](../src/renderer/lib/cornerstone/viewportService.ts) | — | **Refactor**. Default to volume viewports (1.1). Add volume sharing by `(scanId, FoR)` (1.5). Stack creation reserved for non-volumetric data. |
| [`toolService.ts`](../src/renderer/lib/cornerstone/toolService.ts) | 1047 | **Refactor by extraction**. Single primary tool group (1.3). `CrosshairsTool` added. Decompose into `toolService/registration.ts`, `toolService/activation.ts`, `toolService/lifecycle.ts`. |
| [`mprService.ts`](../src/renderer/lib/cornerstone/mprService.ts) | — | **Delete**. Functionality folds into `viewportService` once volume default lands. |
| [`mprToolService.ts`](../src/renderer/lib/cornerstone/mprToolService.ts) | — | **Delete**. |
| [`segmentationService.ts`](../src/renderer/lib/cornerstone/segmentationService.ts) | 5614 | **Refactor by extraction** into the existing `segmentationService/` subfolder. Target ≤ 1000 lines for the orchestrator file. New submodules: `segmentationService/transport.ts` (H contract), `segmentationService/undo.ts` (history), `segmentationService/visibility.ts` (the 3-state mode), `segmentationService/approval.ts` (D7.11), `segmentationService/lifecycle.ts` (load/parse/attach). |
| [`annotationService.ts`](../src/renderer/lib/cornerstone/annotationService.ts) | 214 | **Keep as-is** — already focused. Extend with provenance stamping on annotation create. |
| [`crosshairSyncService.ts`](../src/renderer/lib/cornerstone/crosshairSyncService.ts) | — | **Keep**. Becomes universal once mprToolService is gone. |
| [`SegmentationManager`](../src/renderer/lib/segmentation/SegmentationManager.ts) | — | **Refactor lightly**. Cross-panel attachment logic stays; reconciliation simplifies (single tool group, single viewport type). |
| [`interpolationAcceptance.ts`](../src/renderer/lib/cornerstone/interpolationAcceptance.ts) | — | **Delete** — promote-before-save model is removed (requirement B5). Auto-accept everywhere. |
| [`SafePaintFillTool.ts`](../src/renderer/lib/cornerstone/tools/SafePaintFillTool.ts) | — | **Audit and likely retire**. Phase 5 task: confirm whether the Cornerstone bug or limitation that motivated this wrapper still exists in current PolySeg/Cornerstone version. The audit must verify stock `PaintFillTool` against **requirements C3's full behavior** — preview-while-computing, commit-on-release, cancel-discards — not merely that flood-fill produces correct voxels. If stock can't meet C3, the wrapper stays. If it can, replace with stock `PaintFillTool`. Whichever way it lands, document the decision (and any retained bug workaround) at the top of the file. |
| [`contourRepresentation.ts`](../src/renderer/lib/cornerstone/contourRepresentation.ts) | — | **Keep**. Contour-segmentation indexing stays; PolySeg consumes it. |

### 4.2 New services

| Service | Purpose |
|---|---|
| `containerService.ts` | Container CRUD: create new RTSTRUCT/SEG/SR, add/remove/rename members, recolor, manage approval state. Single entry point for "active member" / "active container" resolution. |
| `undoService.ts` | Per-container undo stack management; HistoryEntry creation by domain code; integrates with the queue-next-save model so saves don't barrier. |
| `transportContractService.ts` | The H1–H10 contract surface to the XNAT integration workstream. Emits dirty events, exposes serialize, ingests version tokens, surfaces save outcomes. The XNAT-specific transport plugs in via this interface. |
| `viewportLayoutService.ts` | Layout presets (1×1, 2×2, MPR-2×2, custom). Replaces the `MPRViewportGrid` ↔ `ViewportGrid` switch with a layout-preset selector on a single grid. |

### 4.3 Hotkey service (extending what exists)

[`hotkeyService.ts`](../src/renderer/lib/hotkeys/hotkeyService.ts) and [`defaultHotkeyMap.ts`](../src/renderer/lib/hotkeys/defaultHotkeyMap.ts) handle all keyboard input. Existing `edit.copy` / `edit.paste` / `edit.undo` / `edit.redo` / `edit.delete` mappings stay. Per requirement D5, "global state" shortcuts (active member, active tool, undo/redo, save) are not panel-scoped — they apply to the active container.

New mappings:
- `container.save` (Cmd-S / Ctrl-S) → save active container.
- `container.saveAll` (Cmd-Shift-S) → save all dirty containers.
- `member.activate` (no default; user-configurable) → make selected member active.
- `selection.clear` (Esc) → clear selection set.

---

## 5. Cornerstone integration

Concrete rules for staying within Cornerstone's published surface.

### 5.1 Tools

Tools registered in the primary tool group (per [toolService.ts:574-605](../src/renderer/lib/cornerstone/toolService.ts:574)):

| Category | Tools (Cornerstone names) |
|---|---|
| Navigation | `WindowLevelTool`, `PanTool`, `ZoomTool`, `StackScrollTool`, `CrosshairsTool` |
| Measurement | `LengthTool`, `AngleTool`, `BidirectionalTool`, `EllipticalROITool`, `RectangleROITool`, `CircleROITool`, `ProbeTool`, `ArrowAnnotateTool` |
| Contour drawing | `PlanarFreehandROITool`, `PlanarFreehandContourSegmentationTool`, `SplineContourSegmentationTool`, `LivewireContourSegmentationTool` |
| Voxel painting | `BrushTool` (with 2D circle, 3D sphere, eraser, threshold modes), `PaintFillTool` (replacing `SafePaintFillTool` if Phase 5 audit clears it), `LabelMapEditWithContourTool` (Contour Fill, fixed in Phase 5) |
| Region | `RegionSegmentTool`, `RegionSegmentPlusTool`, `RectangleROIThresholdTool`, `CircleROIStartEndThresholdTool` |
| Cut | `CircleScissorsTool`, `RectangleScissorsTool`, `SphereScissorsTool` |
| Modify | `SculptorTool` |
| Select / measure | `SegmentSelectTool`, `SegmentBidirectionalTool` |

### 5.2 PolySeg integration

Already initialized at [init.ts:61](../src/renderer/lib/cornerstone/init.ts:61):

```typescript
import * as polySeg from '@cornerstonejs/polymorphic-segmentation';
// ...
cornerstoneTools.init({ addons: { polySeg } });
```

No further integration code required — Cornerstone's `contourDisplay` ([contourDisplay.js:54-95](../node_modules/@cornerstonejs/tools/dist/esm/tools/displayTools/Contour/contourDisplay.js)) consumes PolySeg automatically when contour segmentations are rendered on viewports whose orientation differs from the contour's authoring plane.

**Phase 0 validation**: render an axial-authored contour on sagittal MPR; render a sagittal-authored contour on axial MPR; render contours on a cross-FoR-but-same-orientation viewport. If any fail, file an upstream issue, pin to a working version, or work around in `segmentationService/visibility.ts`.

### 5.3 Tool group: one primary group, no secondary

`MPR_TOOL_GROUP_ID` is removed when `mprToolService` is deleted. All viewports are added to `xnatToolGroup_primary` ([toolService.ts:73](../src/renderer/lib/cornerstone/toolService.ts:73)).

### 5.4 Volume sharing implementation

`viewportService.createViewport()` accepts `(scanId, FrameOfReferenceUID)` and returns a panel handle. Internally it computes a `volumeId` from the pair (e.g., `cornerstoneStreamingImageVolume:${scanId}:${FoR}`) and either reuses an existing `ImageVolume` or creates a new one via `volumeLoader.createAndCacheVolume`. The `volumeService` already exists; extend it with reference-counting so a volume is cached as long as ≥1 viewport is using it, and released when the last viewport closes.

### 5.5 Measurement (SR) rendering on MPR (accepted limitation)
Length, Angle, Bidirectional, ROI, and freehand measurement annotations — the members of an `SR` measurement container (§2.1) — are not segmentation-bound and do not flow through PolySeg's surface-clip path. They render only on viewports whose slice plane is parallel to the annotation's authoring plane (per Cornerstone's [filterAnnotationsWithinSlice](../node_modules/@cornerstonejs/tools/dist/esm/utilities/planar/filterAnnotationsWithinSlice.js), `EPSILON = 1e-3` → ~2.56° tolerance).

**Decision**: accept the limitation. A length drawn on axial does not appear on sagittal. This matches Eclipse, MIM, and RayStation behavior — measurements are intrinsically tied to their authoring plane and showing them on perpendicular reformats as 1D points is more confusing than useful. We do not widen `EPSILON`, do not wrap measurements in a custom segmentation, and do not ship a 3D pin/marker indicator in v1.

**Future enhancement** (not committed): a lightweight 3D pin indicator on intersecting planes is a possible v2 polish if users push back. The data shape (annotation `metadata.viewPlaneNormal`, world point) is already sufficient.

### 5.6 Things we explicitly do not do

- **Do not subclass Cornerstone tools** unless we can name the specific bug being worked around. Each such subclass (currently only `SafePaintFillTool`) must justify itself in a top-of-file comment or be retired.
- **Do not monkey-patch Cornerstone internals**. If a needed capability is missing, we file upstream or wrap at our service boundary, not by mutating Cornerstone's prototype.
- **Do not maintain a parallel annotation store** in Zustand. Cornerstone's annotation state is authoritative; our stores hold lightweight summaries only.
- **Do not bypass the tool group** for tool activation. `cornerstoneTools.ToolGroupManager.getToolGroup(...).setToolActive(...)` is the only entry point.
- **Do not maintain custom hit-testing**. Click-to-select uses Cornerstone's built-in annotation tools' selection events.

### 5.7 Where custom code remains, with justification

| Custom code | Reason it stays |
|---|---|
| `contourRepresentation.ts` | Domain-specific indexing of contour-annotation UIDs by segment for fast lookup; not a Cornerstone replacement. |
| `crosshairSyncService.ts` | App-layer policy for which panels sync with which (based on `(scanId, FoR)`); Cornerstone provides the primitive but not the policy. |
| `SegmentationManager.ts` | Cross-panel attachment policy; Cornerstone provides per-viewport attach but not the multi-panel reconciliation. |
| `viewportReadyService.ts` | Epoch-based readiness gating to avoid stale attachments during rapid layout churn (A12); Cornerstone has no equivalent. |
| `SafePaintFillTool.ts` | **Audit Phase 5.** Either retire or document the specific Cornerstone limitation. |

---

## 6. Forward-compatibility hooks (no v1 functionality)

These exist as null/empty schema so v2 work doesn't break anything.

| Feature | v1 hook | v2 work |
|---|---|---|
| ROI Algebra | `Member.algebra*` fields, always null. Serialize round-trip. | UI for expression building; live re-evaluation; out-of-date indicator. |
| Point / fiducial markers | `kind: 'SR'` measurement container can hold point-type members; recognized but no dedicated marker UX in v1. | Point manipulation tools, isocenter logic, fiducial workflows. |
| Auto-segmentation | `Provenance` enum includes `auto-segmented`. | Model selection, async execution, draft-review flow. |
| Deformable registration | `Provenance` enum includes `deformably-mapped`; `SourceIdentity` carries a `referencedFrameOfReferenceUID`. | DICOM SRO ingestion; transform application. |
| Structure templates | None — the data shape is sufficient. | UI for template selection; Member preset application. |

---

## 7. Implementation phasing

Six phases. Each lands as a series of small PRs. Each ships behind a feature flag where it changes user-visible behavior. **No phase begins until the previous one's per-phase gate (§8.0) is met** — its signals green as functional tests (each shown red→green), all previously-green signals still green, and a manual visual checkpoint done in the real app with proof attached to the PR. The §8.0 "Test discipline (binding)" rules govern every phase below.

### Phase 0 — Preparation
**Goal**: foundation; no user-visible behavior change.

- Validate PolySeg `^4.16.1` against open issues #1288 / #1837 / #1188. Pin to a known-good version. Document outcome in [PHASES.md](../PHASES.md).
- Land the data model types (§2) in `src/renderer/types/annotation.ts`. Wire into existing stores as **additions** — no deletion of fields yet.
- **Land the layering contract + enforcement** ([architecture doc](multiviewport-annotation-architecture.md) §2): add ESLint `no-restricted-imports` boundary zones (stores ⊬ services/Cornerstone; components ⊬ Cornerstone/services; services ⊬ React/components/hooks) to the existing `lint` script and `ci.yml`; quarantine current violations as tracked `BOUNDARY-DEBT` disables. New annotation code is clean from day one.
- Add `transportStore` skeleton (§3.4); empty surface, no consumers.
- Decompose `segmentationService.ts` by extracting the four planned submodules with no logic changes — pure refactor, lines move.
- Decompose `toolService.ts` similarly.
- Add `containerService.ts` skeleton (no consumers yet) with the planned method shape.
- Add `undoService.ts` skeleton.
- Add `viewportLayoutService.ts` skeleton.
- Add feature flag `multiviewport.enabled` (default `false`) gating Phase 1+ behavior.
- **Build the test harness up front (binding — §8.0):**
  - Create the `e2e/fixtures/` DICOM datasets (§8.4), including the intensity-varied `ct-axial-anatomy`. **Fixtures are a Phase 0 exit gate** — the functional tests cannot exist without them.
  - Author all **37 acceptance signals as failing E2E tests** (the full suite, red), so feature work becomes "turn 37 red tests green."
  - **Walking skeleton:** drive one signal fully green through the real stack (real Electron renderer + real Cornerstone + a real fixture) to prove the harness exercises the app and catches a real break.
- **Produce the fully-specified UI mockup (§8.8)** — every list-panel / side-panel state — agreed as the visual acceptance reference before any Phase 3 UI work.
- Tests: type round-trip (Member, Container, SourceIdentity); skeleton tests for new services; plus the 24-signal suite authored red.

**Acceptance**: app builds, runs, looks identical. All existing tests pass. New types compile. The 37 acceptance signals exist as (red) E2E tests; the walking-skeleton signal is green; the fixture set and the UI mockup are in place.

### Phase 1 — Viewport unification
**Goal**: volume default; one tool group; MPR mode consolidated.

- `viewportService.createViewport()`: default to `ORTHOGRAPHIC` per 1.1, with stack-eligibility predicate (single-frame DX/CR, multi-frame US cine).
- Implement `(scanId, FoR)` volume sharing per 1.5; reference-counted volume cache in `volumeService`.
- Collapse `OrientedViewport` and `CornerstoneViewport` into a single `Viewport` component.
- Delete `MPRViewportGrid`, `MPRViewport`, `mprService`, `mprToolService`. Add MPR layout preset to `viewportLayoutService`.
- Move `CrosshairsTool` into the primary tool group.
- Behind `multiviewport.enabled`: the new path. Behind `!multiviewport.enabled`: old path remains so we can A/B during validation.
- Tests: acceptance signals 3 (brush on stack visible on MPR), 6 (rapid layout switch survives), G7 (undo from closed panel). Performance: 4-panel CT load ≤ baseline + 30% (volume mode is heavier; this caps the regression).

**Acceptance**: signals 3, 6, 7 pass with `multiviewport.enabled=true`. Signal 1 (axial draw → sagittal/coronal live update) starts working as a side effect of PolySeg + volume default.

### Phase 2 — Annotation behavior
**Goal**: cross-series rendering, single source of truth, undo, dirty/save.

- Implement A2a/b/c/d FoR-eligibility logic in `segmentationService/visibility.ts`.
- Implement non-native rendering style (D9: dashed stroke, hatch fill) — Cornerstone's `ContourSegmentationTool` styling hooks.
- Implement A2c heuristic per requirements A2c — **default to show (A2b) when uncertain.** Same FoR + same `AcquisitionNumber` → A2b (on-by-default with non-native visual flag). Same FoR + different `AcquisitionNumber` is only a *candidate* for A2c (off-by-default); it flips to A2c **only** when corroborated by a bulk-anatomy displacement check (a large rigid offset between the two series' image content). `AcquisitionNumber` difference **alone is not sufficient to hide** — this keeps the T1/T2 same-exam case (signal 9) rendering by default, since sibling MR sequences routinely carry different `AcquisitionNumber`s. The user toggle (D11) is the safety net in both directions.
- Wire `undoService` per-container; replace existing scattered undo logic. HistoryEntry creation in each domain operation.
- Implement queue-next-save in `segmentationService/transport.ts` per E2. Single `dirty` boolean per container; auto-save debounce in `preferencesStore`.
- Drawing routing per B3: block on no-FoR-match, block on non-native viewport, hint-on-attempt.
- Tests: signals 1, 2, 8, 9, 10, 11, 14, 15, 23 (contour copy/paste — voxel-region paste re-verified in Phase 5), **28 (undo/redo state machine, A8)**, **34 (drag/gesture continuity, D4/A7)**, **36 (A2c auto-classification)**. Signal 12's drawing-block **logic** is covered here at the service-integration layer; its full E2E run lands in Phase 3, which is where the list panel first lets a user set the active container (see note below).

**Acceptance**: T1/T2 case (signal 9), breath-hold case (signal 10), different-FoR case (signal 11), queue-next-save (signal 14), undo-past-save (signal 15) all pass. The drawing-block logic (signal 12) passes at the service-integration layer; full E2E signal 12 is gated on the Phase 3 list panel.

> **Phase dependency note**: drawing routing (B3) targets the *active container*, but the only user affordance to set the active member/container is the list panel (D7.5), which ships in Phase 3. Phase 2 therefore exercises routing/blocking through `containerService` at the service layer (not via UI), and the UI-driven acceptance of signal 12 runs in Phase 3.

### Phase 3 — List panel
**Goal**: D7 fully realized.

- Hierarchy with container + member rows; expand/collapse.
- Per-row metadata: provenance indicator, visibility mode (3-state), lock, active, selection, cross-series, different-FoR, interpolated, empty markers. (No ROI-type badge — removed per review; `RTROIInterpretedType` is preserved on round-trip but not surfaced/edited, per D7.2.)
- Container-level: dirty marker, approval indicator, add-member button (disabled when approved), save/revert/export actions.
- Selection model: single-click selects, double-click activates, multi-select via shift/ctrl. Multi-select bulk operations.
- Load-order list + drag-reorder (no filter / search / sort / "Active only" — all removed per review, D7.7).
- Hover sync with viewports (D7.8).
- Empty / loading / parse-error states (D7.9).
- Approval workflow: approve, revoke (with confirmation), persist via DICOM `ApprovalStatus`. Audit history in session.
- Session-level actions (D7.6): create new structure-set / SEG / SR (measurement); save all. (Loading is **automatic** on XNAT-Browser scan selection — transport B5 — not a panel action; there is no manual "load from XNAT" affordance.)
- Tests: signals 4, 5, 8, 12 (full E2E — active-container selection now exists), 17, 19, 20, 22, **25 (auto-load + navigate lifecycle, A13)**, **26 (session-switch + unsaved retention, A13)**, **27 (conflict + save-failure workflow, E3/H5–H7)**, **31 (list-panel actions)**, **32 (measurement-SR container)**, **33 (selection model)**, **35 (tool affordance + keyboard scoping)**. (Signal 18 retired — ROI type not tracked.) Signals 25–26 depend on the transport auto-load (B5) and the session-scoped panel; signal 27 depends on the §H result/conflict semantics (the transport-workstream blockers C7/D3).

**Acceptance**: signals 19 (approval persistence), 20 (visibility mode), 22 (provenance round-trip) pass. (Signal 18 retired per review.)

### Phase 4 — Interpolation cleanup
**Goal**: write-through model per B5.

- Delete `interpolationAcceptance.ts`. Auto-accept on completion, always.
- Provenance stamping: interpolated contours marked `provenance: 'interpolated'`. Manual edit on an interpolated contour clears the marker (sets `provenance: 'manual'`).
- Interpolated marker on member rows fades after manual edit or save.
- Inter-slice interpolation = single undo entry per operation (covering all generated contours).
- "Step through interpolated slices" review affordance (optional per B5; nice-to-have).
- Tests: signal 13 (write-through round-trip).

**Acceptance**: signal 13 passes. The promote-before-save UI is gone.

### Phase 5 — Tool audit and Contour Fill fix
**Goal**: maximize Cornerstone-stock usage; fix broken tools.

- Audit `SafePaintFillTool` against current Cornerstone version. If the original bug is fixed, swap to stock `PaintFillTool` and delete the wrapper. If not, document the specific bug at the top of `SafePaintFillTool.ts`.
- Fix `LabelMapEditWithContourTool` ("Contour Fill") — currently broken per user. Investigate failure mode, file upstream issue if Cornerstone-side, work around at app boundary if app-side.
- Verify smart-brush tools (`RegionSegmentTool`, `RegionSegmentPlusTool`) work end-to-end with the new container model.
- Verify `Sculptor` works on contour-segmentation members.
- Performance verification: 4-panel CT (~300 slices) with 20 ROIs + 1 multi-segment SEG sustained ≥ 30 fps during edits (D8). Layout changes ≤ 250 ms. Measure on representative hardware.
- Tests: signal 16 (paint-fill on MPR + undo); signal 21 (smart brush respects lock); signal 24 (oblique-SEG round-trip + 3D brush continuity); signal 23 voxel-region copy/paste portion.

**Acceptance**: signals 16, 21, **29 (voxel-tool roster)**, **30 (Contour Fill fix — was broken)**, **37 (performance budget, D8)** pass. Performance baselines documented.

### Phase 6 — Flag removal and cleanup
**Goal**: delete the old code paths.

- Remove `multiviewport.enabled` flag.
- Delete legacy code paths (the `!enabled` branches preserved during phases 1–5).
- Final pass: dead code, stale imports, redundant comments, type tightening.
- Documentation update: README, PHASES.md, and any user-facing docs.

**Acceptance**: a clean codebase with no flag remnants.

---

## 8. Test strategy

### 8.0 Test discipline (binding — read first)

The prior attempt failed in a specific way: **tests were green while the running app was broken.** More tests of the same kind reproduce that. The rules below make it impossible. They are binding — a phase that violates them is not done regardless of what the test log says, and they supplement (do not replace) the CLAUDE.md "Spec-driven UI work" discipline.

1. **Red-before-green (test-the-test).** Every acceptance test must be *observed failing* against the pre-implementation or a deliberately-broken state before it counts as passing. A test that is green the moment it is written is testing nothing and must be fixed. The red run is captured in the PR. This is the direct antidote to "passed while broken."
2. **The 37 signals are authored as failing E2E tests in Phase 0.** The full acceptance suite exists — all red — before feature work begins. The rebuild is then "turn 37 red tests green, in dependency order." No phase may be declared done with one of its signals unaddressed; the signal *is* the contract (prose mirrors the test, not the reverse).
3. **Visual where the signal is visual.** Signals that say "renders / appears / shows / badge" get screenshot or pixel-diff assertions against the agreed mockup (§8.8). "The DOM node exists" never satisfies a visual signal.
4. **Build against a fully-specified mockup (§8.8).** Before any list-panel / side-panel UI, a complete visual mockup of every state is produced and agreed. It is the visual acceptance reference; pixel comparisons target it. Implementation matches the mockup; where mockup and prose disagree, reconcile before coding.
5. **No escape hatches (CI-enforced).** No committed `.skip` / `.only` / `xit` on acceptance tests — CI fails the build if present. No mocking of Cornerstone or internal services in the `e2e/` suite. No test-only data-path bypasses — drive the real affordance (pointer events), never call the store/service setter the UI would call. A flaky acceptance test is a tracked bug with a fix deadline, never silently disabled.
6. **Walking skeleton before scale.** The first thing built is one signal driven fully green through the real stack (real Electron renderer + real Cornerstone + a real DICOM fixture), proving the harness exercises the app and catches a real break — before the suite is trusted for 24.
7. **Vertical slices, not horizontal layers.** Every PR moves at least one signal end-to-end: data path → render → green functional test. "Foundational component, wiring follows" is forbidden — it is the exact shape of the prior failure (CLAUDE.md discipline §3, §5).
8. **Anti-regression.** Every previously-green signal re-runs on *every* subsequent PR, not just nightly. The green set only grows; a later phase cannot silently break an earlier signal.
9. **Per-phase gate.** A phase is done only when: all its mapped signals are green as functional tests (each shown red→green); all previously-green signals still pass; and a manual visual checkpoint was performed in the real app with proof (screen capture / screenshots) attached to the phase PR. No phase begins until the prior phase's gate is met.

### 8.1 Real end-to-end tests are the regression spine
Acceptance is verified by **real end-to-end tests, not mocks**. The 37 acceptance signals from requirements section G are the regression suite, and each one is exercised at the layer where the user touches it: real Electron renderer, real Cornerstone3D, real DICOM data, real annotation gestures, real stores, real persisted state. A test that mocks out Cornerstone, the rendering engine, the segmentation manager, or the transport contract proves nothing — it proves the mocks were satisfied.

This rule is binding on the test plan:

- **No mocking of Cornerstone3D** in acceptance tests. Cornerstone runs in the test browser the same way it runs in production.
- **No mocking of internal services** in acceptance tests. `viewportService`, `segmentationService`, `containerService`, `undoService`, `transportContractService` all execute their real logic.
- **No bypassing UI layers**. A "click contour to select" test clicks the contour with simulated pointer events; it does not call `setSelectedAnnotation` directly.
- **Real DICOM fixtures**. Acceptance tests load representative DICOM datasets from `e2e/fixtures/` — small but real CT/MR/SEG/RTSTRUCT files, not synthetic objects in memory.
- **The transport boundary is the only place a test double is acceptable**, and only for tests that don't require server interaction. Boundary tests against the real XNAT integration belong in the XNAT integration workstream's test plan; multi-viewport acceptance tests use a deterministic in-memory transport that satisfies the H contract exactly.

### 8.2 Test pyramid

| Layer | Runner | Scope | Mocking policy |
|---|---|---|---|
| **Unit** | Vitest ([vitest.config.ts](../vitest.config.ts)) | Pure-logic modules — type round-trip, FoR predicate, geometry utilities, undo-stack mechanics. | Mocks fine for module-internal collaborators where Cornerstone is not involved. |
| **Service-integration** | Vitest with real Cornerstone3D in JSDOM | Service-level flows — container lifecycle, segmentation attach/detach, transport-contract serialize/restore. | No mocking of Cornerstone. Transport mocked at the H contract surface only when network would otherwise be involved. |
| **End-to-end** | Playwright ([playwright.config.ts](../playwright.config.ts)) — Electron context | The 37 acceptance signals from requirements G. | **No mocking, period.** Real renderer, real Cornerstone, real DICOM fixtures, real gestures, real persistence to local file. Visual assertions where helpful (screenshots / pixel-diff snapshots). |

### 8.3 Acceptance signal → test layer mapping

The 37 acceptance signals are predominantly E2E. Specifically:

- **E2E (Playwright, Electron context, no mocks)**: signals 1–17, 19–36 (signal 18 retired). Signal 37 (performance budget) is a measured **benchmark**, not a pixel/behavior pass-fail.
- **Service-integration (Vitest, real Cornerstone)**: signal 7 (undo after viewport closed — best done at the service layer where viewport-mount/unmount can be deterministically scripted), the signal-12 drawing-block logic ahead of its Phase 3 UI, and as a fast-feedback sibling for signals that also have E2E coverage.

Every PR runs the full unit + service-integration suite. E2E runs on every PR for the signals the phase touches; the full E2E suite runs nightly and on `main` merge.

### 8.4 DICOM fixtures
A new directory `e2e/fixtures/` (created Phase 0) holds small but real DICOM datasets:

- `ct-axial-300/` — small axial CT, real DICOM. **Binary sphere phantom** (uniform intensity) — fine for geometry, rendering, and propagation signals, but **cannot** exercise intensity-aware tools.
- `ct-axial-anatomy/` — small axial CT with realistic, intensity-varied anatomy. **Required for signals 16 (intensity-bounded paint-fill) and 21 (smart-brush intensity tolerance)** — a binary phantom has no intensity gradient to grow against or threshold on.
- `mr-t1-t2-sameexam/` — paired T1 and T2 MR series sharing an FoR.
- `4dct-phases/` — 4D-CT with ≥ 3 phase bins, same FoR, different `TemporalPositionIndex`.
- `breath-hold-pair/` — two CT series sharing FoR with different `AcquisitionNumber`.
- `cross-for-ct-mr/` — CT + unregistered MR, different FoR.
- `rtstruct-typed/` — RTSTRUCT covering all `RTROIInterpretedType` values.
- `seg-multilabel/` — multi-segment SEG (≥ 5 segments).
- `cine-us/` — multi-frame US for stack-eligibility predicate testing.

Fixtures are anonymized real DICOM. They live under git LFS or as a separate fixture archive to keep the main repo light.

### 8.5 Manual QA matrix
E2E covers the headline behavior; manual QA covers UX polish, performance feel, and edge-case combinations the test suite cannot economically cover. Per phase, a 30–60 minute manual pass against the fixture datasets, recorded in `docs/qa/multiviewport-annotation-qa.md` (created Phase 0).

### 8.6 Performance baselines
Capture before Phase 1: cold-load time, warm-load time, render fps with 4 panels (instrumented via Playwright + browser performance API), layout-switch latency. Phase 1 must not regress > 30% on any metric. Phase 5 must hit the D8 budget exactly (≥ 30 fps with 4 panels editing). Performance assertions are part of the E2E suite — a regression that passes functional tests but misses the budget fails CI.

### 8.7 Why this matters
This codebase already has a feedback memory captured: *a test that bypasses the layer where the bug lives proves nothing; click the button, dispatch the event, check the pixels*. The same rule applies here at design scale. Mocked tests will let the regressions through that this multi-viewport rewrite specifically exists to prevent (cross-series rendering silently failing on stack viewports, MPR mode dropping annotations on layout switch, undo not surviving viewport close). Acceptance tests must exercise those exact code paths.

### 8.8 Visual mockup — the UI acceptance reference
Before any Annotations-side-panel / list-panel implementation (Rebuild Phase 3, and the side-panel shell wherever it first appears), a **fully-specified visual mockup** is produced and agreed. It covers every state:

- Container rows for each kind (RTSTRUCT / SEG / SR-measurement), collapsed and expanded.
- Member rows with every marker/badge combination: color swatch, name, ROI-type badge, provenance, 3-state visibility, lock, active, selection, cross-series, different-FoR, interpolated, empty.
- The three create buttons (Structure / Segmentation / Measurement) and the context-sensitive toolbox.
- Approval (approved container + member indicators), dirty / saving, conflict / transient-failure.
- Empty session, loading, and parse-error states (D7.9).
- Cross-series dimming and the "↗ N panels" pill (CLAUDE.md UI Architecture).

The mockup is stored under `docs/` (e.g. `docs/multiviewport-annotation-mockup.md`, or a static HTML / figure set it links to) and is the reference the visual (screenshot / pixel-diff) acceptance assertions compare against. Implementation matches the mockup; where mockup and prose disagree, reconcile **before** coding (CLAUDE.md discipline §6). It is a Phase 0 deliverable so it gates Phase 3 rather than being drawn alongside it.

---

## 9. Risk register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| PolySeg has a regression we hit | Medium | High | Phase 0 validation. Pin known-good version. File upstream + work around at service boundary. |
| Volume mode load latency unacceptable on large series | Medium | Medium | Reference-counted volume cache; progressive load; frame-first preview as fallback (open question §10). |
| Contour Fill bug is unfixable without subclassing | Low | Medium | If unfixable, document the subclass with the specific Cornerstone limitation per §0.2. |
| Stack→volume refactor breaks cine workflow | Low | Low | **CS3D `utilities.cine.playClip` supports volume viewports** — scroll-cine through slices *and* dynamic 4D cine (verified in `@cornerstonejs/tools/.../cine/playClip.js`). Cine is **preserved on volumetric series** via `playClip`, not lost. Stack mode is reserved only for genuinely non-volumetric cine loops (US/XA/RF). Use `cine.playClip`, not the legacy stack `setInterval`. |
| 5614-line `segmentationService.ts` decomposition introduces regressions | High | Medium | Phase 0 is pure extraction with no logic change. Tests run after each extraction. Revert any extraction that fails. |
| Approval state DICOM round-trip varies by SCU/SCP | Low | Medium | Test against XNAT round-trip in Phase 3. If `ApprovalStatus` is stripped, fall back to a private tag (documented). |
| Volume sharing introduces unexpected coupling | Low | High | Reference-counting is a well-known pattern. Lifecycle test: open/close/reopen panels and confirm cache hits + eventual release. |
| Undo refactor breaks user expectations | Low | High | Undo behavior matches the requirements A8 spec exactly. Test signals 7, 14, 15, 16. |
| Feature flag removal in Phase 6 reveals code that depended on the flag in unexpected places | Medium | Low | Grep for the flag name everywhere; the flag is a single boolean preference. |

---

## 10. Open questions

**None.** All design-phase questions are resolved and folded into the relevant section above.

Resolutions applied (recorded here for review trail):

| Question | Resolution | Where applied |
|---|---|---|
| Loose-annotation MPR (Length/Angle/etc. on orthogonal views) | **Accept the limitation.** Match commercial-tool behavior; no `EPSILON` widening, no PolySeg wrapper, no 3D pin in v1. | §5.5 |
| A2c heuristic | **Default to show (A2b) when uncertain**, per requirements A2c. Same `AcquisitionNumber` → A2b (on). Different `AcquisitionNumber` → A2b still, *unless* a bulk-anatomy displacement check corroborates a pose change, in which case A2c (off). `AcquisitionNumber` alone never hides. | §7 Phase 2 |
| MPR layout reference panel | **Dropped.** 4th slot is 3D volume rendering. Volume-default mode means axial reformat = source acquisition voxels, eliminating the QA-vs-stack rationale. | §1.3 |
| Cine + per-frame metadata in volume default | **Cine runs on volume viewports** via CS3D `cine.playClip` (scroll-cine + dynamic 4D) — confirmed supported. The stack-eligibility predicate (US/XA/RF, multi-frame-without-spatial-dim) only chooses viewport *type*; it does **not** gate cine availability. Per-frame metadata via `volumeViewport.getCurrentImageId()`. | §1.1 |
| Initial-load latency in volume default | **Cornerstone's `StreamingImageVolume`** (already in use). First paint comparable to stack mode; full volume completes in background. | §1.1 |
| Auto-save debounce period | **Default 3000 ms; on/off and period both user-configurable** via `preferencesStore`. **Silent UX** — no banner / toast; state surfaced in-place on container rows. | §3.4 |
| Slab / MIP rendering | **Kept out of scope** (requirements F). Separate workstream if pursued later. | §11 |

Implementation may surface new questions during phases 1–6; those are tracked as PR-time decisions, not design-blockers.

---

## 11. Out of scope (carried from requirements F)

- Transport / persistence to XNAT — separate workstream per [`annotation-xnat-integration-requirements.md`](annotation-xnat-integration-requirements.md). Interface is the H contract.
- Cross-FoR display via deformable registration. Rigid registration via DICOM SRO ingestion may be considered later; data model accommodates (provenance enum, source identity).
- Real-time collaborative multi-user editing.
- 3D volume-rendered editing as a primary interaction.
- Streaming partial loads of very large segs.
- ROI Algebra execution (data model reserves fields per §2.8).
- Point / fiducial (former "POI") detailed editing UX — a point is a future measurement subtype; the `SR` container type already accommodates it (§2.1).
- Slab / MIP / MinIP / Average projection rendering.
- Atlas / model-based / Deep-Learning auto-segmentation execution (provenance enum reserved).
- Structure templates.
- Plan, dose, DVH, beams.

---

## 12. Document maintenance

This design is the working spec. Amend in place when:
- A phase completes (mark in §7).
- An open question (§10) is resolved (move to the relevant section, leave a brief note in §10).
- A risk fires or is retired (update §9).
- Acceptance signals change (sync with requirements G).

Significant scope changes (new architectural pillar, new out-of-scope item) require an updated requirements doc first.
