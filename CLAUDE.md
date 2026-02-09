# CLAUDE.md

## Project Overview

XNAT Viewer is a desktop DICOM medical image viewer built on Electron. It connects to XNAT imaging repositories to browse, load, annotate, segment, and export medical images. It renders images using Cornerstone3D directly (not OHIF).

## Repository

- **GitHub**: https://github.com/danielmarcus/xnat-viewer (private)
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
- No test framework is currently configured
- PNG assets in the renderer use Vite asset imports (`import url from './assets/file.png'`)
- macOS tray icons must be template images (monochrome, filename ends with `Template`)

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
