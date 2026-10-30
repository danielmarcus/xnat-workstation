# @nrgxnat/workstation-extension-api

The SDK for [XNAT Workstation](https://github.com/danielmarcus/xnat-workstation) extensions:

- the extension API's **types** (`RendererExtensionContext`, `MainExtensionContext`, …);
- the manifest's **validator** (`validateExtensionManifest`, `apiCompatible`,
  `EXTENSION_API_VERSION`);
- **`./react`** and **`./jsx-runtime`** — alias your bundle's `react` to these and your
  components render with the app's own React;
- **`./testing`** — Playwright helpers to run your extension's own E2E against a built app.

How to write, build, test, ship and license an extension:
[docs/extension-authoring.md](https://github.com/danielmarcus/xnat-workstation/blob/main/docs/extension-authoring.md).

The SDK's version starts with the API's: 0.6.x describes extension API 0.6.

## Developing it

The SDK has no API source of its own — it re-exports the app's (`src/shared/extensions/`), so
it cannot drift from what the app implements. In the core repository:

```bash
npm run build:sdk              # → packages/extension-api/dist/
npm run test:extension-guide   # build the guide's example against the packed SDK, and test it
```

## Publishing

Releases are published to npm from GitHub Actions by trusted publishing
(`.github/workflows/publish-sdk.yml`): set the version in `package.json`, commit, and push a tag
`sdk-v<version>`.

npm sets up trusted publishing on a package that already exists, so the **first** version is
published by hand, once, by an owner of the `@nrgxnat` npm organisation:

```bash
npm run build:sdk
cd packages/extension-api && npm publish --access public   # npm asks for the two-factor code
```

then, on npmjs.com, the package's Settings › Trusted publishing: GitHub Actions, repository
`danielmarcus/xnat-workstation`, workflow `publish-sdk.yml`; and "Require two-factor
authentication and disallow tokens".
