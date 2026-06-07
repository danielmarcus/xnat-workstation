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

**23 of 37 signals seeded** (red). Remaining ~28 are tracked for later passes;
some need richer fixtures (paired series, RTSTRUCT/SEG objects) or session/XNAT
machinery (lifecycle/conflict signals 25–27, 36).
