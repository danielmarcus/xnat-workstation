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
      viewer/               # CornerstoneViewport, Toolbar, SegmentationPanel, etc.
      icons.tsx             # Icon components (XnatLogo uses PNG asset import)
    lib/cornerstone/        # Cornerstone3D service layer (singleton modules)
      init.ts               # Cornerstone3D initialization, tool registration
      viewportService.ts    # Viewport creation and management
      toolService.ts        # Tool activation, brush modes
      segmentationService.ts  # Segmentation CRUD, DICOM SEG import/export
      annotationService.ts  # Annotation event sync to Zustand store
      dicomwebLoader.ts     # DICOMweb image loading via XNAT proxy
      mprService.ts         # Multi-planar reconstruction
      metadataService.ts    # Metadata provider helpers
    stores/                 # Zustand stores
      viewerStore.ts        # Panel layout, active images, XNAT session state
      segmentationStore.ts  # Segmentation summaries (synced from Cornerstone events)
      annotationStore.ts    # Annotation summaries
      connectionStore.ts    # XNAT connection state
      metadataStore.ts      # DICOM metadata cache
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
- Tests use **Vitest** for unit + service-integration (`npm test`, configs in `vitest.config.ts`) and **Playwright** for Electron E2E (`npm run test:e2e`, `playwright.config.ts`). DICOM-compliance suites: `npm run test:dicom:compliance`. Cornerstone service tests live in `src/renderer/lib/cornerstone/__tests__/`.
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

**No banners for routine events** — autosave success in particular is silent (surfaced in-place via the per-container autosave row inside the Annotations side panel, never as a toast or banner). The full toast spec and the catch-block surface taxonomy live in the design + requirements docs under `docs/` (see UI Architecture below).

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

## UI Architecture (annotation rebuild — target design)

> **Status:** This branch (`annotation-cleanup`) rebuilds the multi-viewport annotation feature from scratch against the specs in `docs/`. The architecture below is the **target** those specs describe — it is the design contract, **not** a description of the code as it currently stands on this branch (which starts from the pre-rewrite app). Don't assume a component or store named here already exists; verify before relying on it.

The viewer UI is composed of four surfaces plus a shared modal/toast overlay layer:

```
┌─────────────────────────────────────────────────────────┐
│ Toolbar                                                  │
├──────────┬──────────────────────────┬───────────────────┤
│ Sidebar  │   Viewport area          │  Annotations      │
│ (XNAT    │   (grid of viewports)    │  side panel       │
│ browser) │                          │  (resizable)      │
└──────────┴──────────────────────────┴───────────────────┘
Overlay layer (on top): dialogs · toast stack · modals · recovery screens
```

**Annotation lifecycle** (create / name / edit / save / delete) lives **entirely in the Annotations side panel**, not the toolbar. The toolbar holds viewer controls (layout, navigation tools, transform, undo/redo, cine, panel toggles, settings).

**Three peer annotation types**: every container is one of `Segmentation` (DICOM SEG) · `Structure` (DICOM RTSTRUCT) · `Measurement` (DICOM SR). The Annotations side panel header has three corresponding create buttons, and a context-sensitive toolbox at the bottom adapts its tool grid to the active container's type.

**Multi-viewport coupling**: containers are session-scoped (not viewport-scoped). Frame-of-Reference matching determines which viewports a container renders on. The container list shows every container; rows not on the active viewport are dimmed with a cross-panel pill (e.g., `↗ 2 panels`). An optional "Active only" filter narrows to the active viewport.

**Design specs on this branch**:
- [`docs/multiviewport-annotation-design.md`](docs/multiviewport-annotation-design.md) — architecture + signals + test discipline (§8.0)
- [`docs/multiviewport-annotation-requirements.md`](docs/multiviewport-annotation-requirements.md) — requirements + 24 acceptance scenarios
- [`docs/multiviewport-annotation-architecture.md`](docs/multiviewport-annotation-architecture.md) — layering contract, enforced boundaries, current→target migration (authoritative for structure)
- [`docs/multiviewport-annotation-current.md`](docs/multiviewport-annotation-current.md) — current-state snapshot
- [`docs/annotation-xnat-integration-requirements.md`](docs/annotation-xnat-integration-requirements.md) — save-to-XNAT integration

## Spec-driven UI work — discipline

The annotation feature has detailed design and requirements specs in `docs/` (see UI Architecture above). When working from those specs — or any other spec that describes how the UI should look — these rules are non-negotiable. They exist because a prior implementation attempt repeatedly reported "done" on the strength of passing unit tests while the running app stayed broken.

### 1. The acceptance contract is visual, not structural

Read each acceptance criterion literally. If it says "X appears" / "X renders" / "the row shows Y" — that's a contract about pixels on screen, not about whether a component, helper, or store field exists. A passing component test, a wired store, and a mounted component do not by themselves satisfy a visual criterion.

### 2. Verify visually before claiming a UI task is done

For any task whose acceptance includes a render or behavior assertion, you must do **one** of the following before calling it done:

- **Launch the dev app yourself** (`npm run dev`), drive the actual affordance, and confirm the rendered surface and behavior match the spec. Tests don't count.
- **Ask the user to verify** and wait for confirmation. Don't pre-emptively declare success.

If you can't exercise the surface (e.g., it needs data you don't have), say so explicitly — don't paper over it with "tests pass." A test that bypasses the layer where a bug would live proves nothing.

### 3. "Follow-up wiring" is not a done signal

If wiring is required for the acceptance criteria to be true, **do the wiring**. Don't defer it with a "follow-up" note unless the follow-up is genuinely out of scope (a separate epic, a backend change, a new IPC). Foundational helpers + an unmounted component + "wiring follows" is *not* done — it's in progress. If the claim is "the rendering will light up once X happens later," it isn't done until X happens.

### 4. New UI replaces old UI — don't layer

When a spec shows a minimal layout and the existing code shows a busier one (extra chips, legacy buttons, transport indicators), the spec is the contract. **Delete the old chrome** in the same change that wires the new layout. Don't leave the old elements rendering alongside the new — that's not "additive," it's a regression against the spec. If legacy chrome carries information the spec doesn't account for (e.g., approval state), surface it through the spec's affordances (kebab item, tooltip, status pill), don't keep both layouts.

### 5. Component existence ≠ feature shipped

A component built in isolation with passing tests is a *foundation*. It becomes a *feature* only when: it's imported and mounted at the rendering site the spec describes; the data it needs is actually flowing into its props at runtime; and the mount point's surrounding chrome doesn't conflict or duplicate. When you finish a component, ask: "If I `git grep` for its name, do I see it imported somewhere that actually renders?" If not, it's not done.

### 6. Read the spec's mockup, not just the bullet points

Spec sections frequently have both a text description (bullets) and an ASCII mockup. The mockup is the source of truth for layout, ordering, and what's *not* shown. If the mockup omits an existing affordance, that's a deliberate signal — the affordance should move (to a kebab item, tooltip, etc.) or disappear, not stay.

### 7. Honest status reporting

Status must reflect what landed visually, not just what was committed. If you said something was done and then realize the visual sweep didn't happen, **say so and reopen it** rather than letting the record drift. Don't bury "this still isn't actually rendering" under an otherwise-confident summary.

### 8. A test is only trustworthy once it has been seen failing

The prior rebuild attempt reported "done" on green tests while the app stayed broken — because the tests were green on broken code. A test that passes the moment you write it proves nothing. **Red-before-green is mandatory**: observe each acceptance test fail against the unbuilt/broken state before it counts as passing, and capture that red run. For UI work the acceptance test is *visual* (screenshot / pixel-diff against the agreed mockup), drives the *real* affordance (no store/service setter shortcuts), and uses *no* Cornerstone/service mocks. The full per-phase test discipline — author-the-signals-as-red-tests, walking skeleton, no committed `.skip`/`.only`, anti-regression, and the per-phase gate — lives in the design doc's §8.0 "Test discipline (binding)" and governs all annotation-rebuild work.

### Self-check before claiming a UI task done

Answer all five:

1. Did I launch the app and see the change with my own eyes (or get user confirmation)?
2. Does the rendered surface match the spec/mockup — including what's *removed* compared to before?
3. Did I delete any legacy chrome the spec replaces?
4. Are any "follow-ups" genuinely out of scope, or are they "I didn't finish"?
5. Did I watch this test fail *before* it passed (red-before-green), and does it drive the real affordance rather than a setter shortcut?

If any answer is no/ambiguous, it's not done.

### Verify against the data path, not just the component

Bugs in this codebase have repeatedly lived in the seam *between* a component and the store/service that feeds it — not in either alone. Before wiring a side-effect to a store, trace where the rendering actually reads its data from and target *that* source. A component reading store A while your effect writes store B will pass every unit test and fail in the app.
