# Extension framework (plan, for review)

Status: **draft for review, 2026-10-29** (branch `extension-framework`). Nothing is built until
this plan is reviewed.

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
| R12 | **Versioning**: the API is semver; an extension declares the range it supports; an incompatible one is refused at start-up with the reason, never half-loaded | |

## Design points (proposed; flag any to change)

1. **Trust and distribution — question 1.** Recommended: **extensions are bundled into an
   edition at build time** (like Bundled modules — `docs/editions.md`), and are trusted code:
   they run in the app's own processes, with the access the API gives them. The edition's
   signature covers them, so the app needs no extension signing, store or installer, and an
   organisation decides what its build contains. Runtime-installed extensions are left out:
   trusted code a user can drop in is the riskiest thing an app can offer, and nothing needs it
   yet. (The alternative — extensions in an isolated process, their UI in iframes — is the
   design for untrusted code; see question 1.)
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
   (id, name, version, API range, publisher, the slots and commands it contributes, whether it
   has a main part) and its built bundles (`renderer.js` ES module, optional `main.js`). The
   edition configuration gains `extensions: [...]`; `build:edition` copies them into
   `resources/extensions/`, where the app loads them from at start-up through a custom protocol
   (renderer) and `require` (main).
6. **The SDK.** This repository publishes `@xnat-workstation/extension-api`: the API's types,
   the manifest schema, a small runtime shim, and test helpers. An extension's repository
   depends on it (and on React as a peer); building an edition then combines the core with
   that repository's bundles. Where it is published (npm, GitHub Packages) is question 4.
7. **Lifecycle.** Loaded after sign-in state is known; `activate(ext)` registers slots and
   commands; `deactivate()` on sign-out, on disable, and at quit. Settings › Extensions lists
   what the edition ships (name, version, publisher) with an Enabled switch.
8. **Permissions follow XNAT.** The API does not add a permission layer of its own: an
   extension acts as the signed-in user, so XNAT's project roles decide what succeeds, and the
   permission query (R4) lets it show View Only where the user cannot write.
9. **An example extension in this repository**, `extensions/examples/session-notes` — a
   sidebar tab listing per-session notes stored in an XNAT resource, with a toolbar indicator and
   a key — exercising every API family. It is the authoring guide's worked example and the E2E
   fixture, and the open-source edition does not ship it.

## Slices

| Slice | Content | Acceptance |
|---|---|---|
| **X0** | Decisions: this plan's questions; wireframes of the slots (sidebar tab, toolbar slot, full-window view, Settings › Extensions) with the example extension in them | Approved |
| **X1** | **Package and load**: `extension.json` schema and validation; edition `extensions` field and `build:edition` support; loader in main and renderer (custom protocol, API-range check, refusal with reasons); lifecycle; Settings › Extensions; the SDK package skeleton | Unit (seen red first): valid manifests load; every malformed one, and an incompatible API range, is refused with its reason. E2E: a test edition with the example extension lists it in Settings; disabling it removes its slots; an incompatible one is refused and listed with the reason |
| **X2** | **UI slots and commands**: sidebar tab, toolbar slot, full-window view, Settings page, popover/dialog helpers, error boundaries; commands, hotkeys through the hotkey map, ⌘K entries | E2E: the example's tab, toolbar item, full view and Settings page render and work; its key appears in Settings › Hotkeys and is remappable; a component that throws shows an error in its slot only |
| **X3** | **XNAT, navigation, state**: authenticated REST via the main process (no credentials exposed), user and permission queries; open session / scan with the browser's path and its outcome; reveal in browser; viewer and annotation-state events | E2E (live suite for REST; offline for the rest): the example opens a session through the API and is told the outcome; cancelling at the unsaved-changes prompt reports cancelled; events fire on session change and sign-out |
| **X4** | **Annotations API**: save active container (normal transport), read container metadata and version token, open an annotation scan, create from a template, select member | E2E: save through the API is the same save (conflict detection included); create-from-template makes the named members; a locked or approved container refuses as the panel does |
| **X5** | **Storage, files, test hooks**: per-user storage, file dialogs, the Playwright harness for extensions, service fakes | E2E of the example's storage; the harness runs an extension's own E2E from its repository against a built edition |
| **X6** | Docs: `docs/extension-authoring.md` (API reference, manifest, building an edition with an extension), update `docs/editions.md`; publish the SDK; full offline E2E; merge to `main` | An extension built from the guide, in a separate directory, loads in a test edition |

**Out of scope:** runtime installation of extensions; an extension store or update feed;
untrusted (third-party, unsigned) extensions; extensions that replace core UI rather than add
to it.

## Questions for review

1. **Trust model.** (a) Recommended: bundled in an edition, trusted, in-process. (b) Also allow
   installing signed extensions at runtime from trusted publishers (reusing the module signing
   keys) — more flexible, but trusted code installed by users. (c) Isolated: each extension in its
   own sandboxed process with UI in iframes — safe for untrusted code, heavier for every
   extension, and its UI cannot share the app's look and keyboard rules as closely.
2. **UI technology.** Share the app's React (recommended) or require framework-agnostic web
   components / iframes?
3. **What may extensions reach beyond the list above?** For example: running a module or a
   built-in operation, adding columns to the XNAT browser, adding items to a container's ⋮ menu.
   Recommended: only R1–R12 now; add others when an extension needs them.
4. **Where is the SDK published?** Public npm (simplest for anyone), or GitHub Packages.
5. **Naming.** "Extension" for this and "module" for algorithms, as above — or another pair of
   words, since both already appear in the UI (Settings › Modules)?
