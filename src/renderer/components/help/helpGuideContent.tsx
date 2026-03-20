/**
 * helpGuideContent — All 18 sections of the Quick Start Guide.
 *
 * Content is plain JSX + Tailwind. Each section is a self-contained block
 * that renders inside the HelpModal's scrollable content area.
 *
 * Source of truth: docs/user-guide.md (user-verified).
 */

// ─── Types ──────────────────────────────────────────────────────

export interface GuideSection {
  id: string;
  title: string;
  group: string;
  content: React.ReactNode;
}

// ─── Group ordering ─────────────────────────────────────────────

export const GUIDE_GROUPS = [
  'Browsing & Navigation',
  'Viewing',
  'Measurements & Export',
  'Segmentation',
  'Settings',
] as const;

// ─── Shared styling helpers ─────────────────────────────────────

const h3 = 'text-xs font-semibold text-zinc-200 mt-3 mb-1.5';
const p = 'text-[11px] text-zinc-400 leading-relaxed';
const ul = 'text-[11px] text-zinc-400 leading-relaxed list-disc list-outside ml-3.5 space-y-1';
const li = ''; // inherit from ul
const bold = 'text-zinc-300 font-medium';
const tip = 'text-[11px] text-blue-300/80 bg-blue-950/30 border border-blue-900/40 rounded px-2.5 py-1.5 mt-2';
const table = 'w-full text-[11px] text-zinc-400 mt-1.5';
const th = 'text-left text-zinc-300 font-medium pb-1.5 pr-3 border-b border-zinc-800';
const td = 'py-1.5 pr-3 border-b border-zinc-800/50 align-top';

// ─── Sections ───────────────────────────────────────────────────

export const GUIDE_SECTIONS: GuideSection[] = [
  // ── Browsing & Navigation ───────────────────────────────────
  {
    id: 'xnat-browser',
    title: 'XNAT Browser',
    group: 'Browsing & Navigation',
    content: (
      <div className="space-y-2">
        <p className={p}>Browse your XNAT repository to find and load scans.</p>

        <h3 className={h3}>Navigation</h3>
        <ul className={ul}>
          <li className={li}>Click a <strong className={bold}>project</strong> to see its subjects, then a <strong className={bold}>subject</strong> to see sessions, then a <strong className={bold}>session</strong> to see scans.</li>
          <li className={li}>Use the <strong className={bold}>breadcrumb</strong> at the top to navigate back to any level.</li>
          <li className={li}>Type in the <strong className={bold}>search bar</strong> to filter items at the current level.</li>
        </ul>

        <h3 className={h3}>Loading Scans</h3>
        <ul className={ul}>
          <li className={li}>Click a scan to load it into the active viewport panel.</li>
          <li className={li}>Drag a scan onto any viewport panel to load it there.</li>
          <li className={li}>Hold <strong className={bold}>Shift</strong> and click a scan to open it in MPR (multi-planar) mode.</li>
        </ul>

        <h3 className={h3}>Bookmarks</h3>
        <ul className={ul}>
          <li className={li}>Hover over a project, subject, or session and click the <strong className={bold}>pin icon</strong> to bookmark it.</li>
          <li className={li}>Access bookmarks from the <strong className={bold}>pin icon</strong> in the toolbar.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'toolbar',
    title: 'Toolbar',
    group: 'Browsing & Navigation',
    content: (
      <div className="space-y-2">
        <p className={p}>The toolbar provides navigation tools, viewport controls, and quick actions.</p>

        <h3 className={h3}>Navigation Tools</h3>
        <ul className={ul}>
          <li className={li}><strong className={bold}>W/L</strong> — Click and drag to adjust window width and level (brightness/contrast).</li>
          <li className={li}><strong className={bold}>Pan</strong> — Click and drag to move the image.</li>
          <li className={li}><strong className={bold}>Zoom</strong> — Click and drag to zoom in or out.</li>
          <li className={li}><strong className={bold}>Crosshairs</strong> — Click to sync slice position across panels. Hold Shift and move for continuous sync.</li>
        </ul>

        <h3 className={h3}>Viewport Actions</h3>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Reset</strong> — Restore the viewport to its original zoom, pan, rotation, and orientation.</li>
          <li className={li}><strong className={bold}>Invert</strong> — Toggle grayscale inversion.</li>
          <li className={li}><strong className={bold}>Rotate 90&deg;</strong> — Rotate the image 90 degrees clockwise.</li>
          <li className={li}><strong className={bold}>Flip H / Flip V</strong> — Flip the image horizontally or vertically.</li>
        </ul>

        <h3 className={h3}>Undo / Redo</h3>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Undo</strong> (Ctrl+Z) — Undo the last segmentation or annotation edit.</li>
          <li className={li}><strong className={bold}>Redo</strong> (Ctrl+Shift+Z) — Redo a previously undone edit.</li>
        </ul>

        <h3 className={h3}>Cine Playback</h3>
        <ul className={ul}>
          <li className={li}>Click <strong className={bold}>Play</strong> to scroll through slices automatically.</li>
          <li className={li}>Adjust the <strong className={bold}>FPS slider</strong> to control playback speed (1&ndash;60 frames per second).</li>
        </ul>
        <p className={tip}>Cine controls are on the far right of the toolbar and may require a wider window to see.</p>
      </div>
    ),
  },
  {
    id: 'layout-mpr',
    title: 'Layout & MPR',
    group: 'Browsing & Navigation',
    content: (
      <div className="space-y-2">
        <h3 className={h3}>Viewport Layout</h3>
        <ul className={ul}>
          <li className={li}>Click the <strong className={bold}>layout button</strong> in the toolbar to choose a grid arrangement: 1&times;1, 1&times;2, 2&times;1, 2&times;2, or a custom grid (up to 8&times;8).</li>
          <li className={li}>Each panel can display a different scan. Drag scans from the XNAT Browser onto panels.</li>
          <li className={li}>Click a panel to make it the <strong className={bold}>active panel</strong> — tools and annotations apply to the active panel.</li>
        </ul>

        <h3 className={h3}>MPR Mode (Multi-Planar Reconstruction)</h3>
        <ul className={ul}>
          <li className={li}>Click <strong className={bold}>MPR</strong> in the toolbar to enter MPR mode.</li>
          <li className={li}>The viewport switches to a fixed 2&times;2 layout: <strong className={bold}>Axial</strong> (top-left), <strong className={bold}>Sagittal</strong> (top-right), <strong className={bold}>Coronal</strong> (bottom-left), and the original <strong className={bold}>Stack</strong> view (bottom-right).</li>
          <li className={li}>Use crosshairs to navigate — clicking in one plane updates the others.</li>
          <li className={li}>Click <strong className={bold}>MPR</strong> again to exit and return to the standard layout.</li>
        </ul>
      </div>
    ),
  },

  // ── Viewing ─────────────────────────────────────────────────
  {
    id: 'viewport',
    title: 'Viewport',
    group: 'Viewing',
    content: (
      <div className="space-y-2">
        <h3 className={h3}>Slice Navigation</h3>
        <ul className={ul}>
          <li className={li}>Scroll the mouse wheel to move through slices.</li>
          <li className={li}>Drag the <strong className={bold}>scroll slider</strong> on the right edge of the viewport.</li>
          <li className={li}>The current slice position is shown as &ldquo;Im: current/total&rdquo; in the overlay.</li>
        </ul>

        <h3 className={h3}>Overlay Information</h3>
        <ul className={ul}>
          <li className={li}>The four corners of the viewport display configurable metadata (patient name, series description, window/level, zoom, etc.).</li>
          <li className={li}>Orientation markers (A/P, R/L, S/I) appear at the viewport edges.</li>
          <li className={li}>Rulers along the bottom and left edges show physical measurements.</li>
          <li className={li}>Overlay fields can be customized in <strong className={bold}>Settings &rarr; Overlay</strong>.</li>
        </ul>

        <h3 className={h3}>Orientation</h3>
        <ul className={ul}>
          <li className={li}>Use the orientation dropdown (in the top-left overlay) to switch between Stack, Axial, Sagittal, and Coronal views.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'wl-presets',
    title: 'W/L Presets',
    group: 'Viewing',
    content: (
      <div className="space-y-2">
        <p className={p}>Quickly apply standard window/level settings optimized for different tissue types.</p>

        <table className={table}>
          <thead>
            <tr>
              <th className={th}>Preset</th>
              <th className={th}>Window</th>
              <th className={th}>Level</th>
              <th className={th}>Best For</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className={td}>CT Soft Tissue</td><td className={td}>400</td><td className={td}>40</td><td className={td}>General soft tissue</td></tr>
            <tr><td className={td}>CT Lung</td><td className={td}>1500</td><td className={td}>-600</td><td className={td}>Lung parenchyma</td></tr>
            <tr><td className={td}>CT Bone</td><td className={td}>2500</td><td className={td}>480</td><td className={td}>Bone structures</td></tr>
            <tr><td className={td}>CT Brain</td><td className={td}>80</td><td className={td}>40</td><td className={td}>Brain tissue</td></tr>
            <tr><td className={td}>CT Abdomen</td><td className={td}>400</td><td className={td}>60</td><td className={td}>Abdominal organs</td></tr>
          </tbody>
        </table>

        <p className={p}>You can also adjust window/level manually by selecting the <strong className={bold}>W/L</strong> tool and dragging on the image.</p>
      </div>
    ),
  },
  {
    id: 'dicom-tags',
    title: 'DICOM Tags',
    group: 'Viewing',
    content: (
      <div className="space-y-2">
        <p className={p}>View the DICOM metadata for the currently displayed image.</p>
        <ul className={ul}>
          <li className={li}>Use the <strong className={bold}>search bar</strong> to find tags by name, tag number, or value.</li>
          <li className={li}>Tags are grouped by DICOM module (Patient, Study, Series, Equipment, etc.). Click a group header to expand or collapse it.</li>
          <li className={li}>Enable <strong className={bold}>Show private tags</strong> to display vendor-specific proprietary tags.</li>
          <li className={li}>Tag numbers are shown in standard DICOM format (e.g., <code className="text-zinc-300 bg-zinc-800 px-1 rounded text-[10px]">(0010,0010)</code> for Patient Name).</li>
        </ul>
      </div>
    ),
  },

  // ── Measurements & Export ───────────────────────────────────
  {
    id: 'measurement-tools',
    title: 'Measurement Tools',
    group: 'Measurements & Export',
    content: (
      <div className="space-y-2">
        <p className={p}>Click <strong className={bold}>Measure</strong> in the toolbar to open the measurement tool menu. Select a tool, then click on the image to place it.</p>

        <table className={table}>
          <thead>
            <tr>
              <th className={th}>Tool</th>
              <th className={th}>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className={td}><strong className={bold}>Length</strong></td><td className={td}>Measure the distance between two points.</td></tr>
            <tr><td className={td}><strong className={bold}>Angle</strong></td><td className={td}>Measure the angle between three points.</td></tr>
            <tr><td className={td}><strong className={bold}>Bidirectional</strong></td><td className={td}>Two perpendicular length measurements (e.g., tumor long and short axis).</td></tr>
            <tr><td className={td}><strong className={bold}>Probe</strong></td><td className={td}>Place a point to read the pixel value (e.g., Hounsfield Units).</td></tr>
            <tr><td className={td}><strong className={bold}>Ellipse ROI</strong></td><td className={td}>Draw an elliptical region and view area, mean, and standard deviation.</td></tr>
            <tr><td className={td}><strong className={bold}>Rectangle ROI</strong></td><td className={td}>Draw a rectangular region with statistics.</td></tr>
            <tr><td className={td}><strong className={bold}>Circle ROI</strong></td><td className={td}>Draw a circular region with statistics.</td></tr>
            <tr><td className={td}><strong className={bold}>Freehand ROI</strong></td><td className={td}>Draw a freehand region with statistics.</td></tr>
            <tr><td className={td}><strong className={bold}>Arrow</strong></td><td className={td}>Place an arrow annotation with an optional text label.</td></tr>
          </tbody>
        </table>

        <p className={p}>Measurements appear as interactive overlays directly on the image. Press <strong className={bold}>O</strong> to open the Annotations list panel on the right, where you can click a measurement to select it or <strong className={bold}>Clear</strong> to remove all. To export measurements as a CSV file, use the <strong className={bold}>Export</strong> button in the toolbar &rarr; <strong className={bold}>Export Annotations</strong>.</p>
      </div>
    ),
  },
  {
    id: 'export',
    title: 'Export',
    group: 'Measurements & Export',
    content: (
      <div className="space-y-2">
        <p className={p}>Click the <strong className={bold}>Export</strong> icon in the toolbar to access export options.</p>

        <table className={table}>
          <thead>
            <tr>
              <th className={th}>Option</th>
              <th className={th}>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className={td}><strong className={bold}>Save as Image</strong></td><td className={td}>Save the current viewport as a PNG or JPEG file, including any visible annotations.</td></tr>
            <tr><td className={td}><strong className={bold}>Copy to Clipboard</strong></td><td className={td}>Copy the current viewport image to the clipboard for pasting into other applications.</td></tr>
            <tr><td className={td}><strong className={bold}>Save All Slices</strong></td><td className={td}>Export every slice in the current stack as individual PNG files.</td></tr>
            <tr><td className={td}><strong className={bold}>Save DICOM File</strong></td><td className={td}>Download the raw DICOM file (.dcm) for the current slice.</td></tr>
            <tr><td className={td}><strong className={bold}>Export Annotations</strong></td><td className={td}>Save all measurement annotations as a CSV report.</td></tr>
          </tbody>
        </table>
      </div>
    ),
  },

  // ── Segmentation ────────────────────────────────────────────
  {
    id: 'seg-overview',
    title: 'Annotations Overview',
    group: 'Segmentation',
    content: (
      <div className="space-y-2">
        <p className={p}>This panel manages your segmentation and structure annotations.</p>

        <h3 className={h3}>Annotation Types</h3>
        <ul className={ul}>
          <li className={li}><strong className={bold}>SEG</strong> (purple badge) — Labelmap segmentation. Paints directly on voxels. Best for filled regions (tumors, organs).</li>
          <li className={li}><strong className={bold}>STRUCT</strong> (green badge) — RT Structure Set. Draws contour outlines. Best for structure delineation.</li>
        </ul>

        <h3 className={h3}>Creating Annotations</h3>
        <ul className={ul}>
          <li className={li}>Click <strong className={bold}>+ SEG</strong> to create a new segmentation, or <strong className={bold}>+ STRUCT</strong> to create a new structure set.</li>
          <li className={li}>Enter a name and click <strong className={bold}>Create</strong>.</li>
        </ul>

        <h3 className={h3}>Loading Existing Annotations</h3>
        <ul className={ul}>
          <li className={li}>Annotations already saved on XNAT appear in the <strong className={bold}>Available</strong> section at the top. Click one to load it.</li>
        </ul>

        <h3 className={h3}>Managing Annotations</h3>
        <ul className={ul}>
          <li className={li}>Click an annotation row to select it and activate its tools.</li>
          <li className={li}>Double-click a label to <strong className={bold}>rename</strong> it.</li>
          <li className={li}>Click the <strong className={bold}>save icon</strong> on a row to save locally or upload to XNAT.</li>
          <li className={li}>Click <strong className={bold}>&times;</strong> to remove an annotation from the viewer.</li>
          <li className={li}>A blue dot next to the name indicates <strong className={bold}>unsaved changes</strong>.</li>
          <li className={li}>Click <strong className={bold}>Save All</strong> to save all modified annotations at once.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'seg-segments',
    title: 'Segments',
    group: 'Segmentation',
    content: (
      <div className="space-y-2">
        <p className={p}>Each annotation contains one or more segments (individual structures or regions).</p>

        <h3 className={h3}>Working with Segments</h3>
        <ul className={ul}>
          <li className={li}>Click a segment row to make it the <strong className={bold}>active segment</strong> — painting tools will apply to this segment.</li>
          <li className={li}>Each segment should represent <strong className={bold}>one anatomical structure</strong> (e.g., &ldquo;Left Lung,&rdquo; &ldquo;Tumor&rdquo;).</li>
          <li className={li}>Click <strong className={bold}>+ Add Segment</strong> (or <strong className={bold}>+ Add Structure</strong> for RTSTRUCT) to add a new segment.</li>
        </ul>

        <h3 className={h3}>Segment Controls</h3>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Color swatch</strong> — Click to change the segment&apos;s display color.</li>
          <li className={li}><strong className={bold}>Eye icon</strong> — Toggle segment visibility on/off.</li>
          <li className={li}><strong className={bold}>Lock icon</strong> — Lock the segment to prevent accidental edits. Unlock to resume editing.</li>
          <li className={li}><strong className={bold}>&times; icon</strong> — Delete the segment.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'seg-labelmap-tools',
    title: 'Labelmap Tools',
    group: 'Segmentation',
    content: (
      <div className="space-y-2">
        <p className={p}>These tools paint directly on the labelmap. Available when a <strong className={bold}>SEG</strong> annotation is selected.</p>

        <h3 className={h3}>Painting Tools</h3>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Brush</strong> — Freehand circular brush. Adjust size with the Brush Size slider.</li>
          <li className={li}><strong className={bold}>Eraser</strong> — Erase painted regions. Same size control as Brush.</li>
          <li className={li}><strong className={bold}>Threshold Brush</strong> — Paints only on pixels within a specified value range (e.g., Hounsfield Units). Set the range in the Threshold Range inputs below the tool grid.</li>
        </ul>

        <h3 className={h3}>Fill Tools</h3>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Circle Scissors</strong> — Draw a circle to fill the enclosed region.</li>
          <li className={li}><strong className={bold}>Rectangle Scissors</strong> — Draw a rectangle to fill the enclosed region.</li>
          <li className={li}><strong className={bold}>Sphere Scissors</strong> — Fill a spherical region in 3D (affects multiple slices).</li>
          <li className={li}><strong className={bold}>Paint Fill</strong> — Flood-fill a connected region of the same value.</li>
          <li className={li}><strong className={bold}>Contour Fill</strong> — Draw a freehand contour outline, which is then filled into the labelmap automatically.</li>
        </ul>

        <h3 className={h3}>Smart Tools</h3>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Region Segment</strong> — Click on a region to auto-segment it using intensity-based region growing.</li>
          <li className={li}><strong className={bold}>Region Segment+</strong> — Enhanced region segmentation with improved boundary detection.</li>
          <li className={li}><strong className={bold}>Rect Threshold</strong> — Draw a rectangle; only pixels within the threshold range are filled.</li>
          <li className={li}><strong className={bold}>Circle Threshold</strong> — Draw a circle; only pixels within the threshold range are filled.</li>
        </ul>

        <h3 className={h3}>Tool Options</h3>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Brush Size</strong> (1&ndash;50 px) — Controls the radius for Brush, Eraser, and Threshold Brush.</li>
          <li className={li}><strong className={bold}>Labelmap Opacity</strong> (0&ndash;100%) — Controls how transparent the segmentation overlay appears.</li>
          <li className={li}><strong className={bold}>Threshold Range</strong> — Set the minimum and maximum pixel values for threshold-based tools.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'seg-contour-tools',
    title: 'Contour Tools',
    group: 'Segmentation',
    content: (
      <div className="space-y-2">
        <p className={p}>These tools draw contour outlines. Available when a <strong className={bold}>STRUCT</strong> (RT Structure Set) annotation is selected.</p>

        <h3 className={h3}>Drawing Tools</h3>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Freehand Contour</strong> — Draw a contour by clicking and dragging freehand.</li>
          <li className={li}><strong className={bold}>Spline Contour</strong> — Place control points; a smooth spline curve connects them. Choose the spline type (Catmull-Rom, Cardinal, B-Spline, or Linear) from the dropdown below.</li>
          <li className={li}><strong className={bold}>Livewire Contour</strong> — Click to place anchor points; the contour automatically snaps to image edges between points.</li>
        </ul>

        <h3 className={h3}>Editing Tools</h3>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Sculptor</strong> — Click and drag on an existing freehand contour to reshape it. For spline or livewire contours, the Sculptor will offer to convert them to freehand first (this is permanent).</li>
        </ul>

        <h3 className={h3}>Tool Options</h3>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Contour Thickness</strong> (1&ndash;8 px) — Line width for contour display.</li>
          <li className={li}><strong className={bold}>Contour Opacity</strong> (5&ndash;100%) — Transparency of contour lines.</li>
          <li className={li}><strong className={bold}>Spline Type</strong> — Curve interpolation method (shown when Spline Contour is active).</li>
        </ul>
      </div>
    ),
  },

  // ── Settings ────────────────────────────────────────────────
  {
    id: 'settings-hotkeys',
    title: 'Hotkeys',
    group: 'Settings',
    content: (
      <div className="space-y-2">
        <p className={p}>Customize keyboard shortcuts for tools and actions.</p>
        <ul className={ul}>
          <li className={li}>Select an <strong className={bold}>action</strong> from the dropdown, choose the <strong className={bold}>key</strong> and any <strong className={bold}>modifier keys</strong> (Ctrl, Shift, Alt, Meta), then click <strong className={bold}>Set Override</strong>.</li>
          <li className={li}>Click <strong className={bold}>Clear Selected</strong> to remove a single override, or <strong className={bold}>Reset Hotkeys</strong> to restore all defaults.</li>
          <li className={li}>Your custom overrides appear in the list below and persist across sessions.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'settings-overlay',
    title: 'Overlay',
    group: 'Settings',
    content: (
      <div className="space-y-2">
        <p className={p}>Configure what information appears on the viewport.</p>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Show viewport context overlay</strong> — Master toggle for all overlay text.</li>
          <li className={li}><strong className={bold}>Show horizontal ruler / Show vertical ruler</strong> — Toggle measurement rulers on viewport edges.</li>
          <li className={li}><strong className={bold}>Show A/P and L/R indicators</strong> — Toggle anatomical orientation markers.</li>
          <li className={li}><strong className={bold}>Corner fields</strong> — For each corner (top-left, top-right, bottom-left, bottom-right), check the metadata fields you want displayed: patient name, study date, series description, window/level, zoom, slice location, and more.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'settings-annotation',
    title: 'Annotation Defaults',
    group: 'Settings',
    content: (
      <div className="space-y-2">
        <p className={p}>Set default appearance and behavior for new annotations.</p>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Default brush size</strong> — Starting brush radius (1&ndash;50 px) for new segments.</li>
          <li className={li}><strong className={bold}>Default contour thickness</strong> — Starting line width (1&ndash;8 px) for new structure contours.</li>
          <li className={li}><strong className={bold}>Default segment opacity</strong> — Starting overlay transparency (0&ndash;100%).</li>
          <li className={li}><strong className={bold}>Default display mask outlines</strong> — Whether to show outlines on labelmap segments by default.</li>
          <li className={li}><strong className={bold}>Automatically display annotations</strong> — When enabled, annotations are shown on the viewport as soon as they are loaded.</li>
          <li className={li}><strong className={bold}>Default color sequence</strong> — Edit the color palette used when adding new segments.</li>
          <li className={li}><strong className={bold}>Scissors default mode</strong> — Whether scissors tools default to &ldquo;Fill&rdquo; or &ldquo;Erase&rdquo; mode.</li>
          <li className={li}><strong className={bold}>Preview toggle / Preview color</strong> — Show a preview overlay when using scissors tools, in the specified color.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'settings-interpolation',
    title: 'Interpolation',
    group: 'Settings',
    content: (
      <div className="space-y-2">
        <p className={p}>When enabled, painting on two or more separated slices will automatically fill the gap slices using the selected algorithm.</p>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Enable between-slice interpolation</strong> — Master toggle. Turn off to disable all automatic gap-filling.</li>
          <li className={li}><strong className={bold}>Algorithm</strong> — Choose the interpolation method:</li>
        </ul>
        <ul className={`${ul} ml-7`}>
          <li className={li}><strong className={bold}>Morphological (Raya-Udupa)</strong> — Classic medical image interpolation. Interpolates inside-distance fields for better volume preservation and shape handling.</li>
          <li className={li}><strong className={bold}>Signed Distance Field (SDF)</strong> — Computes signed distance transforms on each anchor slice and blends them. Good for smooth, rounded structures.</li>
          <li className={li}><strong className={bold}>Linear Blend</strong> — Simple weighted average of anchor masks. Fast but may produce blocky results. Adjust the Blend Threshold slider to control fill aggressiveness.</li>
          <li className={li}><strong className={bold}>Nearest Slice</strong> — Copies the nearest anchor slice into each gap. No shape blending — useful for structures with sharp boundaries.</li>
        </ul>
        <p className={tip}>Interpolation operates per-segment. Keep one anatomical structure per segment for best results.</p>
      </div>
    ),
  },
  {
    id: 'settings-backup',
    title: 'File Backup',
    group: 'Settings',
    content: (
      <div className="space-y-2">
        <p className={p}>Automatically backs up your annotation work to local files at regular intervals.</p>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Enable local file backup</strong> — Master toggle for automatic backups.</li>
          <li className={li}><strong className={bold}>Backup frequency</strong> — How often backups run (5&ndash;120 seconds).</li>
          <li className={li}><strong className={bold}>Cache location</strong> — Where backup files are stored on disk.</li>
        </ul>

        <h3 className={h3}>Deletion Safety</h3>
        <p className={p}>When deleting annotations from XNAT, you can optionally archive the DICOM file to a session resource folder before the scan is removed.</p>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Archive to session resource before deleting</strong> — Enable this checkbox to copy the file to a resource folder before deletion.</li>
          <li className={li}><strong className={bold}>Resource folder name</strong> — The XNAT resource folder where archived copies are stored (defaults to &ldquo;trash&rdquo;).</li>
        </ul>

        <h3 className={h3}>Cached Backups</h3>
        <p className={p}>Lists all locally stored backup files grouped by session. For each entry you can:</p>
        <ul className={ul}>
          <li className={li}><strong className={bold}>Recover</strong> — Restore the backed-up annotation into the viewer.</li>
          <li className={li}><strong className={bold}>Open</strong> — Open the backup file location on disk.</li>
          <li className={li}><strong className={bold}>Delete</strong> — Remove the local backup file.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'settings-issue-report',
    title: 'Issue Report',
    group: 'Settings',
    content: (
      <div className="space-y-2">
        <p className={p}>Generate a diagnostic report to help troubleshoot problems.</p>
        <ul className={ul}>
          <li className={li}>Add any <strong className={bold}>notes</strong> about what you were doing when the issue occurred.</li>
          <li className={li}>Click <strong className={bold}>Refresh Report</strong> to regenerate the system information.</li>
          <li className={li}>Click <strong className={bold}>Copy Report</strong> to copy the full report to your clipboard for sharing with support.</li>
        </ul>
        <p className={p}>The report includes system information, browser details, loaded scans, and current application state.</p>
      </div>
    ),
  },
];
