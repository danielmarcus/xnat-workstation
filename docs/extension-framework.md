# Extension framework (plan, for review)

Status: **draft for review, 2026-10-29** (branch `extension-framework`). Nothing is built until
this plan is reviewed. **Decided 2026-10-29:** all six questions (below). Question 1 — extensions are bundled into an
edition (option a), designed so runtime installation (b) can be added later without redesign;
and the framework must give an edition what it needs to build a strong licensing model
(R13–R14, design points 10–11).

## Why

Workstation can already run **algorithm modules** (SegWorks parity branch 9,
[module-authoring.md](module-authoring.md)): a module is a pure function in a sandbox — the app
hands it image data, it hands back masks — with no UI of its own, no XNAT, and no access to the
app. That is right for algorithms and wrong for anything that is part of the *workflow*.

Some features belong in the workflow but not in the open-source core: a reading worklist that
assigns cases to annotators, captures what each one did and records reviews; a site's own
assessment forms; an integration with a lab's tracking system. They are maintained by other
teams, sometimes commercially, in their own repositories, and they need what modules are
denied: a place in the UI, the signed-in user's XNAT access, the session on screen, the
annotations, the keyboard.

An **extension** is that: code from outside this repository, shipped with an edition, that
adds UI and behaviour through a stable, versioned **extension API**. The space was reserved
during the SegWorks parity work (decisions D10 and D12): a second sidebar tab beside Browse, a
toolbar slot, a full-window view, and the N / ⇧N keys.

**Modules and extensions stay separate.** Modules remain sandboxed algorithms anyone can share
and install; extensions are trusted workflow code that an edition chooses to ship. An extension
may *use* modules (run an operation), not replace them.

## Requirements

The first extension in view is a reading worklist (built outside this repository). What it
needs, generalised, is the requirement list; every item is something any workflow extension
would plausibly need.

| # | Requirement | Notes |
|---|---|---|
| R1 | **Ship with an edition**, covered by its signature; enabled per edition, can be turned off in Settings | see design point 1 |
| R2 | **UI slots**: a sidebar tab (beside Browse), a toolbar slot (a compact bar, shown when the extension wants), a full-window view (over the viewer, with a way back), a Settings page, popovers and dialogs that follow the app's modal rules | the D10 space |
| R3 | **Commands and keys**: register commands; bind keys through the hotkey map (collision checks, remappable in Settings › Hotkeys, viewport-only as every shortcut is); appear in the ⌘K finder | N / ⇧N reserved (D12) |
| R4 | **XNAT as the signed-in user**: authenticated REST (GET / PUT / DELETE / list resource files) through the app's session — the extension never sees credentials or cookies; the username and profile; a permission query (can read / write the project, a session, a resource) | |
| R5 | **Navigation**: open a session or a scan exactly as the XNAT browser does (hanging protocols, annotation auto-load, the unsaved-changes prompt) and learn whether it opened or the user cancelled; reveal a subject / session in the browser | |
| R6 | **App state and events**: the session and scans on screen, the active viewport, the active annotation container and member, its dirty / saving state, sign-in and sign-out | read-only, as events + getters |
| R7 | **Annotations**: save the active container through the normal transport (conflict detection included); read a container's XNAT scan id, kind, label, members, version token; open a specific annotation scan; create a container from a template (kind, member names, colours); select the active member | through the panel's own actions, so every rule (locks, approval, naming) holds |
| R8 | **Storage**: per-user local data and settings for the extension; reading a file the user picks and saving one (dialogs) | |
| R9 | **Status in place**: an extension shows its state in its own UI; it gets no toasts or banners (the app's notification rules apply) | |
| R10 | **Look and feel**: the app's styles and a small set of shared components, so extension UI matches | |
| R11 | **Testing**: run the built app with an extension under Playwright; let the extension swap its own services for fakes in test runs | |
| R12 | **Versioning**: the API is semver; an extension declares the range it supports; an incompatible one is refused at start-up with the reason, never half-loaded | also what keeps option (b) open |
| R13 | **Licensing hooks**: an extension can decide at start-up, and again later, whether it is active and which of its features are; the host mounts only what is active and shows the rest in place with the extension's reason; trusted inputs for that decision (the XNAT server and user, an install id, secure storage) | design point 10; the core holds no licence logic |
| R14 | **Integrity of shipped code**: an edition's bundled extensions, and the app that loads them, cannot be changed or inspected at run time without breaking the build's integrity checks | design point 11 |

## Design points (proposed; flag any to change)

1. **Trust and distribution — decided: (a).** Extensions are **bundled into an edition at
   build time** (like Bundled modules — `docs/editions.md`), and are trusted code: they run in
   the app's own processes, with the access the API gives them. The edition's signature covers
   them, so the app needs no extension signing, store or installer, and an organisation decides
   what its build contains. The reasoning is under
   [Trust and distribution](#trust-and-distribution-why-a). Runtime installation (b) is
   deferred, not rejected; nothing may assume an extension is bundled (see the rules there).
2. **Two halves.** An extension has a **renderer part** (UI and app-state logic) and,
   optionally, a **main part** (privileged work: XNAT REST, files, anything Node). They talk
   over a channel the framework provides. The renderer part never gets Node or the raw
   `electronAPI`; the main part never gets the window.
3. **A narrow API object, not the app's internals.** Each half receives one API object
   (`ext.ui`, `ext.commands`, `ext.xnat`, `ext.viewer`, `ext.annotations`, `ext.storage`,
   `ext.files`). It is implemented on top of the app's services and stores, but extensions never
   import them, so the app can be refactored without breaking extensions — the API is the only
   contract, and it is versioned (R12).
4. **UI is React, sharing the app's React.** The renderer part exports React components for
   the slots it fills; the host renders them in place with the app's React (a peer dependency),
   inside an error boundary per slot (a crashing extension shows its error in its slot; the app
   carries on). Recommended over iframes: same look, same focus and keyboard rules, no second
   copy of React, and trusted code needs no isolation (question 2).
5. **Packaging.** An extension is a directory (or an archive) with `extension.json`
   (id, name, version, API range, publisher, the slots and commands it contributes — each
   optionally tagged with a **feature** name (design point 10) — whether it has a main part)
   and its built bundles (`renderer.js` ES module, optional `main.js`). The edition
   configuration gains `extensions: [...]`; `build:edition` copies them **into the app archive**
   (`app.asar`, not loose resources, so the archive's integrity check covers them — design
   point 11) and records each one's digest in the edition record, which the loader checks before
   loading. The app loads them at start-up through a custom protocol (renderer) and `require`
   (main). The main bundle may be in whatever form the extension's own build produces —
   minified, or compiled to V8 bytecode for the edition's pinned Electron version — so a
   publisher can harden its own code; the core neither provides nor requires that.
6. **The SDK.** This repository publishes `@nrgxnat/workstation-extension-api`: the API's types,
   the manifest schema, a small runtime shim, and test helpers. An extension's repository
   depends on it (and on React as a peer); building an edition then combines the core with
   that repository's bundles. It is published to public npm (question 4).
7. **Lifecycle.** *(Amended in X1.)* Started when the app starts — the main part first, then
   the renderer part once the window is up; `activate(ext)` registers slots and commands;
   `deactivate()` on disable, when the other part fails, and at quit (main) or when the window
   goes away (renderer). An extension is **not** restarted on sign-in or sign-out: it learns of
   them through app events (X3), and the licence gate re-evaluates on them (X6). Settings ›
   Extensions lists what the edition ships (name, version, publisher, state, reason) with an
   Enabled switch.
8. **Permissions follow XNAT.** The API does not add a permission layer of its own: an
   extension acts as the signed-in user, so XNAT's project roles decide what succeeds, and the
   permission query (R4) lets it show View Only where the user cannot write.
9. **An example extension in this repository**, `extensions/examples/session-notes` — a
   sidebar tab listing per-session notes stored in an XNAT resource, with a toolbar indicator and
   a key — exercising every API family. It is the authoring guide's worked example and the E2E
   fixture, and the open-source edition does not ship it. It also carries a **demonstration
   licence gate** (its own throwaway test key, a signed test licence with two tiers) so the
   licensing hooks are exercised end to end and the guide shows the pattern.
10. **Licensing: the edition's, with a place to stand.** The core contains **no licence
    logic, keys, vendor endpoints or licence server** — this repository is public, and a check
    anyone can read and patch out here would protect nothing. Instead the framework gives a
    publisher what a strong model needs, generically:
    - **An activation gate.** `activate(ext)` (main part first, then renderer) returns the
      extension's state: *active*, *inactive* with a reason ("No licence for this XNAT
      server", "Licence expired 2027-01-31"), and the set of **enabled features**. The host
      mounts only active contributions whose feature is enabled; everything else registers
      nothing — no slot, command, key or ⌘K entry — so a locked feature is absent, not hidden.
      Settings › Extensions shows each extension's state and reason in place, and its Settings
      page stays available while inactive (that is where a licence is entered).
    - **Re-evaluation.** The host asks again on sign-in, sign-out and change of XNAT server, and
      the extension can ask the host to re-evaluate itself (a licence imported, an expiry
      reached, a periodic online check). A change mounts or unmounts contributions live.
    - **Decide in the main part.** Licence verification belongs in the main part: the renderer
      is the easier half to inspect, and the gate's result reaches the renderer only from the
      host. The renderer part cannot enable its own features.
    - **Trusted inputs**, supplied by the host rather than read from the UI: the XNAT server
      the user is signed in to (its URL and, where XNAT exposes it, its site id) and the user —
      so a licence can be bound to an institution's XNAT, the natural unit for a site licence;
      XNAT REST as that user (R4), so a licence can be kept in the XNAT site's own
      configuration or a server-side plugin and checked there; a stable **install id**, random,
      per extension, stored by the host (not hardware data, so nothing identifying leaves the
      machine); and the current time.
    - **Secure storage**: a per-extension store encrypted with the operating system's keychain
      (Electron `safeStorage`) for licences, tokens and activation state; one extension cannot
      read another's.
    - **The publisher's own network.** The main part may contact its publisher's servers
      (activation, check-in, revocation). The manifest declares those hosts and Settings ›
      Extensions lists them, so a site's IT can review what an extension contacts.
    - **Licence import**: a file dialog and a Settings page (R2, R8) are enough to import a
      signed licence file offline.
    - **Updates**: an edition's update feed is its own (`publish` in its configuration) and may
      be private; gating updates on a licence is the edition's business.
11. **Integrity of the build.** A licence check is only as strong as the code around it, so
    the framework closes the ways to change or drive a packaged app from outside, for every
    edition:
    - **Electron fuses** set at packaging: running the app as plain Node off
      (`RunAsNode`), `NODE_OPTIONS` and `--inspect` arguments ignored, the app loaded only from
      its archive, and the archive's **integrity validated** at start-up (macOS and Windows).
    - Extensions inside that archive, with digests in the edition record (design point 5), so
      an edited extension fails the check rather than loading.
    - **DevTools** in packaged builds become an edition setting (`devTools`), off for an
      edition that turns it off; the open-source edition keeps them (question 6). In
      development and E2E builds nothing changes.
    - The code signature (already: hardened runtime, notarisation) covers the rest.
    This raises tampering from "edit a file" to "rebuild and re-sign the app", which is the
    realistic bar for client-side code; enforcement that must hold against a determined user
    lives on a server (the XNAT site or the publisher's), which the hooks above make possible.

## Trust and distribution: why (a)

The two options considered: **(a)** extensions bundled into an edition at build time, covered
by its signature; **(b)** extensions installed into an existing app at run time, verified
against a publisher's signature. (An isolated design — a sandboxed process per extension, UI
in iframes — suits untrusted code and was not pursued: it is heavier for every extension and
its UI cannot follow the app's look and keyboard rules.) The extension format and API are the
same under (a) and (b); only where the loader finds extensions differs.

**Technical**

| | (a) Bundled | (b) Installed at run time |
|---|---|---|
| Work in the core | Small: editions exist (branch 9) | Large: install UI, signature checks, revocation, compatibility checks, extension updates, admin policy |
| Compatibility | The publisher tests the exact core + extension pair it ships | A core update can break or disable an extension in the field; the API must stay strictly compatible |
| Security | Trust settled at build time; code fixed inside the signature | Trust settled at install; a stolen publisher key, or a user persuaded to install something, runs unsandboxed code with the user's XNAT access |
| Native code | Allowed, covered by the app's signature | JavaScript only in practice: macOS will not load native code signed by another team |

**Operational**

| | (a) | (b) |
|---|---|---|
| Site IT approval | One signed installer from one publisher | Two approvals; locked-down machines may block installs into the user folder |
| Updates | The edition's own channel; core fixes arrive when the publisher rebuilds | Core and extensions update independently: faster fixes, more surprises |
| Publisher's release work | Rebuild and re-sign per core release; needs its own signing accounts | Publish packages only |
| Support | One owner for the whole app | Split between core and extension; core version not under the publisher's control |
| A fixed, validated configuration | Easy: one build | Hard: the combination shifts |

**Commercial**

| | (a) | (b) |
|---|---|---|
| Product | The publisher's own named, branded app | An add-on to Workstation |
| Adoption | A separate download, a clear product | Lowest friction for existing users |
| Licence tiers | Every tier's code ships, locked by licence (design point 10) | A customer receives only what it bought |
| Ecosystem | One vendor per edition | Several vendors' extensions in one app |

**Decision (2026-10-29): (a).** It gives a publisher control of a fixed, tested, supportable
product at little cost to the core. Revisit (b) when a second publisher wants to ship
extensions into the same app, customers want add-ons to an app they already run, or keeping
higher-tier code off lower-tier machines matters commercially.

**Rules that keep (b) open** (binding on every slice):

- Every extension declares its supported API range (R12) and the loader enforces it, bundled or
  not.
- The loader takes extensions from a **source** (today one: the edition's archive) and nothing
  downstream of it knows which source an extension came from.
- No API behaves differently for a bundled extension; no extension may rely on being bundled
  (for example on files beside it in the app archive, other than its own).
- Licensing hooks (design point 10) do not depend on the distribution: the same gate works for
  an installed extension.

## Slices

| Slice | Content | Acceptance |
|---|---|---|
| **X0** | Decisions: this plan's questions (all decided 2026-10-29); wireframes of the slots — [`mockup/extension-wireframes.html`](mockup/extension-wireframes.html), decisions E1–E7 — with the example extension in them | Approved |
| **X1** | **Package and load**: `extension.json` schema and validation; edition `extensions` field and `build:edition` support; loader in main and renderer (custom protocol, API-range check, refusal with reasons); lifecycle; Settings › Extensions; the SDK package skeleton | Unit (seen red first): valid manifests load; every malformed one, and an incompatible API range, is refused with its reason. E2E: a test edition with the example extension lists it in Settings; disabling it removes its slots; an incompatible one is refused and listed with the reason |
| **X2** | **UI slots and commands**: sidebar tab, toolbar slot, full-window view, Settings page, popover/dialog helpers, error boundaries; commands, hotkeys through the hotkey map, ⌘K entries | E2E: the example's tab, toolbar item, full view and Settings page render and work; its key appears in Settings › Hotkeys and is remappable; a component that throws shows an error in its slot only |
| **X3** | **XNAT, navigation, state**: authenticated REST via the main process (no credentials exposed), user and permission queries; open session / scan with the browser's path and its outcome; reveal in browser; viewer and annotation-state events | E2E (live suite for REST; offline for the rest): the example opens a session through the API and is told the outcome; cancelling at the unsaved-changes prompt reports cancelled; events fire on session change and sign-out |
| **X4** | **Annotations API**: save active container (normal transport), read container metadata and version token, open an annotation scan, create from a template, select member | E2E: save through the API is the same save (conflict detection included); create-from-template makes the named members; a locked or approved container refuses as the panel does |
| **X5** | **Storage, files, test hooks**: per-user storage, file dialogs, the Playwright harness for extensions, service fakes | E2E of the example's storage; the harness runs an extension's own E2E from its repository against a built edition |
| **X6** | **Licensing hooks and build integrity** (R13–R14): the activation gate with states, reasons and features; feature-tagged contributions; re-evaluation on sign-in / server change / request; trusted inputs (server, user, install id, time); `safeStorage`-backed secure storage; declared publisher hosts in Settings › Extensions; Electron fuses and archive integrity at packaging; extension digests checked at load; the `devTools` edition setting; the example's demonstration licence gate | Unit (seen red first): gate results mount exactly the enabled features; a renderer part cannot enable a feature; one extension cannot read another's secure store. E2E on a packaged test edition: no licence → inactive with the reason, no slot / command / key / ⌘K entry; a basic-tier licence → only the basic features; importing a higher tier mounts the rest live; signing in to another XNAT server re-evaluates; an extension edited after packaging is refused; `--inspect` and `NODE_OPTIONS` have no effect; DevTools absent when the edition turns them off |
| **X7** | Docs: `docs/extension-authoring.md` (API reference, manifest, building an edition with an extension, **a licensing guide**: the gate, trusted inputs, site licences kept on XNAT, offline signed licences, online activation, tiers as features, what client-side checks can and cannot stop), update `docs/editions.md`; publish the SDK; full offline E2E; merge to `main` | An extension built from the guide, in a separate directory, loads in a test edition, and its licence gate works |

**Out of scope:** runtime installation of extensions (deferred — see the rules that keep it
open); an extension store or update feed; untrusted (third-party, unsigned) extensions;
extensions that replace core UI rather than add to it; **any licence logic, keys, licence
server or vendor endpoint in this repository** — the core provides hooks, publishers provide
licensing.

## Status

- [x] **X0** — decisions and wireframes, approved 2026-10-29.
- [x] **X1** — package and load (2026-10-29). As built:
  - `extension.json`: `id`, `name`, `version`, `apiVersion` (major.minor), `publisher`,
    `description`, `renderer` (ES module), `main` (CommonJS, optional); unknown fields are
    refused. The host implements API **0.1**: before 1.0 an extension must match the minor
    exactly, from 1.0 the major (`src/shared/extensions/manifest.ts`).
  - Each part's `activate()` may be async and has 10 s; throwing, rejecting or timing out makes
    the extension Inactive with the error as its reason; a renderer part that fails also stops
    the main part.
  - The edition's extensions are copied by `build:edition` into `build/edition/extensions/<id>/`
    and packaged **inside `app.asar`** (`npm run test:edition` checks the archive). An extension
    the app would refuse fails the edition build.
  - Main: `src/main/extensions/extensionHost.ts` (no Electron imports; one source folder, so a
    second source is a folder, not a code path), `src/main/ipc/extensionHandlers.ts` (the
    `xnat-extension://` scheme, IPC, stopping main parts at quit — only when one is running).
    Renderer: `src/renderer/lib/extensions/rendererHost.ts`; Settings › Extensions
    (`ExtensionsSection.tsx`) appears only when the edition ships an extension.
  - The API types live in `src/shared/extensions/api.ts`; the SDK skeleton
    (`packages/extension-api/`, `"private": true` until X7) re-exports them.
  - Example: `extensions/examples/session-notes` (lifecycle only, for now). E2E:
    `e2e/specs/extensions/` (fixtures in `e2e/fixtures/extensions/`, chosen per spec with
    `test.use({ extensionsDir })`).
  - "Disabling removes its slots" moves to X2's acceptance, where slots exist.
- [x] **X2** — UI slots and commands (2026-10-29). As built (API **0.2**):
  - `ext.ui`: `sidebarTab` (one per extension), `toolbarItem` (host-drawn button, `update()`
    for its text and visibility, a command or a popover), `view` / `openView` / `closeView`,
    `settingsPage`, and `components` (`Button`, `Dialog`). `ext.commands`: `register` (title,
    run, keys) and `execute`. Types: `src/shared/extensions/api.ts`; registry:
    `src/renderer/lib/extensions/uiRegistry.ts`. Everything an extension registers is removed
    when it stops — disabled, failed or reloaded.
  - React is shared (design point 4): the host puts its React on
    `globalThis.__xnatWorkstationExtensionHost`; the SDK's `react` and `jsx-runtime` modules
    read it, and an extension's bundler aliases `react` to them. The example is now TSX, built
    this way by `npm run build:extensions` into `dist/extensions/examples/`.
  - Slots: `SidebarTabs` (tabs only when one exists; ⋯ past two; the choice remembered),
    `ExtensionToolbarItems` (left of the right group; text into the tooltip as the toolbar
    narrows), `ExtensionViewHost` (over everything under the toolbar; Esc / Back; the
    toolbar's viewer controls greyed by a CSS rule from a marker), Settings pages nested under
    Extensions, and `ExtensionSlot` — the error boundary with Reload extension / Copy details.
  - Keys: an extension command is the hotkey action `ext:<extension>:<command>`; it takes the
    keys it asks for only where the app has none (a clash is shown in Settings › Hotkeys), and
    a user override always applies. ⌘K lists commands with their extension's name. **Limit:**
    the finder itself still opens only with an annotation open (it lives in the Annotations
    panel); a finder for the whole app is separate work.
  - The example dropped its "Add note" command: a dialog needs a mounted slot, and a command
    can run with none showing. Its sidebar tab has the button instead.
  - E2E: `e2e/specs/extensions/extension-slots.e2e.ts` (E1–E7 and disabling removes every
    slot, command and key); `npm run test:edition` checks the example's UI in a packaged app.
- [x] **X3** — XNAT, navigation, state (2026-10-29). As built (API **0.3**):
  - `ext.xnat` in both parts: `user()`, `request(path, { method, query, body, contentType })`
    (HTTP errors are responses), `getJson()`, `permissions(projectId)` (read: the project is
    visible; write: XNAT lists it under `permissions=edit`), `resourceFiles()`. Made in main
    through the app's own XnatClient (`rawRequest`: same cookies and CSRF, errors returned) —
    `src/main/extensions/extensionXnat.ts`; paths must be server-relative under `/data/` or
    `/xapi/`. The renderer part's calls go over IPC, allowed only for a running extension.
  - The channel between the parts (design point 2): main `ext.channel.handle` / `post`,
    renderer `ext.channel.request` / `onMessage`; errors arrive with main's own message.
  - `ext.viewer`: `session()`, `activeViewport()`, `openSession(ref, { scanId })` →
    `opened | cancelled | failed` — through the browser's own path (`lib/app/appNavigation.ts`
    → App's handler → `navigateTo` → XnatBrowser → `loadSessionFromXnat`, which now returns
    how it ended) — and `revealInBrowser()`.
  - `ext.annotations` (read-only): `list()`, `active()` — the panel's own projection
    (`lib/annotations/currentContainers.ts`, now shared with `useAnnotationsPanel`).
  - `ext.events.on(...)`: `signedIn`, `signedOut`, `sessionChanged`, `activeViewportChanged`,
    `activeAnnotationChanged`, `annotationsChanged`; listeners go when the extension stops.
  - Main parts get no events of their own yet: the renderer part can tell them over the channel.
  - E2E: `e2e/specs/extensions/extension-state.e2e.ts` (offline, through a probe extension that
    hands the spec its own `ext`); `e2e/specs/auth/extension-xnat.e2e.ts` (signed in,
    read-only on the server) is **written but not yet run**: the test account in `.env.e2e`
    is refused by the server (401) — every live spec fails at sign-in the same way.
- [ ] X4 · [ ] X5 · [ ] X6 · [ ] X7

## Questions for review

1. ~~**Trust model.**~~ **Decided 2026-10-29: (a)**, bundled in an edition, trusted,
   in-process, with (b) kept open. See [Trust and distribution](#trust-and-distribution-why-a).
2. ~~**UI technology.**~~ **Decided 2026-10-29:** share the app's React (design point 4).
3. ~~**Reach beyond R1–R14.**~~ **Decided 2026-10-29:** only R1–R14 now; running a module or
   operation, XNAT-browser columns, ⋮-menu items and the like are added when an extension needs
   them, each as a new minor version of the API.
4. ~~**Where is the SDK published?**~~ **Decided 2026-10-29:** public npm, under the `@nrgxnat`
   organisation (created 2026-10-29; `xnat` was taken), as
   `@nrgxnat/workstation-extension-api` (the scope may hold other XNAT packages, so the name
   says which product it serves). Published from GitHub Actions by npm
   trusted publishing (no stored token, with provenance), on its own version line (the API's
   semver, not the app's), and attached to each GitHub release as a fallback.
5. ~~**Naming.**~~ **Decided 2026-10-29:** "extension" for this, "module" for algorithms.
6. ~~**DevTools in the open-source edition's packaged builds.**~~ **Decided 2026-10-29:** the
   open-source edition keeps them; every edition gets the fuses and archive integrity; an
   edition with licensed extensions sets `devTools: false`.
