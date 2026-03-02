/**
 * Shared SVG icon components for the XNAT Workstation UI.
 *
 * All icons are 16×16 viewBox with consistent stroke-based styling.
 * strokeWidth defaults to 1.5 for a clean, modern look.
 */

interface IconProps {
  className?: string;
  size?: number;
}

const defaults = (props: IconProps, defaultSize = 16) => ({
  className: props.className ?? 'w-4 h-4',
  width: props.size ?? defaultSize,
  height: props.size ?? defaultSize,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

// ─── Interaction Tool Icons ───────────────────────────────────────

/** Window/Level — sun with rays */
export function IconWindowLevel(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <circle cx="8" cy="8" r="3" />
      <line x1="8" y1="1.5" x2="8" y2="3.5" />
      <line x1="8" y1="12.5" x2="8" y2="14.5" />
      <line x1="1.5" y1="8" x2="3.5" y2="8" />
      <line x1="12.5" y1="8" x2="14.5" y2="8" />
      <line x1="3.4" y1="3.4" x2="4.8" y2="4.8" />
      <line x1="11.2" y1="11.2" x2="12.6" y2="12.6" />
      <line x1="3.4" y1="12.6" x2="4.8" y2="11.2" />
      <line x1="11.2" y1="4.8" x2="12.6" y2="3.4" />
    </svg>
  );
}

/** Pan — four-directional arrow */
export function IconPan(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <line x1="8" y1="2" x2="8" y2="14" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <polyline points="5,5 8,2 11,5" />
      <polyline points="5,11 8,14 11,11" />
      <polyline points="5,5 2,8 5,11" />
      <polyline points="11,5 14,8 11,11" />
    </svg>
  );
}

/** Zoom — magnifying glass with plus */
export function IconZoom(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.2" y1="10.2" x2="14" y2="14" />
      <line x1="5" y1="7" x2="9" y2="7" />
      <line x1="7" y1="5" x2="7" y2="9" />
    </svg>
  );
}

/** Crosshairs — targeting reticle */
export function IconCrosshairs(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <circle cx="8" cy="8" r="3.25" />
      <line x1="8" y1="1.5" x2="8" y2="4" />
      <line x1="8" y1="12" x2="8" y2="14.5" />
      <line x1="1.5" y1="8" x2="4" y2="8" />
      <line x1="12" y1="8" x2="14.5" y2="8" />
      <circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ─── Action Icons ─────────────────────────────────────────────────

/** Reset — counterclockwise arrow */
export function IconReset(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M3.5 2.5 V6 H7" />
      <path d="M3.5 6 A5.5 5.5 0 1 1 2.5 8" />
    </svg>
  );
}

/** Invert — half-filled circle */
export function IconInvert(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5 A5.5 5.5 0 0 1 8 13.5 Z" fill="currentColor" />
    </svg>
  );
}

/** Rotate 90° — circular arrow */
export function IconRotate90(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M13 8 A5 5 0 1 1 8 3" />
      <polyline points="10,1 13,3 10,5" fill="none" />
    </svg>
  );
}

/** Flip Horizontal — two arrows with vertical line */
export function IconFlipH(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <line x1="8" y1="2" x2="8" y2="14" strokeDasharray="2 1.5" />
      <polyline points="5,5 2,8 5,11" />
      <polyline points="11,5 14,8 11,11" />
    </svg>
  );
}

/** Flip Vertical — two arrows with horizontal line */
export function IconFlipV(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <line x1="2" y1="8" x2="14" y2="8" strokeDasharray="2 1.5" />
      <polyline points="5,5 8,2 11,5" />
      <polyline points="5,11 8,14 11,11" />
    </svg>
  );
}

/** Play — filled right-pointing triangle */
export function IconPlay(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <polygon points="4,2.5 13,8 4,13.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Stop — filled square */
export function IconStop(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <rect x="3" y="3" width="10" height="10" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ─── Header / Navigation Icons ────────────────────────────────────

/** Disconnect — power plug being pulled */
export function IconDisconnect(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <circle cx="8" cy="8" r="5.5" />
      <line x1="8" y1="4" x2="8" y2="6" />
      <path d="M5.5 9.5 A3 3 0 0 0 10.5 9.5" />
    </svg>
  );
}

/** Folder — for browse XNAT */
export function IconFolder(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M2 4.5 V12 A1 1 0 0 0 3 13 H13 A1 1 0 0 0 14 12 V6.5 A1 1 0 0 0 13 5.5 H8.5 L7 4 H3 A1 1 0 0 0 2 4.5 Z" />
    </svg>
  );
}

/** Import file — folder with upward arrow (into folder) */
export function IconOpenFile(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M2 4.5 V12 A1 1 0 0 0 3 13 H13 A1 1 0 0 0 14 12 V6.5 A1 1 0 0 0 13 5.5 H8.5 L7 4 H3 A1 1 0 0 0 2 4.5 Z" />
      <line x1="8" y1="7.5" x2="8" y2="11" />
      <polyline points="6,9 8,7 10,9" />
    </svg>
  );
}

/** Export file — folder with downward arrow (out of folder) */
export function IconExportFile(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M2 4.5 V12 A1 1 0 0 0 3 13 H13 A1 1 0 0 0 14 12 V6.5 A1 1 0 0 0 13 5.5 H8.5 L7 4 H3 A1 1 0 0 0 2 4.5 Z" />
      <line x1="8" y1="7" x2="8" y2="10.5" />
      <polyline points="6,9 8,11 10,9" />
    </svg>
  );
}

/** Chevron down — for dropdowns */
export function IconChevronDown(props: IconProps) {
  const p = defaults(props);
  return (
    <svg {...p} viewBox="0 0 12 12" strokeWidth={2}>
      <polyline points="2,4 6,8 10,4" />
    </svg>
  );
}

/** Grid icon — for Load All */
export function IconGrid4(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <rect x="2" y="2" width="5" height="5" rx="0.5" />
      <rect x="9" y="2" width="5" height="5" rx="0.5" />
      <rect x="2" y="9" width="5" height="5" rx="0.5" />
      <rect x="9" y="9" width="5" height="5" rx="0.5" />
    </svg>
  );
}

// ─── W/L Preset Icon ──────────────────────────────────────────────

/** Sliders — for preset dropdown */
export function IconSliders(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <line x1="3" y1="3" x2="3" y2="13" />
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="13" y1="3" x2="13" y2="13" />
      <circle cx="3" cy="9" r="1.5" fill="currentColor" />
      <circle cx="8" cy="5" r="1.5" fill="currentColor" />
      <circle cx="13" cy="10" r="1.5" fill="currentColor" />
    </svg>
  );
}

// ─── Panel Toggle Icons ───────────────────────────────────────────

/** List icon — for annotation panel toggle */
export function IconList(props: IconProps) {
  return (
    <svg {...defaults(props)} viewBox="0 0 14 14">
      <line x1="3" y1="3" x2="11" y2="3" />
      <line x1="3" y1="7" x2="11" y2="7" />
      <line x1="3" y1="11" x2="11" y2="11" />
    </svg>
  );
}

/** Document icon — for DICOM tags panel */
export function IconDocument(props: IconProps) {
  return (
    <svg {...defaults(props)} viewBox="0 0 14 14">
      <rect x="2" y="1" width="10" height="12" rx="1.5" />
      <line x1="4.5" y1="4" x2="9.5" y2="4" />
      <line x1="4.5" y1="7" x2="9.5" y2="7" />
      <line x1="4.5" y1="10" x2="7.5" y2="10" />
    </svg>
  );
}

// ─── Close / X icon ───────────────────────────────────────────────

export function IconClose(props: IconProps) {
  return (
    <svg {...defaults(props)} viewBox="0 0 14 14">
      <line x1="4" y1="4" x2="10" y2="10" />
      <line x1="10" y1="4" x2="4" y2="10" />
    </svg>
  );
}

// ─── Trash icon — for clear/delete ────────────────────────────────

export function IconTrash(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <polyline points="3,4 4,14 12,14 13,4" />
      <line x1="2" y1="4" x2="14" y2="4" />
      <path d="M6 4 V2.5 A0.5 0.5 0 0 1 6.5 2 H9.5 A0.5 0.5 0 0 1 10 2.5 V4" />
      <line x1="6.5" y1="6.5" x2="6.5" y2="11.5" />
      <line x1="9.5" y1="6.5" x2="9.5" y2="11.5" />
    </svg>
  );
}

// ─── Export icon (already used in ExportDropdown but standardized) ─

export function IconExport(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M8 2 V10" />
      <polyline points="5,7 8,10 11,7" />
      <path d="M2 12 V13 A1 1 0 0 0 3 14 H13 A1 1 0 0 0 14 13 V12" />
    </svg>
  );
}

// ─── Protocol icon ────────────────────────────────────────────────

/** Protocol/template icon */
export function IconProtocol(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <line x1="8" y1="2" x2="8" y2="14" />
      <line x1="2" y1="8" x2="14" y2="8" />
    </svg>
  );
}

// ─── MPR icon ────────────────────────────────────────────────────

/** MPR — three intersecting orthogonal planes */
export function IconMPR(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      {/* Horizontal plane (axial) */}
      <path d="M3 9 L8 12 L13 9 L8 6 Z" />
      {/* Vertical plane (coronal) */}
      <line x1="8" y1="2" x2="8" y2="14" />
      {/* Side plane (sagittal) */}
      <line x1="3" y1="5" x2="13" y2="11" />
    </svg>
  );
}

// ─── Server / XNAT icon ───────────────────────────────────────────

export function IconServer(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <rect x="2" y="2" width="12" height="4" rx="1" />
      <rect x="2" y="10" width="12" height="4" rx="1" />
      <line x1="8" y1="6" x2="8" y2="10" />
      <circle cx="5" cy="4" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ─── Segmentation Icons ──────────────────────────────────────────

/** Brush — paintbrush for segmentation painting */
export function IconBrush(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M10.5 2 L14 5.5 L7 12.5 L3.5 12.5 L3.5 9 Z" />
      <line x1="9" y1="3.5" x2="12.5" y2="7" />
      <path d="M3.5 12.5 Q2 14 2 14 Q2 14 3.5 12.5" fill="currentColor" />
    </svg>
  );
}

/** Eraser — eraser block */
export function IconEraser(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M5 14 L2 11 L9 4 L14 9 L9 14 Z" />
      <line x1="6" y1="7.5" x2="11.5" y2="7.5" strokeDasharray="0" />
      <line x1="5" y1="14" x2="14" y2="14" />
    </svg>
  );
}

/** Segment icon — layered shapes for segmentation panel */
export function IconSegment(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <circle cx="7" cy="7" r="4.5" />
      <circle cx="10" cy="10" r="3.5" strokeDasharray="2 1" />
    </svg>
  );
}

/** Eye — visible */
export function IconEye(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M1 8 C3 4 6 2.5 8 2.5 C10 2.5 13 4 15 8 C13 12 10 13.5 8 13.5 C6 13.5 3 12 1 8 Z" />
      <circle cx="8" cy="8" r="2.5" />
    </svg>
  );
}

/** Eye off — hidden */
export function IconEyeOff(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M1 8 C3 4 6 2.5 8 2.5 C10 2.5 13 4 15 8 C13 12 10 13.5 8 13.5 C6 13.5 3 12 1 8 Z" />
      <circle cx="8" cy="8" r="2.5" />
      <line x1="3" y1="3" x2="13" y2="13" strokeWidth={2} />
    </svg>
  );
}

/** Lock — closed padlock */
export function IconLock(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5 7 V5 A3 3 0 0 1 11 5 V7" />
      <circle cx="8" cy="11" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Lock open — open padlock */
export function IconLockOpen(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5 7 V5 A3 3 0 0 1 11 5" />
      <circle cx="8" cy="11" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Freehand Contour — freehand closed curve */
export function IconFreehandContour(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M4 10 C2 7 3 3 7 3 C11 2 13 5 12 8 C11 11 8 13 5 12 C3.5 11.5 4 10 4 10 Z" fill="none" />
    </svg>
  );
}

/** Spline Contour — smooth curve with control point dots */
export function IconSplineContour(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M4 11 C2 8 4 3 8 3 C12 3 14 8 12 11 C10 14 6 14 4 11 Z" fill="none" />
      <circle cx="4" cy="11" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="3" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Livewire Contour — curve with magnet indicator */
export function IconLivewireContour(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M3 12 C3 6 6 3 10 3" fill="none" />
      <path d="M10 3 C13 3 14 6 13 9" fill="none" strokeDasharray="2 1.5" />
      <circle cx="3" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <path d="M12 11 L14 13 L12 15" fill="none" strokeWidth={1.2} />
      <line x1="10" y1="13" x2="14" y2="13" strokeWidth={1.2} />
    </svg>
  );
}

/** Circle Scissors — circle with scissors cut */
export function IconCircleScissors(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <circle cx="8" cy="8" r="5.5" />
      <line x1="4" y1="4" x2="6.5" y2="6.5" strokeWidth={1.2} />
      <line x1="4" y1="6.5" x2="6.5" y2="4" strokeWidth={1.2} />
    </svg>
  );
}

/** Rectangle Scissors — rectangle with scissors cut */
export function IconRectangleScissors(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <rect x="2.5" y="3" width="11" height="10" rx="0.8" />
      <line x1="4" y1="4.5" x2="6.5" y2="7" strokeWidth={1.2} />
      <line x1="4" y1="7" x2="6.5" y2="4.5" strokeWidth={1.2} />
    </svg>
  );
}

/** Paint Fill — paint bucket */
export function IconPaintFill(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M4 9 L8 3 L12 9 Z" fill="none" />
      <path d="M3 9 C3 12 5 14 8 14 C11 14 13 12 13 9" fill="none" />
      <path d="M13.5 11 C14 12 14.5 12.5 14 13.5 C13.5 14.5 12.5 13.5 13 12.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Sphere Scissors — sphere with scissors cut */
export function IconSphereScissors(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <circle cx="8" cy="8" r="5.5" />
      <ellipse cx="8" cy="8" rx="5.5" ry="3" strokeDasharray="2 1.5" />
      <line x1="4" y1="4" x2="6.5" y2="6.5" strokeWidth={1.2} />
      <line x1="4" y1="6.5" x2="6.5" y2="4" strokeWidth={1.2} />
    </svg>
  );
}

/** Segment Select — cursor pointer with segment circle */
export function IconSegmentSelect(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M3 2 L3 11 L5.5 8.5 L8 13 L10 12 L7.5 7.5 L11 7.5 Z" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="3" strokeDasharray="2 1" />
    </svg>
  );
}

/** Region Segment — growing region with center seed */
export function IconRegionSegment(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <circle cx="8" cy="8" r="3" />
      <circle cx="8" cy="8" r="6" strokeDasharray="2 1.5" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Region Segment Plus — enhanced region with plus indicator */
export function IconRegionSegmentPlus(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <circle cx="7" cy="8" r="3" />
      <circle cx="7" cy="8" r="5.5" strokeDasharray="2 1.5" />
      <circle cx="7" cy="8" r="1" fill="currentColor" stroke="none" />
      <line x1="12" y1="3" x2="12" y2="7" strokeWidth={1.5} />
      <line x1="10" y1="5" x2="14" y2="5" strokeWidth={1.5} />
    </svg>
  );
}

/** Segment Bidirectional — bidirectional measurement on a segment */
export function IconSegmentBidirectional(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <circle cx="8" cy="8" r="5.5" strokeDasharray="2 1.5" />
      <line x1="3.5" y1="8" x2="12.5" y2="8" />
      <line x1="8" y1="4" x2="8" y2="12" />
      <polyline points="5,6.5 3.5,8 5,9.5" />
      <polyline points="11,6.5 12.5,8 11,9.5" />
    </svg>
  );
}

/** Rectangle ROI Threshold — rectangle with threshold gradient */
export function IconRectangleROIThreshold(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <rect x="2.5" y="3" width="11" height="10" rx="0.8" />
      <line x1="5" y1="6" x2="11" y2="6" strokeWidth={1} strokeDasharray="1.5 1" />
      <line x1="5" y1="8.5" x2="11" y2="8.5" strokeWidth={1} />
      <line x1="5" y1="11" x2="11" y2="11" strokeWidth={1} strokeDasharray="1.5 1" />
    </svg>
  );
}

/** Circle ROI Threshold — circle with threshold gradient */
export function IconCircleROIThreshold(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <circle cx="8" cy="8" r="5.5" />
      <line x1="5" y1="6.5" x2="11" y2="6.5" strokeWidth={1} strokeDasharray="1.5 1" />
      <line x1="4" y1="8.5" x2="12" y2="8.5" strokeWidth={1} />
      <line x1="5" y1="10.5" x2="11" y2="10.5" strokeWidth={1} strokeDasharray="1.5 1" />
    </svg>
  );
}

/** Labelmap Edit with Contour — contour drawing on a labelmap */
export function IconLabelmapEditContour(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <rect x="3" y="3" width="10" height="10" rx="1" strokeDasharray="2 1.5" />
      <path d="M5 10 C4 7 6 5 8 5 C10 5 12 7 11 10" fill="none" />
      <circle cx="5" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="11" cy="10" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Sculptor — push/pull arrows on a curve */
export function IconSculptor(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M3 12 C5 8 7 6 8 6 C9 6 11 8 13 12" fill="none" />
      <line x1="8" y1="6" x2="8" y2="2" />
      <polyline points="6,3.5 8,2 10,3.5" />
      <line x1="8" y1="6" x2="8" y2="10" />
      <polyline points="6,8.5 8,10 10,8.5" />
    </svg>
  );
}

/** Plus — for "Add Segment" button */
export function IconPlus(props: IconProps) {
  return (
    <svg {...defaults(props)} viewBox="0 0 14 14">
      <line x1="7" y1="3" x2="7" y2="11" />
      <line x1="3" y1="7" x2="11" y2="7" />
    </svg>
  );
}

/** Segmentation annotation glyph — filled labelmap block */
export function IconSegmentationAnnotation(props: IconProps) {
  return (
    <svg {...defaults(props)} viewBox="0 0 14 14">
      <rect x="2" y="2" width="10" height="10" rx="1.5" />
      <rect x="4.2" y="4.2" width="2.4" height="2.4" fill="currentColor" stroke="none" />
      <rect x="7.4" y="4.2" width="2.4" height="2.4" fill="currentColor" stroke="none" />
      <rect x="4.2" y="7.4" width="2.4" height="2.4" fill="currentColor" stroke="none" />
      <rect x="7.4" y="7.4" width="2.4" height="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Structure annotation glyph — contour/polyline shape */
export function IconStructureAnnotation(props: IconProps) {
  return (
    <svg {...defaults(props)} viewBox="0 0 14 14">
      <path d="M2.4 8.7 C2.1 6.3 3.0 4.2 4.7 3.2 C6.1 2.4 7.9 2.6 9.2 3.6 C10.6 4.7 11.1 6.4 10.8 8.1 C10.5 9.8 9.2 11.2 7.5 11.6 C5.4 12.1 3.2 10.9 2.4 8.7 Z" />
      <circle cx="2.4" cy="8.7" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="4.7" cy="3.2" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="10.8" cy="8.1" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Save — floppy disk icon */
export function IconSave(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M3 2h8l3 3v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
      <path d="M5 2v4h5V2" />
      <rect x="4" y="9" width="8" height="4" rx="0.5" />
    </svg>
  );
}

/** XNAT Logo — official XNAT icon PNG */
import xnatIconUrl from '../assets/xnat-icon.png';

export function XnatLogo({ className, size }: IconProps) {
  const s = size ?? 40;
  return (
    <img
      src={xnatIconUrl}
      alt="XNAT"
      width={s}
      height={s}
      className={className ?? 'w-10 h-10'}
      draggable={false}
    />
  );
}

/** Pin — pushpin icon (filled or outline) */
export function IconPin(props: IconProps & { filled?: boolean }) {
  const p = defaults(props);
  return (
    <svg {...p} fill={props.filled ? 'currentColor' : 'none'}>
      <path d="M9.5 2L13 5.5 9.5 9l-1-1-3 3.5L2 14l2.5-3.5L8 7.5l-1-1z" />
      <line x1="10" y1="6" x2="13" y2="3" />
    </svg>
  );
}

/** Upload — arrow up into cloud */
export function IconUpload(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <polyline points="5.5,6 8,3 10.5,6" />
      <line x1="8" y1="3.5" x2="8" y2="10" />
      <path d="M3 10v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}

/** Download — arrow down into tray */
export function IconDownload(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <polyline points="5.5,10 8,13 10.5,10" />
      <line x1="8" y1="3.5" x2="8" y2="12.5" />
      <path d="M3 10v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}

/** Undo — counter-clockwise arrow */
export function IconUndo(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M4 6h5.5a3.5 3.5 0 0 1 0 7H8" />
      <polyline points="7,3.5 4,6 7,8.5" />
    </svg>
  );
}

/** Redo — clockwise arrow */
export function IconRedo(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <path d="M12 6H6.5a3.5 3.5 0 0 0 0 7H8" />
      <polyline points="9,3.5 12,6 9,8.5" />
    </svg>
  );
}

/** Settings — simple gear icon */
export function IconSettings(props: IconProps) {
  return (
    <svg {...defaults(props)}>
      <circle cx="8" cy="8" r="4.1" />
      <circle cx="8" cy="8" r="1.8" />
      <path d="M8 0.9 V2.5" />
      <path d="M8 13.5 V15.1" />
      <path d="M0.9 8 H2.5" />
      <path d="M13.5 8 H15.1" />
      <path d="M2.9 2.9 L4 4" />
      <path d="M12 12 L13.1 13.1" />
      <path d="M2.9 13.1 L4 12" />
      <path d="M12 4 L13.1 2.9" />
    </svg>
  );
}
