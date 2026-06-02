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

### `src/renderer/stores/`

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `connectionStore.ts:56` | Login flow failure → sets `{status:'error', error: msg}` consumed by LoginForm component | ✅ Component renders inline error (dialog-equivalent within login form) | |
| `connectionStore.ts:69` | Logout failure → silent | ✅ Silent — already disconnecting | |
| `connectionStore.ts:98` | Session-validation failure → sets `error: 'Connection lost'` (banner-worthy mid-session event) | ✅ Banner-equivalent — existing connection-status pill in toolbar surfaces this | |
| `sessionDerivedIndexStore.ts:455`, `:464`, `:513` | Per-scan derived-index lookup failures → `console.warn` + return null | ✅ Silent — derived-index is a discovery aid; per-scan failures are tolerable | |

6 catches · 0 changes

### `src/renderer/components/settings/`

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `SettingsModal.tsx:457` | Issue-report generation failure → renders error string into the textarea | ✅ Inline UI state — appropriate for a "build a report" action | |
| `SettingsModal.tsx:473` | Clipboard copy failure → sets `issueCopyStatus = 'error'` (button label flips for 3s) | ✅ Inline UI state — toast equivalent for a single button | |

2 catches · 0 changes

### `src/renderer/components/` (top level)

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `ErrorBoundary.tsx:71` | "Copy diagnostics report" failure → falls back to raw error+stack copy | ✅ Silent fallback — already inside the crash recovery screen; user gets *something* on clipboard | |
| `ErrorBoundary.tsx:76` | Inner clipboard fallback also fails → give up | ✅ Silent — already in the crash UI; nothing else to try | |

2 catches · 0 changes (both inside the crash recovery screen, so the surface is the ErrorBoundary itself)

### `src/renderer/components/connection/`

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `ConnectionStatus.tsx:26` | URL parse failure → keep full URL | ✅ Silent — display-only fallback | |
| `LoginForm.tsx:35`, `:51` | Recent-servers localStorage read/write failures | ✅ Silent — convenience feature | |
| `XnatBrowser.tsx:458` | Navigation flow failure → `console.error` + clears loading | ⏳ Should surface via sidebar status footer; defer to **#88 (7.6 Sidebar polish)** | |
| `XnatBrowser.tsx:548` | Per-session-expansion scan-load failure → records to `sessionScansErrorById[id]` (inline error per session row) | ✅ Inline UI state already shown | |
| `XnatBrowser.tsx:599` | Thumbnail load failure → records `status: 'error'` on the thumbnail entry | ✅ Inline UI state — error placeholder | |
| `XnatBrowser.tsx:716` | Background modality-breakdown enrichment failure → `console.error` | ✅ Silent — background enrichment that's optional | |
| `XnatBrowser.tsx:733`, `:749`, `:768`, `:783`, `:858`, `:876`, `:902` | Project/subject/session/scan list-load failures + refresh failures → `console.error` only, no user signal | 🔧 Gap — user sees empty list + no error message. **Owned by #88 (7.6 Sidebar polish)** since that issue threads a status surface into the sidebar. Tracking-only here; no edit in this issue. | |

15 catches · 7 deferred to #88 (gap noted), 0 in-place changes

### `src/renderer/components/viewer/`

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `ContainerListPanel.tsx:210`, `:219`, `:232`, `:332`, `:343`, `:410`, `:677`, `:691`, `:882`, `:957` | User-initiated bulk-action / per-row action failures → `console.warn` only | ⏳ All become toasts in **#82 (7.3e Annotation panel)**; this file gets rewritten there. Tracking-only here. | |
| `ExportDropdown.tsx:177` | Canvas capture failure → `console.error` + return `null` (caller shows "Save failed" toast) | ✅ Silent here; caller surfaces | |
| `ExportDropdown.tsx:244`, `:272`, `:333` | Save / Copy / Export-all failures → already set inline toast state | ✅ Already toast-equivalent (component-local `setToast`); will migrate to global toast in **#77 (7.2)** | |
| `ExportDropdown.tsx` (2 more silent helpers) | Format-detection helpers → return null on parse failure | ✅ Silent — fallback path | |
| `DicomHeaderPanel.tsx:81`, `:93`, `:115`, `:194` | Per-tag formatting fallbacks → empty string / fallback display | ✅ Silent — display-only | |
| `DicomHeaderPanel.tsx:218` | Whole-dataset load failure → `console.warn` + clear `allTags` (panel shows empty) | ⏳ Worth a toast for visibility; this file is rewritten as a modal in **#84 (7.7)**. Tracking-only here. | |
| `ViewportOverlay.tsx:124`, `:155`, `:191` | Modality / orientation detection helpers → fall back to null | ✅ Silent — overlay-formatting fallbacks | |
| `VolumeViewport.tsx:94` | FoR pre-load failure → `console.warn` (volume creation can still proceed) | ✅ Silent — recovery via the outer setup | |
| `VolumeViewport.tsx:178`, `StackViewport.tsx:162` | Viewport setup failure → `console.error` + `setError(...)` shown inline in the viewport cell | ✅ Inline error state — matches spec §13.5 ("per-scan failures surface in the viewport cell"). Per-viewport ErrorBoundary (already landed in #76) catches anything that escapes. | |
| `ScrollSlider.tsx:82` | Pointer-capture release failure → ignore | ✅ Silent — no-op on cleanup | |
| `AddAnnotationButtons.tsx:86` | Create-annotation failure → `console.error` only | ⏳ Should become toast; this surface moves into the panel in **#80 (7.3c)**. Tracking-only here. | |

29 catches · 0 in-place changes (12 deferred to #82 + #77 + #80 + #84 panel/toast rebuilds)

### `src/renderer/App.tsx`

Grouped by purpose because all 31 catches in this file fall into clear categories.

| Group | Lines | Current behavior | Classification |
|---|---|---|---|
| **Backup-recovery iteration** (per-entry processing) | `:192`, `:235`, `:261`, `:318`, `:334`, `:376`, `:421`, `:484`, `:502`, `:2861`, `:2913`, `:2961` | Per-file failures during recovery → `console.error` + continue; aggregate result surfaced via the existing recovery banner | ✅ Silent at per-file level; the recovery banner is the aggregate surface |
| **Cleanup ignores** | `:741`, `:1015`, `:2765`, `:2816`, `:2830` | Discard / cleanup paths → ignore | ✅ Silent — cleanup |
| **Diagnostic copy** | `:1006` | Clipboard write failure → `console.warn` | ✅ Silent — clipboard is a fallback |
| **Local DICOM parse fallback** | `:1157` | DICOM-detection parse failure → treat as regular image | ✅ Silent — working fallback |
| **Metadata-ordering fallback** | `:1178` | Sort by metadata fails → use insertion order | ✅ Silent — working fallback |
| **Local SEG / RTSTRUCT / deferred SEG load failures** | `:1270`, `:1317`, `:1406` | Per-file load failure → `console.error` AND `setBrowserStatusMessage('Failed to load …', 'error')` | ✅ Sidebar status footer (per surface taxonomy) |
| **Existing-SEG / RTSTRUCT reuse fallback** | `:1676`, `:1932` | Reuse failure → `console.warn` + fresh-load fallback | ✅ Silent — working fallback |
| **Per-overlay enrichment failure** | `:2235` | Per-overlay load failure in `loadOverlaysForSourceScan` → `console.error` + continue | ✅ Silent acceptable (overlays are best-effort enrichment; scan still loads); per-overlay toast could be a future enhancement but not a current gap |
| **Scan / session / protocol load failure** | `:2246`, `:2534`, `:2597` | Top-level load failure → `setLoadError(msg)` which renders inline error display | ✅ Inline error display (dialog-equivalent) |
| **Drag-drop payload parse** | `:2684` | Defensive parse of dragged XNAT scan payload → `console.warn` | ✅ Silent — defensive |
| **Pre-load helper** | `:528` | Per-image pre-load failure → `console.warn` + resolved promise | ✅ Silent — pre-load is opportunistic |

31 catches · 0 changes (all 31 are correctly classified: aggregate surfaces feed the existing recovery banner, sidebar status footer, and inline `setLoadError` display)

### `src/main/updater/`

| File:line | Current behavior | Classification | Note |
|---|---|---|---|
| `autoUpdateService.ts:127` | Sets status `phase: 'error'` consumed by renderer's update banner | ✅ Banner — non-routine app-update event already surfaces through the existing top-of-app banner | |

1 catch · 0 changes
