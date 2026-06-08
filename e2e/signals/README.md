# Pending acceptance signals (annotation rebuild)

These specs encode the §G acceptance signals from
`docs/multiviewport-annotation-requirements.md` as **red-before-green** tests
against the **rebuilt** annotation surfaces (the frozen mockup baseline, design
§8.8). They drive the real app offline via the local-fixture path
(`e2e/helpers/local-fixture.ts`), with the `multiviewport` feature flag enabled.

They are **expected to fail** until their phase implements the behavior, so they
live here — *outside* the default green suite (`e2e/specs`, run by
`npm run test:e2e`) — and are run explicitly:

```bash
npx playwright test --config=playwright.signals.config.ts
```

As each phase implements a signal, its test goes green here; when a signal is
fully delivered + stable it graduates into the default suite. This is the seed
of the full 37-signal red suite (PHASES.md → Rebuild Phase 0).

## Rebuilt-panel testid contract (proposed; later phases implement to match)

| testid                          | meaning                                         |
|---------------------------------|-------------------------------------------------|
| `annotations-panel`             | the unified rebuilt Annotations side panel       |
| `create-segmentation`           | header create button → SEG container             |
| `create-structure`              | header create button → RTSTRUCT container        |
| `create-measurement`            | header create button → SR container              |
| `save-all-annotations`          | header save-all icon                             |
| `container-row` (`data-kind`, `data-approved`) | a container row (kind SEG/RTSTRUCT/SR; approved?) |
| `member-row` (`data-active`, `data-empty`, `data-selected`) | a member row (active draw-target? empty? selected?) |
| `member-visibility` (`data-mode`) | per-member tri-state control (filled/outlined/hidden) |
| `approve-container` / `approval-badge` | approve action + approved-state badge |
| `provenance-badge`              | interpolated/manual provenance marker on a contour |
| `active-viewport-indicator`     | indicator on the focused viewport |
| `autosave-row`                  | per-container autosave status row (silent, in-place) |
| `cross-series-pill`             | dimmed cross-series marker on a non-active-viewport row |
| `unsaved-sessions-banner`       | "N sessions with unsaved annotations" banner |

## Seeded so far

| Spec test          | §G signal | Fixture           | What it asserts (red now) |
|--------------------|-----------|-------------------|---------------------------|
| panel structure    | 31 (D7.6) | ct-axial-300      | rebuilt panel + 3 create buttons + save-all |
| measurement peer   | 32 (D7.1) | ct-axial-300      | create Measurement container → member row w/ value+unit |
| selection model    | 33 (A11)  | ct-axial-300      | single-click selects a member globally |
| region-segment     | 21 (C3)   | ct-axial-anatomy  | smart-brush fills a homogeneous in-tolerance region; lock blocks |
| 3D paint-fill + MPR | 16 (A6/C8) | ct-axial-anatomy | fill resamples onto sagittal MPR; undo reverts as one entry |
| empty active member | 17 (A)   | ct-axial-300      | new container's first member is active + empty; drawing fills it |
| approval lock      | 19 (D7)   | ct-axial-300      | approve edit-locks members + shows approval badge |
| visibility tri-state | 20 (D7.3) | ct-axial-300     | member control cycles filled/outlined/hidden |
| undo isolation     | 28 (A8)   | ct-axial-300      | undo reverts only the active container's last op |
| S3: multi-viewport + editing | 1,2,3,4,5,6,7,8,13,22,23,29,34,35 | ct-axial-300/-anatomy | rebuilt MPR propagation, shared-volume edit, cross-panel selection/lock, gesture continuity, interpolation, copy/paste, voxel-tool roster, tool/keyboard scoping |
| SEG round-trip    | 24 (C7/C8) | seg-multilabel    | loaded multi-segment SEG lists all 5 members in the rebuilt panel |
| Contour Fill      | 30 (C3)   | ct-axial-anatomy  | LabelMapEditWithContourTool boundary-fill into active segment, single-undo |
| S5: cross-series / FoR | 9,10,11,12,36 | mr-t1-t2 / breath-hold / cross-for | non-native dashed rendering, drawing-block on non-native series, breath-hold off-by-default, A2c auto-classify, different-FoR listed-not-rendered |
| S7: lifecycle / autosave | 14,15,25,26 | rtstruct-typed / seg-multilabel | auto-load + navigate, session-switch retention, queue-next-save, undo-across-save |

**34 of 37 signals seeded** (red), in `e2e/signals/`. The remainder are gated
outside the offline E2E harness, per the design's coverage note:
- **27** (save-conflict / save-failure round-trip) — needs **live XNAT**; authored under the Transport workstream gate.
- **37** (performance budget) — a **benchmark** (≥30 fps brush propagation, layout swap ≤ ~250 ms), measured under the perf harness, not pass/fail.
- **18** — retired (ROI type is not tracked).

All 9 design fixtures are built. As each phase implements a signal its test goes
green here; fully-delivered signals graduate into the default suite.
