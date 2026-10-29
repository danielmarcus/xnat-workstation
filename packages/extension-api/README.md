# @nrgxnat/workstation-extension-api

The SDK for building [XNAT Workstation](https://github.com/danielmarcus/xnat-workstation)
extensions: the API's types, the manifest's validator, and the API version.

**Status: skeleton (extension framework X1).** Not yet published: `"private": true` stays
until slice X7 builds it into `dist/` and publishes it to npm by trusted publishing. Until then,
extensions build against it from a checkout of the core. See
[docs/extension-framework.md](../../docs/extension-framework.md).

An extension is a folder with:

- `extension.json` — `id` (reverse-DNS), `name`, `version` (semver), `apiVersion` (the API
  major.minor it was built against), `publisher`, optional `description`, `renderer` (an ES
  module) and optional `main` (a CommonJS module).
- The renderer part, exporting `activate(ext)` and optionally `deactivate()`.
- The main part, if any, exporting the same through `module.exports`.

An edition lists extension folders in its configuration (`extensions`); the edition build checks
each one and copies it into the app archive.
