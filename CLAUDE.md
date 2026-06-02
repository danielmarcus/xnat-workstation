# CLAUDE.md

## Project Overview

XNAT Workstation is a desktop DICOM medical image viewer built on Electron. It connects to XNAT imaging repositories to browse, load, annotate, segment, and export medical images. It renders images using Cornerstone3D directly (not OHIF).

## Repository

- **GitHub**: https://github.com/danielmarcus/xnat-workstation (private)
- **Branch**: `main`

## Tech Stack

- **Runtime**: Electron (main + renderer processes, context-isolated preload)
- **Renderer**: React 19, TypeScript, Vite, Tailwind CSS
- **State Management**: Zustand (stores in `src/renderer/stores/`)
- **Medical Imaging**: Cornerstone3D v4 (`@cornerstonejs/core`, `tools`, `adapters`, `dicom-image-loader`)
- **DICOM Parsing**: `dcmjs` (via adapters), `dicom-parser` (for low-level binary parsing)
- **Backend Integration**: XNAT REST API (authenticated via session cookies, proxied through main process)

## Project Structure

```
src/
  main/                     # Electron main process (Node.js, CommonJS)
    index.ts                # App entry: window, tray, menu, dock icon
    ipc/                    # IPC handlers (auth, upload, export, proxy)
    xnat/                   # XNAT REST client and session management
  preload/
    index.ts                # Context bridge: exposes electronAPI to renderer
  renderer/                 # Vite root (React SPA)
    main.tsx                # React entry point
    App.tsx                 # Top-level app: login flow, scan loading, panel management
    components/
      connection/           # LoginForm, XnatBrowser, ConnectionStatus
      viewer/               # Toolbar, ViewportGrid, Viewport, StackViewport, VolumeViewport,
                            # ViewportOverlay, ViewportHint, ContainerListPanel,
                            # AddAnnotationButtons, AnnotationToolDropdown, SegmentationToolDropdown,
                            # DicomHeaderPanel, ExportDropdown, ScrollSlider, CollapsibleGroup
      settings/             # SettingsModal (tabs: Hotkeys, Annotation, Display, Interpolation,
                            #                       Backup, Updates, Diagnostics, About)
      icons.tsx             # Icon components (XnatLogo uses PNG asset import)
    lib/cornerstone/        # Cornerstone3D service layer (singleton modules)
      init.ts               # Cornerstone3D initialization, tool registration
      viewportService.ts    # Viewport creation and management
      toolService.ts        # Tool activation, brush modes
      segmentationService.ts  # Segmentation CRUD, DICOM SEG import/export
      annotationService.ts  # Annotation event sync to Zustand store
      containerService.ts   # Container CRUD (SEG/RTSTRUCT/SR peers)
      containerActions.ts   # Container/member operations + dirty tracking
      containerBridge.ts    # Container ↔ Cornerstone bridge
      containerStoreSync.ts # Cornerstone event → containerStore sync
      xnatUploadService.ts  # Save-to-XNAT pipeline (SEG / RTSTRUCT / SR)
      dicomwebLoader.ts     # DICOMweb image loading via XNAT proxy
      dicomValidation.ts    # Pre-upload IOD validation (see "DICOM Compliance" below)
      crosshairSyncService.ts # Crosshair sync between viewports
      acquisitionNumberProvider.ts # Per-viewport acquisition matching
      metadataService.ts    # Metadata provider helpers
      # Note: MPR is per-viewport via `panelOrientationMap`; no dedicated service.
    lib/hotkeys/            # Hotkey dispatch + default map + service (see §"Hotkey System")
    lib/preferences/        # Preferences loading + apply (see §"Preferences")
    lib/backup/             # Local backup write/read; recovery flow
    lib/e2e/                # Renderer-side E2E hooks (window.__XNAT_E2E__)
    stores/                 # Zustand stores
      viewerStore.ts        # Panel layout, active viewport, panel↔scan map, MPR orientations
      containerStore.ts     # Container summaries (SEG/RTSTRUCT/SR — peer types)
      segmentationStore.ts  # Segmentation summaries (synced from Cornerstone events)
      annotationStore.ts    # Annotation (measurement) summaries
      connectionStore.ts    # XNAT connection state
      metadataStore.ts      # DICOM metadata cache
      preferencesStore.ts   # User preferences (Zustand persist → localStorage)
      dialogStore.ts        # Modal dialog queue
    pages/
      ViewerPage.tsx        # Main viewer layout with viewport grid
    assets/
      xnat-icon.png         # App icon (imported via Vite asset import)
    styles/
      globals.css           # Tailwind base + custom styles
  shared/                   # Code shared between main and renderer
    ipcChannels.ts          # Typed IPC channel constants
    types/                  # TypeScript interfaces (ElectronAPI, DICOM types, XNAT types)
    dicomTagDictionary.ts   # DICOM tag name lookup
build/                      # App icons for packaging
  icon.png                  # Full-color app icon (320x320)
  iconTemplate.png          # macOS tray icon (22x22, monochrome template)
  iconTemplate@2x.png       # macOS tray icon Retina (44x44, monochrome template)
scripts/
  fix-dev-app-name.js       # Patches Electron binary Info.plist for dev mode
```

## Build & Run

```bash
npm install            # Install deps (also runs postinstall to patch Electron app name)
npm run dev            # Start dev mode: Vite dev server + Electron main process
npm run build          # Production build (main + renderer)
npm run package        # Package with electron-builder (outputs to release/)
npx tsc --noEmit       # Type-check renderer + shared code
npx tsc -p tsconfig.main.json --noEmit   # Type-check main process code
npx vite build         # Build renderer only
```

**Dev mode** starts two processes concurrently:
- `dev:renderer`: Vite dev server on port 5173 (with COOP/COEP headers for SharedArrayBuffer)
- `dev:main`: Waits for Vite, compiles main process TypeScript, launches Electron

## Architecture Patterns

### IPC Communication

All renderer-to-main communication uses typed IPC channels defined in `src/shared/ipcChannels.ts`. The preload script (`src/preload/index.ts`) exposes `window.electronAPI` with a typed interface (`ElectronAPI` in `src/shared/types/index.ts`). XNAT API calls are proxied through the main process to handle authentication cookies and avoid CORS/COEP issues.

### Cornerstone3D Service Layer

Cornerstone3D services in `src/renderer/lib/cornerstone/` are singleton modules (not classes). They follow an event-driven sync pattern:
- Cornerstone3D owns all imaging data (viewports, segmentations, annotations)
- Services listen for Cornerstone events, build lightweight summaries, and push to Zustand stores
- React components read from stores for reactive UI updates
- Components call service methods for actions (never call Cornerstone3D directly)

### XNAT Integration

- Images load via DICOMweb (wadouri) through a local proxy (`/dicomweb` in Vite config proxies to `localhost:8081`, which the main process serves)
- DICOM SEG files are uploaded/downloaded as base64 over IPC
- SEG scan IDs follow convention `30xx` where `xx` is the source scan number (e.g., scan 3004 is a SEG for scan 4)

## TypeScript Configuration

Two separate tsconfig files:
- `tsconfig.json`: Renderer + shared code (ESNext modules, bundler resolution, noEmit)
- `tsconfig.main.json`: Main + preload + shared code (CommonJS, node resolution, emits to `dist/main/`)

Path aliases:
- `@/*` → `src/*`
- `@renderer/*` → `src/renderer/*`
- `@shared/*` → `src/shared/*`

## Vite Configuration

- Root: `src/renderer`
- Base: `./` (relative paths for Electron file:// protocol)
- `@cornerstonejs/dicom-image-loader` is excluded from pre-bundling (breaks worker creation)
- Worker format: ES modules
- WASM files included as assets
- COOP/COEP headers enabled for SharedArrayBuffer (required by Cornerstone3D volume rendering)

## Conventions

- Console logging uses `[serviceName]` prefix (e.g., `[segmentationService]`, `[App]`)
- Colors use Tailwind utility classes; the app has a dark theme (`bg-gray-900`)
- Zustand stores use the `create` pattern without providers
- **Testing**: Vitest (`vitest ^2.1.8`) for unit tests as `*.test.tsx` / `*.test.ts` co-located with sources. Playwright (`@playwright/test ^1.58.2`) for E2E in `e2e/specs/`. Run: `npx vitest run` (unit) · `npx playwright test` (E2E).
- PNG assets in the renderer use Vite asset imports (`import url from './assets/file.png'`)
- macOS tray icons must be template images (monochrome, filename ends with `Template`)

### Terminology (project-wide, used in code + docs)

| Term | Meaning |
|---|---|
| **Viewport** | A single Cornerstone3D rendering surface — one image cell. Code IDs are `panel_0`, `panel_1`, etc. (historical naming; they refer to viewports). |
| **Viewport area** | The center region of the app that holds the grid of viewports. |
| **Side panel** | A UI surface alongside the viewport area (e.g., the Annotations side panel). |
| **Sidebar** | The XNAT browser on the left edge of the app. |
| **Container** | A SEG, RTSTRUCT, or DICOM-SR top-level annotation file. Owns *members*. |
| **Member** | One segment (in SEG), one ROI structure (in RTSTRUCT), or one measurement (in SR). |
| **Annotation type** | One of the three peers: **Segmentation** · **Structure** · **Measurement** (singular). |

### Notifications / surface taxonomy

Every error-handler and every user-facing event picks one of four surfaces:

| Surface | Use for |
|---|---|
| **Silent** (`console.warn` only) | Operation has a working fallback; routine background work |
| **Toast** (viewport-area scoped, top-right, 3–5s) | User-initiated action partially failed or briefly succeeded |
| **Dialog** (modal, blocking) | User-initiated action wholly failed and needs decision |
| **Banner** (below toolbar, persistent until dismissed) | Non-routine high-stakes events: backup recovery, app update, connection loss |

**No banners for routine events** — autosave success in particular is silent (surfaced only via the per-container autosave row inside the Annotations side panel). See spec §11 for the full toast spec and §13.2 for the catch-block taxonomy.

## DICOM Compliance

All data handling must follow DICOM standards wherever applicable. This includes tag naming, Value Representation (VR) types, SOP Class UIDs, Transfer Syntax UIDs, sequence nesting, and UID formatting.

### Required Practices

- **Tag integrity**: When reading, writing, or modifying DICOM data, validate that required tags are present and have the correct VR. Do not silently drop or ignore missing required tags. For example, a DICOM SEG must have valid Rows (0028,0010) and Columns (0028,0011) as US (unsigned short) values.
- **Sequence nesting**: Ensure proper nesting of DICOM sequences. PerFrameFunctionalGroupsSequence, SegmentSequence, DerivationImageSequence, etc. must follow the IOD structure defined by the relevant SOP class.
- **UID format**: All UIDs (StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID, etc.) must be well-formed DICOM UIDs: dot-separated numeric components, max 64 characters, no leading zeros in components (except the component "0" itself). Use `dcmjs.data.DicomMetaDictionary.uid()` for generation.
- **SOP Class UIDs**: Use the correct SOP Class UID for each object type. DICOM SEG uses `1.2.840.10008.5.1.4.1.1.66.4` (Segmentation Storage). Do not invent custom SOP classes.
- **Transfer Syntax**: Default to Explicit VR Little Endian (`1.2.840.10008.1.2.1`). When reading DICOM files, respect the declared Transfer Syntax.
- **Pixel Data encoding**: DICOM SEG BINARY type uses 1-bit-per-pixel packing (LSB first). FRACTIONAL uses 8-bit. Ensure BitsAllocated, BitsStored, HighBit, and PixelRepresentation are consistent with the segmentation type.
- **Metadata capitalization**: Cornerstone3D metadata providers return lowercase camelCase keys (e.g., `rows`, `columns`, `sopInstanceUID`). DICOM naturalized datasets use UpperCamelCase (e.g., `Rows`, `Columns`, `SOPInstanceUID`). Use `toUpperCamelTag()`/`toLowerCamelTag()` from `@cornerstonejs/core` for conversion. Never assume one casing convention throughout the stack.

### Validation Philosophy

- When there is a choice between a custom approach and the DICOM-standard way, always prefer the standard.
- Flag non-conformant data rather than silently passing it through. Log warnings for missing optional tags; throw errors for missing required tags.
- After generating DICOM objects (SEG, SR, etc.), validate the output dataset before serialization: check that Rows, Columns, NumberOfFrames, PixelData size, and segment metadata are all internally consistent.
- When loading external DICOM files, detect and report malformed data (e.g., Rows=0, empty PixelData) with clear error messages rather than crashing deep in the adapter stack.

## UI Architecture

The viewer UI is composed of four surfaces plus a shared modal/toast overlay layer:

```
┌─────────────────────────────────────────────────────────┐
│ Toolbar                                                  │
├──────────┬──────────────────────────┬───────────────────┤
│ Sidebar  │   Viewport area          │  Annotations      │
│ (XNAT    │   (grid of viewports)    │  side panel       │
│ browser) │                          │  (resizable)      │
└──────────┴──────────────────────────┴───────────────────┘
Overlay layer (on top): dialogs · toast stack · DICOM Tags modal
                       · cheatsheet (`?`) · ErrorBoundary recovery screen
```

**Annotation lifecycle** (create / name / edit / save / delete) lives **entirely in the Annotations side panel**, not the toolbar. The toolbar holds viewer controls (layout, navigation tools, transform, undo/redo, cine, panel toggles, settings).

**Three peer annotation types**: every container is one of `Segmentation` (DICOM SEG) · `Structure` (DICOM RTSTRUCT) · `Measurement` (DICOM SR). The Annotations side panel header has three corresponding create buttons, and a context-sensitive toolbox at the bottom adapts its tool grid to the active container's type.

**Multi-viewport coupling**: containers are session-scoped (not viewport-scoped). Frame-of-Reference matching determines which viewports a container renders on. The container list shows every container; rows not on the active viewport are dimmed with a cross-panel pill (e.g., `↗ 2 panels`). An optional "Active only" filter narrows to the active viewport.

**Full design spec**: see [`docs/multiviewport-annotation-ui-spec.md`](docs/multiviewport-annotation-ui-spec.md) — 15 sections covering the toolbar, annotation side panel, multi-viewport coupling, hotkeys, sidebar, settings, overlays, DICOM Tags modal, toast system, persistence/backup, and error states. Interactive prototype at [`docs/mockup-viewer.html`](docs/mockup-viewer.html).

## Hotkey System

- Implementation: `src/renderer/lib/hotkeys/` + `src/shared/types/hotkeys.ts` + `src/renderer/hooks/useHotkeys.ts`
- Defaults: `defaultHotkeyMap.ts` (≈50 actions across Tools / Editing tools / Viewport / Layout / Slice / Brush / Panels / W-L presets / Edit / Save / App categories)
- Customization: Settings → Hotkeys tab. Overrides persist in `preferencesStore`. Remap UI **blocks** conflicting assignments until the previous binding is cleared.
- Cross-platform: `meta` and `ctrl` both accepted; no per-platform binding lists.
- Discoverability: `?` opens a cheatsheet overlay listing all bindings. Tooltips on buttons suffix the binding in parens (`Brush (B)`).
- Input-focus guard: hotkeys do not dispatch when focus is in an `INPUT`/`TEXTAREA`/`SELECT`/contenteditable (except `Tab` for viewport cycling).

## Preferences

- Store: `src/renderer/stores/preferencesStore.ts` (Zustand + persist → `localStorage` key `xnat-viewer:preferences`)
- Apply on startup: `src/renderer/lib/preferences/applyPreferences.ts`
- Sub-objects: `hotkeys`, `overlay` (Display), `annotation`, `interpolation`, `backup`, `deletion`, `updates`
- Settings UI: `src/renderer/components/settings/SettingsModal.tsx` (tabs in order: Hotkeys · Annotation · Display · Interpolation · Backup · Updates · Diagnostics · About)
- Defaults: `makeDefaultPreferences()` in `preferencesStore.ts`. Global "Reset All Preferences" requires a confirmation dialog before applying.

## Local Backup

- Service: `src/renderer/lib/backup/backupService.ts` + main-process handlers in `src/main/ipc/backupHandlers.ts`
- Trigger: event-based after segmentation edits, 10s debounce (configurable 5–120s in Settings → Backup)
- Storage: `<userData>/backups/<sessionId>/` per OS (configurable in v1)
- Format: real DICOM SEG / RTSTRUCT binary; atomic `.tmp → rename` writes
- Retention: 30-day auto-prune; backups for XNAT-uploaded containers auto-delete after successful XNAT save
- Recovery: on session load, batched dialog lists recoverable backups with per-row checkboxes. Recovered containers appear in the Annotations side panel with amber "recovered" styling.
- See spec §12 for full behavior including sync-folder (OneDrive/iCloud/Dropbox) warnings.
