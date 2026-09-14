# E2E spec organization — proposal (for review)

**Status:** APPROVED and IMPLEMENTED (2026-09-14).
**Decisions taken:** `interop/` folded into `transport/` (6 directories, not 7); signal IDs
dropped from filenames and kept in test titles.
**Date:** 2026-09-14
**Scope:** `e2e/specs/` (70 files). `e2e/signals/` is already correct and stays as-is.

---

## 1. Recommendation in one paragraph

Replace the `NN-` filename prefixes with **topic directories + descriptive filenames**, and
move the one thing the numbers actually buy — "run smoke first, fail fast" — into
**Playwright project dependencies**, which is the runner's own mechanism for ordering.
This is a pure reorganization: no test logic changes. It also lets us split the live-XNAT
`auth` specs into their own project so expired CNDA credentials stop blocking a full
offline run.

---

## 2. What the research actually says — including the inconvenient part

**Numeric prefixes are not, in general, bad practice. Playwright documents them.**

The official parallelism docs state that with `workers: 1` Playwright "runs test files in
alphabetical order," and explicitly offer prefixed filenames (`001-user-signin-flow.spec.ts`)
as one of two supported strategies when you need forced ordering. So the existing convention
is a documented Playwright pattern, not an invention, and it should not be characterized as
simply wrong.

The case against it is narrower and depends on a question about *this* suite:

> Does this suite actually need forced ordering?

Playwright's best-practices guidance is emphatic that it should not: "Each test should be
completely isolated from another test," and preconditions belong in hooks rather than in
execution order. The wider ecosystem agrees, and treats reliance on file ordering as one of
the anti-patterns that project dependencies exist to replace — the distinction being that
`dependencies` gives you ordering *declared explicitly*, rather than ordering that emerges
from a filename sort.

**For this suite, the answer is that it does not need ordering.** `e2e/fixtures/electron-app.ts`
already has an autouse, worker-scoped `resetState` fixture that performs a **full renderer
reload before every test**, reconstructing Cornerstone, the tool group, and every Zustand
store from scratch. The fixture's own comment describes this as the fix for
"passes alone, fails combined" pollution. Isolation is already engineered in.

So the numbers are not load-bearing for correctness. They are load-bearing for exactly one
thing: putting `00-smoke` and `01-login` before everything else so an environment failure
surfaces in seconds. That is a real benefit, and project dependencies deliver it better.

---

## 3. Why the current scheme should still change

Evidence gathered from the repo as it stands today:

| Symptom | Evidence |
|---|---|
| **Collision already happened** | Two files numbered `61`: `61-measurement-color` and `61-toolbar-undo-active-container`. Nothing enforces uniqueness. |
| **Permanent gaps** | Missing: 03–09, 49, 53, 54, 59. The sequence is an archaeological record of deleted specs, not an index. |
| **Topic scatter** | Measurement specs sit at 34, 55, 56, 60, 61, 62, 71, 79 — the number encodes *when it was written*, never what it covers. New specs can only append, so related work drifts apart permanently. |
| **Undocumented** | No `e2e/specs/README.md`; nothing in CLAUDE.md or AGENTS.md. The scheme is inferred by each new contributor, which is how it decayed. |
| **The repo already disagrees with itself** | `e2e/signals/` uses `<topic>.signals.e2e.ts` — descriptive, no numbers, with a README. The better convention already exists in-tree. |

The decisive point is the last one: we are not importing a foreign convention, we are
extending the one this repo already chose for its newer directory.

---

## 4. Proposed structure

```
e2e/specs/
  smoke/          launch + WebGL2 context                          (1 file)
  auth/           live-XNAT login + browser navigation             (2 files)
  viewport/       layouts, MPR, selection, overlays, scroll        (13 files)
  tools/          tool group, routing, bindings, drawing           (21 files)
  annotations/    panel, members, selection, approval              (20 files)
  transport/      fixture + DICOM load, round trips, autosave,
                  conflict, scan-click reload                      (13 files)
```

> `interop/` (fixture loads + DICOM round trips) was folded into `transport/` per review —
> both answer "did the data survive the trip?", and a 7th directory of 7 files was not
> earning its keep.

Directories are chosen so that the *question you are asking* leads you to one folder:
"is the brush broken?" → `tools/`; "does the panel show the row?" → `annotations/`;
"did the SEG survive a save?" → `transport/`.

---

## 5. Proposed naming convention

Filename: **`<subject>-<behaviour>.e2e.ts`**, kebab-case, no numbers.

Three rules:

1. **No numeric prefix.** Ordering is declared in config, not inferred from a sort.
2. **Drop the `unified-` prefix.** The unified path is the *only* viewport path since P1.8d;
   the word no longer distinguishes anything. (`15-unified-tool-group` → `tools/tool-group`.)
3. **Drop the `-signal-NN` suffix from filenames; keep signal IDs in test titles.** A file can
   cover several signals, so the filename is the wrong place for a single ID. Test titles
   already carry them (`"...(signal 29)"`), which means they appear in the HTML report and stay
   greppable — better traceability than a filename, not worse. The header comment keeps the
   prose link to the requirements doc.

Trade-off worth naming: requirements traceability matters for a medical imaging app, and
`-signal-29` in a filename is a genuinely convenient grep target. The proposal keeps grep
working (`grep -rn "signal 29" e2e/`) while removing the false implication that a file maps
to exactly one signal.

---

## 6. How ordering is preserved (and improved)

Replace filename ordering with explicit projects in `playwright.config.ts`:

```ts
projects: [
  { name: 'smoke',  testDir: './e2e/specs/smoke' },
  { name: 'app',    testDir: './e2e/specs',
                    testIgnore: ['**/smoke/**', '**/auth/**'],
                    dependencies: ['smoke'] },
  { name: 'auth',   testDir: './e2e/specs/auth', dependencies: ['smoke'] },
]
```

What this buys beyond parity:

- **Fail-fast is now declared, not emergent.** If `smoke` fails, dependent projects do not run
  at all — stronger than today's `maxFailures: 1`, which merely stops after the first failure
  wherever it happens.
- **Live-XNAT specs become opt-out.** `npm run test:e2e -- --project=app` runs the whole
  offline suite without touching CNDA. Today, `01-login` and `02-navigation` run *first*
  (verified with `--list`), so expired credentials abort the run under `maxFailures: 1` — the
  exact failure we hit on 2026-09-10, where 6 auth specs returned 401 and required
  `--max-failures=0` to see the other 92 results.
- Reports, traces and fixtures work normally, because setup projects are ordinary test files.

Suggested `package.json` additions: `test:e2e:offline` (`--project=app`) and
`test:e2e:live` (`--project=auth`).

---

## 7. Complete file mapping

<details>
<summary>All 70 files (old → new)</summary>

**smoke/**
- `00-smoke` → `smoke/launch-and-webgl2`

**auth/**
- `01-login` → `auth/login`
- `02-navigation` → `auth/xnat-browser-navigation`

**transport/** (includes the former `interop/` group)
- `10-walking-skeleton` → `transport/walking-skeleton`
- `11-fixture-rtstruct` → `transport/rtstruct-load`
- `12-fixture-seg` → `transport/seg-load`
- `20-unified-contour-polyseg` → `transport/contour-polyseg`
- `51-sr-export-signal` → `transport/sr-export`
- `57-sr-import-roundtrip` → `transport/sr-import-roundtrip`
- `58-sr-local-file-load` → `transport/sr-local-file-load`

**viewport/**
- `13-unified-viewport` → `viewport/viewport-creation`
- `14-mpr-layout` → `viewport/mpr-layout`
- `19-unified-layout-swap` → `viewport/layout-swap`
- `22-unified-viewport-selection` → `viewport/viewport-selection`
- `23-layout-dropdown-and-selection` → `viewport/layout-dropdown`
- `25-viewport-overlay-readouts` → `viewport/overlay-readouts`
- `26-generic-grid-multiscan` → `viewport/grid-multiscan`
- `27-crosshair-tool-no-crash` → `viewport/crosshair-no-crash`
- `28-slice-scrollbar` → `viewport/slice-scrollbar`
- `29-orientation-selector` → `viewport/orientation-selector`
- `30-two-panel-cross-series` → `viewport/cross-series-two-panel`
- `52-second-viewport-load-no-prompt` → `viewport/second-load-no-prompt`
- `77-mpr-3d-panel` → `viewport/mpr-3d-panel`

**tools/**
- `15-unified-tool-group` → `tools/tool-group`
- `16-unified-active-tool` → `tools/active-tool-registration`
- `17-unified-brush-mpr` → `tools/brush-mpr`
- `18-unified-undo` → `tools/undo`
- `21-unified-ui-tool-routing` → `tools/toolbar-routing`
- `24-unified-tool-switch-bindings` → `tools/switch-bindings`
- `35-keyboard-scoping` → `tools/keyboard-scoping`
- `42-contour-fill-signal-30` → `tools/contour-fill`
- `43-voxel-tools-lock-signal-29` → `tools/voxel-tools-lock`
- `44-threshold-brush-signal-29` → `tools/threshold-brush`
- `48-contour-fill-oblique-signal-30` → `tools/contour-fill-oblique`
- `50-toolbar-undo-redo` → `tools/toolbar-undo-redo`
- `61-toolbar-undo-active-container` → `tools/undo-active-container`
- `63-active-container-tool-switch` → `tools/active-container-tool-switch`
- `66-create-activates-drawing-tool` → `tools/create-activates-drawing-tool`
- `67-brush-targets-selected-segmentation` → `tools/brush-targets-selection`
- `68-default-brush-size` → `tools/brush-size-default`
- `69-segbidirectional-no-render-crash` → `tools/segbidirectional-no-crash`
- `72-brush-size-single-source` → `tools/brush-size-single-source`
- `78-untested-voxel-tools` → `tools/voxel-tools-effect`
- `79-measurement-tools-effect` → `tools/measurement-tools-effect`

**annotations/**
- `31-annotations-panel` → `annotations/panel`
- `32-annotations-selection` → `annotations/selection`
- `33-annotations-tool-affordance` → `annotations/tool-affordance`
- `34-annotations-measurement` → `annotations/measurement-member`
- `40-voxel-copy-paste` → `annotations/voxel-copy-paste`
- `41-sr-create-empty` → `annotations/sr-create-empty`
- `45-interpolated-provenance-signal-22` → `annotations/interpolated-provenance`
- `46-interpolation-signal-13` → `annotations/interpolation`
- `47-empty-member-signal-17` → `annotations/empty-member`
- `55-measurement-member-delete` → `annotations/measurement-delete`
- `56-measurement-toolbox-path` → `annotations/measurement-toolbox-path`
- `60-measurement-session-scope` → `annotations/measurement-session-scope`
- `61-measurement-color` → `annotations/measurement-color`
- `62-measurement-delete-display-and-no-plus` → `annotations/measurement-delete-display`
- `64-annotation-edit-scoping` → `annotations/edit-scoping`
- `65-locked-structure-not-editable` → `annotations/locked-structure`
- `70-backup-status-row` → `annotations/backup-status-row`
- `71-measurement-row-highlights-viewport` → `annotations/measurement-row-highlight`
- `73-inline-segment-metrics` → `annotations/inline-segment-metrics`
- `74-approval-lock` → `annotations/approval-lock`

- `36-transport-autosave-conflict` → `transport/autosave-conflict`
- `37-conflict-dialog-ui` → `transport/conflict-dialog`
- `38-unsaved-indicator-review` → `transport/unsaved-indicator`
- `39-session-switch-retention` → `transport/session-switch-retention`
- `75-sr-scan-click-reload` → `transport/sr-scan-click-reload`
- `76-scan-click-autoload` → `transport/scan-click-autoload`

</details>

The `61` collision disappears naturally — the two files land in different directories with
distinct names.

---

## 8. Migration plan

1. `git mv` every file (preserves history; a plain move+add would not).
2. Add `e2e/specs/README.md` documenting the directory meanings and the three naming rules,
   so the convention is written down rather than inferred.
3. Update `playwright.config.ts` with the three projects above.
4. Update the 21 cross-references:
   - 13 prose mentions of `spec NN` inside spec headers (e.g. "proved in spec 78",
     "spec 43's contract") → refer to paths instead.
   - 8 path references in `PHASES.md`, `docs/e2e-suite-triage-and-fix-plan.md`,
     `e2e/fixtures/dicom/README.md`.
5. Add `test:e2e:offline` / `test:e2e:live` scripts.
6. Full verification: `npm run build`, full Playwright run, confirm the same pass count
   (92 offline + 6 auth-gated) and that `--project=app` runs clean without credentials.

Incidental fixes to fold in (both are stale comments, not behaviour):
- `electron-app.ts` says the app fixture is "one Electron app per spec file"; it is
  worker-scoped, so with `workers: 1` it is one app for the **entire run** — which the
  `resetState` comment states correctly a few lines below.
- `maxFailures: 1` in config is why full runs need `--max-failures=0`. Worth revisiting
  once `smoke` is a hard dependency, but that is a behaviour change and is **not** part of
  this proposal.

---

## 9. Risks and costs

| Risk | Mitigation |
|---|---|
| Large diff (70 renames) touching every spec path | Pure rename; `git mv` keeps blame. Run the full suite before and after and compare pass counts. |
| In-flight branches/worktrees conflict on moved files | Do it when no other annotation work is mid-flight; it is a single mechanical commit. |
| Prose cross-references go stale silently | All 21 are enumerated above and updated in the same commit. |
| Loss of `-signal-NN` grep target | Signal IDs stay in test titles; `grep -rn "signal 29" e2e/` still works and is more accurate. |
| Someone later re-adds a number | The new README states the rule explicitly — the current scheme has no written rule at all. |

**Honest cost/benefit:** the payoff is discoverability and a cleaner ordering story, not
correctness — no test gets stronger. If the suite were about to stop growing, the right call
would be to leave it alone. It is growing (70 files, 9 added in the last month), which is
what tips it.

---

## 10. Not proposed

- No change to `e2e/signals/` — it already follows this convention.
- No change to any test logic, assertion, fixture behaviour, or helper.
- No Page Object Model refactor. The ecosystem guidance recommends POM; this suite uses
  direct locators plus `e2e/helpers/`, and changing that is a separate, much larger decision.
- No change to `maxFailures`, timeouts, or retry policy.

---

## 11. Decisions taken

| Question | Decision |
|---|---|
| Directory seams | `smoke / auth / viewport / tools / annotations / transport` — approved. |
| `interop/` | **Folded into `transport/`.** Both answer "did the data survive the trip?"; a 7th directory holding 7 files did not earn its keep. |
| Signal IDs in filenames | **Dropped.** They live in `test()` titles, so they still reach the HTML report and `grep -rn "signal 29" e2e/`. |
| Timing | Executed 2026-09-14 as a single mechanical commit. |

---

## Sources

- [Playwright — Parallelism (file ordering, `workers: 1`, prefixed filenames)](https://playwright.dev/docs/test-parallel)
- [Playwright — Best Practices (test isolation and independence)](https://playwright.dev/docs/best-practices)
- [Playwright — Test projects (`dependencies`, `testMatch`, `testDir`)](https://playwright.dev/docs/test-projects)
- [Playwright — Global setup and teardown](https://playwright.dev/docs/test-global-setup-teardown)
- [QASkills — Project dependencies for ordered setup projects](https://qaskills.sh/blog/playwright-test-project-dependencies-setup)
- [Testomat — Grouping Playwright tests](https://testomat.io/blog/grouping-playwright-tests-for-improved-framework-efficiency/)
- [BrowserStack — Writing scalable Playwright tests](https://www.browserstack.com/guide/playwright-scripts)
