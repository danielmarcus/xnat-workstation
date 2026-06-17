# E2E suite triage & fix plan — full sequential run

**Branch:** `annotation-cleanup`  ·  **Goal:** make the full Playwright E2E run
(`npm run test:e2e`, single worker) green, so the suite gate can move from
"targeted spec groups pass" to "the whole suite passes".

This is a living doc — execute top to bottom; status is tracked inline.

---

## 1. How the suite actually runs (the key to the failures)

- `playwright.config.ts`: **`workers: 1`**, `retries: 0`. One worker runs every
  spec file sequentially.
- The Electron app is a **worker-scoped** fixture (`e2e/fixtures/electron-app.ts`)
  — ONE renderer is shared across many spec files. Playwright keeps that worker
  (and its Electron) alive across files and **only restarts it after a test
  fails**.
- Playwright batches specs by the worker fixtures they require. The offline,
  local-fixture specs (`00`, `10`–`60`) run first under the base `electron-app`
  fixture; the live-XNAT specs that need the `auth` worker fixture (`01`, `02`)
  and the legacy specs run in a separate later batch.

**Consequence:** state written by one spec (an open modal dialog, leftover
segmentations / measurements / SR containers, a ref-counted shared volume left
held, a non-default layout, a dirty/connected session) **leaks into the next
spec in the same worker**. Because the worker only restarts on failure, dirty
state accumulates across a long run of *passing* specs and then knocks over a
later spec — and, once a spec leaves a blocking modal up, it can **cascade**
through every spec after it. The newer annotation specs defend themselves with
`beforeEach` resets; the rest of the suite does not.

## 2. Baseline (red) — measured before any fix

Full run against a clean build, `--max-failures=0`:

```
46 failed
40 passed (11.7m)
```

(The task's earlier "27 failed / 57 passed" predates suite growth — there are now
86 cases through spec `60`, and the cascade reaches further.)

### Failure buckets (verified by isolation runs — each failing spec run ALONE)

The task assumed two classes (legacy + pollution). Running every failing spec in
isolation against the current build proved it is **three** buckets — a
substantial set fails *even alone*, so no reset fixture can fix them.

**Class A — legacy specs (retire).** Live-XNAT `auth` fixture **and** the
pre-rebuild single-viewport UI (`Measure` dropdown, `segmentation-panel`,
`annotation-panel`, `add-segmentation-btn`, `annotation-count` testids). Those
panels mount only when `preferences.features.multiviewportEnabled` is **OFF**;
the default was flipped **ON** (commit `ec57178`), so the old selectors no longer
resolve. Last meaningfully touched 2026‑03/04, before the annotation rebuild.

| Spec | Cases | Replacement coverage (rebuilt, offline) |
|---|---|---|
| `03-image-viewing` | 5 | `13`, `25` (overlay readouts), `28` (scrollbar), `29` (orientation) |
| `04-annotations` | 5 | `31`–`34`, `55`, `56` (measurement create/select/delete) |
| `05-segmentations` | 6 | `12`, `15`–`18`, `40`, `43`, `44` (create/brush/lock/copy-paste) |
| `06-save-upload` | 1 | `36`, `37`, `51` (save/conflict/SR export) |

→ **Retired** (deleted). Coverage gap explicitly accepted: the *live* XNAT
round-trip (real network upload in `06`, real scan-load interactions in `03`) is
no longer exercised by the default suite. The live login/browse path is still
covered by `01`/`02`. A live-XNAT smoke can be reinstated later as a separate,
opt-in, FoR-gated project if desired — out of scope for "green full run".

**Class B — cross-spec pollution (PASS alone, fail combined). Fixable by reset.**
Confirmed pass-alone via isolation runs:
`16, 23, 32, 34, 38, 40, 41, 42, 44, 45, 47, 51, 55, 57, 58, 59, 60` (~17 cases),
plus `01-login` (session/localStorage carryover — its own fresh Electron shares
the persisted `--user-data-dir`, so a prior spec's session auto-reconnects and
"login form renders on launch" fails).
These are downstream of an earlier spec leaving the shared renderer dirty (open
dialog, leftover containers, leaked tool-group viewports/bindings). The in-memory
reset attempted below was **insufficient** (it doesn't reset the unified
tool-group state that breaks `16`/`23`) — the reliable fix is a full renderer
re-init (`page.reload()`) before each test. `01-login` additionally needs the
persisted session cleared.

**Class C — INTRINSIC failures (fail even ALONE). NOT pollution; no reset helps.**
Confirmed failing in isolation: `24, 27, 29, 30, 36, 39, 43`. These are either
genuine app regressions (e.g. `29-orientation-selector` guards the user bug "I can
no longer view an axial image in sagittal orientation") or specs gone stale
against the reworked UI (toolbar button names/roles). Each needs per-spec triage
(fix the app vs. update the spec) — see §3c.

## 3. The fix

### 3a. Worker-level autouse reset (Class B) — `page.reload()`
A first attempt at a hand-rolled in-memory reset (`resetForTest()` clearing
dialogs/containers/selection/transport/layout + a `resetSharedVolumes()` that
evicted cached volumes) was **abandoned** — it (i) didn't reset the unified
tool-group state that breaks `16`/`23`, and (ii) the volume eviction, run between
the tests of a multi-test spec, broke volume **re-acquisition** ("Shared volume
not ready"), regressing `30`/`36`/`39`/`43`. Enumerating every in-memory pollution
vector is fragile.

The robust fix is a full renderer **reload** before each test:

- `e2e/fixtures/electron-app.ts` — **autouse** worker-isolation fixture: before
  every test it `page.reload()`s the shared window and waits for `__XNAT_E2E__` to
  reinstall. Reload re-runs `main.tsx`, so Cornerstone, the unified tool group,
  every Zustand store and every cache are reconstructed from scratch — no vector
  enumeration needed. Inherited by the `auth` fixture. Offline specs re-enter via
  `enterLocalViewer`; the live `auth` specs re-detect their main-process session
  on reload, so both survive it.

This alone took the offline pollution + cascade from ~25 failures to **0**
(verified: a full run dropped from 46 fail / 40 pass → 3 fail / 65 pass, the 3
being the Class-C stale specs below; runtime also fell 11.7m → 2.6m as the
pollution-induced 30 s timeouts vanished).

### 3b. Retire legacy specs (Class A)
Deleted `03-image-viewing`, `04-annotations`, `05-segmentations`,
`06-save-upload`. (`viewer.page.ts` stays — `helpers/local-fixture.ts` still uses
it; `xnat-browser.page`/`login.page` stay — `01`/`02` use them.)

### 3c. Stale specs (Class C) — update to the current UI
These failed *in isolation*; not pollution. Verified each is a stale spec (the
behavior under test still works), not an app regression:

- **`24`, `27`** — located toolbar buttons by their `title` as the accessible
  name. The buttons now render visible text labels (`Pan`, `Cross`, …), so the
  accessible name is the short label (and the bare `Pan` substring collides with
  "Show segmentation **pan**el"). → switched to `button[title="…"]` locators.
- **`29`** — asserted the orientation dropdown defaults to `AXIAL`; it now
  defaults to `ACQUISITION` (a real, intentional option: Acquisition/Axial/
  Sagittal/Coronal). → assert `ACQUISITION`. The actual reformatting assertion
  (switch to Sagittal ⇒ slice total jumps to ≥64) **still passes**, so the
  feature itself is fine.

### 3d. `01-login` (Class C-pollution) — no longer failing
`01-login` shares the default `--user-data-dir`, so a prior spec's persisted
session can auto-reconnect and hide the login form. With the reload-isolated run
it passes (all 4 tests). Left as-is; if it later flakes, give its per-test
Electron a throwaway user-data-dir.

## 4. Ordered execution & status

1. [x] Capture red baseline with observability — **46 failed / 40 passed**.
2. [x] Isolation sweep → bucket every failure (pass-alone = pollution;
   fail-alone = stale/intrinsic).
3. [x] Retire legacy specs `03`–`06`.
4. [x] Autouse `page.reload()` isolation fixture (replaces the abandoned
   in-memory reset; dead code removed).
5. [x] Fix stale specs `24`, `27`, `29`.
6. [x] Rebuild `dist/`.
7. [x] Final `npm run test:e2e` — **68 passed / 0 failed (1.3m), exit 0. GREEN.**

### Final changeset
- `e2e/fixtures/electron-app.ts` — autouse `page.reload()` isolation.
- deleted `e2e/specs/03`–`06` (legacy).
- `e2e/specs/24`, `27`, `29` — stale-selector / stale-default fixes.
- (the abandoned in-memory-reset edits to `volumeService.ts` /
  `installRendererE2eHooks.ts` were reverted — net zero.)

### Baseline → final
`46 failed / 40 passed (11.7m)` → `0 failed / 68 passed (1.3m)`. The runtime drop
is the pollution-induced 30 s timeouts disappearing.

## 5. Verification
`rm -rf dist && npm run build` then `npm run test:e2e`. Red-before-green is
satisfied: every Class-B spec is observed failing in §2's baseline and passing
under reload isolation; the three Class-C specs are observed failing in isolation
(stale) and passing after the spec updates.
