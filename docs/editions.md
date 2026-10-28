# Editions

An **edition** is a build of Workstation: the open-source core, plus the modules it bundles and
its own name and identity, packaged and signed as one application. The open-source repository
builds the default edition. Another repository can build its own edition on the same core —
this is how a commercial edition is made — without forking the app or adding anything to it at
runtime.

| | Open-source edition | Another edition |
|---|---|---|
| Configuration | `edition.config.json` in this repository | its own file, named by `XNAT_EDITION` |
| Bundled modules | the examples (`modules/examples/*`) | whatever it lists |
| Signed by | this project's release signing | its own signing identity |
| Licensing, distribution, updates | — | its own business: the core has no licence mechanism |

Users of any edition can still install **Verified** and **Community** modules (Settings ›
Modules); an edition's **Bundled** modules come with the application and are covered by its
signature. See [module-authoring.md](module-authoring.md) for modules themselves and
[module-security.md](module-security.md) for how they are contained.

## The configuration

```json
{
  "id": "open-source",
  "productName": "XNAT Workstation",
  "appName": "XNAT",
  "appId": "com.xnat.workstation",
  "artifactPrefix": "XNAT-Workstation",
  "modules": ["modules/examples/threshold", "modules/examples/postop-edema"],
  "trustedKeys": []
}
```

| Field | |
|---|---|
| `id` | Lower case, `a-z0-9-`. Only `open-source` publishes to this project's GitHub releases |
| `productName` | The application's name: the app bundle / executable, window title, About, installers |
| `appName` | The short name: the macOS menu, and the **user-data folder** — so each edition keeps its own settings and installed modules. **Never change it after shipping**, or users' data is left behind |
| `appId` | The platform bundle id (`com.example.product`) |
| `artifactPrefix` | Installers and archives are named `<prefix>-<version>-<arch>.<ext>` |
| `modules` | Module directories (packed at build time) or `.xwmodule` files (copied), relative to the configuration file |
| `trustedKeys` | Publisher keys (`module:keygen`'s `public.json` contents) every copy trusts: modules they sign install as Verified |
| `publish` | Optional: electron-builder's `publish` configuration for this edition (none by default) |

## Building

```bash
npm run build            # the app, the modules built from source, and the edition
npm run package          # builds the edition again and packages it with electron-builder
```

`npm run build:edition` reads the configuration (`XNAT_EDITION`, or `edition.config.json`),
packs its modules into `build/edition/modules/`, and records the edition in
`build/edition/edition.json`. `electron-builder.config.js` takes the names and app id from that
record and ships `edition.json` and `modules/` inside the application's resources. At run time
the app reads them from there (in development, from `build/edition/`).

## Building another edition

In a repository of its own, with this one as a dependency (a git submodule, or a checkout in CI):

1. An edition configuration, e.g. `my-edition.json`, listing its modules — directories in its
   own repository, or `.xwmodule` files it builds there (a module can be built from TypeScript
   as `scripts/build-modules.mjs` does).
2. Its branding: replace `build/icon.*` in the core's checkout before packaging (or keep the
   core's).
3. In CI, in the core's checkout:

   ```bash
   npm ci
   npm run build
   XNAT_EDITION=../my-edition/my-edition.json npm run package -- --mac --publish never
   ```

   with its own signing identity in the environment (`CSC_LINK` / `CSC_KEY_PASSWORD`, Apple
   notarisation credentials, Windows signing) — exactly as the open-source release workflow
   (`.github/workflows/release.yml`) supplies this project's.

The result is a separately named, separately signed application. Its bundled modules are inside
its signed bundle; installing further modules later never touches that bundle (they live in the
user-data folder), so the signature and notarisation stay valid.

## Checking an edition

`npm run test:edition` packages the app (unsigned, unpacked) with a test edition
(`e2e/fixtures/edition/test-edition.json`), checks the package carries the edition's record and
its bundled module, launches the packaged app and checks its name, its window title and that the
module is listed as Bundled — then restores the default edition. Point it at your own
configuration's shape when building another edition.

Bundled modules can be **disabled** (Settings › Modules) but not removed, and a package with a
bundled module's id cannot be installed over it.
