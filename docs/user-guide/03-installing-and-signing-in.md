# 3. Installing and signing in

> **Draft status.** Written from the code and packaging configuration on `main` (2026-11-06);
> not yet walked through on a real install. To verify: the download location once the
> repository moves to NrgXnat; the exact Gatekeeper / SmartScreen wording on first launch;
> the contents of **Settings › Updates**; what the user sees when a session expires while
> annotations are open (the viewer is replaced by the sign-in screen — confirm the recovery
> offer appears on reopening the session); which macOS architectures are published (separate
> `arm64`/`x64` or universal) and the Linux artifact names; the memory guidance, which is an
> estimate, not a measurement.

## System requirements

- **macOS** (Apple silicon or Intel), **Windows** 10 or 11 (64-bit), or **Linux** (64-bit).
- A graphics processor with **WebGL 2**. Almost every computer from the last decade has one;
  virtual machines and remote-desktop sessions sometimes do not. A few segmentation tools also
  use **WebGPU** where it is available, and explain themselves if it is not.
- Memory: 8 GB is enough for typical CT and MR; 16 GB or more is recommended for large volumes
  and for multi-planar views of several series at once.
- Network access to your XNAT server.

## Installing

Download the installer for your platform from the project's releases page.

| Platform | Download | Install |
|---|---|---|
| macOS | `XNAT-Workstation-<version>-<arch>.dmg` (`arm64` for Apple silicon, `x64` for Intel) | Open the `.dmg` and drag **XNAT Workstation** to Applications. |
| Windows | `XNAT-Workstation-<version>-x64-setup.exe` | Run it and follow the installer. A `-portable.exe` is also published; it runs without installing. |
| Linux | `XNAT-Workstation-<version>-x64.AppImage` or `.deb` | AppImage: make it executable and run it. Debian/Ubuntu: install the `.deb` with your package manager. |

Release builds for macOS and Windows are signed, so they open without "unidentified developer"
warnings.

### Updates

The app checks for new versions by itself and, by default, downloads them in the background.
When an update is ready it tells you, and installs it the next time the app restarts. You can
turn this off, or check by hand, in **Settings › Updates**.

## Signing in

1. Start the app. It opens on the **Connect to your XNAT server** screen.
2. In **Server**, type your XNAT server's address — for example `xnat.example.edu`. You can
   leave out `https://`; the app adds it. Ask your XNAT administrator if you don't know the
   address; it is the address you use for XNAT in a web browser.
3. Click **Sign In with XNAT**. A window opens showing **your server's own login page**.
4. Sign in there as you normally would — XNAT username and password, your institution's
   single sign-on, or whatever your server uses. The window closes by itself once you are in.

When it succeeds, the main window appears with the XNAT browser on the left. The connection
status at the top shows the server and your username.

The servers you have signed in to are remembered: next time the most recent one is filled in,
and the **⌄** button beside the field lists the others.

### If sign-in does not work

| What you see | What to do |
|---|---|
| The login window says the page cannot be reached | Check the address (try it in a web browser), and your network or VPN. |
| A certificate or security warning | The server's HTTPS certificate is not trusted by your computer. Do not work around it — contact your XNAT administrator. |
| Your institution's sign-in page says sign-in from this browser is blocked (seen with Google sign-in) | Some identity providers refuse sign-in from embedded windows. Ask your XNAT administrator about an alternative sign-in method or an XNAT alias token. |
| You closed the login window | Nothing happens and you stay on the connect screen. Click **Sign In with XNAT** again. |

The app works with one XNAT server at a time. Signing in to another server signs you out of the
first.

## Staying signed in

While the app is open it keeps your XNAT session alive, so you are not signed out in the middle
of a long annotation. You will be signed out if:

- the XNAT server is restarted, or ends sessions on its own schedule;
- your network connection drops long enough for the server to forget you.

When that happens the app returns to the connect screen with **Session expired** or
**Connection lost**. Sign in again and reopen your session. Annotations you had not saved are
kept in a local backup while you work; when you reopen the session, the app offers to restore
them (chapter 13).

## Signing out

Click the disconnect button beside your username in the connection status (its tooltip reads
*Disconnect from XNAT*). If you have
unsaved annotations the app asks first:

- **Save Draft** keeps a recoverable copy before signing you out; you are offered it the next
  time you open that session.
- **Discard** asks you to confirm, then signs you out without keeping your changes.

Signing out ends your session on the XNAT server as well as in the app.
