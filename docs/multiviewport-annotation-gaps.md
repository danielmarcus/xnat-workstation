# Annotation Rebuild — Spec Gap Audit

> **Date:** 2026-06-05 · **Why:** the `A13` annotation-lifecycle gap was found by chance (a reviewer probing a flow the static mockup couldn't show). This audit replaces intuition with **coverage**: a systematic sweep for behaviors that are described-but-untested, stateful workflows lacking explicit transitions, transport stubs, and existing app features the rebuild might silently drop.
>
> **Method — three passes:** (A) every requirement subsection × the acceptance signals (26 at audit time; 27 now, with the conflict signal added) → find clauses with no signal & workflows with no state-spec; (B) the transport contract's "to fill in" stubs → what's undefined + does it block Phase 3; (C) the *current app's* actual behaviors × the specs → existing functionality the rebuild is silent on.
>
> **Two classes of gap:** *flagged* (the transport doc's 33 explicit "to fill in" stubs — known unknowns) and *implicit* (A13-class — behavior between well-specified states, with nothing marking it missing). The implicit ones are the dangerous ones; the discipline that should catch them is §8.0's "every behavior is a red E2E signal first" — **if a function has no signal, its behavior isn't actually pinned.**
>
> Severity: 🔴 blocks Phase 3 / data-loss-or-regression risk · 🟠 should fix before its phase · 🟡 lower / deferrable.
>
> **Resolved since this audit (2026-06-05):** the **conflict + save-failure workflow** (§1 row 1, §2 C7/D3) — §H boundary H5–H7 fleshed out, the clean-container external-change branch decided (no silent swap), and **acceptance signal 27** added. The **transport workstream is now sequenced** in PHASES (T-spec ∥ Phases 0–2 → T-build ≈ Phase 3 → T-gate before Phase 6), so the 33 stubs have an explicit slot. Remaining open items below stand.

---

## 1. Behavioral gaps in the annotation specs (described, but no acceptance signal)

These are A13-class: real behaviors with no signal pinning them. Each needs either a new signal (and an explicit spec where thin) or a documented reason it's QA-matrix-only.

| Gap | Spec | Signal? | Sev |
|---|---|---|---|
| ~~Conflict-resolution workflow~~ — external-change detect, conflict marker, Keep-local / Discard-local / Inspect prompt | E3, H6, H7 | **✅ 27 (added)** | ✅ resolved |
| ~~Save-result outcomes Conflict & Permanent-failure~~ | H5, C7 | **✅ 27** | ✅ resolved |
| **Undo/redo state machine** — redo-invalidation on new edit, per-container history isolation, depth/eviction, external-reload-clears-history | A8 | 7/15/16 (3 cases) | 🟠 |
| **A13 unload sub-states** — dirty→unloaded via explicit discard/revert; app-restart recovery | A13, E3 | 25/26 (load/navigate/retain only) | 🟠 |
| **Voxel-tool roster** — brush/eraser(+all-segment modifier)/threshold/dynamic/planar+through-volume scissors/sculptor; **Contour Fill (flagged BROKEN, must-fix v1)** | C3 | 16, 21 (2 of ~10) | 🟠 |
| **List-panel actions** — inline rename, create-in-edit-mode, revert, export-DICOM, export-CSV, jump-to-first-slice, show-only-this, move-to-container, save-now icon | D7.6 | none | 🟠 |
| **Measurement (SR) container behavior** — first-class peer type, but self-admittedly unspecified | D7.1/D7.6 | **none** (coverage note admits) | 🟠 |
| **Gesture-binding edge cases** — cursor/stylus crossing a viewport mid-gesture; deferred focus-switch hotkey | A7, D4 | 4 (lock only) | 🟡 |
| **A2c auto-classification** (A2b-vs-A2c decision; heuristic is explicitly inconclusive) | A2c | 10 (starts pre-classified) | 🟡 |
| **Performance budget** ≥30 fps / ≤250 ms — a hard number never measured | D8 | none | 🟡 |
| Multi-select set behavior; double-click-to-activate; active-without-changing-selection | A11, D7.5 | 8/17 (single only) | 🟡 |
| Per-container tri-state visibility; dirty/locked/empty/**conflict** row markers | D7.3/D7.4 | 20/22 (partial) | 🟡 |
| Container-level membership invariants (rename/recolor/delete propagate to all viewports); Z-order; open-contour render | B6, B7, B8, C4 | none (QA-matrix) | 🟡 |
| Active-viewport indicator; tool disabled-on-ineligible-viewport; keyboard-scope routing | D1, D3, D5 | none | 🟡 |

**Most urgent (🔴/🟠):** the **conflict-resolution + save-failure** workflow is the single biggest hole — an entire stateful flow (detect → mark → prompt → resolve) with zero signals, exactly the A13 pattern. Then **undo/redo**, the **voxel-tool roster** (esp. the known-broken Contour Fill), **list-panel actions**, and **measurement-SR**.

---

## 2. Transport contract (`annotation-xnat-integration-requirements.md`) — 33 stubs

Only **~4 of 28** subsections carry real substance (B5 defined; C6/C8/E5 partial). The rest are "to fill in." Good news: the split falls cleanly on the transport/UI boundary — most plumbing is genuinely deferrable to the transport workstream's own phase. The ones that **block Phase 3** are the *user-facing result/error semantics*, not the wire mechanics:

| Stub | What's missing | Sev |
|---|---|---|
| **C7. Save errors** | transient-vs-permanent taxonomy + per-row retry affordance the panel must render | 🔴 blocks Phase 3 |
| **D3. Conflict resolution UX** | the actual dialog (copy, defaults, diff/inspect) — overlay-layer work Phase 3 must build | 🔴 blocks Phase 3 |
| **A4. Permissions/ownership** | a read/write-capability signal so save/delete render *honestly* disabled | 🟠 partial blocker (result only) |
| **B3. Parse-and-validate** | the placeholder-row failure shape (B5 promises a retry/remove row) | 🟠 partial blocker |
| **C4/C5. Version token / first save** | success→cleared-dirty and local-id→persisted-asset **row-state transitions** | 🟠 partial blocker |
| **D4. Stale-token handling** | the save-returns-Conflict branch that routes into D3 | 🟠 partial blocker |
| **B4/B6. Source identity / multi-load** | FoR fields feeding dimming/pill; per-container partial-failure + progress | 🟠 partial blocker |
| **C8 slivers / E5 sliver** | delete confirmation copy + undo-window; what "Review now" does | 🟠 partial blocker |
| A1–A3, B1/B2, C1/C2/C3, D1/D2, E1/E2/E4, F1–F5 | hierarchy mapping, fetch/upload plumbing, field→tag mapping, UID gen, round-trip proof | 🟡 deferrable to transport phase |

**Bottom line:** Phase 3 doesn't need the whole transport contract — it needs the **result/error semantics** the panel reacts to (C7, D3, and the result-only slivers of A4/B3/C4/C5/D4/B6/C8/E5). The plumbing waits.

---

## 3. Existing app behaviors the rebuild is silent on (silent-regression risk)

The toolbar is being rebuilt and the frozen mockup lists several controls **by label only** with no behavioral spec. Per CLAUDE.md §4 ("new UI replaces old; delete old chrome"), anything not explicitly carried forward is at risk of being dropped. **These are decisions the user should make, not omissions to silently accept.**

| Existing feature (file) | Spec status | Risk | Sev |
|---|---|---|---|
| **Hanging protocols** (Tomo/Mammo 4-Up, CT Pre/Post, MR Brain) — `hangingProtocol.ts` | toolbar shows "Hanging ▾" **label only**; contents undefined | dropdown ships empty / protocols lost | 🔴 |
| **Multiple W/L presets (5 + Ctrl+1–5)** — `WL_PRESETS` | mockup shows only one "Soft tissue" preset | 4 presets + hotkeys disappear | 🔴 |
| **Configurable per-corner overlay + rulers + orientation markers** — `ViewportOverlay.tsx`, Settings "Overlay" tab | "ruler"/"orientation marker" = 0 spec hits | rich overlay collapses to hardcoded minimal | 🔴 |
| **DICOM Tags panel** (grouped, search, private-tag toggle) — `DicomHeaderPanel.tsx` | toolbar "Tags" label only; content undefined | button wired to nothing / stripped panel | 🔴 |
| **Image/clipboard/all-slices export** (PNG/JPEG/clipboard/all-slices/raw-DICOM) — `ExportDropdown.tsx` | spec reframes "Export" as annotation-only (per-container DICOM/CSV) | viewport image export silently dropped | 🔴 |
| **Custom R×C layout** (`setCustomLayout`) | specs enumerate only fixed presets + MPR | arbitrary grids lost | 🟠 |
| **Toolbar "Import" / "Favorites"** | labels only; **Favorites has zero spec anywhere** | placeholders never wired | 🟠 |
| **Trash-on-delete preference** (`trashOnServerDelete`) — `preferencesStore.ts` | deletion = "local-vs-XNAT (transport C8)"; "trash" 0 hits | soft-delete safety net dropped | 🟠 |
| **Issue-report + Auto-update settings tabs** | mockup removed panel kebab → "global settings", never enumerated | settings tabs lost in rebuild | 🟠 |
| **Connection keepalive + session-expiry/reconnect** — `sessionManager.ts` | 0 hits in multiviewport docs (belongs to transport/integration) | falls between docs — confirm ownership | 🟠 |
| **Cine fps for ordinary multi-frame** — `viewerStore.ts` | volume-default refactor makes volume viewports non-cine-eligible (design §10) | cine regresses for normal series | 🟠 |
| Sculptor / smart-region (Region/Region+) / Contour Fill | named in design but **conditional on Phase-5 audits**; Contour Fill currently broken | behavior changes if an audit can't meet C3 | 🟡 |

**Highest-confidence omissions** (work today, *no* behavioral spec anywhere, toolbar/settings the rebuild touches): **Hanging protocols, W/L presets, configurable overlay/rulers, Tags panel, image/clipboard export, custom layout, trash-on-delete, Favorites.**

> ⚠️ **The toolbar freeze was *visual*.** It locked layout/icons, but the *behavior* behind several buttons (Hanging contents, Import/Favorites actions, W/L-preset set, Export scope, Tags-panel content) was never specified. The freeze does **not** mean those behaviors are defined.

---

## 4. Recommended order of work

1. ✅ **DONE — Decided which existing features survive (§3/§5).** All 12 kept; folded into requirements **§I**. (Hanging, W/L presets, overlay/rulers, Tags, image export, custom layout, trash-on-delete, Favorites, Import, cine-on-volume, connection lifecycle, Phase-5 tools.)
2. ✅ **DONE — Spec the conflict + save-failure workflow** (§H H5–H7 defined, clean-branch decided, **signal 27** added). The remaining transport-side mechanics (C7/D3 internals) are now scheduled in the **transport workstream's T-spec** (PHASES).
3. **🟠 Add signals for the unsignaled core behaviors (§1):** undo/redo state machine, voxel-tool roster (+ fix-and-test Contour Fill), list-panel actions, measurement-SR.
4. **🟠 Define the Phase-3-blocking transport *result semantics* (§2 partial blockers)** — just the result/error contracts the panel reacts to, not the plumbing.
5. **🟡 Everything else** — A2c classification, performance-budget measurement, the deferrable transport plumbing — into the relevant phase, tracked, not silently skipped.

The §8.0 rule remains the backstop: **author each as a red E2E signal before it counts as built.** This audit is the list of behaviors that currently have no such test.

---

## 5. Existing-feature disposition — keep / change / drop (for sign-off)

The §3 features work in the app today but the rebuild specs are silent on them — so they'll be dropped by omission unless ruled on. Below is my recommendation per item + the spec work a "keep" implies. **Most are clear keeps** (the rebuild shouldn't lose working features); **two need a real decision** (🟡 Import/Favorites, Cine-on-volume). Tick a box per row.

| # | Feature (current file) | Recommendation | If KEEP → spec work needed | Your call |
|---|---|---|---|---|
| 1 | **Hanging protocols** (CT Pre/Post, MR Brain, Tomo/Mammo 4-Up) — `hangingProtocol.ts` | **Keep** — real, useful auto-layout; toolbar already has "Hanging ▾" | Spec the dropdown contents + matching/apply behavior (was old Phase 7) | ☐ keep ☐ change ☐ drop |
| 2 | **5 W/L presets + Ctrl+1–5** (Soft Tissue/Lung/Bone/Brain/Abdomen) — `WL_PRESETS` | **Keep all 5** — the mockup's "Soft tissue" is just the dropdown's *current value*, not the only one | Note in the toolbar spec: the W/L-preset control is a dropdown of all presets + hotkeys | ☐ keep ☐ change ☐ drop |
| 3 | **Configurable 4-corner overlay + rulers + orientation markers** — `ViewportOverlay.tsx`, Settings Overlay tab | **Keep** — core radiology UX (visible in your screenshot) | Carry the configurable corners + rulers + orientation markers into the rebuilt viewport overlay | ☐ keep ☐ change ☐ drop |
| 4 | **DICOM Tags panel** (grouped, search, private-tag toggle) — `DicomHeaderPanel.tsx` | **Keep** — toolbar "Tags" opens it | Preserve the existing panel; spec it as the "Tags" target | ☐ keep ☐ change ☐ drop |
| 5 | **Image / clipboard / all-slices / raw-DICOM export** — `ExportDropdown.tsx` | **Keep**, *distinct* from annotation export | Define **two** exports: toolbar **Export** = viewport image/clipboard/all-slices/raw-DICOM; panel kebab = annotation DICOM/CSV | ☐ keep ☐ change ☐ drop |
| 6 | **Custom R×C layout** (`setCustomLayout`) | **Keep** — cheap to retain | Keep "custom rows×cols" in the Layout dropdown alongside presets + MPR | ☐ keep ☐ change ☐ drop |
| 7a | **Favorites (Bookmarks)** — `lib/pinnedItems.ts`, `lib/app/useBookmarks.ts`, `components/app/BookmarksDropdown.tsx` | ✅ **KEEP — spec = existing behavior** | A toolbar dropdown of **pinned items** (projects/subjects/sessions the user pins) + auto-tracked **recent sessions**, scoped per XNAT server, persisted in localStorage. Clicking an entry navigates the XNAT browser to it (`NavigateToTarget`, optional skip-auto-load) and loads the session; recents can be promoted to pinned. Works well — preserve as-is. | ✅ keep |
| 7b | **Import** — local DICOM load — `App.tsx` `loadLocalFiles` | ✅ **KEEP (basic; revisit later)** | Loads DICOM **from the local drive** (not XNAT): drag-and-drop files/folders (always available) + an open-file button, via Cornerstone's file manager (wadouri). Works well enough for now; **flagged for later development** (robustness / large-folder / series-grouping). | ✅ keep |
| 8 | **Trash-on-delete preference** (`trashOnServerDelete`, trash resource) — `preferencesStore.ts` | **Keep** — soft-delete safety net | Fold into the delete contract (transport C8): delete offers trash vs. permanent | ☐ keep ☐ change ☐ drop |
| 9 | **Issue-report + Auto-update settings tabs** — `SettingsModal.tsx`, `updateHandlers.ts` | **Keep** — app-level, live in global Settings (gear) | Enumerate them under the Settings (gear) target the mockup routes to | ☐ keep ☐ change ☐ drop |
| 10 | **Connection keepalive + session-expiry/reconnect** — `sessionManager.ts`, `connectionStore.ts` | **Keep** — essential | Assign ownership: it's connection/auth (not annotation) — confirm the integration doc or a connection spec owns it so it doesn't fall between docs | ☐ keep ☐ change ☐ drop |
| 11 | **Cine on volumetric series** — `viewerStore.ts` | ✅ **KEEP on volume** | Confirmed: CS3D `utilities.cine.playClip` supports VolumeViewport (scroll-cine + dynamic 4D). Implement cine via `cine.playClip` (volume-capable), not the legacy stack `setInterval`. Design risk/open-question notes corrected — cine is **not** lost under volume-default. | ✅ keep-on-volume |
| 12 | **Sculptor / Region / Region+ / Contour Fill** — `toolService.ts` | **Keep** — already in design, gated on Phase-5 audit (Contour Fill is must-fix) | None new — tracked by Phase 5; flagged only because behavior is *conditional* on the audit succeeding | ☐ keep ☐ change ☐ drop |

**Net: ✅ all 12 confirmed KEEP and folded into the specs (2026-06-05)** → requirements **§I "Viewer-chrome & toolbar behaviors"** is the authoritative preservation list. None re-opened the frozen toolbar. Decisions of note: #7a Favorites = existing Bookmarks (pinned + recent), #7b Import = local-DICOM (basic, revisit later), #11 Cine = on volume via CS3D `playClip`.
