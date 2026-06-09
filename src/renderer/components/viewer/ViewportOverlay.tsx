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
import type { MPRPlane } from '@shared/types/viewer';

interface ViewportOverlayProps {
  panelId: string;
}

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}

export default function ViewportOverlay({ panelId }: ViewportOverlayProps): React.ReactElement | null {
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

  const imageIndex = vp?.imageIndex ?? 0;
  const totalImages = vp?.totalImages ?? 0;

  if (!overlayPrefs.showViewportContextOverlay || totalImages <= 0) return null;

  const corners = overlayPrefs.corners ?? DEFAULT_OVERLAY_CORNERS;
  const displayOrientation = panelOrientation === 'STACK' ? nativeOrientation : panelOrientation;
  const crosshairText =
    crosshairPoint && (!crosshairSourcePanelId || crosshairSourcePanelId === panelId)
      ? `${crosshairPoint[0].toFixed(1)}, ${crosshairPoint[1].toFixed(1)}, ${crosshairPoint[2].toFixed(1)}`
      : null;

  /** The display string for a field key, or null when there's nothing to show. */
  const fieldText = (field: OverlayFieldKey): string | null => {
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
            setPanelOrientation(panelId, e.target.value as MPRPlane);
          }}
          title="Viewport orientation"
          className="pointer-events-auto bg-zinc-900/85 border border-zinc-700 text-white text-[10px] rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-40"
        >
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
    <div
      data-testid={`viewport-overlay:${panelId}`}
      className="pointer-events-none absolute inset-0 p-2 flex flex-col justify-between font-mono text-xs text-white [text-shadow:_0_1px_3px_rgb(0_0_0_/_80%)]"
    >
      <div className="flex items-start justify-between gap-4">
        {renderCorner('topLeft', 'left')}
        {renderCorner('topRight', 'right')}
      </div>
      <div className="flex items-end justify-between gap-4">
        {renderCorner('bottomLeft', 'left')}
        {renderCorner('bottomRight', 'right')}
      </div>
    </div>
  );
}
