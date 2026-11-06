# 1. Introduction

> **Draft status.** Written from the code on `main` (2026-11-06). The intended-use statement
> below is a placeholder until the release owner decides the wording (release plan, decision
> "Regulatory positioning").

## What XNAT Workstation is

XNAT Workstation is a desktop application for **reviewing and annotating medical images that
are stored in an XNAT repository**. You sign in to your institution's XNAT server, find a
subject's imaging session, open its scans, and draw on them — segmentations, contours and
measurements — then save what you made back to XNAT, next to the images it describes.

It is built for the work of image review and annotation in research:

- **Viewing**: stacks and multi-frame images, window/level presets, pan, zoom, rotate, flip,
  cine, several viewports side by side, and multi-planar reconstruction (axial, sagittal and
  coronal views of the same volume) with linked crosshairs.
- **Annotating**, with three kinds of annotation that the app treats as peers:
  - **Segmentation** — painted masks (labelmaps), saved as DICOM SEG;
  - **Structure** — contours drawn slice by slice, saved as DICOM RTSTRUCT;
  - **Measurement** — lengths, angles, ROIs and similar, saved as DICOM SR.
- **Assisted segmentation**: intensity-limited brushes and shapes, region growing, level
  tracing, random-walker seeding, interpolation between slices, propagation, cleanup — each
  showing a preview you accept or discard.
- **Saving to XNAT** with conflict detection, plus local autosave so a crash or a lost
  connection does not cost you your work.

Everything is saved in standard DICOM formats, so other tools that read DICOM SEG, RTSTRUCT and
SR (3D Slicer, OHIF and others) can open what you produce, and the app can open what they
produce.

## What it is not

> **Placeholder — wording to be decided before release.** For example: *XNAT Workstation is
> intended for research use only. It is not a medical device and is not intended for
> diagnosis, treatment or any clinical decision.*

It is also not a replacement for the XNAT web interface. Managing projects, users, permissions,
uploads of new imaging, pipelines and sharing all stay in XNAT's own web pages; the app links to
them where it helps (chapter 4).

## Who this guide is for

You already know how to read images: window and level, planes and orientation, what a series
is, roughly what DICOM is. You may never have used XNAT — [chapter 2](02-xnat-in-ten-minutes.md)
covers what you need. You have probably annotated in another tool; chapters 7–12 explain where
this app's model differs, and the [Glossary](glossary.md) defines its terms.

## The app at a glance

Once you are signed in, the window has four areas:

```
┌─────────────────────────────────────────────────────────┐
│ Toolbar                                                  │
├──────────┬──────────────────────────┬───────────────────┤
│ Sidebar  │   Viewport area          │  Annotations      │
│ (XNAT    │   (one or more           │  side panel       │
│ browser) │    viewports)            │                   │
└──────────┴──────────────────────────┴───────────────────┘
```

- The **toolbar** holds viewing controls: layout, navigation tools, transforms, undo and redo,
  cine, and Settings.
- The **sidebar** is the XNAT browser, where you find and open scans.
- The **viewport area** shows images, in one **viewport** or a grid of them. One viewport is
  *active* — it has a thin light-grey outline — and that is where scans load and tools act.
- The **Annotations side panel** is where every annotation is created, named, edited, saved and
  deleted. Its toolbox changes to suit the kind of annotation you are working on.

Each area has its own chapter (5 to 13).
