# Multi-Viewport Annotation & Segmentation: Current Behavior

Audit of how structures (contour annotations) and segmentations behave across multiple open viewports, as of branch `multiviewport-annotation` (off `main`). This is a description of *what exists today*, not a proposal.

## 1. Viewport architecture

- **One `RenderingEngine`** for the whole app (`xnatRenderingEngine`) — [viewportService.ts:17](src/renderer/lib/cornerstone/viewportService.ts:17).
- **One shared tool group** for all viewports (`xnatToolGroup_primary`) — [toolService.ts:73](src/renderer/lib/cornerstone/toolService.ts:73).
- Viewports are keyed by panel ID (`panel_0`, `panel_1`, `mpr_stack`, `axial`, `sagittal`, `coronal`, …).
- Layouts:
  - Stack / 2×2 grid: [ViewportGrid.tsx](src/renderer/components/viewer/ViewportGrid.tsx) — 1–4 panels via CSS grid (`layoutConfig.rows/cols`).
  - MPR: [MPRViewportGrid.tsx](src/renderer/components/viewer/MPRViewportGrid.tsx) — fixed 2×2 with axial/sagittal/coronal + reference stack.
- Active viewport tracked in `useViewerStore.activeViewportId`; click sets it (blue border) — [ViewportGrid.tsx:69](src/renderer/components/viewer/ViewportGrid.tsx:69).
- Lifecycle (mount): `viewportService.createViewport()` → `toolService.addViewport(panelId)` → load images → `segmentationManager.attachVisibleSegmentationsToViewport()` — [CornerstoneViewport.tsx:45-168](src/renderer/components/viewer/CornerstoneViewport.tsx:45). Unmount removes from tool group and destroys viewport.

## 2. Tool group membership

- All annotation + segmentation tools added once at init via `toolService.initialize()` → `addAllTools()` — [toolService.ts:574-605](src/renderer/lib/cornerstone/toolService.ts:574), [toolService.ts:768-796](src/renderer/lib/cornerstone/toolService.ts:768).
- No per-viewport tool group. Adding a viewport: `toolGroup.addViewport(viewportId, ENGINE_ID)` — [toolService.ts:813-836](src/renderer/lib/cornerstone/toolService.ts:813).
- Single global "active tool" (`currentActiveTool` module variable, [toolService.ts:127](src/renderer/lib/cornerstone/toolService.ts:127)). Switching tools **rebuilds the whole tool group** (`rebuildToolGroup()`, [toolService.ts:458-512](src/renderer/lib/cornerstone/toolService.ts:458)) so every viewport sees the same active tool.

## 3. Structures (contour annotations)

### Storage and scoping
- Cornerstone3D owns global annotation state (`csAnnotation.state`).
- Each annotation carries `referencedImageId` + `FrameOfReferenceUID`; spline uses `data.handles.points` + `data.spline.{type,instance}`, freehand uses `data.contour.polyline`.
- Annotations linked to a segmentation via `annotation.data.segmentation.{segmentationId, segmentIndex}` and indexed in `segmentation.representationData.Contour.annotationUIDsMap` (Map<segmentIndex, Set<annotationUID>>) — [contourRepresentation.ts:32-35](src/renderer/lib/cornerstone/contourRepresentation.ts:32).

### Cross-viewport visibility
- Annotations are keyed by `referencedImageId`, **not** by viewport.
- Two viewports on the **same series** → both see the same annotations on the matching slice.
- Two viewports on **different series** (even same study) → independent annotations (different `referencedImageId` set).
- Selection (click-to-select) is filtered to the current viewport's `currentImageId` — [CornerstoneViewport.tsx:362-410](src/renderer/components/viewer/CornerstoneViewport.tsx:362) (line ~382: `referencedImageId !== currentImageId` check). Selection is not synced across viewports.

### Persistence
- Auto-save fires on annotation complete/modify and on segmentation data changes — [segmentationService.ts:1346-1395](src/renderer/lib/cornerstone/segmentationService.ts:1346).
- Writes RTSTRUCT (contours) or SEG (labelmap) DICOM locally; XNAT upload is manual.

## 4. Segmentations

### Attachment model
- Labelmap: `csSegmentation.addLabelmapRepresentationToViewport(viewportId, [{ segmentationId }])` — [segmentationService.ts:2772](src/renderer/lib/cornerstone/segmentationService.ts:2772).
- Contour: `segmentationService.ensureContourRepresentation(viewportId, segId)` — [toolService.ts:1007](src/renderer/lib/cornerstone/toolService.ts:1007).
- Representations are **not** auto-broadcast to all viewports. Attachment is explicit, scoped per viewport.

### Cross-panel auto-attach
- `SegmentationManager.attachSegmentationToPanelsForSource(segId, originPanelId)` — [SegmentationManager.ts:107-139](src/renderer/lib/segmentation/SegmentationManager.ts:107).
- Finds all other panels whose `panelScanMap[panelId]` matches the source scan in the same session and attaches the segmentation there.
- Panels showing different scans stay independent.

### Reconciliation on viewport mount
- `reconcilePanelAfterReady(panelId, sourceScanId, epoch)` — [SegmentationManager.ts:186-225](src/renderer/lib/segmentation/SegmentationManager.ts:186) — re-attaches all previously-loaded segs for that source scan, using `viewportReadyService` with epoch staleness checks.

### Auto-load on scan click
- Optional preference (`useSegmentationStore.autoLoadSegOnScanClick`); handled in `App.tsx`.

## 5. Active viewport / drawing target

- `useViewerStore.activeViewportId` is a single string.
- Cornerstone tool events are viewport-local; the shared tool group routes them through the active tool. Drawing therefore targets whichever viewport the pointer is in — effectively the active one.
- Hotkey service uses `activeViewportId` to scope shortcuts (slice nav, rotate, …) to one panel.
- Lock guard installed per viewport element to block pointer events when the active segment is locked — [toolService.ts:144-156](src/renderer/lib/cornerstone/toolService.ts:144).

## 6. Known gaps / TODOs

1. **Selection sync**: click-select is single-viewport; selecting an annotation in panel A doesn't highlight it in panel B even when both show the same image — [CornerstoneViewport.tsx:362-410](src/renderer/components/viewer/CornerstoneViewport.tsx:362).
2. **Layout/orientation churn**: STACK ↔ volume transitions detach & re-attach representations; if epoch goes stale mid-flight a seg may fail to reattach — [SegmentationManager.ts:186-225](src/renderer/lib/segmentation/SegmentationManager.ts:186).
3. **Image-id scoping**: contours are tied to a specific `referencedImageId`; if two panels load the same series with different initial slice indices, annotations only appear after scrolling to that slice in the second panel.
4. **Contour copy/paste**: `getActiveViewportContextForContourPaste()` targets the active viewport only; no "paste into all viewports of this scan" — [segmentationService.ts:1058-1200](src/renderer/lib/cornerstone/segmentationService.ts:1058).
5. **Auto-save races**: edits in two panels on the same segmentation share one dirty flag and one auto-save target; mid-edit writes are possible — [segmentationService.ts:1305-1395](src/renderer/lib/cornerstone/segmentationService.ts:1305).
6. **Dirty-tracking suppression window**: `removeSegmentationsFromViewport()` mutes dirty tracking for ~1.5s on scan nav; rapid panel switching can mis-classify edits — [SegmentationManager.ts:244](src/renderer/lib/segmentation/SegmentationManager.ts:244).

## File map

| Concern | Path |
|---|---|
| Viewport grid (stack/2×2) | [ViewportGrid.tsx](src/renderer/components/viewer/ViewportGrid.tsx) |
| MPR grid | [MPRViewportGrid.tsx](src/renderer/components/viewer/MPRViewportGrid.tsx) |
| Viewport mount/unmount | [CornerstoneViewport.tsx:45-193](src/renderer/components/viewer/CornerstoneViewport.tsx:45) |
| RenderingEngine, viewport CRUD | [viewportService.ts](src/renderer/lib/cornerstone/viewportService.ts) |
| Tool group, active tool, rebuild | [toolService.ts](src/renderer/lib/cornerstone/toolService.ts) |
| Annotation event sync | [annotationService.ts:97-150](src/renderer/lib/cornerstone/annotationService.ts:97) |
| Seg add/remove on viewport | [segmentationService.ts:2700-2867](src/renderer/lib/cornerstone/segmentationService.ts:2700) |
| Cross-panel seg attach + reconcile | [SegmentationManager.ts:107-225](src/renderer/lib/segmentation/SegmentationManager.ts:107) |
| Contour representation indexing | [contourRepresentation.ts:32-100](src/renderer/lib/cornerstone/contourRepresentation.ts:32) |
| Click-to-select contour | [CornerstoneViewport.tsx:362-430](src/renderer/components/viewer/CornerstoneViewport.tsx:362) |
