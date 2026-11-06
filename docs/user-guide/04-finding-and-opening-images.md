# 4. Finding and opening images

> **Draft status.** Written from the code on `main` (2026-11-06); not yet walked through in the
> running app. To verify: whether clicking a scan loads into the active viewport or replaces
> the whole layout; where the session-level "open all" action is, if any; that dropping a
> *folder* of DICOM files is not supported (the code accepts files, not folders) — if so, say
> it plainly here and consider fixing it; the exact icons for pin and "open in XNAT".

## The XNAT browser

The browser in the sidebar follows XNAT's hierarchy (chapter 2): **projects › subjects ›
sessions › scans**. Click a project to see its subjects, a subject to see its sessions, and a
session to expand it and see its scans.

At each level a **filter** field narrows the list as you type — *Filter projects…*,
*Filter subjects…* and so on. Click **×** to clear it.

Each session row shows its label, modality, date and number of scans.

### Scans

An expanded session shows its scans in one of two views, switched with the buttons at the top:

- **Grid view** — a thumbnail of each scan with its number, description and number of frames.
- **List view** — the same information without thumbnails.

Only image scans are listed. A scan that has annotations saved against it carries a small
count: segmentations and structures (chapter 2, *What happens to your annotations*).

If a session holds no image scans, the browser says *No source scans in this session.*

## Opening a scan

- **Click** a scan to open it in the **active viewport** (the one with the light-grey outline).
  Any annotations saved against that scan open with it.
- **Shift-click** a scan to open it in a multi-planar layout — axial, sagittal and coronal views
  of the same volume (chapter 6).
- **Drag** a scan onto a viewport to open it there. This is the quickest way to put two scans
  side by side: choose a two-viewport layout from the toolbar (chapter 6), then drag one scan
  into each.

A session opens in a single-viewport layout. To lay out several of its scans at once by a
standard arrangement, use **Hanging** on the toolbar, which lists the arrangements that fit the
session:

| Arrangement | Fits | What goes where |
|---|---|---|
| CT Pre/Post Contrast | CT | Scans described as *pre*, *without*, *non-contrast* beside those described as *post*, *with contrast*, *enhanced* |
| MR Brain Standard | MR | T1 (*t1*, *mprage*, *bravo*, *spgr*), T2, FLAIR and diffusion (*dwi*, *adc*, *dti*) |
| Side by Side | any | The two largest series |
| Mammography 4-Up, Tomosynthesis 4-Up | MG | Standard four views by laterality and projection |
| Single Series | any | One series |

Arrangements match on the scans' descriptions, so a session whose series are described
unusually may not offer one. **Hanging** is greyed out when none applies.

### If you have unsaved work

Opening a scan never silently throws away unsaved annotations. If what you are about to open
would leave an annotation with unsaved changes **no longer shown in any viewport**, the app
asks first: **Save**, **Discard**, or **Cancel** (stay where you are). Opening a scan into a
*second* viewport takes nothing away, so it does not ask.

## Favorites: pinned and recent

Hover over a project, subject or session and click the pin to keep it at hand. **Favorites** on
the toolbar lists your pinned items and the **five most recent sessions** you opened on this
server; choose one to jump straight to it. Pins and recents are kept on this computer, per
server.

## Opening the same item in XNAT's web interface

Projects and sessions have an **Open in XNAT** button that opens the corresponding page of
XNAT's web interface in your browser — useful for checking a session's details, its other
files, or who has access.

## Opening DICOM files from your computer

You can also open DICOM files that are on your computer rather than in XNAT — for example, a
series a colleague sent you, or a segmentation made in another tool.

- Click **Import** on the toolbar and choose one or more `.dcm` files; or
- drag the files from your file manager onto the viewport area.

Choose all the files of a series together. A DICOM SEG, RTSTRUCT or SR file opened alongside
the images it was made on is shown on them as an annotation.

Files you open this way are not uploaded anywhere. Annotations you make on them can be exported
to files (chapter 14); saving to XNAT needs a session that is in XNAT.

> **Note.** You need to be signed in to an XNAT server to reach the viewer, even if you only
> want to open local files.
