# Performance baseline (requirements D8)

D8 asks that, with **four open viewports of a ~300-slice CT** plus a structure set and
a multi-segment SEG, edits propagate at **≥ 30 fps** and layout changes do not stall
the UI for more than **~250 ms**.

This was previously recorded as "not offline-measurable" because every acceptance
fixture is ≤ 16 slices. That is no longer true for the measurable part: the harness in
`e2e/perf/` generates a realistic series and times the operations D8 names.

```bash
node e2e/fixtures/dicom/generate.cjs ct-perf-300   # ~150 MB, 300 × 512² slices
npx playwright test --config=playwright.perf.config.ts
```

The run prints its numbers and writes them to `e2e/test-results/perf/latest.json`.
It is **not** part of the default green suite: it measures, and its only assertions
are sanity ceilings that catch "the load never finished".

## What it measures

| Metric | How |
|---|---|
`timeToFirstRenderMs` | import → a visible canvas in panel_0 |
`volumeReadyMs` | import → the shared 3D volume reports ready |
`panelImageCount` / `volumeSlices` | **guard**: both must equal 300, or every other number describes a partial load |
`cacheMb*` | Cornerstone's own cache accounting (`performance.memory` is quantized and did not move at all across a 150 MB load on this host, so it is not used) |
`layoutTo4PanelsMs` | `single` → `mpr-2x2`, until all four canvases are visible |
`scrollStepMeanMs` | 30 single-slice steps on the active viewport |
`editRenderFps` | Cornerstone `IMAGE_RENDERED` events across all four panels during five real brush strokes, ÷ elapsed time |
`brushStrokeMeanWallClockMs` | wall-clock per stroke — **dominated by Playwright's input synthesis**, kept only for run-to-run comparison, NOT a proxy for frame rate |

## Baseline on the development host (2026-09-01)

Apple Silicon macOS dev machine, packaged renderer, 300 × 512² synthetic CT, three runs:

| Metric | Run A | Run B | Run C |
|---|---|---|---|
| timeToFirstRenderMs | 4375 | 4314 | 2961 |
| volumeReadyMs | 4388 | — | — |
| layoutTo4PanelsMs | 344 | 534 | 181 |
| scrollStepMeanMs | 9.5 | 14.9 | 3.3 |
| editRenderFps (4 panels) | 52.5 | 51.7 | 57.1 |
| cacheMbAfterLoad | 150 | 150 | 150 |
| cacheMbAfterEdits | 225 | 225 | 225 |

### Reading

- **Edit propagation clears the bar with headroom**: 52–57 fps across four panels
  while brushing, against a ≥ 30 fps target.
- **Layout change straddles the target**: 181 / 344 / 534 ms against ~250 ms. The
  spread is larger than the target itself, so this is the one D8 metric that is *not*
  settled. It measures until all four canvases are *visible*, which includes the first
  render of three freshly-reformatted MPR planes — a stricter thing than "the UI did
  not stall". Worth re-measuring with frame-level instrumentation before drawing a
  conclusion.
- **Scroll and load** are comfortable, and the volume arrives at the expected 150 MB.

### What this does NOT establish

The numbers describe a development Mac running a *synthetic* series through the
offline import path. They are a regression baseline, not a verdict on the D8 budget:
a clinical-hardware verdict needs a run on that hardware, with real patient data
arriving over DICOMweb (where decode and network cost are part of the picture), and
with the structure set + multi-segment SEG the requirement names loaded alongside.
