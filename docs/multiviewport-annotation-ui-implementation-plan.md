# MV-Phase 7 — Implementation Plan

**Companion to**: [`docs/multiviewport-annotation-ui-spec.md`](multiviewport-annotation-ui-spec.md) (locked spec) · [`docs/mockup-viewer.html`](mockup-viewer.html) (interactive prototype) · [`PHASES.md`](../PHASES.md) §MV-Phase 7
**Source of truth for architecture / DICOM / conventions**: [`CLAUDE.md`](../CLAUDE.md)
**Tracking**: GitHub Issues on `danielmarcus/xnat-workstation` under the `mv-phase-7` label / milestone (TBD: create milestone before issue creation)

This document is the operational rollout plan for the v1 UI rebuild. Each sub-task below maps to one GitHub Issue and one (or a small number of) PRs.

---

## Dependency graph

```
            ┌─────────────────────────────┐
            │ 7.1 Foundation              │
            │ (ErrorBoundary, DICOM       │
            │  validation, catch audit)   │
            └─────────────┬───────────────┘
                          │
                          ▼
            ┌─────────────────────────────┐
            │ 7.2 Toast system            │
            └─────────────┬───────────────┘
                          │
        ┌─────────────────┼─────────────────┬────────────────┐
        ▼                 ▼                 ▼                ▼
  ┌──────────┐     ┌──────────┐      ┌──────────┐    ┌──────────┐
  │ 7.3      │     │ 7.4      │      │ 7.7      │    │ 7.8      │
  │ Panel    │     │ Toolbar  │      │ Tags     │    │ Overlays │
  │ rebuild  │     │          │      │ modal    │    │          │
  │ (a–e)    │     │          │      │          │    │          │
  └────┬─────┘     └──────────┘      └──────────┘    └────┬─────┘
       │                                                   │
       ▼                                                   ▼
  ┌──────────┐                                       ┌──────────┐
  │ 7.5      │                                       │ 7.10     │
  │ Multi-VP │                                       │ Settings │
  │ coupling │                                       │ polish   │
  └────┬─────┘                                       └────┬─────┘
       │                                                   │
       ▼                                                   ▼
  ┌──────────┐                                       ┌──────────┐
  │ 7.6      │                                       │ 7.11     │
  │ Sidebar  │                                       │ Hotkeys  │
  └──────────┘                                       └──────────┘

  ┌──────────┐  ← depends on 7.2 + 7.3, otherwise free
  │ 7.9      │
  │ Backup   │
  └──────────┘
```

**Critical path** (longest dependency chain): 7.1 → 7.2 → 7.3 → 7.5 → 7.6 (≈5 units).
**Parallelizable after 7.2**: 7.4 (toolbar) + 7.7 (Tags modal) + 7.8 (overlays) + 7.9 (backup, partial).

---

## Rollout sequence

### Wave 1 — Foundation (must land before anything else)

#### 7.1 Foundation
- **Scope**: Spec §13. Top-level `ErrorBoundary` wrapping `App.tsx`; per-viewport `ErrorBoundary` inside each viewport cell. Auto-snapshot diagnostics on caught exceptions + unhandled rejections (writes to `<userData>/diagnostics/{timestamp}.json`). "Review report from previous session" banner on next launch. DICOM tag validation before XNAT upload (`xnatUploadService.ts` → new `dicomValidation.ts:validateBeforeUpload`).
- **Catch-block audit**: Sweep every `try/catch` in `src/` and assign each to silent / toast / dialog / banner per spec §13.2 surface taxonomy. Output: an audit-results checklist committed to the PR description, noting which catches changed surface.
- **Acceptance**:
  - Manually trigger a render error → ErrorBoundary recovery screen shows; click "Reload renderer" recovers.
  - Manually trigger an upload of a malformed SEG (missing Rows tag) → dialog blocks upload with the missing-tag message.
  - Auto-snapshot file appears under `<userData>/diagnostics/` after a forced crash.
  - All ~70% currently-silent catches still console-log; reclassified ones surface per the audit table.
- **Tests**: Unit tests for `dicomValidation.validateBeforeUpload` covering each SOP-class required-tag list. Component test asserting ErrorBoundary renders the recovery screen on child crash.
- **Risk**: Catch-block audit may surface latent bugs that were being silently swallowed. PR may grow if any are user-facing.
- **Estimate**: M (2–3 days)

---

### Wave 2 — Notification surface

#### 7.2 Toast system
- **Scope**: Spec §11. New `toastService` (Zustand store + React component `<ToastStack />`). Viewport-area-scoped (mounted by `ViewerPage.tsx` inside the viewport-area container, not in side panels). 4 kinds with the spec'd styling. Optional `action: { label, onClick }` per toast. Click-to-dismiss; hover pauses auto-dismiss timer. `aria-live="polite"` (success/info) or `assertive` (warning/error). Max 3 visible; older fades.
- **API**:
  ```ts
  toastService.notify({
    kind: 'success' | 'info' | 'warning' | 'error',
    message: string,
    detail?: string,
    action?: { label: string; onClick: () => void },
    duration?: number,  // ms; defaults per kind
  });
  ```
- **Replace**: nothing replaced directly — `PanelToast.tsx` was deleted in MV-Phase 6 and is not resurrected. Add toast emission sites where the spec § 11.7 taxonomy says toasts apply.
- **Existing surfaces stay**: sidebar status footer, dialog modals, recovery + update banners, panel autosave row (built in 7.3e).
- **Acceptance**:
  - Programmatically `toastService.notify({...})` for all four kinds; visual check matches the spec styling.
  - Hover pause works.
  - Stacking caps at 3.
  - Routine events (autosave success) emit zero toasts.
- **Tests**: Unit tests for the store (queue mechanics, duration timer, hover pause, action invocation). Component test for `<ToastStack />` rendering up to 3 toasts and dismissing on click.
- **Estimate**: S (1 day)

---

### Wave 3 — Annotation panel rebuild (the largest unit; can ship as 5 sub-PRs)

#### 7.3 Annotation panel rebuild
The single largest unit. Five sub-tickets, each a separate PR.

##### 7.3a Container list + kebab menu
- **Scope**: Spec §4.4, §4.4.1, §4.7. Container row rendering (badge, name, dirty/recovered states, scan ID, kebab, ✕). Right-click context menu (Expand/Collapse/Show-all/Hide-all/Lock-all/Unlock-all). Kebab popover with the locked items per type. v1.1-deferred items (Statistics / Edit ROI types) explicitly **not** rendered.
- **Acceptance**:
  - Each kebab item dispatches the correct service call.
  - Disabled states (Reload-if-no-XNAT-origin, Discard-if-not-dirty, Save-XNAT-if-not-connected) honored.
  - Right-click anywhere on a container row opens the context menu.
- **Tests**: Component tests covering each kebab item + the right-click flow + disabled states.
- **Depends on**: 7.1 (ErrorBoundary), 7.2 (toasts emitted by kebab actions).
- **Estimate**: M

##### 7.3b Member rows
- **Scope**: Spec §4.5. Drag-handle reorder (HTML5 drag with blue drop-target line). Single-click color swatch → inline color picker popover (16 preset + Custom OS picker). Shift-click eye = solo; Alt-click eye = hide-this. Double-click name → inline rename (Enter commit / Esc cancel / blank reverts).
- **Acceptance**:
  - Drag a member up/down within a container; order persists; container becomes dirty.
  - Color picker applies on click; popover closes.
  - Shift-click eye hides others; Alt-click eye hides only this.
  - Rename works for both container and member names.
- **Tests**: Component tests for the four interactions; unit tests for the reorder algorithm.
- **Depends on**: 7.3a (container list shell).
- **Estimate**: M

##### 7.3c Create buttons + resizable panel
- **Scope**: Spec §4.1, §4.3. Resizable panel with drag handle on left edge (140–600 px). Two narrow thresholds (compact-add at < 270 px; compact-tools at < 210 px). Three create buttons (`+ Segmentation` · `+ Structure` · `+ Measurement`) with icons that always render; labels collapse to ellipsis then disappear below the compact-add threshold. Clicking a create button creates the container + drops into inline rename mode (no naming dialog).
- **Acceptance**:
  - Drag the resize handle; width follows the cursor; clamps to range; persists in `preferencesStore`.
  - Cross the narrow threshold; add-button labels disappear; tool-button labels survive longer.
  - Click `+ Segmentation` while the active viewport has no scan → info toast + no container created.
- **Tests**: Component tests for the three thresholds and the create-button gating.
- **Depends on**: 7.3a (panel shell).
- **Estimate**: M

##### 7.3d Dialogs
- **Scope**: Spec §4.4.2, §4.4.3, §4.4.4, §4.4.5. `DeleteConfirmDialog` (3 forms). `ExistingSaveDialog` (Choose + Name modes). `SavingOverlay` (single-container + batch progress + retry-on-failure). **Save All preflight dialog** with per-row action selector + inline name input for "Create new" rows + summary line + batch execution via `SavingOverlay`.
- **Acceptance**:
  - All four dialogs render per the spec.
  - Save All preflight batch executes correctly; skipped containers stay dirty; failed entries surface with Retry.
  - ExistingSaveDialog Create-new path captures the new name and uploads under it.
- **Tests**: Component tests for each dialog. Service-integration test for the Save All batch with a synthetic SaveAdapter (extends MV-Phase 2.8's pattern).
- **Depends on**: 7.3a (kebab triggers the dialogs), 7.2 (success toasts).
- **Estimate**: L (2–3 days)

##### 7.3e Toolbox + Controls + autosave row
- **Scope**: Spec §4.8, §4.9. Toolbox 3-column grid; like-by-like ordering; no formal group labels. Fixed-height (110 px) Controls section that swaps content based on active tool. Empty state ("Select or create…"). Off-active-panel banner. Locked-active-member banner. Autosave row at bottom (idle/saving/saved/error states).
- **Acceptance**:
  - Switch active container type → toolbox swaps to that type's tools.
  - Click different tools → Controls section adapts (brush size for brush-family, sphere radius for sphere-family, threshold range for threshold-family, spline type for SplineContour, etc.).
  - Lock active member → toolbox banner appears; tools hidden.
  - Backup events fire → autosave row reflects state.
- **Tests**: Component tests for each tool-family Controls variant; integration test for autosave state transitions.
- **Depends on**: 7.3a (panel shell).
- **Estimate**: M-L

---

### Wave 4 — Parallel work after 7.2

These can ship in any order after Wave 2.

#### 7.4 Toolbar overhaul
- **Scope**: Spec §3. 9-group structure (Left slot · Data selection · Layout/View · Navigation tools · Transform · Undo/Redo · Cine · Display toggles · Right slot). MPR button cycles the active viewport's `panelOrientation`. `?` cheatsheet overlay listing every binding by category. Tooltip suffixes derived live from current hotkey map (auto-updates on remap).
- **Acceptance**:
  - All 9 groups render per the mockup.
  - MPR button cycles only the active viewport; toolbar button blue when active orientation ≠ STACK.
  - Press `?` (outside input) → cheatsheet opens; Esc closes.
  - Remap a hotkey in Settings → tooltip updates without refresh.
- **Tests**: Component tests for the cheatsheet overlay + tooltip suffix logic. E2E spec for MPR cycling.
- **Depends on**: 7.2 (cheatsheet open/close uses toast? no — but emit a toast on a no-op action attempt for testability).
- **Estimate**: M

#### 7.7 DICOM Tags modal
- **Scope**: Spec §10. Convert `DicomHeaderPanel` from a right-side panel into a resizable modal dialog. Open via toolbar Tags button or `Shift+T`. Module-filter chips above the tag list (single-select). Hover row reveals a copy icon. Right-click row → context menu (Copy value · Copy `(GGGG,EEEE) Name = value` · Copy as JSON · Copy whole group as JSON). Resizable via bottom-right corner drag (640×480 default; 360×320 min; up to 90% viewport).
- **Acceptance**:
  - Tags button + `Shift+T` both open the modal.
  - Esc / ✕ / backdrop click closes.
  - Module chips filter the visible tags.
  - Hover copy icon + right-click context menu both work.
  - Resize handle works.
- **Tests**: Component tests for modal open/close, chip filter, copy actions.
- **Depends on**: 7.2 (copy success toast).
- **Estimate**: M

#### 7.8 Viewport overlays
- **Scope**: Spec §9. Add 4 new `OverlayFieldKey` entries (`cursorHU`, `cursorCoords`, `activeTool`, `activeAnnotation`). Default placements: `cursorHU` + `cursorCoords` BL, `activeTool` + `activeAnnotation` BR. Rename master toggle to "Show corner overlays" (Settings → Display). Drop shadow / text-stroke on all overlay text.
- **Acceptance**:
  - Hover a CT pixel → `cursorHU` field shows "HU: N" when enabled.
  - All 23 fields appear in Settings → Display checkboxes.
  - Master toggle hides corner fields; rulers + markers stay independent.
  - Overlay text legible on bright images.
- **Tests**: Component tests for the 4 new fields' formatting; unit tests for cursor → HU lookup.
- **Depends on**: nothing structural; 7.10 will integrate the Settings rename.
- **Estimate**: S-M

#### 7.9 Persistence / backup
- **Scope**: Spec §12. Auto-prune backups older than 30 days (configurable). Auto-delete local backup on successful XNAT upload. New Settings → Backup controls: configurable directory (folder picker) · Verify Path button · sync-folder warning (OneDrive/iCloud/Dropbox detection). **Batched recovery dialog** replaces the per-entry modal sequence — single modal listing all recoverable backups with per-row Recover/Skip checkboxes. Quit-time synchronous flush with fallback confirm dialog if sync save fails.
- **Acceptance**:
  - Old backup (date > 30 days) gets pruned on next session load.
  - Successful XNAT upload removes the local backup; subsequent app launch shows no recovery prompt for that container.
  - Settings → Backup → change directory to a known OneDrive path → warning appears.
  - Session with 3+ recoverable backups → single dialog with checkboxes, not 3 modals.
  - Quit with dirty changes → sync flush fires; confirm dialog only if flush fails.
- **Tests**: Unit tests for prune logic + sync-folder detection. Component tests for the batched recovery dialog. Integration test for quit-time flush.
- **Depends on**: 7.3 (recovery dialog patterns), 7.2 (post-XNAT cleanup toast).
- **Estimate**: M

---

### Wave 5 — Polish + multi-viewport coupling

#### 7.5 Multi-viewport coupling (Option C)
- **Scope**: Spec §5. Containers not visible on the active viewport render at 50% opacity with a `↗ N panels` pill. List header shows `N total · N on active panel` plus an "All panels / Active only" filter toggle. Active container that isn't on the active viewport → toolbox shows the warning banner (tools hidden). New container creation routes to active viewport + auto-attaches to viewports sharing the same scan. Empty viewport drop-zone styling. "Editing across N panes" pill in the toolbox header.
- **Acceptance**:
  - Active container on viewport_0 → switch to viewport_2 (empty) → row dims, pill appears.
  - Click "Active only" → list filters to active-viewport containers only.
  - Create new SEG while active viewport has scan A → container attaches to active + any other viewport showing A.
  - Toolbox header pill counts panes accurately.
- **Tests**: Component tests for the dim/pill logic; service-integration test for the multi-viewport attach.
- **Depends on**: 7.3 (panel shell), 7.6 not yet — 7.5 must land before 7.6 because 7.6's drag-drop terminates at empty-viewport drop zones from 7.5.
- **Estimate**: M

#### 7.6 Sidebar polish
- **Scope**: Spec §7. Drag-and-drop scans from sidebar to viewport cells (HTML5 drag with `application/x-xnat-scan` MIME). Multi-select via Cmd/Ctrl-click toggle + Shift-click range. Bulk-load action bar when ≥2 selected (Load 1×N + 2×2 for ≤4). Right-click scan → context menu (Open in active panel / Open in panel_0..3 / Open in MPR / Pin / Copy URL). Derived-annotations footer pill. Breadcrumb up-navigation (clickable crumbs above the scan level). PET/CT mixed-modality: modality chips at scans level only when multiple modalities present.
- **Acceptance**:
  - Drag scan → drop on viewport → loads into that exact viewport.
  - Multi-select + Load 1×N → fills N viewports.
  - Right-click scan → context menu opens; "Open in panel_2" replaces panel_2's content.
  - PET/CT session → modality chip row appears at scans level.
- **Tests**: E2E spec covering drag-drop + bulk-load. Component test for the context menu + PET/CT detection.
- **Depends on**: 7.5 (empty viewport drop zones).
- **Estimate**: M

#### 7.10 Settings polish
- **Scope**: Spec §8. Reset All confirmation dialog. Hotkey conflict-blocking remap (must clear previous binding before reassigning). Backup Verify Path button + sync-folder warning. Tab reorder (Hotkeys → Annotation → Display → Interpolation → Backup → Updates → Diagnostics → About) and renames (Overlay → Display · File Backup → Backup · Issue Report → Diagnostics).
- **Acceptance**:
  - Click Reset All → confirm dialog; cancel → no change; confirm → defaults restored.
  - Try to bind `B` (Brush) to another action → block + show conflicting action(s) inline + "Clear" button.
  - Backup tab Verify Path → reports OK / Not writable / Sync-folder warning.
- **Tests**: Component tests for each new behavior.
- **Depends on**: 7.8 (Display tab content), 7.9 (Backup tab content).
- **Estimate**: M

#### 7.11 Hotkeys
- **Scope**: Spec §6. Add 12 default tool bindings + 6 action bindings to `defaultHotkeyMap.ts`. Wire `⌘S` (Save active container) + `⌘⇧S` (Save all) + `Shift+T` (Tags modal) + `m` (MPR cycle) + `⌘,` (Settings) + `?` (cheatsheet). Conflict-blocking handled in 7.10.
- **Acceptance**:
  - All 12 new tool bindings activate the right tools.
  - All 6 new action bindings dispatch correctly.
  - Tooltips on toolbar buttons include the bound key.
- **Tests**: Unit tests for the dispatch map. E2E spec verifying the hotkeys reach the right service calls.
- **Depends on**: 7.10 (remap UI).
- **Estimate**: S

---

## Sequencing summary

| Wave | Sub-tasks | Parallelizable? | Cumulative time est. |
|---|---|---|---|
| 1 | 7.1 | — | M (2–3 d) |
| 2 | 7.2 | — | S (1 d) |
| 3 | 7.3a → 7.3e | Mostly serial (a is the dependency for b/c/e; d depends on a) | L+ (5–8 d) |
| 4 | 7.4, 7.7, 7.8, 7.9 | All parallel after 7.2 | M each |
| 5 | 7.5 → 7.6, 7.10, 7.11 | 7.5 → 7.6 serial; 7.10 → 7.11 serial; 7.10 needs 7.8 + 7.9 | M+S each |

If one engineer in serial: ~3–4 weeks. With Wave 4 parallelized, ~2.5 weeks.

---

## GitHub Issue template

Each unit gets an Issue with the following structure (suggested):

```
Title: [MV-Phase 7] 7.X {Unit name}

## Scope
{Pulled from this plan's "Scope" bullet for the unit}

## Acceptance criteria
{Pulled from this plan's "Acceptance" bullets}

## Tests
{Pulled from this plan's "Tests" bullet}

## Dependencies
- Depends on: #{issue numbers for the units this depends on}
- Blocks: #{issue numbers this blocks}

## Spec references
- `docs/multiviewport-annotation-ui-spec.md` §{section number(s)}
- `docs/mockup-viewer.html` for the interactive prototype

## Labels
mv-phase-7, area:{toolbar|panel|sidebar|overlay|settings|backup|errors|hotkeys|toast}, size:{S|M|L}
```

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Catch-block audit (7.1) surfaces latent bugs | PR scope expands if needed; track follow-ups as separate issues if not v1-critical |
| Toast position conflicts with TR corner overlays (7.2 + 7.8) | Spec §9.4 already accepts the brief overlap; corner overlays stay readable underneath transient toasts |
| Annotation panel size grows past a single PR (7.3) | Already split into 5 sub-tickets; each ≤ 2 days |
| DICOM Tags modal (7.7) breaks Tab focus management | Add focus-trap testing; mirror existing modal patterns (Save All dialog) |
| Drag-and-drop (7.6) breaks on Windows due to OS quirks | Test on macOS + Windows during PR; existing XnatBrowser DnD payload format unchanged |
| 30-day backup pruning (7.9) deletes data unexpectedly during long inactive periods | Make threshold configurable; default 30d; add Settings → Backup count display "N backups will be pruned" |
| Hotkey conflict block (7.10 + 7.11) frustrates power users | Provide a "Clear conflicting binding" one-click button alongside the warning |

---

## v1.1 backlog (not in MV-Phase 7)

Items deferred from the spec §14. Each will become its own issue when promoted to a future milestone:

- Statistics… kebab item (SEG)
- Edit ROI types… kebab item (STRUCT)
- Per-panel state memory
- Per-panel member visibility
- Chord hotkey sequences
- Per-tool / per-panel hotkey scopes
- Default bindings for New Segmentation / Structure / Measurement
- DICOM Tags: recursive sequence expansion · per-frame functional groups · compare mode · code-sequence dereferencing
- App-level bottom status bar
- Developer / perf overlay
- Hash-based backup integrity verification
- Per-session backup size cap
- Cloud-synced backup
- Toast: notification center · sound effects · customizable position/duration
- WholeBodySegmentTool (ML pipeline)
- Round-trip workflow: ExistingSaveDialog "Create new with labeled scan name" path
- Annotation export as DICOM SR (Measurement type save-to-XNAT)
- XNAT ROI Collection integration

---

*End of plan.*
