/**
 * ViewportOverlay — four-corner DICOM metadata overlay.
 *
 * Absolute-positioned over the viewport with pointer-events: none
 * so it doesn't interfere with mouse interactions. Reads per-panel state
 * from viewerStore and per-panel metadata from metadataStore.
 */
import { useViewerStore } from '../../stores/viewerStore';
import { useMetadataStore } from '../../stores/metadataStore';
import { EMPTY_OVERLAY } from '@shared/types/dicom';

interface ViewportOverlayProps {
  panelId: string;
}

const EMPTY_VP = {
  totalImages: 0,
  imageIndex: 0,
  requestedImageIndex: null,
  windowWidth: 0,
  windowCenter: 0,
  zoomPercent: 100,
  rotation: 0,
  flipH: false,
  flipV: false,
  invert: false,
  imageWidth: 0,
  imageHeight: 0,
};

export default function ViewportOverlay({ panelId }: ViewportOverlayProps) {
  const viewport = useViewerStore((s) => s.viewports[panelId] ?? EMPTY_VP);
  const sessionLabel = useViewerStore(
    (s) => s.panelSessionLabelMap[panelId] ?? s.xnatContext?.sessionLabel ?? '',
  );
  const overlay = useMetadataStore((s) => s.overlays[panelId] ?? EMPTY_OVERLAY);

  // Don't render if no images loaded
  if (viewport.totalImages === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none p-2 flex flex-col justify-between font-mono text-xs text-white select-none [text-shadow:_0_1px_3px_rgb(0_0_0_/_80%)]">
      {/* ─── Top Row ───────────────────────────────────────────── */}
      <div className="flex justify-between items-start">
        {/* Top-left: Patient info */}
        <div className="flex flex-col gap-0.5">
          {overlay.patientName && <span>{overlay.patientName}</span>}
          {overlay.patientId && (
            <span className="text-zinc-300">{overlay.patientId}</span>
          )}
          {overlay.studyDate && (
            <span className="text-zinc-400">{overlay.studyDate}</span>
          )}
          {sessionLabel && (
            <span className="text-zinc-400">{sessionLabel}</span>
          )}
        </div>

        {/* Top-right: Institution / series info */}
        <div className="flex flex-col gap-0.5 items-end">
          {overlay.institutionName && <span>{overlay.institutionName}</span>}
          {overlay.seriesDescription && (
            <span className="text-zinc-300">{overlay.seriesDescription}</span>
          )}
          {overlay.seriesNumber && (
            <span className="text-zinc-400">Series: {overlay.seriesNumber}</span>
          )}
        </div>
      </div>

      {/* ─── Bottom Row ────────────────────────────────────────── */}
      <div className="flex justify-between items-end">
        {/* Bottom-left: Slice / W/L */}
        <div className="flex flex-col gap-0.5">
          <span>
            Image: {viewport.imageIndex + 1} / {viewport.totalImages}
          </span>
          {overlay.sliceLocation && (
            <span className="text-zinc-300">
              Loc: {overlay.sliceLocation} mm
            </span>
          )}
          {overlay.sliceThickness && (
            <span className="text-zinc-400">
              Thick: {overlay.sliceThickness} mm
            </span>
          )}
          <span className="text-zinc-300">
            W: {viewport.windowWidth} L: {viewport.windowCenter}
          </span>
        </div>

        {/* Bottom-right: Zoom / dimensions */}
        <div className="flex flex-col gap-0.5 items-end">
          <span>Zoom: {viewport.zoomPercent}%</span>
          {(overlay.rows > 0 || viewport.imageWidth > 0) && (
            <span className="text-zinc-300">
              {overlay.rows || viewport.imageWidth} &times;{' '}
              {overlay.columns || viewport.imageHeight}
            </span>
          )}
          {viewport.rotation !== 0 && (
            <span className="text-zinc-400">Rot: {viewport.rotation}&deg;</span>
          )}
          {(viewport.flipH || viewport.flipV) && (
            <span className="text-zinc-400">
              {viewport.flipH && 'FlipH'}
              {viewport.flipH && viewport.flipV && ' / '}
              {viewport.flipV && 'FlipV'}
            </span>
          )}
          {viewport.invert && (
            <span className="text-zinc-400">Inverted</span>
          )}
        </div>
      </div>
    </div>
  );
}
