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
| `container-row` (`data-kind`)   | a container row (kind SEG/RTSTRUCT/SR)           |
| `member-row`                    | a member row (segment/ROI/measurement)           |

## Seeded so far

| Spec test         | §G signal | What it asserts (red now) |
|-------------------|-----------|---------------------------|
| panel structure   | 31 (D7.6) | rebuilt panel + 3 create buttons + save-all |
| measurement peer  | 32 (D7.1) | create Measurement container → member row w/ value+unit |
| selection model   | 33 (A11)  | single-click selects a member globally |
