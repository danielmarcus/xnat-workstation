# Opening a session from a web link

A web page can open an XNAT session in XNAT Workstation with an `xnat-workstation://` link.

## Link format

```
xnat-workstation://open?server=<XNAT base URL>&project=<project ID>&session=<experiment ID>[&scan=<scan ID>]
```

| Parameter | Required | Value |
|---|---|---|
| `server` | yes | The XNAT base URL, as you would type it on the login screen, e.g. `https://xnat.example.org` or `https://example.org/xnat`. Must be `https`; `http` is accepted only for `localhost` and `127.0.0.1`. |
| `project` | yes | The project ID. |
| `session` | yes | The experiment ID (accession number, e.g. `XNAT_E00012`). The experiment's label in that project also works, because the app looks the session up under the project. |
| `scan` | no | The ID of an image scan in the session to show first. Without it, the session opens as it does from the XNAT browser. |

The app finds the subject from the session, so the link does not need one. Unknown parameters are ignored.

URL-encode each value. In JavaScript, `URLSearchParams` does this for you:

```js
const href = 'xnat-workstation://open?' + new URLSearchParams({ server, project, session, scan });
```

```html
<a href="xnat-workstation://open?server=https%3A%2F%2Fxnat.example.org&project=PROJ01&session=XNAT_E00012&scan=4">
  Open in XNAT Workstation
</a>
```

Browsers usually ask the user before handing the link to the app. If the app is not installed, the link does nothing, and the page cannot tell.

## What the app does

- **Signed in to that server:** it opens the session, showing the scan if one is given. If that session is already open, only the scan is loaded.
- **Not signed in to it:** it starts sign-in to that server, with the server filled in on the login screen, and opens the session once sign-in succeeds. If the user closes the login window, the server stays filled in, and signing in later still opens the session.
- **A sign-in that fails or is cancelled** keeps the link waiting, so signing in again (the login form is prefilled with its server) opens it. It waits at most 10 minutes, as long as a browser sign-in may take: a sign-in after that drops the link instead of opening it. The login form's **Don't open it** drops it at once.
- **A link that arrives while signing in:** if it is for the server being signed in to, it replaces the one waiting, and the app says it will open it after sign-in. If it is for another server, the app asks the user to finish or cancel the sign-in first and open the link again.
- **A server the user has never connected to** (not in the login screen's recent servers): it asks first, naming the server: "Open a session from https://…?", with Open and Cancel.
- **Signed in to a different server:** it asks before switching, because switching signs the user out. Unsaved annotations get the same Save Draft / Discard prompt as Disconnect.

A link that fails validation is ignored. The app never runs or fetches anything from a link, and never logs one. Project, session and scan must be 1 to 64 letters, digits, `_`, `-` or `.`, and must not start with `.`.

## Registration

| Platform | How the scheme is registered |
|---|---|
| macOS | `CFBundleURLTypes` in the app's Info.plist (electron-builder `protocols`), plus `app.setAsDefaultProtocolClient` at start-up |
| Windows | The NSIS installer writes `Software\Classes\xnat-workstation` (`build/installer.nsh`), and the app registers itself at start-up, which covers the portable build |
| Linux | `MimeType=x-scheme-handler/xnat-workstation` in the `.desktop` file (electron-builder `protocols`), plus `app.setAsDefaultProtocolClient` at start-up |

Only one copy of the app runs at a time. On Windows and Linux, a link launches a second copy, which hands the link to the running one and quits. An unpackaged development build is named "XNAT (dev)", with its own settings, so it runs beside an installed copy. The first time it runs, it copies the app's own data (annotation backups and checkpoints, settings, modules, extension data) from the folder development builds used before, which is the installed app's; the old folder is left as it was.

Every edition (editions.md) registers the same scheme, so a web page's link doesn't depend on which edition a user has. With two editions installed on one machine, the operating system picks which one opens links.

## Trying a link

```bash
open 'xnat-workstation://open?server=https%3A%2F%2Fxnat.example.org&project=PROJ01&session=XNAT_E00012'   # macOS
xdg-open 'xnat-workstation://open?…'                                                                   # Linux
start "" "xnat-workstation://open?…"                                                                   # Windows
```

On Windows, `npm run dev` registers the development build as the handler. On macOS and Linux, Electron can register only a packaged app.
