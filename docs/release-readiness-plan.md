# Release readiness plan — XNAT Workstation 1.0

First drafted 2026-10-28 against `main` @ `61cce82`. **Revised 2026-10-30** against `main` @
`d910d97` (package version `0.6.1`): adds the move to the NrgXnat GitHub organisation
(Workstream D), takes in the 24 commits merged since the first draft (§0.1), and adds guidance
on which baseline facts to change before the release (§0.3).
Status: **draft for review**. Nothing in here has been executed yet.

This plan gets the app from "feature-complete on `main`" to a release we can hand to image
reviewers and annotators who have never used it, published from the NrgXnat organisation with
the other XNAT repositories. Four workstreams run partly in parallel and meet at one gate:

| Workstream | Output | Owner of the final call |
|---|---|---|
| **A. Functional testing** | Manual test scripts (MTS) per component, an automated suite with no unexplained gaps against them, a signed-off test run on all three platforms | Release owner |
| **B. Code review and cleanup** | A findings ledger (format of `docs/bug-review-2026-10.md`), every P1/P2 fixed or explicitly deferred, dead code and stale docs removed | Release owner |
| **C. Documentation** | A user guide for annotators (`docs/user-guide/`), a rewritten README, in-app help links, release notes; developer docs (modules, extensions, editions) checked for the SDK's public audience | Release owner + one outside annotator |
| **D. Move to NrgXnat** | The repository transferred to `NrgXnat/xnat-workstation`, every hard-coded owner reference, CI secret, npm trusted publisher and update feed pointing at it, and existing installs proven to update across the move | Release owner + an NrgXnat org owner |

**Do D first.** Everything in A–C that touches CI, secrets, release workflows or the SDK's
publishing has to be configured once, in its final home. Setting it up under the personal
account and moving it later means doing it twice and re-proving it.

---

## 0. Where we start (baseline facts)

Checked against `main` @ `d910d97`:

- **Automated tests exist in bulk.** 181 Vitest files (unit + Cornerstone service integration;
  1,489 unit tests at the last count in a commit message) and 163 Playwright E2E specs in
  `e2e/specs/{smoke,auth,viewport,tools,annotations,transport,modules,extensions,sweep,packaging}`.
  Only conditional `test.skip`s (edition packaging, WebGPU-absent case, the SSO login-page spec
  when a token is used); no `.only`.
- **CI does not run E2E.** `.github/workflows/ci.yml` runs lint, notices check, typecheck
  (now including the SDK and example extensions), `npm test` (with `dciodvfy`) and
  `npm run build`. The Playwright suite runs only when someone runs it locally.
- **The live suite runs against production CNDA, read-only.** The `auth` project (15 tests:
  login, browser navigation, the extension XNAT API) signs in with an XNAT alias token, because
  CNDA now accepts only institutional SSO; the last recorded run was 14 passed, 1 skipped. Nothing
  live writes to a server.
- **The XNAT write path is only tested against a mock.** The transport specs (SEG/RTSTRUCT/SR
  save, autosave, conflict) run against `mockXnatApi.ts`. Real uploads, overwrite, version
  conflicts against a real server, and session expiry mid-save have no automated coverage.
- **Work is committed directly to `main`.** CI runs after the push, not before it (CLAUDE.md,
  Repository). There is no branch protection, review requirement or CODEOWNERS.
- **The repository lives under a personal account** (`danielmarcus/xnat-workstation`), and five
  places hard-code that owner (§D.2), including the auto-update feed of every installed copy and
  the npm package metadata.
- **The extension SDK is already public.** `@nrgxnat/workstation-extension-api` 0.6.0 is on npm;
  `.github/workflows/publish-sdk.yml` publishes later versions by npm trusted publishing, which
  is bound to a specific GitHub owner/repository/workflow.
- **The README is stale.** It describes Cornerstone3D v4, a legacy annotation list panel,
  shortcuts that no longer match `defaultHotkeyMap.ts` (e.g. `O` and `G` as panel toggles; `O`
  now picks Contour Fill), and a segmentation tool list that predates the seven tool families.
  It says nothing about modules or extensions, and its clone URL is the personal one.
- **Developer docs are rich; user docs do not exist.** `docs/` holds 26 design, requirement,
  review and authoring documents, all at the top level, mixing live references with finished
  proposals. `docs/annotation-tool-reference.md` is the closest thing to a user reference.
- **The last review cycle is closed.** `docs/bug-review-2026-10.md` lists no open items. The
  sweep specs (`e2e/specs/sweep/`) it introduced are the model for "realistic data,
  invariant-based" testing and should be extended, not replaced.
- **No known feature gaps.** CLAUDE.md's Known gaps reads "none open". (Circle Multi, the former
  gap, was removed from the app on 2026-09-21; Circle Threshold, added 2026-10-30, is a different,
  working tool.)
- **Packaged builds are locked down.** Electron fuses close run-as-Node, `NODE_OPTIONS`,
  `--inspect` and validate the archive (X6b), so a packaged edition cannot be driven by Playwright;
  `npm run test:edition` builds a test copy with the inspector re-opened to check one.

### 0.1 What changed on `main` since the first draft

| Change | Commits | Effect on this plan |
|---|---|---|
| **Extension framework X0–X7**: extensions bundled into an edition; sidebar tab, toolbar slot, full-window view, Settings page, commands/keys, ⌘K; XNAT access as the user; app state and events; annotations API; storage and files; licensing hooks; build integrity (fuses, fingerprints, `devTools` switch); the SDK package and the authoring guide | `6f0770d`…`1fccb0b`, merge `d910d97` | New components **C21** (extension host) and **C22** (SDK and authoring guide); new security review surface (§B.2 partition 2); edition/packaging scripts in C1; developer-docs track in §C.6; npm trusted publishing in §D |
| SDK published to npm as `@nrgxnat/workstation-extension-api`, with provenance via `publish-sdk.yml` | `955991b`, `bb4d573` | The trusted publisher must be moved with the repo (§D.4) |
| Live E2E sign in with an alias token and a non-browser User-Agent; the extension XNAT spec runs | `86c7d12`, `c1203ec` | Live suite is runnable again — but against production; see §0.3 |
| **Circle Threshold** added (Shape › Circle, Limit = Window; works on oblique reformats); **Rect Multi renamed Rect Threshold**; "Rect" spelled out except where it would be cut off | `3ca5101`, `cc49364`, `5a770ef` | C8-02 covers both threshold shapes, including oblique; the user guide uses the new names |
| **Cleanup › Smooth edges** reworked into a visible, stable outline smoother | `334915f` | New C9 case for its Strength control and stability across reruns |
| Active dot dropped from member rows | `ff6d6a9` | C7 visual check; screenshots regenerated |
| SegWorks parity complete; the worklist leaves this repo and becomes a private extension; CLAUDE.md records that proprietary extensions never go in this public repo | `2373fef` | §B.4 adds a check that no proprietary plan or code has crept in before the repo moves to a wider-audience org |
| CLAUDE.md Known gaps cleared | in `d910d97` | Drift item from the first draft is resolved |

### 0.2 Release criteria (the gate)

The release candidate (RC) ships only when all of the following are true on the RC commit:

1. **The repository is `NrgXnat/xnat-workstation`**, Workstream D's checklist is complete, and the
   release is published from there.
2. **CI green**, including the new E2E job (§A.3 G1) for the offline suite on Linux, and branch
   protection requiring it.
3. **Full offline E2E suite green on macOS, Windows and Linux** (one run each).
4. **Live suite green** against the dedicated test XNAT (§A.1), including the new live
   transport specs (§A.3 G2).
5. **Every manual test script executed** on at least one platform, and the *platform-sensitive*
   scripts (marked 🖥 below) on all three, by someone other than the person who wrote the code
   under test. Results recorded in the run log (§A.2).
6. **No open P1 findings; every open P2 has a written deferral** accepted by the release owner.
7. **DICOM conformance**: every object the app writes (SEG, RTSTRUCT, SR) passes `dciodvfy`
   with no errors, and loads in at least two independent viewers (C19).
8. **User guide complete** for every feature that ships enabled, reviewed by one annotator from
   outside the dev team who followed the Getting Started chapter cold.
9. **Signed, notarised installers** produced by `release.yml` in the NrgXnat repo for all three
   platforms, `npm run test:edition` green on each, and an install of **0.6.1 from the old
   location updates itself to the RC** (C1-03, §D.5).
10. **SDK version decided and published** from the NrgXnat repo with provenance (§D.4, §0.3).

### 0.3 Baseline facts to change before the release

Each of these makes the release slower, riskier or harder to hand over if left as it is.

| Fact today | Change to | Why | When |
|---|---|---|---|
| Repo under a personal account | Transfer to NrgXnat (Workstream D) | Release artifacts, update feed and npm provenance all name the repo; changing them after users install 1.0 means a second migration for every install | Week 1, before any other CI or release change |
| Commits go straight to `main`; CI runs after the push | Protect `main` in the new org: PRs required, the CI job (and, once stable, E2E) required, linear history or merge commits per NRG convention, no force-push. Cut `release/1.0` at RC1; only fixes go there, each also merged to `main` | During a test cycle every push to `main` invalidates manual results already recorded; a release branch freezes what testers are testing | Rules on transfer day; branch at RC1 |
| One author, no CODEOWNERS | Add `CODEOWNERS` naming at least two NRG maintainers; require one review | An org-owned public repo with a bus factor of one is a support risk the org inherits; review is also where §B findings get applied | Transfer day |
| E2E not in CI | Offline E2E job on every PR (Linux, `xvfb`); nightly macOS + Windows; nightly live job | Today an E2E-only regression can merge green; 163 specs only help if they run | Week 1 non-blocking, required by RC1 |
| Live suite runs against production CNDA with a personal alias token | A dedicated, writable test XNAT with de-identified data and service accounts; CNDA used for at most a read-only smoke before release, by a person, not CI | Live tests that write (G2) cannot run on production; traces, screenshots and videos from a CNDA run contain real PHI and must never be uploaded as CI artifacts of a public repo; a personal token in org CI secrets ties CI to one person's account | Server by week 2; never put CNDA credentials in org secrets |
| Write path only mock-tested | Live write specs (G2) against the test XNAT | Save is the one action whose failure loses users' work | Week 2–3 |
| README stale; user docs absent | Rewrite README as a short landing page that points to the user guide and developer docs | The README is the first thing NrgXnat visitors see | Week 3 |
| `docs/` flat, live docs mixed with finished proposals | `docs/user-guide/` (annotators), `docs/developer/` (building, modules, extensions, editions, architecture), `docs/archive/` (finished proposals, reviews, parity plans); fix links | Readers in a wider org cannot tell which document is current; the SDK README and authoring guide link into `docs/` and must stay stable | Week 3, in one commit, with a link check |
| Extension API 0.x on npm (an extension must match the minor exactly) | Decide whether app 1.0 ships extension API 1.0 (semver: compatible across minors) or stays 0.x and says so in the guide | A "1.0" app with a 0.x API invites extension authors to assume stability they don't have, or locks the API before its first real consumer (the worklist) has used it | Decision before RC1 (§5) |
| App version 0.6.1; no CHANGELOG | Pick the release number (§5), add `CHANGELOG.md`, tag from the NrgXnat repo | Users and the update feed see the number; the changelog is what release notes are built from | RC1 |
| Example signing keys and a throwaway licence key pair in the repo (`extensions/examples/session-notes`, `docs/extension-authoring-example`) | Keep, but confirm in §B that each is labelled throwaway and that no production edition trusts it (`trustedKeys: []` in `edition.config.json`) | A public org repo is copied; a key that looks real will be reused | §B partition 2 |

---

## 1. Component inventory

Every script, spec and doc chapter in this plan hangs off this list. IDs are stable; use them in
test titles (`test('C9-04 …')`), findings and doc cross-references.

| ID | Component | Main code | Existing E2E coverage |
|---|---|---|---|
| C1 | Install, launch, update, editions, packaging integrity | `src/main/index.ts`, `src/main/updater/`, `electron-builder.config.js`, `edition.config.json`, `scripts/build-edition.mjs` | `smoke/`, `packaging/`, `npm run test:edition` |
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
| C21 | Extension host (load, slots, commands/keys, XNAT/state/annotations APIs, storage, licensing gate, fingerprints) | `src/main/extensions/`, `src/main/ipc/extensionHandlers.ts`, `src/renderer/lib/extensions/`, `ExtensionsSection` | `extensions/` (6 specs), `auth/extension-xnat` (live) |
| C22 | Extension SDK and authoring guide | `packages/extension-api/`, `src/shared/extensions/`, `docs/extension-authoring*`, `publish-sdk.yml` | `npm run test:extension-guide` |

---

## Workstream A — Functional testing

### A.1 Environments and data

**Platforms.** macOS (Apple silicon, plus one Intel run), Windows 11 x64, Ubuntu 22.04 x64. At
least one Retina/HiDPI display and one 1080p display — the overlays, rings and cursor sizes are
pixel-sensitive.

**Test XNAT.** A dedicated server, never production (see §0.3 for why CNDA is not it), ideally
run by NRG alongside other XNAT test infrastructure, with:

- Project `WS_RELEASE_TEST` holding de-identified data covering: CT (thin-slice body, 512²,
  real rescale), MR (multi-sequence brain, same exam), an oblique acquisition, a 4D/multi-phase
  CT, a cine/US multiframe, a localizer, and sessions that already contain SEG, RTSTRUCT and SR
  scans (including one with a `30xx` SEG and one written by another tool, e.g. 3D Slicer).
- Three service accounts: project owner, member, read-only collaborator (permission failures on
  save). Alias tokens for CI, owned by the accounts, not by a person.
- Local login, plus SSO (OIDC or LDAP) configured if feasible — C2 needs every auth path seen at
  least once, and SSO-only servers like CNDA are now the norm for real users.
- The `XNAT_*` variables in `e2e/helpers/env.ts` stored as **NrgXnat repo secrets** for the
  nightly live job, set up after the transfer (§D.3).

**Offline fixtures.** The generated phantoms in `e2e/fixtures/dicom/` stay the backbone of the
offline suite. Add any series new specs need through `generate.cjs`, never as committed
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
Steps: 1. Press the Lung preset shortcut.  2. Press the Bone preset shortcut.  3. Open the W/L
          preset menu on the toolbar and choose Soft Tissue.  4. Drag left-click with the W/L
          tool active.
Expect: 1. Lung parenchyma visible, W/L readout bottom-left reads the Lung preset values.
        2. Bone window; readout updates.  3. Menu choice applies and the menu closes.
        4. Readout changes continuously; no other viewport changes.
Auto:  viewport/overlay-readouts (steps 1–2); manual-only for 3–4 (feel).
Result: Pass / Fail / Blocked — tester, platform, build, notes, screenshot if Fail
```

`🖥` = run on all three platforms. `Auto:` links each case to the spec(s) that automate it, or
says "manual-only" and why — the traceability matrix (§A.3) in miniature.

**Run log.** One row per case per platform: build hash, tester, result, linked issue. Kept under
`docs/testing/runs/<rc>/`. Manual results are valid only for the build they were run on; this is
why §0.3 asks for a release branch.

#### Script catalogue

The cases below are the minimum set; script authors expand steps into the format above.

**C1 — Install, launch, update, editions, integrity** 🖥
- C1-01 Fresh install from the signed installer; first launch shows the login screen; app name,
  dock/taskbar icon and tray icon (macOS template icon in light and dark menu bar) are correct.
- C1-02 Gatekeeper / SmartScreen: no "unidentified developer" or unsigned warning.
- C1-03 Auto-update from 0.6.1 (installed from the **old** `danielmarcus` releases) to the RC
  published from **NrgXnat**: update offered, downloaded, applied on restart; About shows the new
  version. Then update RC → RC+1 entirely within NrgXnat (§D.5).
- C1-04 Update with unsaved annotations open: the app does not restart under them.
- C1-05 WebGL2 unavailable / software rendering (VM without GPU): clear message, no white screen.
- C1-06 Uninstall leaves no running processes; reinstall keeps or clears preferences as documented.
- C1-07 Open-source edition bundles exactly the modules in `edition.config.json` and no extensions
  (Settings › Extensions absent).
- C1-08 Packaged-build lock-down: `--inspect`, `NODE_OPTIONS` and `ELECTRON_RUN_AS_NODE` do nothing;
  an archive edited after packaging does not start (macOS, Windows); `npm run test:edition` green.

**C2 — Authentication and session**
- C2-01 Local account login via the XNAT login window; username shown in connection status.
- C2-02 LDAP and C2-03 OIDC/institutional SSO login (CNDA by a person, read-only, plus the test server).
- C2-04 Wrong password; C2-05 unreachable server; C2-06 server URL with/without scheme, trailing
  slash, path prefix (`normalizeServerUrl`).
- C2-07 Self-signed / invalid TLS certificate: refused with an understandable message.
- C2-08 Session expiry while idle: keepalive holds it, or the user is told and can re-login
  **without losing open annotations**.
- C2-09 Session expiry **during a save** (C13 interaction).
- C2-10 Logout: images, annotations and caches from the previous user are gone; extensions get
  `signedOut`; a different user logs in cleanly.

**C3 — XNAT browser**
- C3-01 Projects → subjects → sessions → scans; counts and labels match the XNAT web UI.
- C3-02 Filter fields; long lists (≥500 subjects) scroll without lag.
- C3-03 Load one scan; load a whole session (hanging protocol applied: CT pre/post, MR brain).
- C3-04 Pin and unpin project/subject/session; bookmarks survive restart; recents update.
- C3-05 Scans that cannot be displayed (non-image, SR-only, unsupported transfer syntax) are
  labelled, not silently broken.
- C3-06 Clicking a SEG/RTSTRUCT/SR scan loads its source and the annotation (scan-click reload).
- C3-07 Read-only collaborator: browsing works; save is refused with a clear dialog (C13).

**C4 — Local DICOM import** 🖥
- C4-01 Import a folder; C4-02 individual files out of order (sorted correctly); C4-03 mixed series
  in one folder split into series; C4-04 a non-DICOM file is skipped with a notice; C4-05 a corrupt
  file (Rows=0, truncated pixel data) is reported, not a crash.
- C4-06 Local import of a SEG/RTSTRUCT/SR together with its source.

**C5 — Image display and navigation** 🖥 (rendering)
- C5-01 Scroll: wheel, arrows, Page Up/Down, Home/End, scrollbar drag, slice track.
- C5-02 Pan, zoom, rotate 90°, flip H/V, invert, reset — from toolbar and hotkeys.
- C5-03 W/L presets and drag (example above).
- C5-04 Four-corner overlay: every field in Settings › Overlay toggles and shows correct values.
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
- C6-04 MPR 2×2: volume builds with progress; planes consistent; crosshairs sync; intensity readout.
- C6-05 3D panel renders and rotates.
- C6-06 Mixed-orientation series and an oblique series in MPR.
- C6-07 Layout change with annotations present: annotations re-attach to the right viewports.

**C7 — Annotations panel core**
- C7-01 Create Segmentation, Structure, Measurement from the header buttons; name captured by
  typing straight away (focus stays on the image), Enter → first member name, Escape keeps defaults.
- C7-02 Add, rename, recolour, hide, lock, delete members; container kebab actions; active member
  shown by row state alone (no separate dot).
- C7-03 Viewport scoping: annotation listed and rendered only on viewports showing its scan;
  cross-panel pill on same-scan viewports; drawing refused on another scan's viewport.
- C7-04 Unsaved indicator visible even for an unfocused viewport's container.
- C7-05 Approval: approve, approved container is read-only, approval persists across reload.
- C7-06 Inline per-segment metrics update after an edit.
- C7-07 Panel resize; very long names truncate with tooltip.

**C8 — Segmentation toolbox** (one sub-script per family, each against `annotation-tool-reference.md`)
- C8-01 Brush family: every Kernel × Limit mode paints, erases with Shift, respects brush size
  (`[` `]`), refuses a locked segment.
- C8-02 Shape family: Circle / Rect / Sphere × Limit None / Window — including **Rect Threshold**
  and **Circle Threshold**: only voxels inside the window join; a window nothing matches writes
  nothing; one undo step; locked segment refused; Circle Threshold works on an oblique reformat
  (Rect Threshold is refused there, with a reason); labels read "Rectangle" except where cut off.
- C8-03 Region (drag/click); C8-04 Level Trace preview + ⏎; C8-05 Random Walker seeds + Run;
  C8-06 ROI limit constrains Level Trace/RW/Cleanup; C8-07 Contour Fill with each boundary;
  C8-08 Smart Brush; C8-09 Seg Bidir.
- C8-10 Options strip: essentials visible, "More" holds the rest, dot appears when changed.
- C8-11 ⌘K / Ctrl+K finder: every tool, mode and operation found by name (old names such as
  "Rect Multi" either alias to the new tool or are gone — decide and test).
- C8-12 Every tooltip reads correctly to an annotator (wording review, not just presence).
- C8-13 Without WebGPU: Region/Region+ refuse with a reason.
- C8-14 Removed tools (Circle Multi) are not offered anywhere — toolbox, finder, hotkeys.

**C9 — Segmentation operations**
- C9-01..07 One per operation (Cleanup, Interpolate, Propagate, Seeded, Region competition,
  QC 3D, module operations): scope Slice/Range/Volume × Active/All; preview hatching; `\` compare;
  ⏎ commits as one undo step; ⎋ discards; preview discarded and reported when the segment
  changes underneath; locked segment previews read-only.
- C9-08 Operation stays open across tool changes; collapse ▾ and close ✕ (with pending-preview ask).
- C9-09 Operation on a viewport not showing the active container is refused.
- C9-10 Large volume (512² × 300): progress and Cancel work; UI stays responsive.
- C9-11 Cleanup › Smooth edges: the preview visibly smooths a jagged outline; Strength changes the
  result monotonically; re-running on its own output is stable (no drift or shrinkage).

**C10 — Structure (contour) tools**
- C10-01 Freehand, spline (each type), live wire, scissors, sculptor: draw, close, edit.
- C10-02 Escape / tool switch mid-draw cancels cleanly; Backspace removes the last spline point.
- C10-03 Interpolation between slices, including oblique; interpolated provenance shown.
- C10-04 Copy nearby / propagate / refine / snake refine.
- C10-05 Locked and approved structures cannot be edited by any path.
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

**C13 — Save/load to XNAT** (test server required)
- C13-01 Save a new SEG, RTSTRUCT, SR → new scan with the expected ID convention and metadata;
  reopen from XNAT is identical.
- C13-02 Overwrite an existing annotation scan; version bump.
- C13-03 Conflict: another user/tool modifies the scan first → conflict dialog; each choice does
  what it says.
- C13-04 Autosave at the configured frequency; per-container autosave row; no toast or banner on success.
- C13-05 Network drop mid-save → retry/transient handling; nothing lost.
- C13-06 Leave guard: loading a scan that would orphan unsaved work → Save · Discard · Cancel;
  loading into a second viewport does not prompt.
- C13-07 Quit with unsaved work → `CloseUnsavedDialog`.
- C13-08 Permission denied (read-only account) → dialog, work kept.
- C13-09 Load SEG/RTSTRUCT written by another tool (3D Slicer, OHIF).

**C14 — Backup, checkpoints, recovery**
- C14-01 Force-quit mid-edit → relaunch offers recovery banner; recovered work matches.
- C14-02 Checkpoints: create, list, restore; checkpoint files section in Settings.
- C14-03 File Backup settings honoured (location, retention).

**C15 — Export** 🖥 (file dialogs, clipboard)
- C15-01 Save as image (PNG/JPEG) includes annotations; C15-02 copy to clipboard pastes into
  another app; C15-03 save all slices; C15-04 save DICOM file; C15-05 export annotations (CSV /
  SEG / RTSTRUCT / SR) opens in a spreadsheet / other viewer.
- C15-06 Hide PHI respected in every export that renders the overlay.

**C16 — Modules**
- C16-01 Bundled modules listed in Settings › Modules; run each on example data.
- C16-02 Install a signed third-party module; reject an unsigned/tampered one with a reason.
- C16-03 Sandbox: a module cannot read files or network outside its grant.
- C16-04 Module failure surfaces per the surface taxonomy; app stays usable.

**C17 — Settings**
- C17-01 Every Settings section: change, close, reopen, restart — value persists and takes effect.
- C17-02 Hotkeys section matches actual behaviour; rebinding works; extension-command clashes shown.
- C17-03 Issue report produces a bundle containing logs and no PHI, credentials or licence files.
- C17-04 About shows version, build, licences (THIRD-PARTY-NOTICES), and the NrgXnat project link.

**C18 — Keyboard and focus**
- C18-01 Every shortcut in `defaultHotkeyMap.ts` from a viewport does what the guide says.
- C18-02 After clicking any toolbar/panel/slider/dropdown, arrow keys and Space still reach the viewport.
- C18-03 Text fields keep keystrokes while typing; modals (including extension dialogs) trap focus.

**C19 — DICOM conformance and interoperability**
- C19-01 SEG, RTSTRUCT, SR written by the app open correctly in 3D Slicer, OHIF (and Horos/OsiriX
  on macOS); geometry aligned, labels and colours preserved.
- C19-02 Objects written by those tools load correctly in the app.
- C19-03 Per `docs/dicom-export-field-policy.md`: no PHI leaks into derived objects beyond policy.

**C20 — Performance and stability** 🖥
- C20-01 `npm run test:perf` within `docs/perf-baseline.md` tolerances.
- C20-02 Two-hour annotation soak (3 sessions loaded/unloaded): memory plateaus, no slowdown, no
  WebGL context loss.
- C20-03 Largest realistic study (e.g. 2,000-slice CT) loads; MPR builds; no crash.

**C21 — Extension host** (run with a test edition that bundles `session-notes`, since the
open-source edition ships none)
- C21-01 Edition with an extension: Settings › Extensions lists it; disable → every slot,
  command and key it added disappears; re-enable restores them.
- C21-02 Slots: sidebar tab beside Browse (⋯ past two; choice remembered), toolbar item (text
  moves to tooltip as the toolbar narrows), full-window view (Esc / Back), Settings page.
- C21-03 Commands in ⌘K with the extension's name; keys yield to app keys; clash shown in Settings › Hotkeys.
- C21-04 An extension that throws, times out (10 s) or needs a newer API is refused with the
  reason, never half-loaded; Reload extension / Copy details on a slot error.
- C21-05 XNAT access as the signed-in user; paths outside `/data/` and `/xapi/` refused.
- C21-06 Licensing gate (example licence): none → nothing mounted, Basic, Pro, expired,
  edited-after-signing, wrong server — each shown in place with the reason.
- C21-07 Fingerprints: change one file of a bundled extension in an unpacked build → "Changed
  after the edition was built"; an unknown extension folder → "Not part of this edition".

**C22 — SDK and authoring guide** (developer audience)
- C22-01 Follow `docs/extension-authoring.md` from an empty folder using the **published** npm
  package, not the repo: build, run, see the tab, licence it.
- C22-02 `npm view @nrgxnat/workstation-extension-api` shows the release version with provenance
  pointing at `NrgXnat/xnat-workstation` (§D.4).

### A.3 Automated functional tests

**Step 1 — Traceability matrix (week 1).** Generate `docs/testing/traceability.md`: one row per
MTS case, columns *spec(s)*, *unit test(s)*, *manual-only reason*. Seed it by grepping spec
titles and file names against component areas, then correct by hand.

**Step 2 — Fill the gaps**, in priority order:

| # | Gap | New automation |
|---|---|---|
| G1 | E2E not in CI | `e2e-offline` job in `ci.yml`: `npm run build`, then `xvfb-run npm run test:e2e:offline` on Ubuntu with software GL (`app` project now includes `extensions/`); HTML report uploaded on failure (offline fixtures are synthetic, so reports are safe to publish). Non-blocking for one week to measure flakiness, then required by branch protection. Nightly macOS and Windows matrix. |
| G2 | Live XNAT write path | `e2e/specs/transport/live-*.e2e.ts` in the `auth` project: save new SEG/RTSTRUCT/SR to the **test server**, reload, compare voxels/contours/values; overwrite; injected conflict (a second REST client edits first); read-only account refusal. Each test deletes what it created. Nightly; **traces, videos and screenshots from live runs kept private** (not uploaded as public artifacts) even on the test server. |
| G3 | Session expiry | Live spec that invalidates the session mid-session and mid-save (C2-08/09). |
| G4 | Interoperability | Slicer- and OHIF-written SEG/RTSTRUCT/SR fixtures in `test:dicom:compliance`; `dciodvfy` on every object the E2E specs write (extend `seg-export-roundtrip` to RTSTRUCT and SR). |
| G5 | Recovery after crash | E2E that kills the Electron process mid-edit and relaunches on the same user-data dir (C14-01). |
| G6 | Packaged app | Run `npm run test:edition` in `release.yml` on each platform before publishing (it already builds a test package with the inspector re-opened, checks fuses, integrity, modules and extensions). Add a small smoke subset to it. |
| G7 | Settings persistence | One spec per Settings section: change → relaunch → assert (C17-01). |
| G8 | Hotkey contract | Table-driven spec generated from `defaultHotkeyMap.ts` asserting each binding's effect, so the guide's shortcut table and the code cannot drift (C18-01). |
| G9 | Export files | Assert written files (image dimensions, CSV columns, DICOM validity) for every `ExportDropdown` action (C15). |
| G10 | Measurement accuracy | Known-geometry phantom: each measurement tool against analytic truth (C11-01). |
| G11 | Visual baselines | Screenshot baselines for each panel state the user guide shows — doubles as the doc screenshot generator (§C.4). |
| G12 | SDK and guide | `npm run test:extension-guide` in CI (nightly or on changes to `packages/`, `src/shared/extensions/`, `docs/extension-authoring*`), and an `npm publish --dry-run` of the SDK on every PR touching it. |
| G13 | Threshold shapes | Effect specs for Circle Threshold on an oblique reformat and Smooth edges stability (C8-02, C9-11), if `roi-threshold-tools` and the operation sweep don't already assert them. |

**Rules for every new spec** (CLAUDE.md, binding): watch it fail first and record the red run in
the PR; drive the real affordance, no store setters, no Cornerstone mocks; assert that edits
*landed* (voxel/contour counts); cover the same-scan-two-viewports case for anything touching
scoping; title starts with the MTS case ID.

**Step 3 — Unit coverage review.** `npm run test:coverage`; for C13, C14, C19, C2 and C21 set a
floor and read the uncovered branches — error paths are what users hit in the field.

**Step 4 — Stabilise.** Full offline suite 5× on each platform; any test that fails once and
passes on re-run is root-caused before RC.

### A.4 Defect handling

- Every failure becomes a GitHub issue in **NrgXnat/xnat-workstation**, labelled `release-1.0`,
  component `C<n>`, priority P1–P3 (definitions as in `bug-review-2026-10.md`). Create the labels
  and a milestone after the transfer.
- P1 blocks the RC. P2 is fixed or deferred in writing. P3 goes to the backlog.
- Each fix lands with the automated test that would have caught it (seen red first), as a PR to
  `main` and, after RC1, cherry-picked to `release/1.0`.

---

## Workstream B — Code review and cleanup

### B.1 Tools and how each is used

| Tool | Used for | When |
|---|---|---|
| **`/code-review`** (Claude Code skill), `high` per area; `xhigh` for C13, C14, C19, C2, C21 | Correctness bugs in each component's code. Run per area (target = a path or the PR), so each review has focused context. `max` starts many reviewer agents and is the costliest — only if you decide the release warrants it. | Weeks 1–3 |
| **`/security-review`** | Main process, IPC handlers, preload bridge, module sandbox and signatures, **extension host** (`xnat-extension://` scheme, IPC allow-list, XNAT path allow-list, storage, licence verification, fingerprints, fuses), auth/cookie handling, update channel, issue-report bundle. | Week 1 |
| **`/simplify`** | Reuse, simplification and dead-weight cleanups after correctness fixes land. Quality only. | Week 3 |
| **Claude multi-agent workflow** (only with explicit opt-in — it can spawn many agents and spend many tokens) | One reviewer per component in §1, each finding adversarially verified by a second agent before it enters the ledger. | Optional, replaces the per-area loop |
| **Explore / general-purpose agents** | Inventory: unused exports and files, components imported nowhere (CLAUDE.md rule 5), TODO/FIXME/HACK sweep, docs that describe deleted code, every hard-coded repo/owner reference (§D.2), anything proprietary that must not be in a public org repo. | Week 1 |
| **Static tooling** | `npm run lint`, `npm run typecheck`, `knip` (or `ts-prune`), `npm audit --omit=dev`, `npm run notices:check`, Electron security checklist (`contextIsolation`, `sandbox`, `webSecurity`, CSP, `setWindowOpenHandler`), secret scanning (GitHub's, enabled in the org). | Week 1, then in CI |
| **`dciodvfy`** | Every DICOM object the app can write. | Continuous |

### B.2 Review partitions

Data-loss and security surfaces first:

1. **C13 + C14** transport, autosave, conflict, leave guard, backup, checkpoints.
2. **C2 + main process + preload + C16 sandbox + C21 host** (security). Includes the throwaway
   keys check in §0.3.
3. **C19** SEG/RTSTRUCT/SR writers and readers.
4. **C9 + C8** mask operations (incl. the reworked Smooth edges), solvers, tools (incl. Circle
   Threshold's injected window).
5. **C10 + C11 + C12** contours, measurements, selection/undo.
6. **C22 public API review** — before it is frozen at whatever version §5 picks: every exported
   type and function in `src/shared/extensions/api.ts` is intended, documented, and something we
   are willing to support; `./testing` export doesn't leak internals.
7. **C5 + C6 + C7 + C18** viewer, layouts, panel, focus model.
8. **C1 + C3 + C4 + C15 + C17** shell, browser, import, export, settings.

### B.3 Ledger and triage

All findings go into `docs/code-review-2026-11.md`, same columns as `bug-review-2026-10.md`
(ID, P, finding, source, status). Each finding needs a traced path from a real input to the
failure; far-fetched paths are recorded as "won't fix (reason)". Fixes land with a regression
test seen red first.

### B.4 Cleanup checklist

- Remove dead code, unused exports, unmounted components, stale feature flags; confirm
  `installRendererE2eHooks` and the E2E keychain switch are inert in release builds.
- Resolve or ticket every TODO/FIXME; no `console.log` debugging left (keep `[service]` warnings).
- **Public-repo hygiene before the move:** no proprietary extension code, worklist plans or
  customer data in the tree (CLAUDE.md says they never go here — verify, including git history
  of `docs/segworks-parity.md`); no real PHI in fixtures; no credentials in history (run secret
  scanning on full history).
- Reorganise `docs/` (§0.3) and update `CLAUDE.md`, `AGENTS.md`, `PHASES.md` accordingly.
- Bump versions and write `CHANGELOG.md`.
- Dependencies: Cornerstone packages exact-pinned to one version, Electron on a supported line,
  no high/critical `npm audit` items in shipped deps.

---

## Workstream C — Documentation

### C.1 Audience

An **experienced image reviewer or annotator** — radiologist, technologist, research assistant
or imaging scientist — who knows window/level, planes, DICOM basics and has annotated in some
tool (3D Slicer, ITK-SNAP, OsiriX, a PACS), but:

- may never have used **XNAT** (projects, subjects, sessions/experiments, scans, resources,
  permissions, how a SEG becomes a scan, signing in through an institution's SSO), and
- does not know **this app's** model: containers and members, the three annotation types,
  viewport scoping, tool families and modes, operations with preview/commit, autosave vs save,
  approval.

Tone: task-first, precise, no developer vocabulary. Every term in the CLAUDE.md terminology table
is defined once, in the glossary, and used consistently.

### C.2 Deliverables and outline

`docs/user-guide/` (Markdown, publishable as a static site), plus a rewritten `README.md` that
points to it.

1. **Introduction** — what the app is for; what it is not (regulatory wording, §5).
2. **XNAT in ten minutes** — projects → subjects → sessions → scans; who can see and write what;
   how saved annotations appear in XNAT (new scans, ID convention, versions); opening the same
   session in the XNAT web UI.
3. **Installing and signing in** — per-platform install, first launch, server URL, local / LDAP /
   institutional SSO, staying signed in, signing out, updates.
4. **Finding and opening images** — browser, filters, bookmarks and recents, scan vs session,
   hanging protocols, local DICOM files.
5. **Viewing images** — screen tour, navigation, W/L and presets, pan/zoom/rotate/flip/invert,
   overlays and Hide PHI, hover probe and ruler, cine and multi-phase, DICOM header panel.
6. **Layouts, MPR and 3D**.
7. **Annotation concepts** — containers and members; Segmentation · Structure · Measurement and
   when to use which; which viewports show an annotation and why; naming as you create; colour,
   visibility, lock; unsaved indicator.
8. **Segmenting** — the seven tool families and their modes (current names: Rectangle / Circle
   Threshold, etc.), options strip and More, Ctrl/⌘K finder; worked recipes (liver with Level
   Trace + Cleanup; lesion with Brush + Interpolate; seeded Random Walker; a threshold shape on
   bone).
9. **Operations** — scope, preview, compare, commit/discard; each operation, including Smooth edges.
10. **Contouring (Structures)**.
11. **Measuring** — each tool, reading values, saving as SR.
12. **Selecting, copy/paste, undo**.
13. **Saving, autosave and recovery** — save to XNAT, overwrite vs new, conflicts, leaving a scan
    with unsaved work, crash recovery, checkpoints, approval.
14. **Exporting**.
15. **Modules** — what they are, running one, installing a trusted module, security in brief.
16. **Extensions** — short: what an extension is, that some editions add them (a sidebar tab, a
    toolbar item, a full-window view), how to turn one off in Settings › Extensions, what a
    licence message means. The open-source edition ships none.
17. **Settings** — every section, every option.
18. **Keyboard shortcuts** — generated from `defaultHotkeyMap.ts` (checked by G8).
19. **Troubleshooting and FAQ** — sign-in problems (SSO, certificates), blank viewport/WebGL,
    slow loads, "why can't I draw here", "where did my annotation go", issue report, where to
    file an issue (NrgXnat repo or the XNAT discussion group — decide, §5).
20. **Glossary**.
21. **Release notes** — what's in the release, known limitations (e.g. WebGPU-only tools).

`docs/annotation-tool-reference.md` stays the generated per-tool table and is linked from
chapters 8–10, not duplicated.

### C.3 How it gets written

- Claude drafts each chapter from the code (catalog, hotkey map, settings sections, dialog
  strings) **and** from driving the running app — every procedure is executed before it is
  written down (CLAUDE.md rule 2). Where one can't be (e.g. a given SSO), the draft says so and a
  human verifies it.
- The MTS (§A.2) and the guide are written together; drift between them is a bug.
- Two review passes: technical (is it true?) and audience (an outside annotator follows chapters
  2–8 cold and notes every point of confusion).

### C.4 Screenshots

Generated: a Playwright script (`e2e/docs/screenshots.e2e.ts`, outside the normal suite) drives
fixture data to each documented state and writes PNGs to `docs/user-guide/img/`. Re-run before
each release; G11 reuses it. Fixtures only — no PHI.

### C.5 In-app hooks

A Help menu item opening the guide; links from Settings sections and error dialogs to the
relevant troubleshooting entry. Small, but a UI change — follows the visual-verification rules.

### C.6 Developer documentation (the SDK is public)

`docs/module-authoring.md`, `docs/extension-authoring.md` (+ the worked example), `docs/editions.md`
and `packages/extension-api/README.md` now have outside readers. For the release:

- Move them to `docs/developer/` with stable links (the npm README and package `homepage`
  point into the repo — update them in the same commit as the move, §D.2).
- Add a short `CONTRIBUTING.md` (build, test, PR rules, DCO/CLA per NRG convention) and
  `SECURITY.md` (how to report a vulnerability to NRG privately), unless the NrgXnat org's
  `.github` repository already provides org-wide defaults.
- C22-01 is the acceptance test: the guide works from npm, outside the repo.

---

## Workstream D — Move the repository to NrgXnat

Target: **`NrgXnat/xnat-workstation`** (same name, so redirects are simple). Use GitHub's
**Transfer ownership**, not a fresh push: a transfer keeps issues, PRs, releases, stars, history
and sets up redirects from the old URLs for web, git and API — which installed copies' update
feed depends on (§D.5).

### D.1 Before the transfer

1. **Agree with an NrgXnat org owner**: repo name, visibility (public), which team(s) get
   admin/maintain/write, and that the transferring account may create repositories in the org
   (or that an org owner accepts the transfer).
2. **Check the target name is free** in NrgXnat (no existing `xnat-workstation` repo or fork).
3. **Check org policy** that would block CI or releases: allowed Actions (the workflows use
   `actions/checkout`, `actions/setup-node`, upload-artifact, `gh`), required SSO/2FA for members,
   default `GITHUB_TOKEN` permissions (`release.yml` and `publish-sdk.yml` need `contents: write`;
   `publish-sdk.yml` needs `id-token: write`), macOS/Windows runner availability and billing, and
   whether org rulesets will apply to the repo on arrival.
4. **Inventory what is tied to the repo, not the code**, and write it down — the transfer may
   carry some of it, but verify each afterwards rather than assuming:
   - Actions secrets and variables used by `release.yml` (Apple signing certificate, password,
     notarisation API key/ID/team; DigiCert KeyLocker settings for Windows) and any environment
     secrets.
   - GitHub Apps installed on the repo (Claude, CI integrations, any Claude Approvals check),
     webhooks, deploy keys, branch rules, Pages.
   - npm trusted publisher for `@nrgxnat/workstation-extension-api` (bound to
     `danielmarcus/xnat-workstation` + `publish-sdk.yml`).
   - Claude Code cloud environments and sessions that reference the repo.
5. **Quiesce**: no release, SDK tag or workflow run in flight; open PRs merged or noted.
6. **Prepare the reference-update PR** (§D.2) on a branch, ready to merge right after the transfer.

### D.2 Hard-coded references to update (found by `grep -rn danielmarcus`)

| File | What | Change to |
|---|---|---|
| `electron-builder.config.js:48` | `publish: { provider: 'github', owner: 'danielmarcus', repo: 'xnat-workstation' }` — the **update feed** built into every installer | `owner: 'NrgXnat'` |
| `packages/extension-api/package.json` | `repository.url`, `homepage` | `NrgXnat/xnat-workstation` — npm provenance checks `repository.url` against the publishing repo, so a mismatch fails the publish |
| `packages/extension-api/README.md` | repo links; the trusted-publishing instructions name the repository | NrgXnat |
| `README.md` | `git clone` URL | NrgXnat |
| `CLAUDE.md` | Repository section: URL; "work is committed directly to `main`" | NrgXnat URL; the new PR/branch-protection rule (§0.3) |

Also: any links in `docs/` to `github.com/danielmarcus/...` (none today besides the above), the
About box / Help links once they exist, and `package.json` (add `repository`, `homepage`,
`bugs` pointing at NrgXnat — it has none today).

### D.3 Transfer day

1. Transfer `danielmarcus/xnat-workstation` → `NrgXnat` (Settings › Danger zone › Transfer).
2. **Do not create anything at `danielmarcus/xnat-workstation` afterwards** — no new repo, no
   fork back to the personal account with that name. Doing so silently breaks every redirect,
   including the update feed of installed 0.6.x copies.
3. Every maintainer: `git remote set-url origin https://github.com/NrgXnat/xnat-workstation.git`
   (git redirects work, but don't rely on them).
4. Merge the §D.2 reference-update PR.
5. Re-check, and re-enter where missing, the secrets, variables, Apps and webhooks from D.1.4.
   Install the Claude GitHub App on NrgXnat for this repo if Claude sessions will keep working
   on it; update Claude Code environments to the new repo.
6. Apply the §0.3 repository rules: branch protection / ruleset on `main`, required CI check,
   CODEOWNERS, labels and `release-1.0` milestone, secret scanning and Dependabot alerts.
7. Add the repo to the appropriate NrgXnat team(s); remove personal-account-only access paths.

### D.4 npm SDK publishing

1. On npmjs.com, package Settings › Trusted publishing: change the GitHub repository to
   `NrgXnat/xnat-workstation` (workflow `publish-sdk.yml`); keep "require 2FA and disallow tokens".
2. Make sure the `@nrgxnat` npm organisation has at least two owners from NRG.
3. Publish a patch version (e.g. `0.6.1`, or the version §5 decides) from a `sdk-v*` tag in the
   new repo; confirm on npm that the provenance names `NrgXnat/xnat-workstation`. Until this
   succeeds, treat SDK publishing as broken.

### D.5 Update-feed continuity (the step that affects users)

Installed copies of 0.6.x check `danielmarcus/xnat-workstation` releases. After the transfer
GitHub redirects that to NrgXnat, so they should find releases there — but this must be
**proven**, not assumed:

1. Publish a **bridge release** (the first NrgXnat release, built with the updated
   `electron-builder.config.js`) — can be an RC on a pre-release channel if the updater is
   configured to see one, or the release itself.
2. On each platform, install 0.6.1 from the old release assets, launch, and confirm it updates to
   the bridge release (C1-03). Confirm the updated app now checks NrgXnat directly.
3. Keep releases that 0.6.x users might still update from **reachable** (don't delete old release
   assets) until telemetry or time says they have moved on.
4. If the redirect fails for any platform's updater, there is no second copy to publish to —
   after a transfer the old name only redirects. The fallback is a notice in the README and XNAT
   community channels with a manual download link; decide before the transfer whether that is
   acceptable (§4, decision 9).

### D.6 After the transfer

- Run the full CI, a `release.yml` dry run (`workflow_dispatch`, publish off) on all three
  platforms, and a `publish-sdk.yml` run (§D.4) — all green from the new home before any other
  release work continues.
- Announce the new location (XNAT discussion group / NRG channels); update any XNAT
  documentation site or plugin listings that link to the personal repo.

---

## 2. Schedule

Assumes one developer driving with Claude, plus a part-time tester/annotator and an NrgXnat org
owner for a few hours in week 1.

| Week | D — Move | A — Testing | B — Review | C — Docs |
|---|---|---|---|---|
| 1 | D.1–D.4; CI, release dry run and SDK publish green from NrgXnat | Test XNAT requested; traceability matrix; G1 (non-blocking) | Static tooling; secret scan of history; `/security-review`; partitions 1–2 | Outline approved; glossary; chapters 1–4 |
| 2 | D.5 bridge-release proof (can use a pre-release) | MTS for C1–C10; G2–G5 | Partitions 3–5; P1 fixes | Chapters 5–9; screenshot script |
| 3 | — | MTS for C11–C22; G6–G13; flake stabilisation | Partitions 6–8; `/simplify`; `docs/` reorganisation | Chapters 10–21; developer docs (C.6) |
| 4 | — | **RC1**: cut `release/1.0`; full manual run on 3 platforms; E2E required | P1/P2 fixes from the run | Technical review; outside-annotator review |
| 5 | — | RC2: re-run failed/affected scripts; live + offline green | Ledger closed or deferred | Fixes; release notes |
| 6 | Announce | Release gate (§0.2) | — | Publish guide; README |

---

## 3. Risks

- **The update feed breaks across the move.** Every 0.6.x install stops getting updates silently.
  Mitigation: D.5 proof before the release, never reuse the old name, keep old assets.
- **Secrets don't arrive with the transfer**, and signing/notarisation fails at release time.
  Mitigation: D.1.4 inventory, D.6 dry run in week 1.
- **npm provenance fails** after the move (repository URL or trusted publisher mismatch).
  Mitigation: D.2 + D.4 together, patch publish in week 1.
- **E2E in headless Linux CI may not match real GPUs.** Mitigation: nightly macOS/Windows, 🖥 scripts.
- **Live tests leak PHI** through traces or reports. Mitigation: test server only; live artifacts
  private; CNDA only by hand.
- **Docs drift from UI** while fixes land in weeks 4–5. Mitigation: generated screenshots and
  shortcut table; doc review after the last UI change.
- **Review findings outrun fix capacity.** Mitigation: data loss and security first; P3s to backlog.

---

## 4. Decisions needed before starting

1. **NrgXnat setup**: repo name (`xnat-workstation` assumed), owning team(s), who the second
   CODEOWNER is, merge style (merge commits vs squash), and who at NRG owns the Apple/DigiCert
   signing identities going forward — are they personal, WashU, or NRG?
2. **Release number**: 1.0.0, or a 0.x public beta first.
3. **Extension API version at release**: freeze at 1.0 with the app, or stay 0.x (and say so).
4. **Release scope**: anything to finish, hide or remove for this release (e.g. tools that need WebGPU).
5. **Regulatory positioning**: "research use only / not for diagnostic use" wording for the
   guide, About box and installer.
6. **Test XNAT**: which server, who provisions the de-identified data and the service accounts.
7. **Code-review depth**: per-area `/code-review` (default), the opt-in multi-agent workflow, or
   `max` on the data-loss partitions.
8. **Doc hosting and support channel**: Markdown in-repo only or also a published site; where
   users file issues and ask questions (GitHub issues, the XNAT discussion group, both).
9. **Update-feed fallback**: if D.5 shows a platform's updater won't follow the redirect, is a
   manual-download notice acceptable for existing 0.6.x users?
