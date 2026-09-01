/**
 * ViewportOverlay — the four-corner DICOM readout drawn over a unified viewport.
 *
 * PREFERENCE-DRIVEN: each corner renders exactly the fields the user enabled in
 * Settings → Overlay (`preferences.overlay.corners`), in their configured order.
 * The whole overlay is gated on `showViewportContextOverlay`. Reads per-panel
 * display state (index / W-L / zoom / transforms) from viewerStore and per-panel
 * DICOM metadata from metadataStore — both kept live by useViewport's state-sync.
 * No service / Cornerstone imports (§2); components read stores directly.
 *
 * Not yet here (separate overlay features): rulers, orientation edge-markers, and
 * the crosshair reticle (the reticle + coords ride with the world-point crosshair,
 * B3 — the `crosshair` field renders only once a crosshair world point exists).
 *
 * pointer-events-none so it never intercepts viewport interaction.
 */
import { useViewerStore } from '../../stores/viewerStore';
import { useMetadataStore } from '../../stores/metadataStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { EMPTY_OVERLAY } from '@shared/types/dicom';
import { DEFAULT_OVERLAY_CORNERS } from '@shared/types/preferences';
import type { OverlayCornerId, OverlayFieldKey } from '@shared/types/preferences';
import type { MPRPlane, DisplayPlane } from '@shared/types/viewer';

interface ViewportOverlayProps {
  panelId: string;
  /**
   * The panel is a 3D volume rendering (C5c). Slice-only readouts are suppressed:
   * a 3D view has no slice index, no slice thickness, no reformat plane to pick and
   * no in-plane patient edge-markers, so showing them (or an orientation dropdown
   * that cannot act) would be a lie about what the panel is.
   */
  render3d?: boolean;
}

/**
 * Standard radiological edge-markers per reformat plane (patient supine). top/bottom
 * are the vertical edges, left/right the horizontal. A=anterior P=posterior R=right
 * L=left S=superior I=inferior. (Non-standard patient positioning + mammography
 * refinements from PatientOrientation are a Phase-2 enhancement.)
 */
const ORIENTATION_LABELS: Record<MPRPlane, { top: string; bottom: string; left: string; right: string }> = {
  AXIAL: { top: 'A', bottom: 'P', left: 'R', right: 'L' },
  SAGITTAL: { top: 'S', bottom: 'I', left: 'A', right: 'P' },
  CORONAL: { top: 'S', bottom: 'I', left: 'R', right: 'L' },
};

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

export default function ViewportOverlay({ panelId, render3d = false }: ViewportOverlayProps): React.ReactElement | null {
  const vp = useViewerStore((s) => s.viewports[panelId]);
  const overlay = useMetadataStore((s) => s.overlays[panelId]) ?? EMPTY_OVERLAY;
  const overlayPrefs = usePreferencesStore((s) => s.preferences.overlay);

  const subjectLabel = useViewerStore(
    (s) => s.panelSubjectLabelMap[panelId] ?? s.panelXnatContextMap[panelId]?.subjectId ?? '',
  );
  const sessionLabel = useViewerStore(
    (s) => s.panelSessionLabelMap[panelId] ?? s.xnatContext?.sessionLabel ?? '',
  );
  const panelScanId = useViewerStore(
    (s) => s.panelScanMap[panelId] ?? s.panelXnatContextMap[panelId]?.scanId ?? '',
  );
  const nativeOrientation = useViewerStore((s) => s.panelNativeOrientationMap[panelId] ?? 'AXIAL');
  const panelOrientation = useViewerStore((s) => s.panelOrientationMap[panelId] ?? 'STACK');
  const crosshairPoint = useViewerStore((s) => s.crosshairWorldPoint);
  const crosshairSourcePanelId = useViewerStore((s) => s.crosshairSourcePanelId);
  const setPanelOrientation = useViewerStore((s) => s.setPanelOrientation);
  const setActiveViewport = useViewerStore((s) => s.setActiveViewport);

  const imageIndex = vp?.imageIndex ?? 0;
  const totalImages = vp?.totalImages ?? 0;

  const showContext = overlayPrefs.showViewportContextOverlay;
  const showMarkers = overlayPrefs.showOrientationMarkers;
  // The corner readouts and the edge-markers have independent toggles; render the
  // overlay shell if either is on (and there's an image).
  if (totalImages <= 0 || (!showContext && !showMarkers)) return null;

  const corners = overlayPrefs.corners ?? DEFAULT_OVERLAY_CORNERS;
  const displayOrientation = panelOrientation === 'STACK' ? nativeOrientation : panelOrientation;
  // The ACQUISITION plane has no fixed anatomical marker set; approximate it with the
  // scan's nearest orthogonal native plane (it's within a few degrees of it).
  const markerPlane = displayOrientation === 'ACQUISITION' ? nativeOrientation : displayOrientation;
  const markers = ORIENTATION_LABELS[markerPlane as MPRPlane] ?? ORIENTATION_LABELS.AXIAL;
  const crosshairText =
    crosshairPoint && (!crosshairSourcePanelId || crosshairSourcePanelId === panelId)
      ? `${crosshairPoint[0].toFixed(1)}, ${crosshairPoint[1].toFixed(1)}, ${crosshairPoint[2].toFixed(1)}`
      : null;

  /**
   * Fields that describe a SLICE. A 3D volume rendering has none of them, so they are
   * suppressed there rather than shown with meaningless values (the capture that
   * prompted this showed "1 / 1", "Thick: 3 mm" and a reformat dropdown on a 3D view).
   */
  const SLICE_ONLY_FIELDS: OverlayFieldKey[] = [
    'orientationSelector',
    'imageIndex',
    'sliceLocation',
    'sliceThickness',
    'windowLevel',
    'dimensions',
  ];

  /** The display string for a field key, or null when there's nothing to show. */
  const fieldText = (field: OverlayFieldKey): string | null => {
    if (render3d && SLICE_ONLY_FIELDS.includes(field)) return null;
    switch (field) {
      case 'orientationSelector':
        return displayOrientation ? titleCase(displayOrientation) : null;
      case 'subjectLabel':
        return subjectLabel || null;
      case 'sessionLabel':
        return sessionLabel || null;
      case 'patientName':
        return overlay.patientName || null;
      case 'patientId':
        return overlay.patientId ? `ID: ${overlay.patientId}` : null;
      case 'studyDate':
        return overlay.studyDate || null;
      case 'institutionName':
        return overlay.institutionName || null;
      case 'seriesDescription':
        return overlay.seriesDescription || null;
      case 'scanId':
        return (overlay.seriesNumber || panelScanId) ? `Scan: ${overlay.seriesNumber || panelScanId}` : null;
      case 'imageIndex':
        return totalImages > 0 ? `${imageIndex + 1} / ${totalImages}` : null;
      case 'sliceLocation':
        return overlay.sliceLocation ? `Loc: ${overlay.sliceLocation} mm` : null;
      case 'sliceThickness':
        return overlay.sliceThickness ? `Thick: ${overlay.sliceThickness} mm` : null;
      case 'windowLevel':
        return `W: ${vp?.windowWidth ?? 0} L: ${vp?.windowCenter ?? 0}`;
      case 'zoom':
        return `Zoom: ${vp?.zoomPercent ?? 100}%`;
      case 'dimensions': {
        const w = overlay.rows || vp?.imageWidth || 0;
        const h = overlay.columns || vp?.imageHeight || 0;
        return w > 0 && h > 0 ? `${w} × ${h}` : null;
      }
      case 'rotation':
        return vp?.rotation ? `Rot: ${vp.rotation}°` : null;
      case 'flip': {
        const parts = [vp?.flipH ? 'FlipH' : '', vp?.flipV ? 'FlipV' : ''].filter(Boolean);
        return parts.length ? parts.join(' / ') : null;
      }
      case 'invert':
        return vp?.invert ? 'Inverted' : null;
      case 'crosshair':
        return crosshairText;
      default:
        return null;
    }
  };

  /** A field's rendered node — an interactive control for orientationSelector, a
   *  text string for everything else, or null when there's nothing to show. */
  const renderField = (field: OverlayFieldKey): React.ReactNode => {
    // 3D: no reformat plane to choose (the dropdown would be inert).
    if (render3d && SLICE_ONLY_FIELDS.includes(field)) return null;
    if (field === 'orientationSelector') {
      // The interactive plane selector: change a volume's reformat plane (axial ⇄
      // sagittal ⇄ coronal). pointer-events-auto (the overlay is pointer-events-none);
      // stop propagation so opening the dropdown doesn't drive viewport tools.
      return (
        <select
          data-testid={`orientation-select:${panelId}`}
          value={displayOrientation}
          disabled={totalImages <= 1}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            setPanelOrientation(panelId, e.target.value as DisplayPlane);
            // Return focus to the viewport so the wheel / arrow keys navigate the
            // image instead of cycling the still-focused dropdown.
            const panel = e.currentTarget.closest('[data-panel-id]') as HTMLElement | null;
            e.currentTarget.blur();
            panel?.focus();
            setActiveViewport(panelId);
          }}
          title="Viewport orientation"
          className="pointer-events-auto bg-zinc-900/85 border border-zinc-700 text-white text-[10px] rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-40"
        >
          <option value="ACQUISITION">Acquisition</option>
          <option value="AXIAL">Axial</option>
          <option value="SAGITTAL">Sagittal</option>
          <option value="CORONAL">Coronal</option>
        </select>
      );
    }
    return fieldText(field);
  };

  const renderCorner = (corner: OverlayCornerId, align: 'left' | 'right') => {
    const fields = corners[corner] ?? [];
    const items = fields
      .map((field) => ({ field, node: renderField(field) }))
      .filter((x) => x.node != null && x.node !== '');
    return (
      <div
        data-testid={`overlay-corner-${corner}:${panelId}`}
        className={`flex flex-col gap-0.5 ${align === 'right' ? 'text-right' : 'text-left'}`}
      >
        {items.map(({ field, node }) => (
          <div key={field} data-testid={`overlay-field-${field}:${panelId}`} className="leading-tight">
            {node}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div data-testid={`viewport-overlay:${panelId}`} className="pointer-events-none absolute inset-0">
      {/* Corner readouts (the four preference-driven field stacks). */}
      {showContext && (
        <div className="absolute inset-0 p-2 flex flex-col justify-between font-mono text-xs text-white [text-shadow:_0_1px_3px_rgb(0_0_0_/_80%)]">
          <div className="flex items-start justify-between gap-4">
            {renderCorner('topLeft', 'left')}
            {renderCorner('topRight', 'right')}
          </div>
          <div className="flex items-end justify-between gap-4">
            {renderCorner('bottomLeft', 'left')}
            {renderCorner('bottomRight', 'right')}
          </div>
        </div>
      )}

      {/* Patient-orientation edge-markers (A/P/R/L/S/I) for the current plane —
          in-plane only, so not on a 3D render. */}
      {showMarkers && !render3d && (
        <div
          data-testid={`overlay-orientation-markers:${panelId}`}
          className="absolute inset-0 text-[11px] font-bold text-zinc-200 [text-shadow:_0_1px_2px_rgb(0_0_0_/_85%)]"
        >
          <span data-testid={`orientation-marker-top:${panelId}`} className="absolute top-1.5 left-1/2 -translate-x-1/2">{markers.top}</span>
          <span data-testid={`orientation-marker-bottom:${panelId}`} className="absolute bottom-1.5 left-1/2 -translate-x-1/2">{markers.bottom}</span>
          <span data-testid={`orientation-marker-left:${panelId}`} className="absolute left-1.5 top-1/2 -translate-y-1/2">{markers.left}</span>
          <span data-testid={`orientation-marker-right:${panelId}`} className="absolute right-1.5 top-1/2 -translate-y-1/2">{markers.right}</span>
        </div>
      )}
    </div>
  );
}
