# XNAT Viewer

A desktop DICOM medical image viewer built with Electron that connects to [XNAT](https://www.xnat.org/) imaging repositories. Browse, view, annotate, segment, and export medical imaging studies with a modern interface powered by [Cornerstone3D](https://www.cornerstonejs.org/).

![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

### DICOM Viewing

- **Stack-based navigation** — scroll through slices with arrow keys, Page Up/Down, Home/End
- **Window/Level** — adjustable presets for Soft Tissue, Lung, Bone, Brain, and Abdomen
- **Viewport controls** — pan, zoom, rotate, flip, invert
- **Cine playback** — adjustable frame rate (1–60 FPS)
- **DICOM metadata overlay** — four-corner overlay with patient, study, series, and image info
- **DICOM header inspector** — searchable tag browser grouped by DICOM module with ~400 tag definitions

### Multi-Panel Layouts

- 1×1, 1×2, 2×1, and 2×2 grid configurations
- Independent viewport state per panel (window/level, zoom, rotation)
- Active panel selection with keyboard and mouse

### Multi-Planar Reconstruction (MPR)

- 3D volume creation from 2D image stacks with streaming progress
- Orthographic views: Axial, Sagittal, and Coronal
- Crosshairs tool for synchronized plane navigation
- Orientation labels (A/P, R/L, S/I)

### Annotation & Measurement Tools

| Tool | Description |
|------|-------------|
| Length | Distance measurement |
| Angle | Angle between two lines |
| Bidirectional | Longest diameter + perpendicular |
| Elliptical ROI | Ellipse with area and mean HU |
| Rectangle ROI | Rectangle with area and mean HU |
| Circle ROI | Circle with area and mean HU |
| Probe | Single-point density (HU) |
| Arrow Annotate | Arrow with text label |
| Planar Freehand ROI | Freehand region of interest |

Annotation list panel with search, visibility toggles, and delete.

### Segmentation & Contouring

- **Labelmap tools** — Brush, Eraser, Threshold Brush (HU range)
- **Contour tools** — Planar Freehand, Spline (Cardinal / B-Spline / Catmull-Rom / Linear), Livewire, Circle Scissors, Rectangle Scissors, Paint Fill, Sculptor
- **Segment management** — add/remove segments, color picker, visibility and lock toggles
- **DICOM SEG** — load existing segmentations from XNAT with automatic source image matching
- **DICOM RTSTRUCT** — load contour-based segmentations from XNAT
- **Undo / Redo** — full edit history for segmentation modifications (Ctrl+Z / Ctrl+Y)
- **Auto-save** — automatic save to XNAT temp storage with recovery on next session load
- **Manual save** — save as new XNAT scan or overwrite existing; auto-save temp files cleaned up on save

### XNAT Integration

- Secure browser-based login (local, LDAP, OIDC)
- Browse projects → subjects → sessions → scans
- Load individual scans or entire sessions
- Hanging protocol auto-detection (CT Pre/Post Contrast, MR Brain, etc.)
- Upload DICOM SEG and RTSTRUCT segmentations back to XNAT
- Bookmarks: pin projects, subjects, and sessions; recent session history

### Export

- Save viewport as PNG/JPEG screenshot (includes annotations)
- Copy viewport to clipboard
- Save all slices as image series
- Save raw DICOM files to local filesystem
- Export DICOM SEG and RTSTRUCT files locally
- Export measurement reports as text

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `W` | Window/Level tool |
| `P` | Pan |
| `Z` | Zoom |
| `L` | Length measurement |
| `A` | Angle measurement |
| `B` | Brush (segmentation) |
| `E` | Eraser (segmentation) |
| `R` | Reset viewport |
| `Shift+R` | Rotate 90° |
| `I` | Invert |
| `H` / `V` | Flip horizontal / vertical |
| `1`–`4` | Layout presets |
| `[` / `]` | Decrease / increase brush size |
| `Ctrl+1`–`Ctrl+5` | Window/Level presets |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `O` | Toggle annotation panel |
| `G` | Toggle segmentation panel |
| `Space` | Play/stop cine |

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Desktop runtime | Electron 40 |
| UI framework | React 19 + TypeScript 5.9 |
| Medical imaging | Cornerstone3D v4 (core, tools, adapters, DICOM image loader, polymorphic segmentation) |
| State management | Zustand 5 |
| Styling | Tailwind CSS 3 |
| Build (renderer) | Vite 5 |
| Build (main) | TypeScript compiler (CommonJS) |
| Packaging | electron-builder |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm 9+

### Setup

```bash
git clone https://github.com/danielmarcus/xnat-viewer.git
cd xnat-viewer
npm install
```

### Run

```bash
npm run dev
```

This starts the Vite dev server (port 5173) and launches Electron with hot reload.

### Build

```bash
npm run build
```

Compiles the main process (TypeScript → CommonJS) and bundles the renderer (Vite).

### Package

```bash
npm run package
```

Creates distributable installers in `release/`:
- **macOS** — DMG, ZIP
- **Windows** — NSIS installer, portable EXE
- **Linux** — AppImage, DEB

### Signed macOS Package (Developer ID)

To avoid Gatekeeper "unidentified developer" warnings, build with Apple signing + notarization credentials:

```bash
# Code signing certificate (.p12 exported from Keychain Access)
export CSC_LINK="/absolute/path/to/DeveloperIDApplication.p12"
export CSC_KEY_PASSWORD="your-p12-password"

# Notarization (recommended: App Store Connect API key)
export APPLE_API_KEY="/absolute/path/to/AuthKey_XXXXXX.p8"
export APPLE_API_KEY_ID="XXXXXX"
export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# Alternative notarization auth:
# export APPLE_ID="name@example.com"
# export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
# export APPLE_TEAM_ID="XXXXXXXXXX"

npm run package -- --mac
```

Quick validation after build:

```bash
codesign --verify --deep --strict --verbose=2 "release/mac/XNAT Workstation.app"
spctl -a -vv -t install "release/XNAT Workstation-*.dmg"
```

If `codesign` fails with `unable to build chain to self-signed root`, restore standard keychain search paths and remove custom trust overrides on `Developer ID Certification Authority`:

```bash
security list-keychains -d user -s \
  ~/Library/Keychains/login.keychain-db \
  /Library/Keychains/System.keychain \
  /System/Library/Keychains/SystemRootCertificates.keychain

security find-certificate -c "Developer ID Certification Authority" -p \
  /Library/Keychains/System.keychain > /tmp/dev-id-ca.pem
security remove-trusted-cert -d /tmp/dev-id-ca.pem
```

## Architecture

```
src/
├── main/               # Electron main process (Node.js)
│   ├── index.ts        # Window creation, menus, app lifecycle
│   ├── ipc/            # IPC handlers (auth, proxy, export, upload)
│   └── xnat/           # XNAT REST API client and session management
├── preload/
│   └── index.ts        # Context bridge (window.electronAPI)
├── renderer/           # React SPA (Vite)
│   ├── App.tsx         # Root: login flow, session loading, SEG/RTSTRUCT auto-load
│   ├── pages/          # ViewerPage layout orchestrator
│   ├── components/     # UI components (viewer, connection, panels)
│   ├── stores/         # Zustand stores (viewer, segmentation, annotation, connection)
│   ├── lib/cornerstone # Cornerstone3D service layer (singletons)
│   └── lib/hotkeys     # Global keyboard shortcut system
└── shared/             # Types and IPC channel constants shared across processes
```

**Key design decisions:**

- **Service layer pattern** — React components never call Cornerstone3D directly; all imaging operations go through singleton service modules
- **Event-driven state sync** — Cornerstone events → service listeners → Zustand stores → React reactivity
- **IPC proxy** — All XNAT API calls are proxied through the main process for auth header injection and CORS bypass
- **Context isolation** — The renderer has no direct access to Node.js APIs; all main-process functionality is exposed through a typed preload bridge

## License

MIT
