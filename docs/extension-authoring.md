# Writing an extension

An **extension** adds a workflow to XNAT Workstation: a tab in the sidebar, an item in the
toolbar, a full-window view, a Settings page, commands and keys — working with XNAT as the
signed-in user, the session on screen and its annotations. It is built in a repository of its
own, against the SDK [`@nrgxnat/workstation-extension-api`](../packages/extension-api), and
shipped **inside an edition** of the app ([editions.md](editions.md)): an extension is trusted
code covered by the edition's signature, not something a user installs.

Extensions are not **modules**. A module is a sandboxed algorithm anyone can share
([module-authoring.md](module-authoring.md)); an extension is workflow code an edition chooses to
ship. Why the framework is shaped this way, and how it was built, is in
[extension-framework.md](extension-framework.md).

This guide's worked example is
[`docs/extension-authoring-example/`](extension-authoring-example/) — "Hello, licensed": a
sidebar tab and a command behind a signed licence. `npm run test:extension-guide` builds it as
an extension's own repository would (outside this one, against the packed SDK) and runs its
tests, so what is quoted here is what works.

- [The parts of an extension](#the-parts-of-an-extension)
- [The manifest](#the-manifest)
- [Building](#building)
- [The API](#the-api)
- [Rules the app's UI follows — and yours](#rules-the-apps-ui-follows--and-yours)
- [Testing](#testing)
- [Shipping in an edition](#shipping-in-an-edition)
- [Licensing](#licensing)
- [Versions](#versions)

## The parts of an extension

An extension is a folder:

```
hello-licensed/
  extension.json   the manifest
  renderer.js      the renderer part — an ES module: what it shows
  main.cjs         the main part (optional) — CommonJS: privileged work, the licence
  …                anything else it needs (a public key, styles, data)
```

- **The renderer part** runs in the app's window. It draws with React — the app's own React —
  and reaches the app through the `ext` object its `activate(ext)` receives.
- **The main part** runs in the app's main process, with Node. It is where anything privileged
  belongs: a licence check, a token, a call to the publisher's server. It too gets an `ext`.
- **The two talk over a channel** the host provides (`ext.channel`).

Each part exports `activate(ext)` and, optionally, `deactivate()`. `activate` may be async; if it
throws, rejects or takes more than 10 seconds the extension is **Inactive** with the error as its
reason (Settings › Extensions shows it). When the user disables an extension, its renderer part
stops first, then its main part; everything it registered — tabs, items, views, commands, keys,
listeners — is removed by the host, so `deactivate` only has to clean up the extension's own state.

The main part starts first. If it returns a **gate** (see [Licensing](#licensing)) saying the
extension is inactive, the renderer part still starts — its Settings page is where a licence is
entered — but nothing else of it shows.

> Name the main part `main.cjs`. A `main.js` is read as an ES module wherever a
> `package.json` above it says `"type": "module"` — your own repository's, for instance — and
> `require` then fails.

## The manifest

```json
{
  "id": "org.example.hello-licensed",
  "name": "Hello, licensed",
  "version": "1.0.0",
  "apiVersion": "0.6",
  "publisher": "Example Labs",
  "description": "The extension authoring guide's example: a sidebar tab and a command, behind a signed licence.",
  "renderer": "renderer.js",
  "main": "main.cjs",
  "features": [{ "id": "hello", "name": "Hello tab" }]
}
```

| Field | |
|---|---|
| `id` | Reverse-DNS, lower case. Unique in an edition |
| `name`, `publisher`, `description` | Shown in Settings › Extensions |
| `version` | Semantic version of the extension |
| `apiVersion` | The extension API major.minor it was built against — see [Versions](#versions) |
| `renderer` | The renderer part: a `.js` / `.mjs` path inside the folder |
| `main` | Optional: the main part, a `.cjs` (or `.js`) path inside the folder |
| `features` | Optional: features the gate can enable one by one (tiers), `{ id, name }` |
| `hosts` | Optional: the publisher's servers the extension contacts (`licence.example.com`), listed in Settings for a site's IT |

Any other field is refused (a typo would otherwise be silently ignored). So is a manifest whose
`apiVersion` this app does not provide, an entry that points outside the folder, or a file it
names that is missing — Settings › Extensions lists the extension as **Refused**, with the reason.

## Building

The renderer part is an ES module that imports `react` like any React code. Your bundler
**aliases `react` and `react/jsx-runtime` to the SDK's**, so your components render with the
app's own React — one copy: shared hooks, context, and the app's error boundaries. With esbuild
([build.mjs](extension-authoring-example/build.mjs)):

```js
await build({
  entryPoints: ['src/renderer.tsx'],
  outfile: `${out}/renderer.js`,
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic',
  alias: {
    react: '@nrgxnat/workstation-extension-api/react',
    'react/jsx-runtime': '@nrgxnat/workstation-extension-api/jsx-runtime',
  },
});
```

Import the API's types from the package itself:

```ts
import type { RendererExtensionContext } from '@nrgxnat/workstation-extension-api';
```

The SDK also exports `validateExtensionManifest`, `apiCompatible` and `EXTENSION_API_VERSION`,
so your build can refuse a manifest the app would refuse.

Style with the app's Tailwind classes (the dark `zinc` palette); `ext.ui.components` has a
`Button` and a `Dialog` drawn the app's way.

## The API

`activate(ext)` receives everything; there is nothing else to import at run time. The types,
with their full documentation, are in the SDK (`RendererExtensionContext`,
`MainExtensionContext`).

### Both parts

| | |
|---|---|
| `ext.id`, `ext.version`, `ext.apiVersion` | Who you are; the API the app provides |
| `ext.log(...)` | Console output prefixed with your id |
| `ext.xnat.user()` | The signed-in user, the server, its site id — or null |
| `ext.xnat.request(path, { method, query, body, contentType })` | XNAT as that user. Paths are server-relative, under `/data/` or `/xapi/`. HTTP errors are responses (`ok`, `status`), not exceptions; not being signed in is |
| `ext.xnat.getJson(path, query)` | GET with `format=json`; rejects on an HTTP error |
| `ext.xnat.permissions(projectId)` | `{ read, write }` for the signed-in user |
| `ext.xnat.resourceFiles(resourcePath)` | The files of a resource |
| `ext.storage` | `get / set / delete / keys` — JSON, on this computer, per user, yours alone (5 MB) |
| `ext.testing` | True under a test harness: swap your services for fakes |

Requests go through the app's own session: you never see the user's credentials or cookies, and
XNAT's project roles decide what succeeds.

### The renderer part

| | |
|---|---|
| `ext.ui.sidebarTab({ title, component, feature })` | A tab beside Browse (one per extension) |
| `ext.ui.toolbarItem({ label, icon, title, visible, command \| popover, feature })` | An item left of Annotate · Tags · Settings; returns `{ update(), dispose() }` |
| `ext.ui.view({ id, title, component, feature })`, `openView(id)`, `closeView()` | A full-window view over the viewer, with Back / Esc |
| `ext.ui.settingsPage({ component })` | Your page under Settings › Extensions — always shown while you run |
| `ext.ui.components` | `Button`, `Dialog` |
| `ext.commands.register({ id, title, run, keys, feature })`, `execute(id)` | In the ⌘K finder and Settings › Hotkeys. A key the app already uses is not taken: your command is left unbound, and Settings shows the clash. N and ⇧N are kept free for extensions |
| `ext.viewer.session()`, `activeViewport()` | The XNAT session on screen; the active viewport |
| `ext.viewer.openSession(ref, { scanId })` | Opens it exactly as the browser does — hanging protocol, annotation auto-load, the unsaved-changes prompt — and resolves `opened`, `cancelled` or `failed` |
| `ext.viewer.revealInBrowser(target)` | Shows a project, subject or session in the browser |
| `ext.annotations.list()`, `active()` | The annotations as the panel lists them: kind, label, members, unsaved edits, approval, XNAT scan id, version token |
| `ext.annotations.select(id, memberId)`, `create(template)`, `save(id)`, `openScan(ref, scanId)` | Through the panel's own actions, under its rules: an approved annotation is refused, a save is the normal save with its conflict detection (`saved`, `conflict`, `failed`) |
| `ext.events.on(name, listener)` | `signedIn`, `signedOut`, `sessionChanged`, `activeViewportChanged`, `activeAnnotationChanged`, `annotationsChanged`, `gateChanged` |
| `ext.channel.request(message)`, `onMessage(listener)` | Your main part |
| `ext.files.open({ title, filters })`, `save({ suggestedName, data, filters })` | The system's file dialogs |
| `ext.gate.current()`, `reevaluate()` | Your gate, read-only — see [Licensing](#licensing) |

### The main part

| | |
|---|---|
| `ext.channel.handle(handler)`, `post(message)` | Answer your renderer part; send it messages |
| `ext.secureStorage` | `get / set / delete / keys` — text encrypted with the system keychain. For licences and tokens |
| `ext.installId` | A random id for this install of your extension |
| `ext.gate.reevaluate()` | Ask the host to run your `evaluate()` again |
| `evaluate(ext)` (exported) | How the host asks for your gate again — see [Licensing](#licensing) |

## Rules the app's UI follows — and yours

Your components render inside the app, so they follow its rules:

- **The keyboard stays with the images.** Shortcuts are viewport-only; clicking a button must not
  leave focus on it. Text fields keep the keyboard while typed in; a modal dialog — use
  `ext.ui.components.Dialog`, or give yours `role="dialog" aria-modal="true"` — is a keyboard
  surface of its own.
- **Blue means active or selected**, nothing else. Use the zinc palette and the type colours.
- **No toasts or banners.** Show state in place: in your tab, your toolbar item, your Settings
  page. The app keeps banners for high-stakes events.
- **Add, never replace.** No slot lets an extension hide or move the app's own controls.
- **Fail in place.** A component that throws shows an error card in its own slot — with Reload
  extension and Copy details — and the rest of the app carries on.

## Testing

The SDK's testing helpers (`@nrgxnat/workstation-extension-api/testing`) launch a built XNAT
Workstation with your extension and let a Playwright test reach your own `ext`
([e2e/hello.e2e.ts](extension-authoring-example/e2e/hello.e2e.ts)):

```ts
const run = await launchWorkstation({ mainEntry: path.join(core, 'dist/main/main/index.js'), extensionsDir: 'out' });
const hello = extension(run.page, 'org.example.hello-licensed');
await hello.waitUntilRunning();
expect(await hello.evaluate((ext) => ext.gate.current())).toEqual({ active: false, features: [], reason: 'No licence' });
await openViewer(run.page); // into the viewer, where the slots are
```

- `core` is a checkout of this repository, built with `npm run build`.
- `extension(page, id).evaluate((ext, arg) => …)` runs in the app with your extension's renderer
  context: drive the real API, then check the UI with Playwright as a user would.
- Under the harness `ext.testing` is true, and secure storage uses Chromium's stand-in keychain —
  a test never touches the user's real keychain.
- Pass `userDataDir` to two runs to test a restart.
- A **production** edition cannot be driven this way: its inspector is switched off at packaging
  (see below). Test against an unpackaged core, or a test package with the inspect fuse turned
  back on, as this repository's `npm run test:edition` does.

## Shipping in an edition

An extension reaches users inside an edition: the open-source core, plus your extensions and
modules, built, signed and distributed as one application under your name
([editions.md](editions.md)). In the edition configuration:

```json
{
  "extensions": ["../hello-licensed/out/hello-licensed"],
  "devTools": false
}
```

`npm run build:edition` checks each extension (manifest, API version, files), copies it **into the
app archive**, and records a fingerprint of every file in the edition record; an extension the app
would refuse fails the build. Every edition is locked down at packaging: Electron's fuses turn off
running as plain Node, `NODE_OPTIONS` and `--inspect`, load the app only from its archive and
validate that archive at start-up (macOS, Windows); an extension whose files differ from the
record is refused. Changing an edition's code therefore means rebuilding and re-signing it.
`devTools: false` removes developer tools from the packaged app — do this for an edition with
licensed extensions.

Settings › Extensions lists what the edition ships, with an Enabled switch per extension.

## Licensing

The core holds **no licence logic, keys or servers** — this repository is public, and a check
anyone can read and patch out here would protect nothing. It gives your extension what a licence
model needs, and acts on its answer.

### The gate

Your main part decides. `activate(ext)` returns the extension's state, and an exported
`evaluate(ext)` is how the host asks again:

```js
// main.cjs
async function gate(ext) {
  const text = await ext.secureStorage.get('licence');
  if (!text) return { state: 'inactive', reason: 'No licence' };
  try {
    const licence = verify(text);
    if (new Date(licence.expires) < new Date()) return { state: 'inactive', reason: `Licence expired ${licence.expires}` };
    return { state: 'active', tier: licence.tier };
  } catch (err) {
    return { state: 'inactive', reason: `Invalid licence: ${err.message}` };
  }
}

module.exports = { activate(ext) { /* … */ return gate(ext); }, evaluate: gate };
```

| Return | Effect |
|---|---|
| nothing | Active, every declared feature on |
| `{ state: 'active', features, tier }` | Active; only `features` on (all, when omitted); the tier shown in Settings ("Active · Basic") |
| `{ state: 'inactive', reason }` | Inactive: nothing of yours shows but your Settings page; Settings › Extensions shows the reason |
| a throw | Inactive: "Licence check failed: …" |

The host asks again **on sign-in, sign-out and a change of XNAT server**, and whenever either part
calls `ext.gate.reevaluate()` — after a licence is imported, when an expiry passes, after an
online check-in. The result applies live: features appear and disappear without a restart, an
open view whose feature is locked closes, keys are bound and unbound.

### Features and tiers

Declare features in the manifest and tag what each one shows:

```js
ext.ui.sidebarTab({ title: 'Hello', component: HelloTab, feature: 'hello' });
ext.commands.register({ id: 'greet', title: 'Say hello', run, keys: [{ key: 'y' }], feature: 'hello' });
```

A tier is the set of features your gate enables. A locked feature is **absent, not disabled**: no
tab, toolbar item, view, command, key or ⌘K entry — the app never shows a control that cannot
work. Settings › Extensions lists each declared feature as ✓ or 🔒 "not in your licence".
Register everything once, in `activate`; the host does the showing.

### Where the decision lives

- **Verify in the main part.** The renderer part is the easier half to inspect and change; it can
  read its gate (`ext.gate.current()`) but cannot set it.
- **Keep secrets in `ext.secureStorage`** (main part only), encrypted with the system keychain. It
  is refused where the system offers no encryption, rather than writing in the clear.
- **Ship a public key, never a private one.** Sign licences with a key that lives with you —
  `licence.mjs` in the example shows the shape; keep `private-key.pem` out of every repository.
  (The open-source example *Session notes* publishes a throwaway demo key pair, private half
  included, to test its own gate. Never copy that pattern.)

### Licence models

The hooks support each of these; combine them.

| Model | How | Inputs |
|---|---|---|
| **Signed licence file, offline** | The user imports a file (your Settings page, `ext.files.open`); the main part verifies its signature, keeps it in secure storage; `evaluate` re-checks expiry | `ext.files`, `ext.secureStorage`, the time |
| **Site licence on XNAT** | The licence lives in the XNAT site's own configuration, or a small server-side plugin; `evaluate` fetches and verifies it as the signed-in user. Users install nothing; the site's admin installs once | `ext.xnat.user()` (server, site id), `ext.xnat.getJson`, re-evaluation on sign-in |
| **Bound to a server** | A licence names the XNAT server (or site id) it is for; `evaluate` compares | `ext.xnat.user()` |
| **Online activation** | The main part calls your server (declare it in `hosts`) with the install id; keeps the answer in secure storage; checks in now and then, with a grace period offline | `ext.installId`, `ext.secureStorage`, `hosts` |

Sites often restrict networks: prefer a model that works offline or through XNAT, and declare in
`hosts` every server you contact — Settings lists them so a site's IT can review them.

### What a client-side check can and cannot stop

A check running on the user's computer keeps honest users honest; it cannot stop a determined
one with time and tools. The build's lock-down raises the bar from "edit a file" to "rebuild and
re-sign the application": the archive and its fingerprints are checked at start-up, the
inspector and `NODE_OPTIONS` are switched off, and an edition can remove developer tools.
Enforcement that must hold against a determined user belongs on a server the user does not
control — the XNAT site's (a server-side plugin) or yours (online activation). Write the
contract to match.

## Versions

- The **API** has a version, major.minor (`EXTENSION_API_VERSION`; this guide describes 0.6). Before
  1.0, every minor may change the API, so an extension's `apiVersion` must match the app's exactly;
  from 1.0, a minor only adds, so an extension built for 1.2 runs on any 1.x from 1.2.
- The **SDK**'s version starts with the API's (0.6.x describes API 0.6).
- An app that does not provide your `apiVersion` refuses your extension, saying which it needs and
  which it has.
