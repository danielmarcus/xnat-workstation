# Annotations Side Panel — Mockup & State Matrix

> **The visual acceptance reference** for the annotation rebuild (design §8.8). The implementation matches this mockup; the visual / pixel-diff acceptance assertions (§8.0) compare against frozen screenshots of it. This doc is the **completeness contract**: the mockup is "done" only when every state in the matrix below has a rendered example.

- **Mockup file:** [`docs/mockup/annotations-panel.html`](mockup/annotations-panel.html) — a self-contained static page using the app's Tailwind dark theme (zinc base, blue accent, dense type, 16×16 stroke-1.5 icons). Open it in a browser or the Launch preview panel.
- **Scope (per decision):** Annotations side panel — header, container rows, member rows, context toolbox, dialogs/overlays.
- **Out of scope for this mockup:** the D9 **canvas** rendering styles (dashed stroke / cross-hatch fill for non-native contours) are drawn on the Cornerstone canvas, not the DOM — they get a separate style note (cadence, opacity) and are verified by the signal-9/10 pixel snapshots, not this HTML. Viewport-area chrome (on-canvas dimming, pill placement) is likewise deferred.
- **How it feeds testing:** once frozen, screenshots of each labelled cell become the pixel-diff baselines the §8.0 visual assertions run against. The implementation translates the mockup's markup into the presentational React components in `components/annotations/` (architecture doc §4.2).

## How we iterate

I draft → you review the rendered page → we adjust state-by-state against the matrix → **freeze** as the baseline. The matrix is the punch list; nothing is "the reference" until its row is ✓ and you've signed off.

---

## State matrix

Legend: ✅ rendered in the current draft · ◻ still to add before freeze · — n/a (out of scope / future).

### Panel shell & header
| State | Req | Status |
|---|---|---|
| Three create buttons (Structure · Segmentation · Measurement) | D7.1/D7.6 | ✅ |
| Filter / search field | D7.7 | ✅ |
| "Active only" toggle | CLAUDE.md UI arch | ✅ |
| Sort control (creation / alpha / size) | D7.7 | ◻ |
| Panel settings (kebab) | — | ✅ |

### Container rows
| State | Req | Status |
|---|---|---|
| RTSTRUCT (Structure) · SEG (Segmentation) · SR (Measurement) kinds | D7.1 | ✅ (all three) |
| Expanded | D7.1 | ✅ |
| Collapsed | D7.1 | ◻ |
| Clean / Dirty / Saving | A9, E2 | ✅ |
| Approved (locked) | D7.11 | ✅ |
| Conflict / Transient-failure | E3, H5/H7 | ✅ |
| Loading (spinner) / Parse-error (banner + retry/remove) | D7.9 | ✅ |
| Cross-panel pill ("↗ N") | CLAUDE.md UI arch | ✅ |
| Empty container (no members, "add new") | D7.9 | ◻ |
| Container kebab menu (open) — rename/hide-all/lock-all/approve/export/revert | D7.6 | ◻ |

### Member rows
| State | Req | Status |
|---|---|---|
| Color swatch · name · geometry summary (slices / cm³ / cm²) | D7.2 | ✅ |
| ROI-type badge: GTV / CTV / PTV / ORGAN | D7.2 | ✅ |
| ROI-type badge: EXTERNAL / AVOIDANCE / MARKER / others | D7.2 | ◻ |
| Provenance: manual (no badge) / interpolated ("auto") / imported | D7.2 | ✅ |
| Visibility 3-state: filled / outlined / hidden | D7.3 | ✅ |
| Lock: unlocked / locked / approved-lock | D7.3/D7.11 | ✅ |
| Active (the "pen") — left accent + indicator | D7.5 | ✅ |
| Selected — highlight ring | D7.5 | ✅ |
| Active **and** selected (combined treatment) | D7.5 | ◻ |
| Hover emphasis | D2 | ◻ (static; annotate behavior) |
| Cross-series (non-native): dimmed + source-series + read-only lock | D9 | ✅ |
| Different-FoR: "not viewable here" | A2d/D7.4 | ✅ |
| Interpolated auto-marker | B5/D7.4 | ✅ |
| Empty member "(empty)" | D7.4 | ✅ |

### Context toolbox (adapts to active kind)
| State | Req | Status |
|---|---|---|
| Structure tools (freehand/spline/livewire/sculptor/copy/interpolate) | C3 | ✅ |
| Segmentation tools (brush/eraser/threshold/paint-fill/scissors/region/contour-fill) | C3 | ✅ |
| Measurement tools (length/angle/bidirectional/ROI/probe/arrow) | §5.5 | ✅ |
| Active tool highlight | — | ✅ |
| Disabled tool (no FoR-matched viewport) | D3 | ◻ |

### Dialogs & overlays
| State | Req | Status |
|---|---|---|
| New-member name entry (+ type + color) | D7.6 | ✅ |
| Delete confirm | D7.6 | ✅ |
| Conflict resolution — Keep local / Discard local / Inspect | H7 | ✅ |
| Revoke-approval confirm | D7.11 | ✅ |
| Approve confirm | D7.11 | ◻ |
| Save-in-progress overlay / toast | §3.4 | ◻ (header "saving" shown; full overlay TODO) |

### Session-level
| State | Req | Status |
|---|---|---|
| Empty session ("no annotations yet" + create/load) | D7.9 | ✅ |
| Load-from-XNAT affordance | H9 | ✅ |

---

## Open punch list before freeze
The ◻ rows above, plus a sign-off pass on: density/spacing, the active-vs-selected visual distinction (must be unmistakable per D7.5), the cross-series dimming level (legible on dark backgrounds per D9), and badge color choices against the existing palette.
