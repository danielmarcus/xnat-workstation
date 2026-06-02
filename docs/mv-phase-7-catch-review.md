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

### `src/main/updater/`

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `autoUpdateService.ts:127` | Sets status `phase: 'error'` consumed by renderer's update banner | ✅ Banner — non-routine app-update event already surfaces through the existing top-of-app banner | |

1 catch · 0 changes
