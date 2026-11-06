# XNAT Workstation

A desktop application for reviewing and annotating medical images stored in
[XNAT](https://www.xnat.org/). Sign in to your XNAT server, open a session's scans, segment,
contour and measure them, and save the results back to XNAT as standard DICOM — SEG, RTSTRUCT
and SR — next to the images they describe. Rendering is by [Cornerstone3D](https://www.cornerstonejs.org/).

![Electron](https://img.shields.io/badge/Electron-40-47848F?logo=electron)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
![License](https://img.shields.io/badge/License-MIT-green)

## Using it

**Start with the [User Guide](docs/user-guide/README.md).** It is written for image reviewers
and annotators, and assumes no prior XNAT experience.

What it does, in brief:

- **View** — stacks and multi-frame images; window/level presets; pan, zoom, rotate, flip,
  invert; cine; several viewports side by side; multi-planar reconstruction with linked
  crosshairs, and a 3D view; DICOM header inspector; hiding patient details on screen.
- **Annotate**, with three peer annotation types, all created and managed in one Annotations
  side panel:
  - **Segmentation** (DICOM SEG) — seven tool families: brushes, shapes, intensity-limited
    tools, region growing, level tracing, random-walker seeding, contour fill; operations with a
    preview before anything is written — cleanup, interpolate, propagate, seeded growth, 3D QC;
  - **Structure** (DICOM RTSTRUCT) — freehand, spline and live-wire contours, scissors,
    sculptor, interpolation between slices;
  - **Measurement** (DICOM SR) — length, angle, bidirectional, ellipse/rectangle/circle ROIs,
    probe, arrow annotations.
- **Save to XNAT** with conflict detection, local autosave and crash recovery, checkpoints and
  approval.
- **Find data** in an XNAT browser with filters, thumbnails, pinned items and recent sessions,
  and hanging protocols; or open local DICOM files.
- **Extend** with sandboxed algorithm **modules** and, in editions that include them,
  **extensions**.

Downloads for macOS, Windows and Linux are on the [Releases](../../releases) page.

## Documentation

| For | Read |
|---|---|
| Annotators and reviewers | [User Guide](docs/user-guide/README.md) · [Annotation tool reference](docs/annotation-tool-reference.md) |
| Module authors | [Writing a module](docs/module-authoring.md) · [Module security](docs/module-security.md) |
| Extension authors | [Writing an extension](docs/extension-authoring.md) · [Extension framework](docs/extension-framework.md) · SDK: [`@nrgxnat/workstation-extension-api`](packages/extension-api/README.md) |
| Building an edition | [Editions](docs/editions.md) |
| Contributors | [CLAUDE.md](CLAUDE.md) — architecture, conventions, testing; [Authentication](docs/authentication.md); [E2E specs](e2e/specs/README.md) |
| Releasing | [Releasing](docs/releasing.md) — CI, signing, notarisation, the release checks |

## Building from source

Requires [Node.js](https://nodejs.org/) 20 or later.

```bash
git clone https://github.com/danielmarcus/xnat-workstation.git
cd xnat-workstation
npm install
npm run dev        # Vite dev server + Electron, with hot reload
```

| Command | Does |
|---|---|
| `npm run build` | Production build (main, renderer, modules, extensions, edition) |
| `npm run typecheck` | Type-check every configuration — `build` does not type-check the renderer |
| `npm test` | Unit and service-integration tests (Vitest) |
| `npm run test:e2e:offline` | Electron end-to-end tests that need no XNAT server (run `npm run build` first) |
| `npm run package` | Installers into `release/` (DMG/ZIP, NSIS/portable EXE, AppImage/DEB) |

Changes to `main` go through pull requests; see [CLAUDE.md](CLAUDE.md) for the workflow and
the full list of test commands.

## Technology

Electron 40 · React 19 · TypeScript 5.9 · Cornerstone3D v5 · Zustand 5 · Tailwind CSS 3 ·
Vite 5 · electron-builder. Architecture: [CLAUDE.md](CLAUDE.md).

## License

MIT — see [LICENSE](LICENSE). Third-party licences: [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
