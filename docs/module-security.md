# Module security

Modules are code from people other than the app's authors — including unsigned **Community**
modules. This is the threat model: what a module can and cannot reach, how that is enforced, and
what it does not protect against.

## The threat

A module may be careless or hostile. Workstation holds things worth stealing or damaging: the
images on screen (patient data), the XNAT session (an authenticated cookie that can read and
write a server's data), the user's files, and the app itself (its code, its signature, other
modules). The renderer that shows the viewer has Electron privileges and the XNAT session, so a
module must **never** run there — which is the decisive difference from SegWorks, whose modules
were injected into the viewer page with its full privileges.

## What a module can reach

Only what the host hands it for one run:

- the **data the manifest declares** it reads (`reads`): the image in the chosen box, segment
  masks, seed strokes, the ROI rectangle — nothing undeclared is posted to it;
- its **own package's files**;
- **CPU and memory** for the run, and WebAssembly.

It returns a mask (and optionally a table). It cannot write anything itself: the host applies the
result through the same path every operation uses — staged in a transaction, previewed, locked
segments read-only, one undo step — and only when the user commits.

## How it is enforced

Each run gets a **fresh, hidden, sandboxed renderer process** of its own
(`src/main/modules/moduleRuntime.ts`), destroyed when the run ends:

| Layer | Effect |
|---|---|
| OS process sandbox (`sandbox: true`), no Node (`nodeIntegration: false`, `contextIsolation`) | No `require`, `process`, file system or child processes |
| A preload that only relays one message port | No `electronAPI`, no IPC to the main process |
| Its own in-memory session (`xnat-module-run-<uuid>`) | No cookies, cache or storage shared with the app — no XNAT session; nothing persists |
| Every request cancelled except its own `xnat-module://<id>/` files | No network (XNAT, the internet, localhost), no `file://` |
| Content-Security-Policy `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'` | No `eval` / `Function`, no remote scripts, `fetch` / XHR / WebSocket only to its own files |
| Navigation prevented, `window.open` denied, every permission denied | No escaping the page, no camera, notifications, clipboard… |
| A time limit (30 min), Cancel then destroy (2 s), destroyed with the app page | A runaway module is stopped |

The network layers are independent: either the request filter or the CSP alone blocks the
hostile module's requests (`e2e/specs/modules/module-sandbox` aims one at a server it knows is
reachable and asserts the server saw nothing).

**Installing** is guarded too (`src/main/modules/`):

- A package is read by a strict zip reader: entry, size and path limits; no `..`, absolute paths
  or links.
- The manifest is validated; an unknown API major or runtime is refused by name.
- A package the user picks is checked in the main process and installed **by token** — renderer
  code can never point the installer at an arbitrary path.
- Installed files go to the user-data folder, never the app bundle; their digest is recorded and
  **re-checked at every listing and every run**, so a module changed on disk is refused, signed
  or not.
- Community modules need the user's confirmation (showing the signer and what the module reads
  and writes), and can be turned off altogether (*Allow community modules*).

## What it does not protect against

- **A wrong result.** A module can return a bad mask, maliciously or not. It is a preview until
  the user commits it, and one undo step after — review it.
- **What a signature means.** *Verified* means the package was signed by a key you (or your
  edition) trust and has not changed since. It is a statement about who published it, not a
  review of what it does. Trust a publisher only as far as you trust them; if their key is
  compromised, remove it (Settings › Modules), and their modules become Community.
- **Resource use.** A module can use a core and memory for as long as it runs (up to the time
  limit, or until Cancel). The memory estimate (`bytesPerVoxel`) warns and blocks large boxes,
  but a module can exceed its own declaration; at worst its process is killed.
- **Seeing the data it was given.** A module sees the image data it declares, and could encode it
  into its result. It cannot send it anywhere — there is no channel out but the result — but a
  mask the user then exports or uploads carries whatever the module put in it.
- **Side channels** between a run and the rest of the machine (timing and the like) are not
  addressed.
- **Bundled modules** are part of an edition and run in the same sandbox; their trust comes from
  the edition's signature, which the edition's publisher controls.
