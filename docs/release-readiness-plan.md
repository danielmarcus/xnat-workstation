# Release readiness plan — XNAT Workstation 1.0

Drafted 2026-10-28 against `main` @ `61cce82` (package version `0.6.1`).
Status: **draft for review**. Nothing in here has been executed yet.

This plan gets the app from "feature-complete on `main`" to a release we can hand to image
reviewers and annotators who have never used it. It has three workstreams that run partly in
parallel and meet at one gate:

| Workstream | Output | Owner of the final call |
|---|---|---|
| **A. Functional testing** | Manual test scripts (MTS) per component, an automated suite with no unexplained gaps against them, a signed-off test run on all three platforms | Release owner |
| **B. Code review and cleanup** | A findings ledger (format of `docs/bug-review-2026-10.md`), every P1/P2 fixed or explicitly deferred, dead code and stale docs removed | Release owner |
| **C. User documentation** | A user guide for annotators (`docs/user-guide/`), a rewritten README, in-app help links, release notes | Release owner + one outside annotator |

---

## 0. Where we start (baseline facts)

These were checked while drafting, and they shape the plan:

- **Automated tests exist in bulk.** ~170 Vitest files (unit + Cornerstone service integration)
  and 155 Playwright E2E specs in `e2e/specs/{smoke,auth,viewport,tools,annotations,transport,modules,sweep,packaging}`.
  Only two conditional `test.skip`s (edition packaging, WebGPU-absent case); no `.only`.
- **CI does not run E2E.** `.github/workflows/ci.yml` runs lint, notices check, typecheck,
  `npm test` (with `dciodvfy`) and `npm run build`. The Playwright suite runs only when someone
  runs it locally. That is the biggest structural gap for a release: a regression in anything
  only E2E covers can merge green.
- **The XNAT write path is only tested against a mock.** The transport specs (SEG/RTSTRUCT/SR
  save, autosave, conflict) run against `mockXnatApi.ts`. The live `auth` project covers only
  login and browser navigation. Real uploads, overwrite, version conflicts against a real
  server, and session expiry mid-save have no automated coverage.
- **The README is stale.** It describes Cornerstone3D v4, a legacy annotation list panel,
  shortcuts that no longer match `defaultHotkeyMap.ts` (e.g. `O` and `G` as panel toggles; `O`
  now picks Contour Fill), and a segmentation tool list that predates the seven tool families.
- **Developer docs are rich; user docs do not exist.** `docs/` holds ~24 design, requirement
  and review documents written for developers. `docs/annotation-tool-reference.md` is the
  closest thing to a user reference and is generated from `toolCatalog.tsx`.
- **The last review cycle is closed.** `docs/bug-review-2026-10.md` lists no open items; its
  issues (#91–#103) are recorded as fixed. The sweep specs (`e2e/specs/sweep/`) it introduced
  are the model for "realistic data, invariant-based" testing and should be extended, not
  replaced.
- **CLAUDE.md drifts from the code.** Its "Known gaps" note still calls `Circle Multi` a
  disabled `planned` tool, but the tool was removed from the app entirely on 2026-09-21 (see the
  note in `e2e/specs/tools/voxel-tools-effect.e2e.ts`; `annotations/tool-affordance` guards that
  it stays absent). The doc consolidation in §B.4 covers CLAUDE.md as well as user-facing docs.

---

## 1. Release criteria (the gate)

The release candidate (RC) ships only when all of the following are true on the RC commit:

1. **CI green**, including the new E2E job (§A.4) for the offline suite on Linux.
2. **Full offline E2E suite green on macOS, Windows and Linux** (one run each, on the packaged
   app where the spec allows, otherwise on `dist/`).
3. **Live suite green** against the dedicated test XNAT (§A.1), including the new live
   transport specs (§A.3).
4. **Every manual test script executed** on at least one platform, and the *platform-sensitive*
   scripts (marked 🖥 below) on all three, by someone other than the person who wrote the code
   under test. Results recorded in the run log (§A.2 template).
5. **No open P1 findings; every open P2 has a written deferral** accepted by the release owner.
6. **DICOM conformance**: every object the app writes (SEG, RTSTRUCT, SR) passes `dciodvfy`
   with no errors, and loads in at least two independent viewers (§A.3, C19).
7. **User guide complete** for every feature that ships enabled, reviewed by one annotator from
   outside the dev team who followed the Getting Started chapter cold.
8. **Signed, notarised installers** produced by `release.yml` for all three platforms, and the
   auto-update path verified from the previous public build (C1).

---

## 2. Component inventory

Every script, spec and doc chapter in this plan hangs off this list. IDs are stable; use them in
test titles (`test('C9-04 …')`), findings and doc cross-references.

| ID | Component | Main code | Existing E2E coverage |
|---|---|---|---|
| C1 | Install, launch, update, editions | `src/main/index.ts`, `src/main/updater/`, `electron-builder.config.js`, `edition.config.json` | `smoke/`, `packaging/` |
| C2 | Authentication and session | `src/main/xnat/`, `src/main/ipc/authHandlers.ts`, `LoginForm` | `auth/login` (live) |
| C3 | XNAT browser, bookmarks, hanging protocols | `XnatBrowser`, `BookmarksDropdown`, `hangingProtocolService` | `auth/xnat-browser-navigation` (live) |
| C4 | Local DICOM import | `lib/dicom/`, `local-fixture` | `viewport/local-*` |
| C5 | Image display and navigation | `Viewport`, `ViewportOverlay`, `ViewportScrollbar`, `ViewportHoverProbe`, `ViewportRuler`, `ViewportTimeScrubber`, `DicomHeaderPanel`, `Toolbar` | `viewport/` (most) |
| C6 | Layouts, MPR, 3D, crosshairs | `UnifiedViewportGrid`, `viewportLayoutService`, `volumeService`, `unifiedCrosshair` | `viewport/mpr-*`, `layout-*`, `crosshair-*` |
| C7 | Annotations panel core | `components/annotations/` (`ContainerRow`, `MemberRow`, `PanelHeader`), `containerService`, approval | `annotations/panel*`, `naming-affordance`, `approval-lock`, `panel-viewport-scoping` |
| C8 | Segmentation toolbox (7 families) | `ContextToolbox`, `toolCatalog`, `toolFamilyStore`, `ToolFinder` | `tools/`, `annotations/tool-*`, `sweep/tool-sweep` |
| C9 | Segmentation operations | `OperationsSection`, `*Sheet.tsx`, `maskOpsService`, `solverService`, `qc3dService` | `annotations/{interpolate,propagate,mask-cleanup-*,seeded-*,region-*,qc-3d}`, `sweep/operation-sweep` |
| C10 | Structure (contour) tools | `contourToolService`, `splineSliceService`, `ContourToolControls` | `annotations/contour-*`, `spline-*`, `snake-refine` |
| C11 | Measurements | `annotationService`, `srExport`, `srImport` | `annotations/measurement-*`, `tools/measurement-tools-effect` |
| C12 | Selection, copy/paste, delete, undo/redo | `componentSelection`, `maskSelection`, `undoService` | `annotations/select*`, `*-copy-paste`, `tools/undo*` |
| C13 | Save/load to XNAT | `transportService`, `xnatTransport`, `xnatAutosaveWiring`, `leaveGuard` | `transport/` (mock XNAT) |
| C14 | Local backup, checkpoints, recovery | `backupService`, `checkpointService`, `checkpointHandlers` | `annotations/checkpoint*`, `backup-status-row` |
| C15 | Export to local files | `ExportDropdown`, `exportHandlers` | `transport/sr-export`, `seg-export-roundtrip` (partial) |
| C16 | Algorithm modules | `src/main/modules/`, `lib/modules/`, `ModuleSheet`, `ModulesSection` | `modules/` |
| C17 | Settings and preferences | `SettingsModal`, `preferencesStore`, `applyPreferences` | scattered |
| C18 | Keyboard and focus model | `hotkeyService`, `defaultHotkeyMap`, `keepFocusInViewports` | `tools/keyboard-scoping`, `viewport/side-panel-focus` |
| C19 | DICOM conformance and interoperability | `dicomExportHelpers`, `dicomValidation`, `rtStructService`, `segmentationService` | `test:dicom:compliance` (unit), `seg-export-roundtrip` |
| C20 | Performance, memory, stability | — | `playwright.perf.config.ts`, `docs/perf-baseline.md` |

---

## Workstream A — Functional testing

### A.1 Environments and data

**Platforms.** macOS (Apple silicon, plus one Intel run), Windows 11 x64, Ubuntu 22.04 x64. At
least one Retina/HiDPI display and one 1080p display — the overlays, rings and cursor sizes are
pixel-sensitive.

**Test XNAT.** A dedicated server, never production, with:

- Project `WS_RELEASE_TEST` holding de-identified data covering: CT (thin-slice body, 512²,
  real rescale), MR (multi-sequence brain, same exam), an oblique acquisition, a 4D/multi-phase
  CT, a cine/US multiframe, a localizer, and sessions that already contain SEG, RTSTRUCT and SR
  scans (including one with a `30xx` SEG and one written by another tool, e.g. 3D Slicer).
- Three accounts: a project owner, a member, and a read-only collaborator (to exercise
  permission failures on save).
- If feasible, an OIDC or LDAP login configured alongside local accounts (C2 needs all three
  auth paths seen at least once).
- The `XNAT_*` variables in `e2e/helpers/env.ts` pointed at it, stored as CI secrets for the
  live job.

**Offline fixtures.** The generated phantoms in `e2e/fixtures/dicom/` stay the backbone of the
offline suite. Add any series the new specs need through `generate.cjs`, never as committed
binaries of real patients.

### A.2 Manual test scripts

Manual scripts exist for what automation cannot judge well: how it looks and feels, whether
the wording makes sense, real servers, real installers, real hardware. Each script is written so
an annotator unfamiliar with the code can run it.

**Where:** `docs/testing/manual/C<n>-<component>.md`, one file per component, plus
`docs/testing/manual/run-log-template.md`.

**Script format** (every case):

```
### C5-03  Window/level presets  🖥
Pre:   Logged in; CT body series loaded in a 1×1 layout.
Steps: 1. Press the Lung preset shortcut.  2. Press the Bone preset shortcut.  3. Open the W/L preset menu on the
          toolbar and choose Soft Tissue.  4. Drag left-click with the W/L tool active.
Expect: 1. Lung parenchyma visible, W/L readout bottom-left reads the Lung preset values.
        2. Bone window; readout updates.  3. Menu choice applies and the menu closes.
        4. Readout changes continuously; no other viewport changes.
Auto:  viewport/overlay-readouts (steps 1–2); manual-only for 3–4 (feel).
Result: Pass / Fail / Blocked — tester, platform, build, notes, screenshot if Fail
```

`🖥` = run on all three platforms. `Auto:` links each case to the spec(s) that automate it, or
says "manual-only" and why — this is the traceability matrix (§A.3) in miniature.

**Run log.** One row per case per platform: build hash, tester, result, linked issue. Kept as a
spreadsheet or a Markdown table under `docs/testing/runs/<rc>/`.

#### Script catalogue

The cases below are the minimum set; script authors expand steps into the format above.

**C1 — Install, launch, update, editions** 🖥
- C1-01 Fresh install from the signed installer; first launch shows the login screen; app name,
  dock/taskbar icon and tray icon (macOS template icon in light and dark menu bar) are correct.
- C1-02 Gatekeeper / SmartScreen: no "unidentified developer" or unsigned warning.
- C1-03 Auto-update from the previous public build: update offered, downloaded, applied on
  restart; Settings → Updates shows the new version; About matches `package.json`.
- C1-04 Update with unsaved annotations open: the app does not restart under them (leave guard
  or deferral).
- C1-05 WebGL2 unavailable / software rendering (VM without GPU): clear message, no white screen.
- C1-06 Uninstall leaves no running processes; reinstall keeps or clears preferences as documented.
- C1-07 Open-source edition bundles exactly the modules in `edition.config.json`.

**C2 — Authentication and session**
- C2-01 Local account login via the XNAT login window; username shown in connection status.
- C2-02 LDAP and C2-03 OIDC login (where the test server supports them).
- C2-04 Wrong password; C2-05 unreachable server; C2-06 server URL entered with/without scheme,
  trailing slash, path prefix (`normalizeServerUrl`).
- C2-07 Self-signed / invalid TLS certificate: refused with an understandable message.
- C2-08 Session expiry while idle: keepalive holds it, or the user is told and can re-login
  **without losing open annotations**.
- C2-09 Session expiry **during a save** (C13 interaction).
- C2-10 Logout: images, annotations and caches from the previous user are gone; a different user
  logs in cleanly.

**C3 — XNAT browser**
- C3-01 Projects → subjects → sessions → scans navigation; counts and labels match the XNAT web UI.
- C3-02 Filter fields; long lists (≥500 subjects) scroll without lag.
- C3-03 Load one scan; load a whole session (hanging protocol applied: CT pre/post, MR brain).
- C3-04 Pin and unpin project/subject/session; bookmarks survive restart; recents list updates.
- C3-05 Scans that cannot be displayed (non-image, SR-only, unsupported transfer syntax) are
  labelled, not silently broken.
- C3-06 Clicking a SEG/RTSTRUCT/SR scan loads its source and the annotation (scan-click reload).
- C3-07 Read-only collaborator: browsing works; save is refused with a clear dialog (C13).

**C4 — Local DICOM import** 🖥
- C4-01 Import a folder; C4-02 import individual files out of order (sorted correctly);
  C4-03 mixed series in one folder split into series; C4-04 a non-DICOM file in the folder is
  skipped with a notice; C4-05 a corrupt file (Rows=0, truncated pixel data) is reported, not a crash.
- C4-06 Local import of a SEG/RTSTRUCT/SR together with its source.

**C5 — Image display and navigation** 🖥 (rendering)
- C5-01 Scroll: wheel, arrows, Page Up/Down, Home/End, scrollbar drag, slice track.
- C5-02 Pan, zoom, rotate 90°, flip H/V, invert, reset — from toolbar and hotkeys.
- C5-03 W/L presets and drag (example above).
- C5-04 Four-corner overlay: every field in Settings → Overlay toggles on/off and shows correct values.
- C5-05 Hide PHI: patient name/ID/dates hidden on overlays, header panel, exported images.
- C5-06 Hover probe shows HU (CT) / raw values (MR) matching an independent viewer at 3 points.
- C5-07 Ruler scale matches pixel spacing (measure a known structure).
- C5-08 Cine: play/stop (Space), FPS change; 4D time scrubber on multi-phase data.
- C5-09 DICOM header panel: search, module grouping, sequences expand, private tags shown.
- C5-10 Orientation markers (A/P, R/L, S/I) correct on axial, sagittal, coronal and oblique data.
- C5-11 Exactly one viewport outline, on the active viewport only; no focus ring anywhere after
  clicking toolbar/panel controls (CLAUDE.md "Viewport outlines").

**C6 — Layouts, MPR, 3D**
- C6-01 Each layout preset (1–4 keys and dropdown); C6-02 swap viewports; C6-03 different series
  per viewport.
- C6-04 MPR 2×2: volume builds with progress; axial/sagittal/coronal consistent; crosshairs sync;
  crosshair intensity readout.
- C6-05 3D panel renders and rotates.
- C6-06 Mixed-orientation series and an oblique series in MPR.
- C6-07 Layout change with annotations present: annotations re-attach to the right viewports.

**C7 — Annotations panel core**
- C7-01 Create Segmentation, Structure, Measurement from the header buttons; name captured by typing
  straight away (focus stays on the image), Enter → first member name, Escape keeps defaults.
- C7-02 Add, rename, recolour, hide, lock, delete members; container kebab actions.
- C7-03 Viewport scoping: annotation listed and rendered only on viewports showing its scan;
  cross-panel pill on same-scan viewports; drawing refused on another scan's viewport.
- C7-04 Unsaved indicator visible even for an unfocused viewport's container.
- C7-05 Approval: approve, approved container is read-only, approval persists across reload.
- C7-06 Inline per-segment metrics (volume, voxel count) update after an edit.
- C7-07 Panel resize; very long names truncate with tooltip.

**C8 — Segmentation toolbox** (one sub-script per family, each against `annotation-tool-reference.md`)
- C8-01 Brush family: every Kernel × Limit mode paints, erases with Shift, respects brush size
  (`[` `]`), refuses a locked segment.
- C8-02 Shape family: circle/rect/sphere × limit; C8-03 Region (drag/click); C8-04 Level Trace
  preview + ⏎; C8-05 Random Walker seeds + Run; C8-06 ROI limit constrains Level Trace/RW/Cleanup;
  C8-07 Contour Fill with each boundary; C8-08 Smart Brush; C8-09 Seg Bidir.
- C8-10 Options strip: essentials visible, "More" holds the rest, dot appears when changed.
- C8-11 ⌘K / Ctrl+K finder: every tool, mode and operation found by name.
- C8-12 Every tooltip reads correctly to an annotator (wording review, not just presence).
- C8-13 Without WebGPU: Region/Region+ refuse with a reason.
- C8-14 Removed tools (Circle Multi) are not offered anywhere — toolbox, finder, hotkeys.

**C9 — Segmentation operations**
- C9-01..07 One per operation (Cleanup, Interpolate, Propagate, Seeded, Region competition,
  QC 3D, module operations): scope Slice/Range/Volume × Active/All; preview hatching; `\` compare;
  ⏎ commits as one undo step; ⎋ discards; preview discarded and reported when the segment
  changes underneath; locked segment previews read-only.
- C9-08 Operation stays open across tool changes; collapse ▾ and close ✕ (with pending-preview ask).
- C9-09 Operation on a viewport not showing the active container is refused (X3).
- C9-10 Large volume (512² × 300): progress and Cancel work; UI stays responsive.

**C10 — Structure (contour) tools**
- C10-01 Freehand, spline (each type), live wire, scissors, sculptor: draw, close, edit.
- C10-02 Escape / tool switch mid-draw cancels cleanly; Backspace removes last spline point (T4, T5).
- C10-03 Interpolation between slices, including oblique; interpolated provenance shown.
- C10-04 Copy nearby / propagate / refine / snake refine.
- C10-05 Locked and approved structures cannot be edited by any path (T8).
- C10-06 Holes and multiple components per slice.

**C11 — Measurements**
- C11-01 Each tool (Length, Angle, Bidirectional, Elliptical/Rectangle/Circle ROI, Probe, Arrow
  Annotate, Planar Freehand): value matches an independent viewer within tolerance.
- C11-02 Measurement rows highlight their annotation; colour; delete; session scope.
- C11-03 Save as SR and reload — values, labels and positions identical.

**C12 — Selection, clipboard, undo**
- C12-01 Select tool: click, Shift-click add/remove, empty-click clear, selecting another member's
  component activates it; slice change clears.
- C12-02 Ctrl+C / Ctrl+V / Delete on contours and islands; each one undo step.
- C12-03 Undo/redo across mixed edits, scoped to the active container; toolbar buttons match keys.

**C13 — Save/load to XNAT** (live server required)
- C13-01 Save a new SEG, RTSTRUCT, SR → appears in XNAT as a new scan with the expected ID
  convention and metadata; reopen from XNAT is identical.
- C13-02 Overwrite an existing annotation scan; version bump.
- C13-03 Conflict: another user/tool modifies the scan first → conflict dialog; each choice does
  what it says.
- C13-04 Autosave at the configured frequency; per-container autosave row; no toast or banner on success.
- C13-05 Network drop mid-save → retry/transient handling; nothing lost.
- C13-06 Leave guard: loading a scan that would orphan unsaved work → Save · Discard · Cancel;
  loading into a second viewport does not prompt (GH #75).
- C13-07 Quit with unsaved work → `CloseUnsavedDialog`.
- C13-08 Permission denied (read-only account) → dialog, work kept.
- C13-09 Load SEG/RTSTRUCT written by another tool (3D Slicer, OHIF).

**C14 — Backup, checkpoints, recovery**
- C14-01 Kill the app (force quit) mid-edit → relaunch offers recovery banner; recovered work matches.
- C14-02 Checkpoints: create, list, restore; checkpoint files section in Settings.
- C14-03 File Backup settings honoured (location, retention).

**C15 — Export** 🖥 (file dialogs, clipboard)
- C15-01 Save as image (PNG/JPEG) includes annotations; C15-02 copy to clipboard pastes into
  another app; C15-03 save all slices; C15-04 save DICOM file; C15-05 export annotations (CSV /
  SEG / RTSTRUCT / SR) opens in a spreadsheet / other viewer.
- C15-06 Hide PHI respected in every export that renders the overlay.

**C16 — Modules**
- C16-01 Bundled modules listed in Settings → Modules; run each on example data.
- C16-02 Install a signed third-party module; reject an unsigned/tampered one with a reason
  (`docs/module-security.md`).
- C16-03 Sandbox: a module cannot read files or network outside its grant.
- C16-04 Module failure surfaces as a dialog/toast per the surface taxonomy, app stays usable.

**C17 — Settings**
- C17-01 Every Settings section: change, close, reopen, restart — value persists and takes effect.
- C17-02 Hotkeys section matches actual behaviour; rebinding (if supported) works.
- C17-03 Issue report produces a bundle containing logs and no PHI or credentials.
- C17-04 About shows version, build, licences (THIRD-PARTY-NOTICES).

**C18 — Keyboard and focus**
- C18-01 Every shortcut in `defaultHotkeyMap.ts` from a viewport does what the guide says.
- C18-02 After clicking any toolbar/panel/slider/dropdown, arrow keys and Space still reach the viewport.
- C18-03 Text fields (filter, rename, numbers) keep keystrokes while typing; modals trap focus.

**C19 — DICOM conformance and interoperability**
- C19-01 SEG, RTSTRUCT, SR written by the app open correctly in 3D Slicer, OHIF (and Horos/OsiriX
  on macOS); geometry aligned with source, labels and colours preserved.
- C19-02 Objects written by those tools load correctly in the app.
- C19-03 Per `docs/dicom-export-field-policy.md`: no PHI leaks into derived objects beyond policy.

**C20 — Performance and stability** 🖥
- C20-01 `npm run test:perf` within `docs/perf-baseline.md` tolerances.
- C20-02 Two-hour annotation soak (real workflow, 3 sessions loaded/unloaded): memory plateaus,
  no slowdown, no WebGL context loss.
- C20-03 Largest realistic study (e.g. 2,000-slice CT) loads; MPR builds; no crash.

### A.3 Automated functional tests

**Step 1 — Traceability matrix (week 1).** Generate `docs/testing/traceability.md`: one row per
MTS case, columns *spec(s)*, *unit test(s)*, *manual-only reason*. Seed it automatically by
grepping spec titles and file names against component areas, then correct by hand. Every case
ends up either automated or carrying a reason ("visual judgement", "real installer", "OS dialog").

**Step 2 — Fill the gaps.** Known and likely gaps, in priority order:

| # | Gap | New automation |
|---|---|---|
| G1 | E2E not in CI | Add an `e2e-offline` job to `ci.yml`: `npm run build`, then `xvfb-run npm run test:e2e:offline` on Ubuntu with software GL; upload the HTML report on failure. Start as non-blocking for one week to measure flakiness, then make it required. Nightly matrix job for macOS and Windows runners. |
| G2 | Live XNAT write path | New `e2e/specs/transport/live-*.e2e.ts` in the `auth` project: save new SEG/RTSTRUCT/SR to the test server, reload, compare voxels/contours/values; overwrite; injected conflict (second REST client edits first); read-only account refusal. Each test cleans up the scans it created. Nightly, with secrets. |
| G3 | Session expiry | Live spec that invalidates the JSESSIONID mid-session and mid-save (C2-08/09). |
| G4 | Interoperability | Add Slicer- and OHIF-written SEG/RTSTRUCT/SR fixtures to `test:dicom:compliance`; assert round-trip geometry. Run `dciodvfy` on every object the E2E specs write (extend the `seg-export-roundtrip` pattern to RTSTRUCT and SR). |
| G5 | Recovery after crash | E2E that kills the Electron process mid-edit and relaunches against the same user-data dir (C14-01). |
| G6 | Packaged app smoke | Run `smoke/` and a 5-spec subset against the *packaged* app in `release.yml` before publish. |
| G7 | Settings persistence | One spec per Settings section: change → relaunch → assert (C17-01). |
| G8 | Hotkey contract | Table-driven spec generated from `defaultHotkeyMap.ts` asserting each binding's observable effect, so the guide's shortcut table and the code cannot drift (C18-01). |
| G9 | Export files | Assert written files (image dimensions, CSV columns, DICOM validity) for every `ExportDropdown` action (C15). |
| G10 | Measurement accuracy | Known-geometry phantom: each measurement tool against analytic truth (C11-01). |
| G11 | Visual baselines | Screenshot baselines for each panel state the user guide shows — doubles as the doc screenshot generator (§C.4). |

**Rules for every new spec** (from CLAUDE.md, binding): watch it fail first (red-before-green, and
record the red run in the PR); drive the real affordance, no store setters, no Cornerstone mocks;
assert that edits *landed* (voxel/contour counts), not only that UI appeared; cover the
same-scan-two-viewports case for anything touching scoping; title starts with the MTS case ID.

**Step 3 — Unit coverage review.** Run `npm run test:coverage`; for the components with the
most user-visible risk (C13 transport, C14 backup, C19 DICOM writers, C2 auth) set a floor and
read the uncovered branches — error paths are what users hit in the field.

**Step 4 — Stabilise.** Run the full offline suite 5× on each platform; any test that fails once
and passes on re-run gets root-caused (the CI rule: "flake" is not a root cause) before RC.

### A.4 Defect handling

- Every failure becomes a GitHub issue labelled `release-1.0`, component `C<n>`, priority P1–P3
  (definitions as in `bug-review-2026-10.md`).
- P1 blocks the RC. P2 is fixed or deferred in writing. P3 goes to the backlog.
- Each fix lands with the automated test that would have caught it (seen red first).

---

## Workstream B — Code review and cleanup

### B.1 Tools and how each is used

| Tool | Used for | When |
|---|---|---|
| **`/code-review`** (Claude Code skill), at `high` per area; `xhigh` for C13, C14, C19, C2 | Correctness bugs in each component's code. Run per area (target = a path), not over the whole repo at once, so each review has focused context. The `max` level starts many reviewer agents and is the costliest — use it only if you decide the release warrants it. | Week 1–2, area by area |
| **`/security-review`** | Main process, IPC handlers, preload bridge, module sandbox and signatures, auth/cookie handling, update channel, issue-report bundle (PHI/credential leakage). | Week 1 |
| **`/simplify`** | Reuse, simplification and dead-weight cleanups after correctness fixes land. Quality only; it does not hunt bugs. | Week 3 |
| **Claude multi-agent workflow** (only with explicit opt-in — it can spawn many agents and spend many tokens) | Parallel fan-out: one reviewer per component in §2, each finding then adversarially verified by a second agent before it enters the ledger. Same shape as the review that produced `bug-review-2026-10.md`. | Optional, replaces the per-area `/code-review` loop |
| **Explore / general-purpose agents** | Inventory work: unused exports and files, components imported nowhere (CLAUDE.md rule 5), feature flags left on/off, TODO/FIXME/HACK sweep, docs that describe deleted code. | Week 1 |
| **Static tooling** | `npm run lint`, `npm run typecheck`, `knip` (or `ts-prune`) for dead exports, `npm audit --omit=dev`, `npm run notices:check`, Electron security checklist (`contextIsolation`, `sandbox`, `webSecurity`, CSP, `setWindowOpenHandler`), `electron-builder` asar integrity. | Week 1, then in CI |
| **`dciodvfy`** | Every DICOM object the app can write (already in CI for unit fixtures; extended by G4). | Continuous |

### B.2 Review partitions

Run reviews in this order — data-loss and security surfaces first:

1. **C13 + C14** transport, autosave, conflict, leave guard, backup, checkpoints (data loss).
2. **C2 + main process + preload + C16 sandbox** (security).
3. **C19** SEG/RTSTRUCT/SR writers and readers (data correctness, interoperability).
4. **C9 + C8** mask operations, solvers, tools (the area the last review found most in).
5. **C10 + C11 + C12** contours, measurements, selection/undo.
6. **C5 + C6 + C7 + C18** viewer, layouts, panel, focus model.
7. **C1 + C3 + C4 + C15 + C17** shell, browser, import, export, settings.

### B.3 Ledger and triage

All findings go into `docs/code-review-2026-11.md`, same columns as `bug-review-2026-10.md`
(ID, P, finding, source, status). Each finding needs a traced path from a real input to the
failure before it is accepted; far-fetched paths are recorded as "won't fix (reason)", not built
for. Fixes land with a regression test seen red first.

### B.4 Cleanup checklist

- Remove dead code, unused exports, unmounted components, stale feature flags and `e2e` hooks
  that ship in production bundles unintentionally (confirm `installRendererE2eHooks` is inert in
  release builds).
- Resolve or ticket every TODO/FIXME; no `console.log` debugging left (keep `[service]` warnings).
- Consolidate `docs/`: mark superseded proposals as historical (or move to `docs/archive/`),
  keep `CLAUDE.md` and `AGENTS.md` consistent, and update `PHASES.md`.
- Bump `package.json` version and write `CHANGELOG.md`.
- Dependencies: Cornerstone packages exact-pinned to one version (already), Electron on a
  supported line, no high/critical `npm audit` items in shipped deps.

---

## Workstream C — User documentation

### C.1 Audience

An **experienced image reviewer or annotator** — radiologist, technologist, research assistant
or imaging scientist — who knows window/level, planes, DICOM basics and has annotated in some
tool (3D Slicer, ITK-SNAP, OsiriX, a PACS), but:

- may never have used **XNAT** (projects, subjects, sessions/experiments, scans, resources,
  permissions, how a SEG becomes a scan), and
- does not know **this app's** model: containers and members, the three annotation types,
  viewport scoping, tool families and modes, operations with preview/commit, autosave vs save,
  approval.

Tone: task-first, precise, no developer vocabulary (no "store", "Cornerstone", "IPC"). Every
term from the CLAUDE.md terminology table is defined once, in the glossary, and used consistently.

### C.2 Deliverables and outline

`docs/user-guide/` (Markdown, publishable as a static site later), plus a rewritten `README.md`
that points to it.

1. **Introduction** — what the app is for; what it is not (not a diagnostic device, unless
   regulatory says otherwise — see §6).
2. **XNAT in ten minutes** — projects → subjects → sessions → scans; who can see and write what;
   how annotations you save appear in XNAT (new scans, ID convention, versions); how to open the
   same session in the XNAT web UI.
3. **Installing and signing in** — per-platform install, first launch, server URL, local/LDAP/
   OIDC login, staying signed in, signing out, updates.
4. **Finding and opening images** — browser, filters, bookmarks and recents, loading a scan vs a
   session, hanging protocols, opening local DICOM files.
5. **Viewing images** — the screen tour (toolbar, sidebar, viewport area, Annotations panel),
   navigation, W/L and presets, pan/zoom/rotate/flip/invert, overlays and Hide PHI, hover probe
   and ruler, cine and multi-phase, DICOM header panel.
6. **Layouts, MPR and 3D** — grid presets, active viewport, MPR, crosshairs, orientation, 3D.
7. **Annotation concepts** — containers and members; Segmentation · Structure · Measurement and
   when to use which (SEG vs RTSTRUCT vs SR in plain terms); which viewports show an annotation and
   why; naming as you create; colour, visibility, lock; unsaved indicator.
8. **Segmenting** — the seven tool families and their modes, the options strip and More,
   Ctrl/⌘K finder; worked recipes (outline a liver with Level Trace + Cleanup; a lesion with Brush +
   Interpolate; seeded Random Walker).
9. **Operations** — scope, preview, compare, commit/discard; each operation with when to use it.
10. **Contouring (Structures)** — freehand, spline, live wire, scissors, sculptor, interpolation,
    copy nearby/propagate, refine.
11. **Measuring** — each measurement tool, reading values, saving as SR.
12. **Selecting, copy/paste, undo** — the selection model in user terms.
13. **Saving, autosave and recovery** — save to XNAT, overwrite vs new, conflicts and what each
    choice does, leaving a scan with unsaved work, crash recovery, checkpoints, approval.
14. **Exporting** — images, clipboard, all slices, DICOM files, annotation CSV/DICOM.
15. **Modules** — what they are, running one, installing a trusted module, security model in brief.
16. **Settings** — every section, every option.
17. **Keyboard shortcuts** — generated from `defaultHotkeyMap.ts` (one source of truth, checked by G8).
18. **Troubleshooting and FAQ** — login problems, blank viewport/WebGL, slow loads, "why can't I
    draw here", "where did my annotation go", issue report.
19. **Glossary** — XNAT terms, DICOM terms (SEG, RTSTRUCT, SR, series, frame of reference), app terms.
20. **Release notes** — what's in 1.0, known limitations (e.g. WebGPU-only tools).

`docs/annotation-tool-reference.md` stays the generated per-tool table and is linked from chapters
8–10 rather than duplicated.

### C.3 How it gets written

- Claude drafts each chapter from the code (catalog, hotkey map, settings sections, dialog
  strings) **and** from driving the running app — every procedure is executed in the app before
  it is written down, per CLAUDE.md rule 2. Where a procedure cannot be executed (e.g. OIDC), the
  draft says so and a human verifies it.
- The manual test scripts (§A.2) and the guide are written together: a procedure in the guide is
  usually an MTS case with the expectations turned into prose. Drift between them is a bug.
- Review in two passes: technical (dev team — is it true?) and audience (one annotator outside
  the team follows chapters 2–8 cold and notes every point of confusion).

### C.4 Screenshots

Generated, not hand-captured: a Playwright script (`e2e/docs/screenshots.e2e.ts`, not in the
normal suite) drives the fixture data to each documented state and writes PNGs to
`docs/user-guide/img/`. Re-run before each release so images never go stale; G11 reuses it as a
visual baseline. PHI: fixtures only, overlays show synthetic names.

### C.5 In-app hooks

A Help menu item opening the guide; links from Settings sections and error dialogs to the
relevant troubleshooting entry. (Small, but a UI change — follows the visual-verification rules.)

---

## 3. Schedule

Assumes one developer driving with Claude, plus a part-time tester/annotator. Adjust to staffing.

| Week | A — Testing | B — Review | C — Docs |
|---|---|---|---|
| 1 | Test XNAT provisioned; traceability matrix; G1 (E2E in CI, non-blocking) | Static tooling; `/security-review`; dead-code inventory; `/code-review` partitions 1–2 | Outline approved; glossary; chapters 1–4 |
| 2 | MTS written for C1–C10; G2–G5 | Partitions 3–5; fixes for P1s | Chapters 5–9; screenshot script |
| 3 | MTS for C11–C20; G6–G11; flake stabilisation | Partitions 6–7; `/simplify`; doc consolidation | Chapters 10–20 |
| 4 | **Full manual run** on 3 platforms (RC1); E2E made required in CI | P1/P2 fixes from the run | Technical review; outside-annotator review |
| 5 | Re-run failed/affected scripts on RC2; live + offline suites green | Ledger closed or deferred | Fixes from review; release notes |
| 6 | Release gate (§1) | — | Publish guide; README |

---

## 4. Risks

- **E2E in headless Linux CI may not match real GPUs** (WebGL2/WebGPU paths). Mitigation: the
  nightly macOS/Windows jobs, and 🖥 manual scripts.
- **Live-server tests are slow and stateful.** Mitigation: dedicated project, per-test cleanup,
  nightly not per-push.
- **Docs drift from UI** while fixes land in weeks 4–5. Mitigation: generated screenshots and
  shortcut table; doc review after the last UI change.
- **Review findings outrun fix capacity.** Mitigation: partition order puts data loss and
  security first; P3s go to backlog without debate.

---

## 5. Decisions needed before starting

1. **Release scope**: are any tools or features to be finished, hidden or removed for 1.0
   (e.g. tools that need WebGPU)?
2. **Regulatory positioning**: "research use only / not for diagnostic use" wording for the guide,
   About box and installer.
3. **Test XNAT**: which server, and who provisions the de-identified data and the three accounts.
4. **Code-review depth**: per-area `/code-review` (default), or the opt-in multi-agent workflow,
   or `max` level on the data-loss partitions.
5. **Doc hosting**: Markdown in-repo only, or also a published site (GitHub Pages) linked from Help.
6. **Version number**: 1.0.0, or a 0.x public beta first.
