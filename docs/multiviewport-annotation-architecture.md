# Multi-Viewport Annotation: Architecture & Migration

> **Status: ready for implementation.** Companion to [`multiviewport-annotation-design.md`](multiviewport-annotation-design.md). The design doc is authoritative for **behavior and data model**; this doc is authoritative for **structure** — the layering contract, enforced module boundaries, the current→target migration map, the component architecture, and the service public-API surface. It is a **Phase 0 deliverable**: the layering rules and their enforcement land before feature code.

---

## 1. Why this doc exists

The prior attempt produced hard-to-maintain code, and the symptoms are still in the tree:

- **God components.** [`SegmentationPanel.tsx`](../src/renderer/components/viewer/SegmentationPanel.tsx) is **2080 lines** and imports six services/singletons directly (`segmentationService`, `rtStructService`, `segmentationManager`, `backupService`, plus stores). `Toolbar.tsx` (772), `ViewportOverlay.tsx` (732), `ExportDropdown.tsx` (493) mix presentation with orchestration.
- **Stores acting as controllers.** [`viewerStore.ts`](../src/renderer/stores/viewerStore.ts) calls `toolService` / `viewportService` / `volumeService` / `mprToolService` (lines 487–707). `sessionDerivedIndexStore.ts` reaches into `@cornerstonejs/core` `metaData`, `wadouri`, and `rtStructService`. A store the UI subscribes to that also drives services **is** the entanglement we are trying to remove.
- **Cornerstone leaking into the UI.** 8 source components import `@cornerstonejs` directly.
- **No enforced boundary.** A `lint` script and `.github/workflows/ci.yml` exist, but there are no import-restriction rules — the layering is a prose principle nothing prevents from drifting, and it has.

The design doc specifies the target data model and services but not how this entanglement is dismantled or how the UI stays decoupled. This doc fills that gap. The goal, stated plainly: **a clean architecture where the UI is not entangled with the underlying services — enforced, not just intended.**

---

## 2. The layering contract (binding + enforced)

### 2.1 Layers and the dependency rule

Five layers. **Dependencies point strictly downward; there are no cycles.**

```
┌─────────────────────────────────────────────────────────────┐
│ Components (React, presentational)                           │
│   read store selectors via hooks · dispatch via hook callbacks│
└───────────────┬─────────────────────────────────────────────┘
                │ may import ↓
┌───────────────▼─────────────────────────────────────────────┐
│ Hooks (the UI ↔ state/service seam)                          │
│   the ONLY layer that both reads stores and calls services    │
└───────┬─────────────────────────────────┬───────────────────┘
        │ may import ↓                     │ may import ↓
┌───────▼────────────────┐      ┌──────────▼───────────────────┐
│ Services               │ ───▶ │ Stores (PURE reactive state)  │
│ orchestration; own all │ write│ state + selectors + setters   │
│ Cornerstone interaction│ smry │ import NOTHING outward         │
└───────┬────────────────┘      └───────────────────────────────┘
        │ may import ↓
┌───────▼────────────────┐
│ Cornerstone3D + adapters│
└─────────────────────────┘
```

Allowed-import matrix (everything not listed is forbidden):

| Layer | May import | Must NOT import |
|---|---|---|
| **Components** | hooks, other components, pure `util`/types, store **selector** entry points (read-only) | services (`lib/cornerstone/*`, `lib/segmentation/*`, …), `@cornerstonejs/*`, store **setters**, raw store actions |
| **Hooks** | stores, services, types | React components, `@cornerstonejs/*` directly (go through a service) |
| **Services** | `@cornerstonejs/*`, other services, store **setters** (to push summaries), `util`/types | React, components, hooks |
| **Stores** | `zustand`, types, pure `util` | services, `@cornerstonejs/*`, React, hooks — **nothing that produces a side effect** |

### 2.2 Data flow is unidirectional

```
user gesture → Component → Hook → Service method → Cornerstone mutation
                                                          │
   Component ← selector ← Store ← setter (summary) ← Service event listener
```

Closed loop, one direction. **No component reads Cornerstone. No store calls a service. No service touches React.** Cornerstone is the source of truth for geometry (design §0.1); stores mirror lightweight summaries; the read-modify-write that lives in today's `viewerStore` actions splits cleanly — the hook *reads* the active id from a store selector, the service *performs* the mutation, and the service *writes* the resulting summary back to the store.

### 2.3 Enforcement (Phase 0 deliverable, fails CI)

The contract is enforced with ESLint `no-restricted-imports` (built-in; no new dependency) as per-directory override zones in the existing config, run by the existing `lint` script in `ci.yml`:

- **`src/renderer/stores/**`** — forbid `lib/**`, `@cornerstonejs/**`, `react` (zustand only).
- **`src/renderer/components/**`** — forbid `lib/cornerstone/**`, `lib/segmentation/**`, `@cornerstonejs/**`; permit `hooks/**`, sibling components, store selector entry points.
- **`src/renderer/lib/**`** (services) — forbid `components/**`, `hooks/**`, `react`.

Because the **current** code violates these rules, they go on in Phase 0 in a way that doesn't block the repo: existing violations are quarantined with a single `// eslint-disable-next-line … -- BOUNDARY-DEBT: removed in Rebuild Phase N` comment, each tagged with the phase that removes it. The rule is therefore **on from day one** for all new annotation code (which must be clean) while legacy debt is visible, counted, and burned down on a schedule. Phase 6 asserts zero `BOUNDARY-DEBT` comments remain.

---

## 3. Current → target migration map

No entanglement is carried forward silently. Each knot is either untangled in a named phase or explicitly tracked as `BOUNDARY-DEBT`.

| Current entanglement | Evidence | Target shape | Phase |
|---|---|---|---|
| 2080-line `SegmentationPanel` god-component (orchestrates 6 services) | `SegmentationPanel.tsx` | Decompose into presentational `AnnotationsSidePanel` → `ContainerRow` → `MemberRow` → `ContextToolbox` + dialogs (§4.2), all driven by hooks. No service imports in any of them. | R3 |
| `viewerStore` is a controller (calls `toolService`/`viewportService`/`volumeService`/`mprToolService`) | `viewerStore.ts:487-707` | `viewerStore` → **pure** layout + active-state. The thin wrapper-actions delete; their bodies already call services, so consumers move to `useViewportActions()`/`useToolActions()` over the same services. Low-risk mechanical move. | R1 |
| `sessionDerivedIndexStore` imports `metaData`/`wadouri`/`rtStructService` | `sessionDerivedIndexStore.ts` | Derivation logic moves into a service; the store holds only the derived summary. (This store is missing from design §3.2 — add it.) | R0–R2 |
| 8 source components import `@cornerstonejs` directly | `grep @cornerstonejs src/renderer/components` | Metadata access via `metadataService` + a hook; type-only imports allowed but isolated to a single types module. | R1–R3 |
| `Toolbar` / `ViewportOverlay` / `ExportDropdown` mix presentation + orchestration | line counts 772/732/493 | Split: presentational component + a hook that supplies data and callbacks. | R1 / R3 |
| `mprService` / `mprToolService` / `MPRViewport` / `MPRViewportGrid` | design §1.3 | **Deleted**; folded into `viewportService` + an MPR layout preset. | R1 |
| No hooks seam (only `useHotkeys`, `useToolbarCollapse` exist) | `src/renderer/hooks/` | Build the hooks layer (§5) as the single UI↔state/service boundary. | R1–R3 |
| No import-boundary enforcement | no eslint zones | ESLint `no-restricted-imports` zones + CI gate. | R0 |

---

## 4. Component architecture (the new UI)

### 4.1 Presentational, not container
Components are **presentational**: they receive data via props or via hooks that read store selectors, and they dispatch via hook-provided callbacks. **Zero imaging logic, zero service imports, zero Cornerstone.** All wiring lives in hooks, never in component bodies. A component that needs a service has the wrong shape — the service call belongs in a hook.

### 4.2 Annotations side panel decomposition
New components live under `src/renderer/components/annotations/` (a separate tree from legacy `viewer/` — see §7):

```
AnnotationsSidePanel        shell; layout, resize, scroll
├─ PanelHeader              3 create buttons (Structure · Segmentation · Measurement); filters
├─ ContainerList
│   └─ ContainerRow         name, kind, dirty/approval indicators, cross-panel pill, expand/collapse
│        └─ MemberRow       swatch · name · ROI-type badge · provenance · 3-state visibility ·
│                           lock · active · selection · cross-series / different-FoR / interpolated / empty
├─ ContextToolbox           tool grid; adapts to the active container's kind
└─ (dialogs)                reuse components/dialog/* and the existing viewer/segmentation/* dialogs
```

Each reads via hooks (`useContainers()`, `useActiveMember()`, `useMemberRow(id)`) and dispatches via hooks (`useContainerActions()`, `useMemberActions()`). A `MemberRow` knows nothing about Cornerstone or `segmentationService`; it renders props and calls callbacks.

### 4.3 Viewport layer
A single `Viewport` component (collapsing `OrientedViewport` + `CornerstoneViewport`, design §1.1) is a presentational shell that mounts a Cornerstone element and delegates **all** lifecycle (create, attach, load, destroy) to `viewportService` through a `useViewport(panelId)` hook. The component holds a ref and JSX; the hook holds the wiring; the service holds the Cornerstone calls.

### 4.4 Size as a smell, not a hard rule
A new-tree file over ~400 lines triggers a decomposition review. This is a smell check (the failure mode is the 2080-line panel), not a gameable hard cap.

---

## 5. Hooks layer (the UI ↔ state/service seam)

Hooks are the **only** place that bridges stores and services. They are why the decoupling holds: components depend on a hook's signature, not on store shape or service internals, so either can be refactored without touching a component.

Read hooks (store selectors): `useContainers()`, `useActiveMember()`, `useSelection()`, `useMemberRow(id)`, `usePerViewportVisibility(panelId)`.

Action hooks (return callbacks that call services): `useContainerActions()` (create/rename/delete/approve/serialize), `useMemberActions()` (add/remove/recolor/setRoiType/setVisibility/lock/setActive), `useViewportActions()` (W/L, zoom, rotate, flip, scroll — the work `viewerStore` does today), `useToolActions()` (activate tool), `useViewport(panelId)` (lifecycle).

Rule: a component imports hooks; it never imports a store setter or a service.

---

## 6. Service public APIs (committed before consumers are written)

To stop components and services co-designing into a tangle, each new service's **public method surface** is committed before its consumers exist. Signatures may be refined, but the interface is the contract the hooks code to. Sketch:

- **`containerService`** — `createContainer(kind, seriesCtx)`, `deleteContainer(id)`, `renameContainer(id, name)`, `addMember(containerId, init)`, `removeMember(memberId)`, `renameMember`, `recolorMember`, `setRoiType`, `setActiveMember(memberId)`, `getActiveContainer(): Container | null` (derived from active member, design §2.4), `setApproval(containerId, approved)`, `serialize(containerId)`.
- **`undoService`** — `pushEntry(containerId, entry)`, `undo(containerId)`, `redo(containerId)`, `clear(containerId)`. Entries are viewport-independent, bounded-delta (design §2.7).
- **`viewportLayoutService`** — `applyPreset(preset)`, `currentPreset()`, `addViewport`/`removeViewport`.
- **`transportContractService`** — `onDirty(cb)`, `serialize(containerId)`, `ingestVersionToken(containerId, token)`, `reportSaveResult(containerId, result)`, `onExternalChange(cb)` (the design §4.2 H-contract surface).

Each service file exports only its public surface; internal helpers are not exported.

---

## 7. Dual-path isolation during the flag period

Running the legacy and new paths behind `multiviewport.enabled` for Rebuild Phases 1–5 is itself a maintenance hazard unless isolated:

- The flag is read at **one composition root** (e.g. `ViewerPage` selects the legacy subtree or the new subtree). **No component branches internally on the flag.**
- New components live under `components/annotations/`; legacy stays under `components/viewer/`. The two trees share only the **read-only** image/session stores, never mutable annotation state.
- Legacy stores/services that the new path replaces are **not** modified to serve both paths. The new path uses the new stores/services exclusively.
- Phase 6 deletes the legacy tree and the flag wholesale.

---

## 8. Definition of "clean" (architecture acceptance — checkable)

These are verifiable and belong in the Phase 0 walking-skeleton and every phase gate:

1. `npm run lint` passes with the §2.3 boundary zones enabled.
2. No file under `components/**` imports `@cornerstonejs/*` or `lib/cornerstone/**` (type-only imports isolated to one types module excepted).
3. No store imports a service or Cornerstone.
4. No service imports React, a component, or a hook.
5. New annotation code carries **zero** `BOUNDARY-DEBT` disables; the count in legacy code only decreases, reaching zero by Phase 6.
6. No new-tree file exceeds the §4.4 smell threshold without a recorded decomposition decision.

If any fails, the architecture is not clean yet — independent of whether the feature tests are green.
