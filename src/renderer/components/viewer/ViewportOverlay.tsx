/**
 * ViewportOverlay — the four-corner DICOM readout drawn over a unified viewport.
 *
 * Presentational: reads the per-panel display state (image index / W-L / zoom)
 * from viewerStore and the per-panel DICOM metadata from metadataStore — both
 * kept live by useViewport's state-sync (viewportService.readViewportState, which
 * reads the correct slice index/total for BOTH stack and volume viewports). No
 * service / Cornerstone imports (§2); components read stores directly.
 *
 * Orientation edge-markers, rulers, and the crosshair reticle are NOT here yet
 * (the reticle rides with the world-point crosshair work, B3).
 *
 * pointer-events-none so it never intercepts viewport interaction.
 */
import { useViewerStore } from '../../stores/viewerStore';
import { useMetadataStore } from '../../stores/metadataStore';
import { EMPTY_OVERLAY } from '@shared/types/dicom';

interface ViewportOverlayProps {
  panelId: string;
}

/** A single overlay text line; renders nothing when the value is empty. */
function Line({ children, testid }: { children: React.ReactNode; testid?: string }): React.ReactElement | null {
  if (children == null || children === '' || children === false) return null;
  return (
    <div data-testid={testid} className="leading-tight">
      {children}
    </div>
  );
}

export default function ViewportOverlay({ panelId }: ViewportOverlayProps): React.ReactElement {
  const vp = useViewerStore((s) => s.viewports[panelId]);
  const overlay = useMetadataStore((s) => s.overlays[panelId]) ?? EMPTY_OVERLAY;

  const imageIndex = vp?.imageIndex ?? 0;
  const totalImages = vp?.totalImages ?? 0;
  const windowWidth = vp?.windowWidth ?? 0;
  const windowCenter = vp?.windowCenter ?? 0;
  const zoomPercent = vp?.zoomPercent ?? 100;

  return (
    <div
      data-testid={`viewport-overlay:${panelId}`}
      className="pointer-events-none absolute inset-0 p-2 flex flex-col justify-between font-mono text-xs text-white [text-shadow:_0_1px_3px_rgb(0_0_0_/_80%)]"
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-4">
        <div className="text-left">
          <Line testid={`overlay-patient-name:${panelId}`}>{overlay.patientName}</Line>
          <Line testid={`overlay-patient-id:${panelId}`}>{overlay.patientId ? `ID: ${overlay.patientId}` : ''}</Line>
          <Line>{overlay.studyDate}</Line>
        </div>
        <div className="text-right">
          <Line testid={`overlay-series-desc:${panelId}`}>{overlay.seriesDescription}</Line>
          <Line>{overlay.seriesNumber ? `Series ${overlay.seriesNumber}` : ''}</Line>
          <Line>{overlay.institutionName}</Line>
        </div>
      </div>

      {/* Bottom row */}
      <div className="flex items-end justify-between gap-4">
        <div className="text-left">
          <Line testid={`overlay-wl:${panelId}`}>{`W: ${windowWidth} L: ${windowCenter}`}</Line>
          <Line testid={`overlay-zoom:${panelId}`}>{`Zoom: ${zoomPercent}%`}</Line>
          <Line>{overlay.sliceLocation ? `Loc: ${overlay.sliceLocation} mm` : ''}</Line>
        </div>
        <div className="text-right">
          <Line testid={`overlay-image-index:${panelId}`}>
            {totalImages > 0 ? `${imageIndex + 1} / ${totalImages}` : ''}
          </Line>
        </div>
      </div>
    </div>
  );
}
