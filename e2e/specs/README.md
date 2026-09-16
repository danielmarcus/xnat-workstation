# E2E specs — layout and naming

Playwright specs for the Electron app, grouped by **the question you are trying to answer**.
Run with `npm run test:e2e` (see [Running](#running) for the offline/live split).

## Directories

| Directory | Holds | Ask it when |
|---|---|---|
| `smoke/` | Electron launch + WebGL2 context | "Is the harness even alive?" |
| `auth/` | XNAT login, browser navigation | "Can we reach the server?" |
| `viewport/` | Layouts, MPR, selection, overlays, scrolling, orientation | "Is it rendered/arranged right?" |
| `tools/` | Tool group, routing, bindings, drawing, undo | "Does the tool do anything?" |
| `annotations/` | Panel, containers/members, selection, approval, metrics | "Does the panel reflect it?" |
| `transport/` | Fixture + DICOM load, SEG/RTSTRUCT/SR round trips, autosave, conflict, scan-click reload | "Did the data survive the trip?" |

Nothing lives at the top level. A new spec goes in exactly one of these.

## Naming rules

1. **No numeric prefixes.** Run order is declared in `playwright.config.ts` (see below), never
   inferred from a filename sort. The old `NN-` scheme encoded *when a spec was written*, which
   scattered related specs (measurement tests once sat at 34, 55, 56, 60, 61, 62, 71, 79) and
   eventually collided — two files were both numbered `61`.
2. **`<subject>-<behaviour>.e2e.ts`**, kebab-case. `threshold-brush.e2e.ts`,
   `measurement-row-highlight.e2e.ts`. The directory supplies the context, so don't repeat it:
   inside `annotations/` a file is `selection.e2e.ts`, not `annotations-selection.e2e.ts`.
3. **No `-signal-NN` suffix.** Acceptance-signal IDs belong in the `test()` title — a file often
   covers several, and titles show up in the HTML report. Traceability is unaffected:
   `grep -rn "signal 29" e2e/` still finds everything, and finds it more precisely.
4. **Drop `unified-`.** The unified viewport path has been the only path since P1.8d, so the
   word distinguishes nothing.

## Multi-viewport specs: cover the SAME scan, not only different ones

A multi-viewport spec that only ever loads **different** series into the two panels cannot
see a whole class of bug, and three shipped that way: a container hidden from a viewport
showing its own scan, a contour drawn from the second viewport silently discarded, and
"same scan" being decided by an XNAT scan id that is empty for local imports and unset on
MPR panels. Every one of them is invisible when the panels hold different series, because
then the container genuinely does belong to only one of them.

So when a change touches viewport scoping, attachment, or annotation identity, cover both:

| Case | Helper | What it can catch |
|---|---|---|
| Different series per panel | `loadTwoSeries(page, 'cross-for-ct-mr', …)` (different FoR) or `'mr-t1-t2-sameexam'` (same FoR, sibling series) | Eligibility, dimming, the cross-panel pill, read-only siblings |
| **Same series in both panels** | `loadSameSeriesTwice(page, 'ct-axial-300', 'slice')` | Viewport-dependent annotations, duplicate containers, strokes that go nowhere |
| **Same volume, several orientations** | `setLayoutPreset('mpr-2x2')` | Anything that scopes per plane rather than per volume |

`annotations/same-scan-viewport-parity` is the worked example, including the two container
kinds (Structure, Measurement) that take different attach paths from SEG.

Two traps that made earlier versions of those specs pass while the app was broken:

- **Asserting only "exactly one container" passes when the stroke does nothing.** Assert
  that the edit *landed* as well — voxel count, contour count — or a no-op reads as success.
- **Different frames of reference can make a spec vacuous.** The labelmap volume is not
  shared, so a stroke on the second viewport has nothing to write into whatever the code
  does. Check by deleting the mechanism you think you are testing and confirming the spec
  goes red.

## Run order

Declared as Playwright **projects** in `playwright.config.ts`:

```
smoke ──┬── app    (the offline suite; no credentials)
        └── auth   (live XNAT)
```

`dependencies: ['smoke']` means a launch/WebGL2 failure stops the dependent projects outright,
rather than letting 90 specs fail one at a time.

The suite does **not** depend on execution order. The autouse `resetState` fixture in
[`../fixtures/electron-app.ts`](../fixtures/electron-app.ts) reloads the renderer before every
test, rebuilding Cornerstone, the tool group and every Zustand store — so a spec must pass on
its own, in any order. If a spec only passes after some other spec, that is a bug in the spec.

## Running

```bash
npm run test:e2e           # everything (auth specs need live CNDA credentials)
npm run test:e2e:offline   # smoke + app — no credentials required
npm run test:e2e:live      # smoke + auth only
```

Full runs need `--max-failures=0`; the config sets `maxFailures: 1` so ordinary runs stop at the
first failure. Use the `list` reporter rather than `json`.

The app must be **built** first — the fixture launches `dist/main/main/index.js`, not the dev
server, so source edits are invisible to E2E until `npm run build`.

## Related

- `e2e/signals/` — acceptance-signal specs that are *expected to fail* until their phase lands.
  Separate config (`playwright.signals.config.ts`), separate README, outside the green suite.
- `e2e/helpers/`, `e2e/fixtures/`, `e2e/pages/` — shared setup; imported as `../../<dir>/…`.
