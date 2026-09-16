# Viewport-scoped annotations + save-on-switch — proposal (for review)

**Status:** proposed, not implemented. Nothing changes until this is approved.
**Date:** 2026-09-16
**Scope:** the annotation panel's container model, scan/session switching, and the
multi-viewport display rules.

---

## 1. What is being asked for

1. **Prompt to save** when leaving a scan or session that has unsaved annotations.
2. **Show only the annotations belonging to the focused viewport.** Switching focus
   between viewports switches which annotations are listed.
3. **Reload on re-open** — annotations come back when their scan is opened again.

---

## 2. This reverses two recorded decisions

Worth stating plainly, because both were deliberate and the reasoning is on record.

**a. The save prompt was removed on purpose.** `f383e64` — *"Change 1c: session-switch
retention + hide held-over annotations (A13)"*:

> "Switching XNAT sessions no longer wipes (or prompts to save/discard) unsaved work —
> dirty containers from the previous session are RETAINED in memory and surfaced via the
> in-panel unsaved indicator; clean ones are unloaded."

`9a48e7c` before it replaced the below-toolbar banner with the in-panel unsaved indicator,
and `61f5097` added an anti-regression spec asserting that a second-viewport load shows
**no** prompt.

**b. Viewport scoping is the "Active only" filter, which was cut in review.**

> `docs/multiviewport-annotation-mockup.md:32` — *~~"Active only" toggle~~ — ❌ removed per
> review (dimming + pill convey it)*
>
> `CLAUDE.md:213` — *"containers are **session-scoped (not viewport-scoped)**. The container
> list shows **every** container; rows not on the active viewport are dimmed with a
> cross-panel pill (↗ 2 panels)."*

The mockup carrying that decision is marked **frozen**, and its sign-off pass explicitly
covered the active-vs-selected distinction (D7.5) and cross-series dimming (D9) — the
mechanisms that exist *instead of* viewport scoping.

So this replaces the core model: **session-scoped with dimming → viewport-scoped with
prompting.** Approving this proposal means re-approving the mockup's §2 and rewriting
`CLAUDE.md:213`.

---

## 3. Why the current model feels broken — measured

The reported experience ("no dimming", "I can draw in two viewports with different scans")
is not only a design disagreement. Parts of the current model were **never wired**.

| Mechanism | Status | Evidence |
|---|---|---|
| Cross-panel pill (`↗ N`) | **Never rendered** | `crossPanelCount` appears only inside `ContainerRow.tsx` — declared, destructured, rendered. Neither `ContainerList` nor `useAnnotationsPanel` ever passes it. |
| Member dimming (D9 / FoR eligibility) | **Never rendered** | `MemberRow.eligibility` defaults to `'native'` and is never supplied by `ContainerList`. |
| Draw gate (D3) | **Wired and enforced** | `useViewport.ts:203` → `evaluateDrawBlock` on pointerdown capture, blocks and warns. Needs separate diagnosis for the reported cross-viewport drawing. |
| Held-over container identity | **Unidentifiable** | `ContainerRow` shows a scan-id badge, but the code notes it is *"Absent until the annotation has been saved"* — and retention exists precisely to hold **unsaved** work. |

The last row is the crux of the confusion: the containers most likely to be retained are
structurally the ones with no identity to show. The review dialog already splits *"This
session"* from *"Held from other sessions"*, so the need was anticipated — the list just
never got the same treatment.

**This is the third never-wired prop found today**, after `ContextToolbox.compact` (panel
resize) and the threshold brush's range. Worth noting as a pattern, not three coincidences.

---

## 4. Proposed behaviour

### 4.1 The panel lists only the focused viewport's annotations

- The panel is scoped to `activeViewportId`.
- A container is listed when it is attached to, and renders on, that viewport.
- Changing viewport focus re-scopes the list. No filter toggle — focus *is* the filter.
- Containers that legitimately render on several viewports (same Frame of Reference,
  e.g. an MPR triple) appear in each of those viewports' lists. They are one container,
  not copies — editing from either place edits the same thing.

### 4.2 The prompt fires when a scan leaves the screen

- Replacing the scan in a viewport, or switching session, with unsaved containers that
  would become orphaned → modal: **Save · Discard · Cancel**. Cancel aborts the switch.
- **Adding** a viewport, or loading a scan into a *new* viewport, never prompts —
  nothing is leaving. This keeps GH #75 (`second-load-no-prompt`) intact.
- The trigger is "this container will no longer be shown anywhere", not "the session
  changed" — a container still visible in another viewport is not orphaned.

### 4.3 Unload and reload

- After Save or Discard, the scan's containers are unloaded from memory.
- Re-opening the scan reloads them. **This already works** — auto-load-on-scan-click is
  built and covered (`transport/scan-click-autoload`, `transport/sr-scan-click-reload`),
  so no new work here. Discarded (never-saved) work does not come back, which is correct.

### 4.4 What happens to dimming and the pill

With viewport scoping, "rows not on the active viewport" no longer exist — they are not
listed. So:

- **Cross-panel pill (`↗ N`)** — keep, and finally wire it. It stops meaning "this is
  elsewhere, dimmed" and starts meaning "this is also on N other viewports", which is
  genuinely useful for a same-FoR container in an MPR layout.
- **Member eligibility dimming (D9)** — wire it. Still needed *within* a viewport for
  members that cannot be edited there (`different-for`, displaced).

Both are wiring work that was outstanding regardless of this proposal.

---

## 5. Open question: is viewport scoping right for MPR?

The one case that argues against scoping: an MPR layout shows axial/coronal/sagittal of
the **same volume**. Scoping by viewport is invisible there — the same containers appear
in all three — so it costs nothing. The scoping only bites when viewports hold *different
scans*, which is exactly the case that prompted this.

So I believe scoping is safe, but it is worth confirming you want the list to re-render
on every focus change even in MPR, where the content will not visibly differ.

---

## 6. Work required

| Area | Change |
|---|---|
| `useAnnotationsPanel` | Scope `containers` to `activeViewportId`; supply `crossPanelCount` and member `eligibility` (both currently unwired) |
| Switch path (`App.loadFromXnatScan`, session switch) | Detect orphaning, show the modal, act on the choice, then unload |
| New dialog | Save / Discard / Cancel for leaving with unsaved work |
| `segmentationManager.applySessionSwitch` | Becomes "unload after the user has decided" rather than "retain silently" |
| Draw gate | Diagnose the reported cross-viewport drawing — the guard is wired, so the failure is in `canDrawOnViewport`'s decision, likely its documented fail-open when spatial ids are unresolved |

### Specs

| Spec | Fate |
|---|---|
| `transport/session-switch-retention` | **Inverts** — retention becomes prompt-then-unload |
| `viewport/second-load-no-prompt` (GH #75) | **Unchanged** — still must not prompt |
| `transport/unsaved-indicator` | **Unchanged** — the indicator and review dialog remain how you save |
| `viewport/cross-series-two-panel` | Revisit — it asserts cross-panel rendering behaviour |
| New | Panel re-scopes on focus change; prompt on scan replace; no prompt on viewport add |

### Docs

- `CLAUDE.md:213` — rewrite the multi-viewport coupling paragraph
- `docs/multiviewport-annotation-mockup.md` — §2 needs re-approval; the "Active only"
  removal decision is reversed
- Requirements A13 / D9 / signals 9–11 — note the supersession

---

## 7. Risks

- **Largest blast radius of anything changed this month.** It touches the container model,
  the switch path, and the panel's primary list.
- **A frozen, signed-off visual baseline changes.** That baseline is the reference the
  visual acceptance work depends on.
- **Losing work is now possible.** Today, unsaved work is never dropped; after this,
  Discard drops it deliberately. The modal is the only thing standing in front of it, so
  its wording and default matter.
- **Focus changes become stateful.** Clicking a viewport now changes what the panel lists;
  if focus is easy to change accidentally, the list will feel jumpy.

---

## 8. Decisions needed

1. Confirm the orphaning rule in §4.2 — prompt when a container would no longer be shown
   anywhere, rather than on any session change.
2. Confirm §5 — viewport scoping applies in MPR too, even though the list will not differ.
3. Should **Discard** be available at all, or only **Save · Cancel**? Discard is the only
   path that can lose work.
4. Does the cross-panel pill survive (§4.4), or is a single-viewport list enough?
