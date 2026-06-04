# Annotation Transport: XNAT Integration Requirements

> **Status: skeleton.** Section headings only. To be filled in as a separate workstream from the multi-viewport annotation requirements.

Functional requirements for moving RTSTRUCT, DICOM SEG, and DICOM-SR (measurement) containers between the XNAT Workstation app and an XNAT server (and, by extension, other backends with similar semantics). Covers loading, saving, versioning, conflict detection, and the lifecycle around them. (DICOM-SR transport is in scope as the third container type per multi-viewport requirements D7.1, but its field-mapping detail — section F — is a skeleton pending the measurement requirements fill-in.)

The boundary with in-memory annotation behavior is the **transport contract** in section H of [`multiviewport-annotation-requirements.md`](multiviewport-annotation-requirements.md). This document elaborates the transport side of that contract; the multi-viewport doc is authoritative for in-memory behavior.

## Scope

In scope:
- Discovery, browse, fetch, parse, validate.
- Serialize, upload, version, conflict detection.
- Mapping between RTSTRUCT/SEG DICOM fields and XNAT asset metadata.
- Lifecycle: when autosave pushes, manual save, retry on transient failures, behavior under offline / auth-expired.
- Failure UX visible at the transport boundary (errors on container rows, session-level transport status).
- Convention layer: scan ID conventions (e.g., the `30xx` pattern for SEG-derived scans), resource paths, file naming.

Out of scope:
- In-memory rendering, edit routing, undo, dirty tracking, list-panel UX. See multi-viewport doc.
- Real-time collaborative multi-user editing.
- Backend protocols other than XNAT (in v1; the design should leave room).

---

## A. XNAT asset model

### A1. Project / subject / experiment / scan / resource hierarchy
*To fill in: how containers map to XNAT's hierarchy, where RTSTRUCT and SEG live, what an "experiment" is for our purposes.*

### A2. Scan ID conventions
*To fill in: the `30xx` SEG-derived-scan-ID pattern, how source scan IDs are recovered from a SEG, how to avoid ID collisions when creating new SEGs in-session.*

### A3. Resource and asset typing
*To fill in: which XNAT asset/resource type holds RTSTRUCT vs SEG, file naming conventions, MIME or format declarations.*

### A4. Permissions and ownership
*To fill in: read vs write at project / subject / experiment level, behavior when permissions disallow save, who "owns" an in-session-created container until first save.*

---

## B. Loading

### B1. Browse and discovery
*To fill in: how a user finds existing RTSTRUCT/SEG assets to load (project browser, scan-level affordance, search). What metadata is shown before download.*

### B2. Fetch
*To fill in: download mechanics, byte-level transport (REST endpoint shapes, IPC channel for the Electron renderer/main split, base64 vs binary, chunked transfer for large SEGs).*

### B3. Parse and validate
*To fill in: DICOM parse path (likely dcmjs adapters), validation steps, how parse failures are reported on a placeholder container row (multi-viewport H9 + D7.9).*

### B4. Source identity construction
*To fill in: how the transport builds the source identity record (multi-viewport H2): URI, modality, referenced source-series UIDs, version token.*

### B5. Auto-load on scan click
*To fill in: behavior when the user opens a scan that has associated RTSTRUCT/SEG assets — does the transport auto-load? User preference? Default state? Existing app has `autoLoadSegOnScanClick` — formalize.*

### B6. Multi-container loading
*To fill in: ordering, parallelism, progress reporting per container, behavior on partial failure (one container fails, others succeed).*

---

## C. Saving

### C1. Trigger model
*To fill in: when does the transport push? On every dirty event (H3)? Debounced? Manual only? Per-container preference? Idle timer?*

### C2. Serialize
*To fill in: how the transport invokes the multi-viewport `serialize` call (H4), how it handles the returned dataset, validation before upload.*

### C3. Upload mechanics
*To fill in: REST endpoint shapes, IPC channel, chunked vs single PUT, retry policy, timeout, progress reporting.*

### C4. Version token assignment
*To fill in: how the server returns a new version token, how the transport reports success up to the multi-viewport layer (H5), token format.*

### C5. New-container first save
*To fill in: how a session-local container ID becomes a permanent XNAT asset on first save (H8), how derived scan IDs are allocated (interaction with A2 conventions).*

### C6. Save during edit
*To fill in: the XNAT-specific mechanics of the multi-viewport E2 guarantee (edits during save are not lost). The model is **decided — queue-next-save**: multi-viewport requirements E2 specifies it and explicitly rejects save-then-amend. The transport must honor it — while a save for container C is in flight, additional edits set the dirty flag and do not start a second concurrent save; on success the transport reports a new version token and, if C is still dirty, a follow-up save is issued. This section fills in the upload mechanics of that policy, not the policy itself.*

### C7. Save errors
*To fill in: how transient vs permanent failures are distinguished, what the user sees, what retry affordances exist, how partial failures (RTSTRUCT saves but SEG fails) are reported.*

---

## D. Conflict detection and resolution

### D1. Detecting external changes
*To fill in: how the transport learns the server's version has changed for a container (poll? push? on-save check?). Note: real-time push from XNAT is not standard; pragmatic approach likely poll-on-save plus optional periodic poll.*

### D2. Notifying the multi-viewport layer
*To fill in: shape of the version-changed event (H6).*

### D3. Conflict resolution UX
*To fill in: implementation of the H7 prompt — what the dialog says, where "diff or side-by-side" lives if implemented, what defaults are offered, accessibility.*

### D4. Stale-token handling
*To fill in: behavior when a save attempt fails because the in-memory version token is stale (server has moved on) — H5 Conflict outcome.*

---

## E. Lifecycle and session state

### E1. Online / offline
*To fill in: behavior when the network is unavailable mid-session, when XNAT auth expires, when the user explicitly disconnects.*

### E2. Auth-expired during save
*To fill in: what happens to in-flight saves, dirty state preservation, re-auth flow, retry resume.*

### E3. App restart with unsaved state
*To fill in: is unsaved state preserved across app restarts? If so, where and how? If not, how is the user warned before quitting with unsaved containers?*

### E4. Session-level transport status
*To fill in: a session-level status indicator (online / saving / queued / errors), separate from per-container status on D7 list rows.*

---

## F. Mapping: in-memory → DICOM → XNAT

### F1. RTSTRUCT field mapping
*To fill in: which in-memory fields land in which DICOM tags, which are XNAT-side metadata vs in-file, special handling for ROIObservation labels, structure-set labels, dates.*

### F2. SEG field mapping
*To fill in: same for DICOM SEG — segment labels, segment descriptions, segmented property categories, derivation image sequences.*

### F3. Source-series back-references
*To fill in: how RTSTRUCT `ReferencedFrameOfReferenceSequence` and SEG `ReferencedSeriesSequence` are populated, how cross-series authoring (A2b in the multi-viewport doc) is recorded.*

### F4. UID generation
*To fill in: when the transport generates new UIDs (new SOP Instance, possibly new Series Instance), what generator is used (`dcmjs.data.DicomMetaDictionary.uid()` per CLAUDE.md).*

### F5. Round-trip fidelity proof
*To fill in: test plan that proves E4 of the multi-viewport doc holds against a real XNAT round trip — load, no edits, save, reload, byte-equivalent (or DICOM-semantically-equivalent) output.*

---

## G. Out of scope

- Real-time collaborative multi-user editing of the same container (F.1 of multi-viewport doc).
- Non-XNAT backends in v1 (design should leave room without committing).
- DICOMweb STOW-RS / WADO-RS as the primary protocol — XNAT REST is primary, DICOMweb may appear as an underlying detail.

---

## H. Acceptance signals

*To fill in: smoke tests for transport scenarios — basic load, basic save, save-then-edit-then-save, conflict detected on save, conflict detected on external change, network drop mid-save, auth expiry mid-save, large SEG upload, parse failure surfacing.*

---

## Open questions

- **Trigger model for autosave** (C1): the *app-level* autosave debounce is **decided** (design §3.4 — debounced, default 3000 ms, on/off and period user-configurable, silent UX). What remains is transport-side: whether to push on every app-level autosave flush vs. batch/apply an additional idle timer, and how that interacts with H3 (the multi-viewport layer emits the dirty signal; the transport decides cadence).
- ~~**Save-during-edit semantics** (C6): save-then-amend vs queue-next-save.~~ **Resolved: queue-next-save**, per multi-viewport requirements E2 (save-then-amend rejected). C6 fills in only the XNAT mechanics.
- **External-change polling cadence** (D1): on-save only, or periodic? Cost vs staleness tradeoff.
- **Diff/inspect option in conflict UX** (D3): in v1, or deferred?
- **Unsaved state across app restart** (E3): preserve locally, prompt-on-quit, or no preservation?
- **Multi-backend abstraction** (G): how much do we generalize the contract surface to leave room for non-XNAT backends?
