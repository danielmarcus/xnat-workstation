/**
 * ViewportOverlay — four-corner DICOM metadata overlay plus crosshair guides.
 *
 * Absolute-positioned over the viewport with pointer-events: none
 * so it doesn't interfere with mouse interactions. Reads per-panel state
 * from viewerStore and per-panel metadata from metadataStore.
 */
import { useViewerStore } from '../../stores/viewerStore';
import { useMetadataStore } from '../../stores/metadataStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { EMPTY_OVERLAY } from '@shared/types/dicom';
import type { MPRPlane } from '@shared/types/viewer';
import { ToolName } from '@shared/types/viewer';
import { getPanelDisplayPointForWorld } from '../../lib/cornerstone/crosshairGeometry';

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

function getCrosshairDisplayPoint(
  panelId: string,
  worldPoint: [number, number, number],
): { x: number; y: number; width: number; height: number } | null {
  return getPanelDisplayPointForWorld(panelId, worldPoint);
}

export default function ViewportOverlay({ panelId }: ViewportOverlayProps) {
  const showContextOverlay = useSegmentationStore((s) => s.showViewportContextOverlay);
  const viewport = useViewerStore((s) => s.viewports[panelId] ?? EMPTY_VP);
  const panelOrientation = useViewerStore((s) => s.panelOrientationMap[panelId] ?? 'STACK');
  const nativeOrientation = useViewerStore((s) => s.panelNativeOrientationMap[panelId] ?? 'AXIAL');
  const setPanelOrientation = useViewerStore((s) => s.setPanelOrientation);
  const subjectLabel = useViewerStore(
    (s) =>
      s.panelSubjectLabelMap[panelId]
      ?? s.panelXnatContextMap[panelId]?.subjectId
      ?? s.xnatContext?.subjectId
      ?? '',
  );
  const sessionLabel = useViewerStore(
    (s) => s.panelSessionLabelMap[panelId] ?? s.xnatContext?.sessionLabel ?? '',
  );
  const panelScanId = useViewerStore(
    (s) =>
      s.panelScanMap[panelId]
      ?? s.panelXnatContextMap[panelId]?.scanId
      ?? '',
  );
  const scanSeriesDescription = useViewerStore((s) => {
    const scanId = s.panelScanMap[panelId] ?? s.panelXnatContextMap[panelId]?.scanId;
    if (!scanId) return '';
    const match = (s.sessionScans ?? []).find((scan) => scan.id === scanId);
    return match?.seriesDescription?.trim() ?? '';
  });
  const overlay = useMetadataStore((s) => s.overlays[panelId] ?? EMPTY_OVERLAY);
  const crosshairPoint = useViewerStore((s) => s.crosshairWorldPoint);
  const activeTool = useViewerStore((s) => s.activeTool);
  const displayOrientation: MPRPlane =
    (panelOrientation === 'STACK' ? nativeOrientation : panelOrientation) as MPRPlane;

  if (viewport.totalImages === 0) return null;

  const crosshairGuides =
    activeTool === ToolName.Crosshairs && crosshairPoint
      ? getCrosshairDisplayPoint(panelId, crosshairPoint)
      : null;
  const showCrosshairGuides = crosshairGuides !== null;

  if (!showContextOverlay && !showCrosshairGuides) return null;

  const crosshairText =
    activeTool === ToolName.Crosshairs && crosshairPoint
      ? `${crosshairPoint[0].toFixed(1)}, ${crosshairPoint[1].toFixed(1)}, ${crosshairPoint[2].toFixed(1)}`
      : null;

  return (
    <div className="absolute inset-0 pointer-events-none select-none">
      {showCrosshairGuides && (() => {
        const { x, y, width, height } = crosshairGuides;
        const gap = 12;
        const stroke = 1;
        const color = 'rgba(34, 197, 94, 0.95)';
        const leftWidth = Math.max(0, x - gap);
        const rightStart = Math.min(width, x + gap);
        const rightWidth = Math.max(0, width - rightStart);
        const topHeight = Math.max(0, y - gap);
        const bottomStart = Math.min(height, y + gap);
        const bottomHeight = Math.max(0, height - bottomStart);

        return (
          <div className="absolute inset-0">
            <div
              className="absolute"
              style={{ left: 0, top: `${y - stroke / 2}px`, width: `${leftWidth}px`, height: `${stroke}px`, background: color }}
            />
            <div
              className="absolute"
              style={{ left: `${rightStart}px`, top: `${y - stroke / 2}px`, width: `${rightWidth}px`, height: `${stroke}px`, background: color }}
            />
            <div
              className="absolute"
              style={{ left: `${x - stroke / 2}px`, top: 0, width: `${stroke}px`, height: `${topHeight}px`, background: color }}
            />
            <div
              className="absolute"
              style={{ left: `${x - stroke / 2}px`, top: `${bottomStart}px`, width: `${stroke}px`, height: `${bottomHeight}px`, background: color }}
            />
          </div>
        );
      })()}

      {showContextOverlay && (
        <div className="absolute inset-0 p-2 flex flex-col justify-between font-mono text-xs text-white [text-shadow:_0_1px_3px_rgb(0_0_0_/_80%)]">
          {/* ─── Top Row ───────────────────────────────────────────── */}
          <div className="flex justify-between items-start">
            {/* Top-left: Patient info */}
            <div className="flex flex-col gap-0.5">
              <div className="pointer-events-auto">
                <select
                  value={displayOrientation}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    const next = e.target.value as MPRPlane;
                    setPanelOrientation(panelId, next === nativeOrientation ? 'STACK' : next);
                  }}
                  className="bg-zinc-900/85 border border-zinc-700 text-zinc-200 text-[10px] rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  title="Viewport orientation"
                  disabled={viewport.totalImages <= 1}
                >
                  <option value="AXIAL">Axial</option>
                  <option value="SAGITTAL">Sagittal</option>
                  <option value="CORONAL">Coronal</option>
                </select>
              </div>
              {subjectLabel && <span className="text-zinc-200">{subjectLabel}</span>}
              {sessionLabel && (
                <span className="text-zinc-400">{sessionLabel}</span>
              )}
              {overlay.studyDate && (
                <span className="text-zinc-400">{overlay.studyDate}</span>
              )}
            </div>

            {/* Top-right: Institution / series info */}
            <div className="flex flex-col gap-0.5 items-end">
              {overlay.institutionName && <span>{overlay.institutionName}</span>}
              {(overlay.seriesDescription || scanSeriesDescription) && (
                <span className="text-zinc-300">{overlay.seriesDescription || scanSeriesDescription}</span>
              )}
              {(overlay.seriesNumber || panelScanId) && (
                <span className="text-zinc-400">
                  Scan: {overlay.seriesNumber || panelScanId}
                </span>
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
              {crosshairText && (
                <span className="text-cyan-300">{crosshairText}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
