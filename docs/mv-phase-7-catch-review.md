# MV-Phase 7.1 §13.2 — try/catch error-handling coverage review

Working document for the try/catch review portion of issue #76. Walks `src/` one directory at a time, classifies each catch into the spec §11.7 / §13.2 surface taxonomy, and flags the ones whose current surface is wrong.

## Surface taxonomy (spec §13.2)

| Surface | When to use |
|---|---|
| **Silent** (`console.warn` / `console.error` only) | Operation has a working fallback the user shouldn't be bothered by, or the error is internal-detail that has no user-actionable meaning. |
| **Toast** (per §11) | User-initiated action partially failed or briefly succeeded; recoverable; user may want to retry but doesn't need to. |
| **Dialog** | User-initiated action wholly failed and needs decision. |
| **Banner** | Non-routine high-stakes events: backup recovery, app update, connection loss mid-session. |

## Per-directory review

Walking order from lowest-coupling (shared / main) up through renderer/lib then renderer/components. For each directory: list the catches, classify, and call out only the ones whose current surface is wrong.

### Conventions

- ✅ — current surface is appropriate, no change
- 🔧 — surface should change in this issue
- ⏳ — surface change deferred to a later wave (e.g., toast emissions wait for #77)

### `src/shared/diagnostics/`

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `deidentify.ts:22` | URL parse fallback to `<url-redacted>` | ✅ Silent — the fallback IS the function's job (produce a redacted string); no user-actionable signal | |

1 catch · 0 changes

### `src/main/xnat/`

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `xnatClient.ts:117` | Cookie-set failure → `console.warn` | ✅ Silent — best-effort cookie sync; no user-actionable signal | |
| `xnatClient.ts:159` | Username lookup failure → return `null` | ✅ Silent — caller handles null | |
| `xnatClient.ts:205` | Disconnect-time logout failure → ignore | ✅ Silent — already disconnecting | |
| `xnatClient.ts:339` | User listing → fall back to legacy endpoint | ✅ Silent — working fallback | |
| `xnatClient.ts:354` | Optional profile metadata failure → return `{}` | ✅ Silent — optional metadata | |
| `xnatClient.ts:546` | Resource-level loop failure → continue | ✅ Silent — batch op continues | |
| `xnatClient.ts:582`, `:586` | Per-file SOP class lookup → continue/null | ✅ Silent — best-effort cache fill | |
| `xnatClient.ts:676` | Catalog endpoint not available → empty array + `console.warn` | ✅ Silent — known older-XNAT fallback | |
| `xnatClient.ts:851` | SeriesNumber stamping failure → throws | ✅ Throw — wrapped by upload-level catch above | |
| `xnatClient.ts:1011`, `:1099`, `:1159`, `:1216` | Post-upload `pullDataFromHeaders` failure → `console.warn` | ✅ Silent — primary upload succeeded; secondary metadata refresh is best-effort | |
| `xnatClient.ts:1380` | Trash copy failure → `console.warn` | ✅ Silent — comment notes "best-effort" | |
| `browserLogin.ts:59`, `:93`, `:267`, `:279`, `:295`, `:351` | All non-fatal sub-step failures within login flow | ✅ Silent — flow-level error returned to caller as structured result | |
| `sessionManager.ts:46`, `:254` | Login flow failure → return `{success:false, error}` to renderer | ✅ Renderer surfaces via login form (dialog-equivalent) | |
| `sessionManager.ts:160`, `:227` | Cookie removal cleanup → ignore | ✅ Silent — cleanup | |
| `sessionManager.ts:215` | CSRF token fetch failure → non-fatal | ✅ Silent — already-noted fallback | |

26 catches · 0 changes

### `src/main/ipc/`

All 47 catches in this directory follow the standard IPC handler pattern: `catch → console.error → return { ok: false, error: msg }`. The error travels back over IPC as a structured result, and the renderer caller decides the surface based on the calling context.

| File | Catches | Pattern |
|---|---|---|
| `backupHandlers.ts` | 12 | IPC structured result (renderer panels show inline state) |
| `uploadHandlers.ts` | 11 | IPC structured result (renderer xnatUploadService translates to dialog/toast) |
| `exportHandlers.ts` | 9 | IPC structured result (renderer ExportDropdown shows feedback) |
| `proxyHandlers.ts` | 7 | IPC structured result; also calls `sessionManager.handleAuthFailure()` for 401-class errors |
| `diagnosticsHandlers.ts` | 7 | IPC structured result; missing-directory cases return `{ok: true, [...]: []}` (intentionally non-error) |
| `localE2eHandlers.ts` | 1 | E2E hook only — silent return | |

✅ All 47 main-process IPC handlers correctly return structured errors. The surface decision lives on the renderer side and is reviewed in the renderer sections below.

47 catches · 0 changes (surface decision deferred to renderer caller; reviewed below)

### `src/renderer/lib/diagnostics/`

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `crashSnapshotService.ts:70` | Capture path failure → `console.warn` + return `null` | ✅ Silent — comment explicitly notes "never let capture failures cascade into the crash path" | |
| `issueReport.ts:35` | Main-process snapshot fetch failure → records `{ok:false, error}` into the report payload | ✅ Silent — diagnostics report intentionally includes the fetch failure for support | |
| `rendererLogBuffer.ts:17` | `JSON.stringify` on circular ref → `String(arg)` fallback | ✅ Silent — fallback IS the function's job (produce a string log line) | |

3 catches · 0 changes

### `src/renderer/lib/backup/`

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `backupService.ts:173` | Manifest read failure → fresh manifest | ✅ Silent — init path | |
| `backupService.ts:234`, `:301`, `:316`, `:329`, `:339` | Cleanup of stale backup files → ignore | ✅ Silent — best-effort cleanup | |
| `backupService.ts:254` | Export-to-DICOM failure during auto-save: "no painted segment data" returns silently, other errors rethrow up to `autoSave.ts` | ✅ Silent — caller `autoSave.ts:performAutoSave` translates to `autoSaveStatus` state read by the spec'd panel autosave row (§4.9) | |
| `backupService.ts:274` | Manifest write failure → `console.error` | ✅ Silent here — surface decision lives in `autoSave.ts` via `autoSaveStatus`; the **panel autosave row** (#82 §4.9 + #86 §13.7) is the documented home for "backup failed — retry" + the 3-failure escalation toast | |

8 catches · 0 changes (surfaces decided by `autoSave.ts` consumer; panel autosave row is the spec'd home)

### `src/renderer/lib/segmentation/`

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `SegmentationManager.ts:94` | viewport-ready timeout → 200ms wait + continue | ✅ Silent — recovery built in | |
| `SegmentationManager.ts:134`, `:159`, `:701` | Per-viewport attach failure → `console.debug` | ✅ Silent — best-effort multi-viewport attach | |
| `SegmentationManager.ts:221` | Reconcile-after-ready failure → `console.debug` | ✅ Silent — comment notes non-fatal causes (stale epoch, timeout) | |
| `SegmentationManager.ts:232` | Viewport-presence check → return `false` | ✅ Silent — boolean return is the contract | |
| `SegmentationManager.ts:525` | Overlay-load failure → `console.error` + sets `loadStatus: 'error'` for UI consumer | ✅ Silent here; UI consumer (panel rebuild #82 §4.4 row state) will surface | |

7 catches · 0 changes

### `src/renderer/lib/app/`

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `appHelpers.ts:185`, `:214` | DICOM tag lookup helpers → return `null` on parse failure | ✅ Silent — caller treats null as "not available" | |
| `appHelpers.ts:241`, `:283` | Per-scan match-loop failure → continue to next scan | ✅ Silent — search loop tolerates individual failures | |

4 catches · 0 changes

### `src/renderer/lib/e2e/`

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `e2eFixtureBridge.ts:159` | Metadata-ordering helper failure → `console.warn` + IPC-order fallback | ✅ Silent — test helper, fallback path is correct | |
| `installRendererE2eHooks.ts:553` | Viewport-attachment lookup → return `[]` | ✅ Silent — comment notes Cornerstone API inconsistency | |
| `installRendererE2eHooks.ts:969` | Export-to-DICOM-SEG failure → records to `window.__XNAT_E2E_LAST_EXPORT_ERROR__` | ✅ Silent — test hook intentionally records onto a global for spec retrieval | |
| `installRendererE2eHooks.ts:1036` | Export-to-RTSTRUCT failure → `console.warn` + rethrow | ✅ Rethrow — test hook lets the spec see the actual error | |

4 catches · 0 changes (all are E2E test-rig hooks, intentionally non-production)

### `src/renderer/lib/dicom/`

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `segReferencedSeriesUid.ts:119` | SEG header parse failure → `console.warn` + return `{referencedSeriesUID: null, ...}` | ✅ Silent — caller falls back to filename-based heuristics | |

1 catch · 0 changes

### `src/renderer/lib/` (top level)

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `pinnedItems.ts:86`, `:94`, `:161`, `:169`, `:279`, `:281`, `:295`, `:302` | localStorage read/write failures (quota, corrupted JSON) → ignore / return `[]` | ✅ Silent — pinned-items + recent-sessions are convenience features; their absence is acceptable | |

8 catches · 0 changes

### `src/main/updater/`

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `autoUpdateService.ts:127` | Sets status `phase: 'error'` consumed by renderer's update banner | ✅ Banner — non-routine app-update event already surfaces through the existing top-of-app banner | |

1 catch · 0 changes
