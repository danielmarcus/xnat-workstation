# Contextual Help Panel Content

Quick start up guide for end users (clinicians/researchers, not developers).

---

## 1. XNAT Browser (Left Sidebar)

**Panel header: XNAT Browser**

Browse your XNAT repository to find and load scans.

**Navigation**
- Click a **project** to see its subjects, then a **subject** to see sessions, then a **session** to see scans.
- Use the **breadcrumb** at the top to navigate back to any level.
- Type in the **search bar** to filter items at the current level.

**Loading Scans**
- Click a scan to load it into the active viewport panel.
- Drag a scan onto any viewport panel to load it there.
- Hold **Shift** and click a scan to open it in MPR (multi-planar) mode.

**Bookmarks**
- Hover over a project, subject, or session and click the **pin icon** to bookmark it.
- Access bookmarks from the **pin icon** in the toolbar.

---

## 2. Toolbar

**Panel header: Toolbar**

The toolbar provides navigation tools, viewport controls, and quick actions.

**Navigation Tools**
- **W/L** — Click and drag to adjust window width and level (brightness/contrast).
- **Pan** — Click and drag to move the image.
- **Zoom** — Click and drag to zoom in or out.
- **Crosshairs** — Click to sync slice position across panels. Hold Shift and move for continuous sync.

**Viewport Actions** (icon buttons, right side)
- **Reset** — Restore the viewport to its original zoom, pan, rotation, and orientation.
- **Invert** — Toggle grayscale inversion.
- **Rotate 90°** — Rotate the image 90 degrees clockwise.
- **Flip H / Flip V** — Flip the image horizontally or vertically.

**Undo / Redo**
- **Undo** (Ctrl+Z) — Undo the last segmentation or annotation edit.
- **Redo** (Ctrl+Shift+Z) — Redo a previously undone edit.

**Cine Playback** (far right of toolbar — may require a wider window to see)
- Click **Play** to scroll through slices automatically.
- Adjust the **FPS slider** to control playback speed (1–60 frames per second).

---

## 3. Layout & MPR

**Panel header: Layout**

**Viewport Layout**
- Click the **layout button** in the toolbar to choose a grid arrangement: 1×1, 1×2, 2×1, 2×2, or a custom grid (up to 8×8).
- Each panel can display a different scan. Drag scans from the XNAT Browser onto panels.
- Click a panel to make it the **active panel** — tools and annotations apply to the active panel.

**MPR Mode** (Multi-Planar Reconstruction)
- Click **MPR** in the toolbar to enter MPR mode.
- The viewport switches to a fixed 2×2 layout: **Axial** (top-left), **Sagittal** (top-right), **Coronal** (bottom-left), and the original **Stack** view (bottom-right).
- Use crosshairs to navigate — clicking in one plane updates the others.
- Click **MPR** again to exit and return to the standard layout.

---

## 4. W/L Presets

**Panel header: Window/Level Presets**

Quickly apply standard window/level settings optimized for different tissue types:

| Preset | Window | Level | Best For |
|--------|--------|-------|----------|
| CT Soft Tissue | 400 | 40 | General soft tissue |
| CT Lung | 1500 | -600 | Lung parenchyma |
| CT Bone | 2500 | 480 | Bone structures |
| CT Brain | 80 | 40 | Brain tissue |
| CT Abdomen | 400 | 60 | Abdominal organs |

You can also adjust window/level manually by selecting the **W/L** tool and dragging on the image.

---

## 5. Measurement Tools

**Panel header: Measure**

Click **Measure** in the toolbar to open the measurement tool menu. Select a tool, then click on the image to place it.

| Tool | Description |
|------|-------------|
| **Length** | Measure the distance between two points. |
| **Angle** | Measure the angle between three points. |
| **Bidirectional** | Two perpendicular length measurements (e.g., tumor long and short axis). |
| **Probe** | Place a point to read the pixel value (e.g., Hounsfield Units). |
| **Ellipse ROI** | Draw an elliptical region and view area, mean, and standard deviation. |
| **Rectangle ROI** | Draw a rectangular region with statistics. |
| **Circle ROI** | Draw a circular region with statistics. |
| **Freehand ROI** | Draw a freehand region with statistics. |
| **Arrow** | Place an arrow annotation with an optional text label. |

Measurements appear as interactive overlays directly on the image. Press **O** to open the Annotations list panel on the right, where you can click a measurement to select it or **Clear** to remove all. To export measurements as a CSV file, use the **Export** button in the toolbar → **Export Annotations**.

---

## 6. Segmentation Panel — Annotations Overview

**Panel header: Annotations**

This panel manages your segmentation and structure annotations.

**Annotation Types**
- **SEG** (purple badge) — Labelmap segmentation. Paints directly on voxels. Best for filled regions (tumors, organs).
- **STRUCT** (green badge) — RT Structure Set. Draws contour outlines. Best for structure delineation.

**Creating Annotations**
- Click **+ SEG** to create a new segmentation, or **+ STRUCT** to create a new structure set.
- Enter a name and click **Create**.

**Loading Existing Annotations**
- Annotations already saved on XNAT appear in the **Available** section at the top. Click one to load it.

**Managing Annotations**
- Click an annotation row to select it and activate its tools.
- Double-click a label to **rename** it.
- Click the **save icon** on a row to save locally or upload to XNAT.
- Click **×** to remove an annotation from the viewer.
- A blue dot next to the name indicates **unsaved changes**.
- Click **Save All** to save all modified annotations at once.

---

## 7. Segmentation Panel — Segments

**Panel header: Segments**

Each annotation contains one or more segments (individual structures or regions).

**Working with Segments**
- Click a segment row to make it the **active segment** — painting tools will apply to this segment.
- Each segment should represent **one anatomical structure** (e.g., "Left Lung," "Tumor").
- Click **+ Add Segment** (or **+ Add Structure** for RTSTRUCT) to add a new segment.

**Segment Controls** (icons on each segment row)
- **Color swatch** — Click to change the segment's display color.
- **Eye icon** — Toggle segment visibility on/off.
- **Lock icon** — Lock the segment to prevent accidental edits. Unlock to resume editing.
- **× icon** — Delete the segment.

---

## 8. Segmentation Panel — SEG Tools

**Panel header: Labelmap Tools**

These tools paint directly on the labelmap. Available when a **SEG** annotation is selected.

**Painting Tools**
- **Brush** — Freehand circular brush. Adjust size with the Brush Size slider.
- **Eraser** — Erase painted regions. Same size control as Brush.
- **Threshold Brush** — Paints only on pixels within a specified value range (e.g., Hounsfield Units). Set the range in the Threshold Range inputs below the tool grid.

**Fill Tools**
- **Circle Scissors** — Draw a circle to fill the enclosed region.
- **Rectangle Scissors** — Draw a rectangle to fill the enclosed region.
- **Sphere Scissors** — Fill a spherical region in 3D (affects multiple slices).
- **Paint Fill** — Flood-fill a connected region of the same value.
- **Contour Fill** — Draw a freehand contour outline, which is then filled into the labelmap automatically.

**Smart Tools**
- **Region Segment** — Click on a region to auto-segment it using intensity-based region growing.
- **Region Segment+** — Enhanced region segmentation with improved boundary detection.
- **Rect Threshold** — Draw a rectangle; only pixels within the threshold range are filled.
- **Circle Threshold** — Draw a circle; only pixels within the threshold range are filled.

**Tool Options**
- **Brush Size** (1–50 px) — Controls the radius for Brush, Eraser, and Threshold Brush.
- **Labelmap Opacity** (0–100%) — Controls how transparent the segmentation overlay appears.
- **Threshold Range** — Set the minimum and maximum pixel values for threshold-based tools.

---

## 9. Segmentation Panel — RTSTRUCT Tools

**Panel header: Contour Tools**

These tools draw contour outlines. Available when a **STRUCT** (RT Structure Set) annotation is selected.

**Drawing Tools**
- **Freehand Contour** — Draw a contour by clicking and dragging freehand.
- **Spline Contour** — Place control points; a smooth spline curve connects them. Choose the spline type (Catmull-Rom, Cardinal, B-Spline, or Linear) from the dropdown below.
- **Livewire Contour** — Click to place anchor points; the contour automatically snaps to image edges between points.

**Editing Tools**
- **Sculptor** — Click and drag on an existing freehand contour to reshape it. For spline or livewire contours, the Sculptor will offer to convert them to freehand first (this is permanent).

**Tool Options**
- **Contour Thickness** (1–8 px) — Line width for contour display.
- **Contour Opacity** (5–100%) — Transparency of contour lines.
- **Spline Type** — Curve interpolation method (shown when Spline Contour is active).

---

## 10. Export Options

**Panel header: Export**

Click the **Export** icon in the toolbar to access export options.

| Option | Description |
|--------|-------------|
| **Save as Image** | Save the current viewport as a PNG or JPEG file, including any visible annotations. |
| **Copy to Clipboard** | Copy the current viewport image to the clipboard for pasting into other applications. |
| **Save All Slices** | Export every slice in the current stack as individual PNG files. |
| **Save DICOM File** | Download the raw DICOM file (.dcm) for the current slice. |
| **Export Annotations** | Save all measurement annotations as a CSV report. |

---

## 11. DICOM Tags Panel

**Panel header: DICOM Tags**

View the DICOM metadata for the currently displayed image.

- Use the **search bar** to find tags by name, tag number, or value.
- Tags are grouped by DICOM module (Patient, Study, Series, Equipment, etc.). Click a group header to expand or collapse it.
- Enable **Show private tags** to display vendor-specific proprietary tags.
- Tag numbers are shown in standard DICOM format (e.g., `(0010,0010)` for Patient Name).

---

## 12. Viewport

**Panel header: Viewport**

**Slice Navigation**
- Scroll the mouse wheel to move through slices.
- Drag the **scroll slider** on the right edge of the viewport.
- The current slice position is shown as "Im: {current}/{total}" in the overlay.

**Overlay Information**
- The four corners of the viewport display configurable metadata (patient name, series description, window/level, zoom, etc.).
- Orientation markers (A/P, R/L, S/I) appear at the viewport edges.
- Rulers along the bottom and left edges show physical measurements.
- Overlay fields can be customized in **Settings → Overlay**.

**Orientation**
- Use the orientation dropdown (in the top-left overlay) to switch between Stack, Axial, Sagittal, and Coronal views.

---

## 13. Settings — Interpolation

**Panel header: Between-Slice Interpolation**

When enabled, painting on two or more separated slices will automatically fill the gap slices using the selected algorithm.

- **Enable between-slice interpolation** — Master toggle. Turn off to disable all automatic gap-filling.
- **Algorithm** — Choose the interpolation method:
  - **Morphological (Raya-Udupa)** — Classic medical image interpolation. Interpolates inside-distance fields for better volume preservation and shape handling.
  - **Signed Distance Field (SDF)** — Computes signed distance transforms on each anchor slice and blends them. Good for smooth, rounded structures.
  - **Linear Blend** — Simple weighted average of anchor masks. Fast but may produce blocky results. Adjust the **Blend Threshold** slider to control fill aggressiveness.
  - **Nearest Slice** — Copies the nearest anchor slice into each gap. No shape blending — useful for structures with sharp boundaries.

**Tip:** Interpolation operates per-segment. Keep one anatomical structure per segment for best results.

---

## 14. Settings — File Backup

**Panel header: Local File Backup**

Automatically backs up your annotation work to local files at regular intervals.

- **Enable local file backup** — Master toggle for automatic backups.
- **Backup frequency** — How often backups run (5–120 seconds).
- **Cache location** — Where backup files are stored on disk.

**Deletion Safety**

When deleting annotations from XNAT, you can optionally archive the DICOM file to a session resource folder before the scan is removed.

- **Archive to session resource before deleting** — Enable this checkbox to copy the file to a resource folder before deletion.
- **Resource folder name** — The XNAT resource folder where archived copies are stored (defaults to "trash").

**Cached Backups** — Lists all locally stored backup files grouped by session. For each entry you can:
- **Recover** — Restore the backed-up annotation into the viewer.
- **Open** — Open the backup file location on disk.
- **Delete** — Remove the local backup file.

---

## 15. Settings — Hotkeys

**Panel header: Keyboard Shortcuts**

Customize keyboard shortcuts for tools and actions.

- Select an **action** from the dropdown, choose the **key** and any **modifier keys** (Ctrl, Shift, Alt, Meta), then click **Set Override**.
- Click **Clear Selected** to remove a single override, or **Reset Hotkeys** to restore all defaults.
- Your custom overrides appear in the list below and persist across sessions.

---

## 16. Settings — Overlay

**Panel header: Viewport Overlay**

Configure what information appears on the viewport.

- **Show viewport context overlay** — Master toggle for all overlay text.
- **Show horizontal ruler / Show vertical ruler** — Toggle measurement rulers on viewport edges.
- **Show A/P and L/R indicators** — Toggle anatomical orientation markers.
- **Corner fields** — For each corner (top-left, top-right, bottom-left, bottom-right), check the metadata fields you want displayed: patient name, study date, series description, window/level, zoom, slice location, and more.

---

## 17. Settings — Annotation Defaults

**Panel header: Annotation Defaults**

Set default appearance and behavior for new annotations.

- **Default brush size** — Starting brush radius (1–50 px) for new segments.
- **Default contour thickness** — Starting line width (1–8 px) for new structure contours.
- **Default segment opacity** — Starting overlay transparency (0–100%).
- **Default display mask outlines** — Whether to show outlines on labelmap segments by default.
- **Automatically display annotations** — When enabled, annotations are shown on the viewport as soon as they are loaded.
- **Default color sequence** — Edit the color palette used when adding new segments.
- **Scissors default mode** — Whether scissors tools default to "Fill" or "Erase" mode.
- **Preview toggle / Preview color** — Show a preview overlay when using scissors tools, in the specified color.

---

## 18. Settings — Issue Report

**Panel header: Issue Report**

Generate a diagnostic report to help troubleshoot problems.

- Add any **notes** about what you were doing when the issue occurred.
- Click **Refresh Report** to regenerate the system information.
- Click **Copy Report** to copy the full report to your clipboard for sharing with support.

The report includes system information, browser details, loaded scans, and current application state.
