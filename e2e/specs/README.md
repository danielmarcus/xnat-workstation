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
