# 2. XNAT in ten minutes

> **Draft status.** XNAT concepts are standard; the app-specific parts (scan numbering, where
> annotations appear) are from the code on `main` (2026-11-06) and have not yet been checked
> by saving to a live server. To verify: the SR scan type shown in the XNAT web UI; how a
> second annotation of the same scan is numbered in practice.

XNAT is an open-source imaging informatics platform: a server, usually run by your institution
or research group, that stores imaging data, the information about who and what it came from,
and who may see it. XNAT Workstation is a client for it, in the same way an email program is a
client for a mail server. Your images never live only on your computer — they live in XNAT,
and the app fetches what you open.

## How XNAT organises data

Everything in XNAT sits in a four-level hierarchy:

```
Project            e.g. "LIVER_TUMOUR_STUDY"
└─ Subject         a participant, e.g. "LTS_014"
   └─ Session      one imaging visit or exam, e.g. "LTS_014_MR1"   (XNAT also calls these "experiments")
      └─ Scan      one series acquired in that session, e.g. scan 4, "T1 post-contrast"
```

- A **project** is the unit of access. You see a project's data only if you are a member of it
  (or it is public). Your role in the project decides what you can do:

  | Role | Can view | Can save annotations |
  |---|---|---|
  | Owner | yes | yes |
  | Member | yes | yes |
  | Collaborator | yes | no — saving is refused |

  Your XNAT administrator or the project owner manages roles, in XNAT's web interface.
- A **subject** is a person (or animal, or phantom) in the study. Labels are usually study IDs,
  not names.
- A **session** is one visit to a scanner. It has a modality (CT, MR, PT…) and a date, and
  holds the scans from that visit.
- A **scan** is a single series, identified by a **scan ID** — usually the series number from
  the scanner (`1`, `2`, `4`, `501`…) — and a description such as *T1 MPRAGE* or *AX POST*.
  Each scan's DICOM files are stored with it.

## What happens to your annotations

When you save an annotation, the app stores it in XNAT **as a new scan in the same session**,
alongside the images it was drawn on. It is a DICOM object in its own right — a segmentation,
a structure set or a measurement report — so anyone with access to the session can see it,
download it, or open it in another tool.

These scans are numbered so that you can tell, from the ID alone, what kind of annotation it is
and which scan it belongs to:

| Annotation type | DICOM object | Scan ID | Example: annotation of scan 4 |
|---|---|---|---|
| Segmentation | SEG | `30` + source scan | `3004` |
| Structure | RTSTRUCT | `40` + source scan | `4004` |
| Measurement | SR | `50` + source scan | `5004` |

If that ID is already taken — a second segmentation of scan 4, say — the next number up is
used (`3104`). The source scan number is zero-padded to two digits, so scan 12's segmentation is
`3012`.

In the app you rarely need these numbers: annotation scans are not listed in the XNAT browser as
scans of their own. Instead, the scan they belong to shows a small count of its segmentations
and structures, and opening that scan opens them with it (chapter 4).

Saving again **updates the same scan** rather than creating another one. If someone else has
changed it since you opened it, the app tells you and lets you choose what to do instead of
overwriting their work (chapter 13).

## Signing in

XNAT servers authenticate users in different ways: with an XNAT username and password, with an
institutional directory (LDAP), or by sending you to your institution's single sign-on page
(OIDC / SAML). The app does not need to know which. When you sign in, it opens **your server's
own login page** in a window, and you sign in there exactly as you would in a web browser
(chapter 3). The app never sees or stores your password.

## The XNAT web interface

Everything the app does not do — creating projects, uploading new imaging, managing users and
permissions, running pipelines, sharing data — is done in XNAT's web interface, in an ordinary
browser at your server's address. From the app's browser you can jump to any project or session
in the web interface (chapter 4).

## Words you will meet

XNAT and DICOM use some terms differently from each other and from everyday speech. The
[Glossary](glossary.md) lists them; the ones that matter most:

- **Session** (XNAT) ≈ **study** (DICOM) — one exam.
- **Scan** (XNAT) ≈ **series** (DICOM) — one acquisition within it.
- **Subject** (XNAT) ≈ **patient** (DICOM).
