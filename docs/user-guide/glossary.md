# Glossary

> **Draft status.** Complete for chapters 1–4; terms for later chapters (operation names,
> tool families) are included where they are already settled in the app.

Terms are grouped by where they come from. **App** terms have a specific meaning in XNAT
Workstation that may differ from other tools.

## XNAT

**Alias token** — a revocable username/password pair that XNAT issues to stand in for your real
credentials, typically for scripts or for servers that only allow single sign-on.

**Collaborator, Member, Owner** — your role in a project. Collaborators can view; members and
owners can also save annotations. See chapter 2.

**Experiment** — XNAT's general name for a session (and for some other data, such as
assessments). In this app, *session*.

**Project** — the top level of XNAT's hierarchy and the unit of access control.

**Scan** — one series within a session, identified by a scan ID. Saved annotations are scans
too (chapter 2).

**Scan ID** — a scan's identifier within its session, usually the scanner's series number.
Annotation scans use the `30xx` / `40xx` / `50xx` numbering in chapter 2.

**Session** — one imaging visit or exam of a subject; holds scans. Corresponds to a DICOM study.

**Subject** — the person, animal or phantom imaged. Corresponds to a DICOM patient.

**XNAT** — the imaging repository server the app connects to.

## DICOM

**DICOM** — the standard format and protocol for medical images and related objects.

**Frame of reference** — the patient coordinate system a series was acquired in. Series that
share one line up in space; the app uses this to know which images an annotation fits.

**RTSTRUCT** (RT Structure Set) — the DICOM object for contours. The app saves *Structures* as
RTSTRUCT.

**SEG** (Segmentation) — the DICOM object for painted masks. The app saves *Segmentations* as
SEG.

**Series** — one acquisition within a study; in XNAT, a scan.

**SR** (Structured Report) — the DICOM object for measurements and findings. The app saves
*Measurements* as SR.

**Study** — one exam; in XNAT, a session.

**Window / level** — the mapping from stored intensities to grey levels on screen: window is
the width of the intensity range shown, level its centre.

## App

**Active member** — the one member of a container you are working on; tools draw into it. Shown
by its row in the Annotations side panel.

**Active viewport** — the viewport that scans load into and tools act on; marked with a thin
light-grey outline.

**Annotation type** — one of the three peers: **Segmentation**, **Structure**, **Measurement**.

**Annotations side panel** — the panel on the right where every annotation is created, named,
edited, saved and deleted.

**Container** — one annotation file: a Segmentation (SEG), Structure set (RTSTRUCT) or
Measurement report (SR). It holds **members**.

**Hanging protocol** — a standard arrangement of a session's scans across viewports, chosen
with **Hanging** on the toolbar.

**Member** — one item inside a container: a segment in a Segmentation, one structure (ROI) in a
Structure set, one measurement in a Measurement report.

**Module** — an add-on algorithm (for example, a segmentation method) that runs in a sandbox and
appears as an operation. See chapter 15.

**MPR** (multi-planar reconstruction) — showing a volume as axial, sagittal and coronal planes
at once, with linked crosshairs.

**Extension** — an add-on that some editions of the app include, adding a sidebar tab, toolbar
item or full-window view. See chapter 16.

**Operation** — a whole-slice or whole-volume action on a segment (cleanup, interpolate,
propagate…) that shows a preview before anything is written. See chapter 9.

**Preview** — the proposed result of an operation, drawn over the image before you accept it
(**⏎**) or discard it (**⎋**).

**Sidebar** — the XNAT browser on the left of the window.

**Tool family / mode** — the Segmentation toolbox groups tools into families (Brush, Shape,
Region…); a family's modes choose the exact tool. See chapter 8.

**Viewport** — one image display surface. The **viewport area** holds one or more of them in a
grid.
