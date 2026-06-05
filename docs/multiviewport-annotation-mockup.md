# Annotations Side Panel — Mockup & State Matrix

> ## 🔒 FROZEN — approved visual acceptance baseline
> Reviewed state-by-state and **approved by the user (dmarcus) on 2026-06-05**. **Both surfaces are frozen and are pixel-match requirements:** the **Annotations side panel** (§1–§9) and the **Top toolbar** (§10). This mockup is the frozen visual acceptance reference for the annotation rebuild (design §8.8). Implementation (Rebuild Phase 3) matches it; the §8.0 visual / pixel-diff assertions compare against screenshots of it. **Changes from here require an explicit re-open** (note the change + re-approval) — don't silently drift.

> **The visual acceptance reference** for the annotation rebuild (design §8.8). The implementation matches this mockup; the visual / pixel-diff acceptance assertions (§8.0) compare against frozen screenshots of it. This doc is the **completeness contract**: the mockup is "done" only when every state in the matrix below has a rendered example.

- **Mockup file:** [`docs/mockup/annotations-panel.html`](mockup/annotations-panel.html) — a self-contained static page using the app's Tailwind dark theme (zinc base, blue accent, dense type, 16×16 stroke-1.5 icons). Open it in a browser or the Launch preview panel. The state-by-state gallery (§1–§10) is the **frozen baseline**.
- **Full-application composite:** [`docs/mockup/full-app.html`](mockup/full-app.html) — the whole app frame. The **frozen redesigned surfaces** — toolbar (top) + Annotations panel (right) — are extracted **verbatim** from the gallery (any drift is a bug). The **window chrome, XNAT browser sidebar, and viewport** reproduce the **current app** (from the provided current-app screenshot + `XnatBrowser.tsx`) — these are *not* being redesigned, so they show today's UI with the two new surfaces dropped in. Built via `/tmp/build_fullapp.py`. **Note:** the panel shows the frozen *pelvis* reference example while the viewport shows the screenshot's *S002 brain MR* — in the live app the panel renders the loaded scan's own annotations; the cross-surface data here is illustrative.
- **Scope (per decision):** Annotations side panel — header, container rows, member rows, context toolbox, dialogs/overlays. **(This is what's frozen.)**
- **Top toolbar (§10) — 🔒 FROZEN / approved 2026-06-05 · pixel-match baseline:** the viewer-controls toolbar. Out of the original side-panel scope; added because the rebuild touches it, reviewed in its own track, now frozen alongside the side panel. Holds viewer controls only — annotation create/edit/save/delete stays in the side panel. **Final layout (left→right):** XNAT swirl logo (asset, **no wordmark**) + connection chip; **Import / Export / Favorites**; **Layout (2×2 ▾) + Hanging ▾** (MPR removed — it's a layout preset); windowing (crosshairs / pan / zoom / W-L active / Soft-tissue preset / **Invert** — placed adjacent to W-L; grayscale-negative, **distinct icon** from the W-L circle); transform (**rotate** [distinct image-rotation icon, ≠ reset] / flip H / flip V / reset); undo / redo (per active container, A8); cine (fps); — *(right)* — **Annotate** (blue, opens/closes the Annotations panel) · Tags · Settings. The **XNAT-browser sidebar is always visible**, shrunk via a drag handle (no toolbar toggle).
- **Behaviour is NOT in this mockup.** A static mockup captures visual *states*, not *dynamics*. The interaction/lifecycle contract — when the panel populates, what happens on scan-navigate vs. session-switch, unload + unsaved-retention — lives in the **requirements** (A13 "Annotation lifecycle", B5 auto-load, E3/transport-E5 retention) and is verified by **acceptance signals 25–26** (E2E), not by this HTML.
- **Out of scope for this mockup:** the D9 **canvas** rendering styles (dashed stroke / cross-hatch fill for non-native contours) are drawn on the Cornerstone canvas, not the DOM — they get a separate style note (cadence, opacity) and are verified by the signal-9/10 pixel snapshots, not this HTML. Viewport-area chrome (on-canvas dimming, pill placement) is likewise deferred.
- **How it feeds testing:** once frozen, screenshots of each labelled cell become the pixel-diff baselines the §8.0 visual assertions run against. The implementation translates the mockup's markup into the presentational React components in `components/annotations/` (architecture doc §4.2).

## How we iterate (complete)

I draft → you review the rendered page → we adjust state-by-state against the matrix → **freeze** as the baseline. ✅ **Done** — reviewed, adjusted across many rounds, and frozen (see banner above). The matrix below is now the frozen reference; every row is ✓ (or an explicit ❌-removed-per-review).

---

## State matrix

Legend: ✅ rendered in the current draft · ◻ still to add before freeze · — n/a (out of scope / future).

### Panel shell & header
| State | Req | Status |
|---|---|---|
| Three create buttons (Structure · Segmentation · Measurement) | D7.1/D7.6 | ✅ (type-colored green / purple / orange; in header every state + empty-CTA; colored "+") |
| Create buttons **disabled** — no scan loaded in active viewport | D7.6/D3 | ✅ (§1a) |
| ~~Filter / search field~~ | — | ❌ removed per review (few annotations) |
| ~~"Active only" toggle~~ | — | ❌ removed per review (dimming + pill convey it) |
| ~~Sort control (creation / alpha / size)~~ | — | ❌ removed per review (not needed; not implemented anywhere) |
| Save-all header icon — enabled (≥1 dirty) / disabled (nothing to save) | D7.6 | ✅ (§2 enabled w/ dirty dot · §1a/§1b disabled) |
| Inline rename (double-click → edit field; ⏎/esc) — container + member | D7.6 | ✅ (§6) |
| Create-in-edit-mode (new container/member → default name pre-selected) | D7.6 | ✅ (§6) |

### Container rows
| State | Req | Status |
|---|---|---|
| RTSTRUCT (Structure) · SEG (Segmentation) · SR (Measurement) kinds | D7.1 | ✅ (all three) |
| Expanded | D7.1 | ✅ |
| Collapsed | D7.1 | ✅ (§7) |
| Clean / Dirty / Saving | A9, E2 | ✅ |
| Approved (locked) | D7.11 | ✅ |
| Conflict / Transient-failure | E3, H5/H7 | ✅ |
| Loading (spinner) / Parse-error (banner + retry/remove) | D7.9 | ✅ |
| Cross-panel pill ("↗ N") | CLAUDE.md UI arch | ✅ |
| Empty container (no members, "add new") | D7.9 | ✅ (§7) |
| Add-member "+" button on the container row | D7.6 | ✅ (§2/§7 — disabled on approved containers, §2 Baseline) |
| Per-container **Save icon** on the row (left of kebab) — enabled dirty / disabled clean / disabled approved | D7.6 | ✅ (§2 A enabled · B/C disabled) |
| **Approve "✓" toggle on the row** (not kebab; **no "APPROVED" text badge** — toggle is the indicator) — outline (approve) / green (approved→revoke) | D7.6/D7.11 | ✅ (§2 A/B outline · C green; §3 approved row) |
| **Delete "✕" on every row** (container + member) — local/XNAT logic; disabled when approved | D7.6/transport C8 | ✅ (§2 — members + containers; approved disabled) |
| Member rows **indented** under their container | — | ✅ (per review) |
| No "RS:/SEG:/SR:" prefix on container name (kind shown by colored icon) | — | ✅ (per review) |
| Container kebab (open) — **trimmed**: hide-all/lock-all/export-DICOM/**export-CSV**/revert (no rename/add/save/approve/delete — those are row buttons) | D7.6 | ✅ (§7) |

### Member rows
| State | Req | Status |
|---|---|---|
| Color swatch · name · geometry summary (slices / cm³ / cm²) | D7.2 | ✅ |
| ~~ROI-type badge (GTV/CTV/PTV/ORGAN/EXTERNAL/AVOIDANCE/MARKER/…)~~ | — | ❌ removed per review — not shown/edited; `RTROIInterpretedType` preserved on round-trip only (D7.2) |
| Provenance: manual (no badge) / interpolated ("auto") / imported | D7.2 | ✅ |
| Visibility 3-state: filled / outlined / hidden | D7.3 | ✅ |
| Lock: **unlocked (open shackle, gray)** / **session-locked (closed, amber)** / **approved (closed, green)** — shape (open vs closed) + color, no read-only padlock | D7.3/D7.11 | ✅ (per review) |
| Active (the "pen") — left accent + indicator | D7.5 | ✅ |
| Selected — highlight ring | D7.5 | ✅ |
| Active **and** selected (combined treatment) | D7.5 | ✅ (§8 — left accent + ring + dot) |
| Hover emphasis | D2/D7.8 | ✅ (§8 — bg + jump-to revealed; static) |
| Cross-series (non-native): dimmed + source-series indicator (conveys read-only; **no separate read-only padlock**) | D9 | ✅ (per review) |
| Different-FoR: "not viewable here" | A2d/D7.4 | ✅ |
| Interpolated auto-marker | B5/D7.4 | ✅ |
| Empty member "(empty)" | D7.4 | ✅ |

### Context toolbox (adapts to active kind)
| State | Req | Status |
|---|---|---|
| **3-wide icon+label grid, responsive → icon-only** as panel narrows | C3 | ✅ (§4 — full grid + 4b icon-only) |
| Segmentation tools — full registered set (brush family · scissors · paint fill · region/region+ · multi-threshold · contour fill · select · seg-bidir) | C3 | ✅ (§4) |
| Structure tools (freehand/spline/livewire/sculptor — **no copy/interpolate**) | C3 | ✅ (§2/§4) |
| Measurement tools (length/angle/bidir/ellipse/rect/circle ROI/probe/arrow/freehand) | §5.5 | ✅ (§4) |
| Controls strip (active segment + labelmap opacity) + backup status | C3/§3.4 | ✅ (§4) |
| Toolbox header: `<KIND> TOOLS` + colored active-member name (all three kinds) | — | ✅ (§2/§4 — per review) |
| Active tool highlight | — | ✅ |
| **Planned tool — greyed (temporary)** (e.g. Dyn. Thresh, Sph. variants, Rect Multi) | C3 | ✅ (§4 — flat grey, distinct from D3) |
| Disabled tool (no FoR-matched viewport) | D3 | ✅ (§4 Sphere — dashed + slash) |

### Dialogs & overlays
| State | Req | Status |
|---|---|---|
| New-member name entry (name + color; **no type dropdown** — removed per review) | D7.6 | ✅ (§5) |
| Delete confirm | D7.6 | ✅ |
| Conflict resolution — Keep local / Discard local / Inspect | H7 | ✅ |
| Revoke-approval confirm | D7.11 | ✅ |
| Approve confirm | D7.11 | ✅ (§5) |
| Save-in-progress — **in-place** (row spinner + footer strip), **not** a toast/overlay | §3.4 | ✅ (§9 — reconciled, see note) |

### Session-level
| State | Req | Status |
|---|---|---|
| Empty session ("no annotations yet" + create only — no load button) | D7.9 | ✅ (spec change — see note) |
| Auto-load on scan selection (no manual "load from XNAT" affordance) | B5 | ✅ (no UI element — behavior note) |

---

## Pre-freeze sign-off — ✅ complete (approved 2026-06-05)
Every matrix state renders, the state-by-state review is done, and the user signed off. The sign-off pass covered density/spacing, the active-vs-selected distinction (D7.5), cross-series dimming (D9), and color choices — all approved. (ROI-type badges, filter, "Active only", and Sort were *removed* during review; see decisions below.) The mockup is **frozen** (banner at top).

### Decisions during review (recorded; specs updated to match)
- **Browser per-scan annotation indicator uses the annotation-type icon + color** (struct = green curve, seg = purple square, meas = orange diamond) — same icons/colors as the panel — with a count, instead of a generic badge. Shown on the loaded SAG T1 FLAIR scan in `full-app.html` (purple ×2 = two SEGs). (Behaviour/lifecycle of *when* the panel populates / what happens on scan-or-session switch is a spec concern, not a static-mockup one — see note below.)
- **No manual "load from XNAT" in the panel.** Annotations **auto-load** when the user selects a session/scan in the XNAT Browser (the implemented `autoLoadSegOnScanClick` behavior, default on). Formalized in transport **B5**; the manual session-level action removed from requirements **D7.6** and the empty-session affordance **D7.9**, and from design §7. The empty session shows create-only.
- **Type-accent palette** (matches the app's `TYPE_ACCENTS`, extended for the new Measurement peer): **Structure = green/emerald**, **Segmentation = purple**, **Measurement = orange**. Applied to the type icons, the three create buttons, and the container-kind cue. **Blue stays reserved exclusively for active/selection** — Measurement uses orange specifically to avoid colliding with the active/selected blue.
- **Create buttons appear in the header in EVERY state** (consistent control — no longer moves between empty/populated). The empty session *also* shows the three large labeled CTA buttons as an onboarding aid. Every create affordance — header icons and CTA buttons — carries a **colored "+"** next to the type icon, in the type color.
- **Filter / search and "Active only" removed.** Annotation counts per session are small enough that filtering isn't worth the chrome; active-viewport state is already shown by row dimming + the cross-panel pill. Sort (Created / A–Z / Size) is kept. Specs: requirements D7.7, CLAUDE.md UI arch.
- **ROI type (`RTROIInterpretedType`) not tracked at all.** No badge, no editor, no create-dialog dropdown, and **no dedicated member-model field**. Not special-cased among DICOM tags — like any other source-file tag it rides through general round-trip fidelity untouched, not singled out (no dedicated preservation requirement). **Signal 18 retired** (numbering 19–24 preserved). Specs: requirements D7.2 / signal 18, design data model + §7 + containerService.
- **Sort removed entirely** (not needed; wasn't implemented anywhere). D7.7 is now "Ordering" (load order + drag-reorder only). Mockup §6 repurposed.
- **Planned tools shown greyed (temporary).** The tools that were asterisked in the prior toolbox mock (Dynamic Threshold, Spherical Brush/Eraser/Threshold, Rectangle-Multi) are registered-but-not-yet-wired; they render **flat-greyed with a "planned" tooltip** — to be implemented right after this project. Distinct from the D3 "no FoR viewport" disable (dashed + slash). Label/Intersect omitted entirely (no Cornerstone mapping). Spec: C3.
- **Toolbox header style unified** to `<KIND> TOOLS` + the active member's name **in its own color** — just the colored label, no arrow or swatch (the color is the cue). Applied to all three kinds (§2/§4). The "editing across N panes" badge was **removed** (the container row's "↗ N" cross-panel pill already conveys multi-pane state).
- **Toolbox redesigned to the agreed 3-wide icon+label layout** (§4), responsive: full width = 3 columns of icon+label; narrower = labels truncate then hide → icon-only. **In scope = every registered Cornerstone3D tool** for the active kind (full lists in requirements C3 "Toolbox scope"); **AI/auto-seg tools deferred**. View tools (pan/zoom/scroll/WL/crosshairs) stay in the toolbar. **Interpolate removed** (it's a setting/behaviour, B5 — a controls toggle, not a tool) and **Copy/paste removed** (keyboard viewport action, Ctrl-C/V per C3). Toolbox carries a `<KIND> TOOLS` header with the active member's colored name, a Controls strip (active segment + labelmap opacity), and the silent backup status.
- **Approve and Delete are row buttons** (not kebab). Container rows now carry the cluster **approve ✓ · add + · save · kebab ⋮ · delete ✕**. Approve is a toggle (outline = approve / green = approved→revoke). Delete ("✕") is on **every** row (container + member), disabled on approved items, and triggers the local-vs-XNAT removal logic (transport C8). The kebab is now just Hide all · Lock all · Export DICOM · Export CSV · Revert.
- **Lock states simplified to three, shape-distinguished:** unlocked = **open** shackle (gray); session-locked = **closed** shackle (amber); approved = **closed** shackle (green). Open-vs-closed shape carries the meaning so it doesn't rely on color alone. The **read-only padlock was dropped** — a cross-series member's read-only status is already conveyed by its cross-series source indicator (D9), so the redundant dim padlock is gone.
- **Member rows indented** under their container for clear hierarchy. **Structure-tools label colored to match the active member** (e.g. red for GTV_primary, with a swatch).
- **Export to CSV…** added to the kebab — writes per-member metrics (volume / slices / area / HU stats / measurement values) to a CSV. Surfaces the segment-statistics capability listed in PHASES "Segmentation Enhancements"; a local file export alongside Export-to-DICOM. Spec: D7.6.
- **Per-container Save icon on the row** (left of the kebab) — enabled when that container is dirty, greyed when clean or approved. Counterpart to the header Save-all. **Kebab de-duplicated**: Rename (now double-click) and Add member (now the row "+") removed from the menu; kebab keeps Hide all · Lock all · Approve · Export to DICOM… · Revert. **Export to DICOM** = write a standalone DICOM file (SEG/RTSTRUCT/SR) to local disk (distinct from saving to XNAT). **Revert** = discard unsaved local changes back to last-saved (confirmed). Spec: D7.6.
- **Inline rename by double-click; create starts in edit mode.** Double-click a container/member name → inline edit (⏎ commit, esc cancel; kebab "Rename" is the alt). New container/member is created with a default name and immediately in edit mode with the text pre-selected. Default-name scheme proposed in §6 (open to change). Spec: D7.6.
- **Add-member is a button on the container row** (a "+" in each container header), not just a kebab item — quicker access. Disabled on approved (locked) containers (D7.11). Empty containers still show the in-body "+ Add member" affordance.
- **No "RS:/SEG:/SR:" prefix** on container names — the colored kind icon already identifies the type.
- **No header "panel settings" kebab.** Removed — the settings it would hold (autosave, default visibility, opacity, etc.) belong in global or tool-specific settings, not a panel menu. The header keeps the three create buttons + a **Save-all icon** (D7.6 "save all dirty containers"), greyed when nothing is dirty / nothing loaded. (The per-*container* kebab — rename/hide-all/lock-all/approve/export/revert, §7 — is unaffected and stays.)
- **Create is disabled when no scan is loaded in the active viewport** (§1a). Create tags to the active viewport's series, so with nothing loaded there is no FoR target; the buttons grey out (D3 disabled style) with an explanatory tooltip and enable once a scan loads. Spec: requirements D7.6 + D7.9.

### Reconciliation recorded (prose vs. mockup, per CLAUDE.md §6)
- **Save-in-progress is in-place, not a toast/overlay.** The matrix originally listed "Save-in-progress overlay / toast." That conflicts with the decided silent-autosave UX (design §3.4) and the CLAUDE.md surface taxonomy ("no banners for routine events; autosave success is silent, surfaced in-place"). Reconciled in favor of the prose: §9 shows the per-container row spinner (autosave) and an in-place footer strip for an explicit "Save all." A toast is reserved for a user-initiated save that *failed* or briefly succeeded; a banner only for non-routine high-stakes events. No floating save overlay.
