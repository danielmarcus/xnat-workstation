/**
 * ViewportOverlay — four-corner DICOM metadata overlay plus crosshair guides.
 *
 * Absolute-positioned over the viewport with pointer-events: none
 * so it doesn't interfere with mouse interactions. Reads per-panel state
 * from viewerStore and per-panel metadata from metadataStore.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { metaData } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import {
  DEFAULT_OVERLAY_CORNERS,
  type OverlayCornerId,
  type OverlayFieldKey,
} from '@shared/types/preferences';
import { useViewerStore } from '../../stores/viewerStore';
import { useMetadataStore } from '../../stores/metadataStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
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

/** Stable empty array to prevent Zustand selector infinite re-render loops. */
const EMPTY_IMAGE_IDS: string[] = [];

function getCrosshairDisplayPoint(
  panelId: string,
  worldPoint: [number, number, number],
): { x: number; y: number; width: number; height: number } | null {
  return getPanelDisplayPointForWorld(panelId, worldPoint);
}

const ORIENTATION_LABELS: Record<MPRPlane, { top: string; bottom: string; left: string; right: string }> = {
  AXIAL: { top: 'A', bottom: 'P', left: 'R', right: 'L' },
  SAGITTAL: { top: 'S', bottom: 'I', left: 'A', right: 'P' },
  CORONAL: { top: 'S', bottom: 'I', left: 'R', right: 'L' },
};
const PIXEL_SPACING_CACHE = new Map<string, { row: number; col: number } | null>();
const PATIENT_ORIENTATION_CACHE = new Map<string, { top: string; bottom: string; left: string; right: string } | null>();

function toWadouriUri(imageId: string): string {
  return imageId.startsWith('wadouri:') ? imageId.slice(8) : imageId;
}

function oppositeOrientationToken(token: string): string {
  const map: Record<string, string> = {
    A: 'P',
    P: 'A',
    R: 'L',
    L: 'R',
    H: 'F',
    F: 'H',
    S: 'I',
    I: 'S',
  };
  return token
    .toUpperCase()
    .split('')
    .map((char) => map[char] ?? '')
    .join('');
}

export function getOrientationMarkersFromPatientOrientation(raw: string): { top: string; bottom: string; left: string; right: string } | null {
  const parts = raw
    .split('\\')
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part.length > 0);
  if (parts.length < 2) return null;
  const vertical = parts[0];
  const horizontal = parts[1];
  const bottom = oppositeOrientationToken(vertical);
  const right = oppositeOrientationToken(horizontal);
  if (!bottom || !right) return null;
  return {
    top: vertical,
    bottom,
    left: horizontal,
    right,
  };
}

function getStringTagValue(dataSet: { string?: (tag: string) => string | undefined } | undefined, tag: string): string {
  return dataSet?.string?.(tag)?.trim() ?? '';
}

export function getCcMammographyOrientationMarkers(
  patientMarkers: { top: string; bottom: string; left: string; right: string } | null,
): { top: string; bottom: string; left: string; right: string } {
  return {
    top: 'H',
    bottom: 'F',
    left: patientMarkers?.left ?? 'L',
    right: patientMarkers?.right ?? 'R',
  };
}

function isMammographyImage(imageId: string | null): boolean {
  if (!imageId) return false;
  try {
    const uri = toWadouriUri(imageId);
    const dataSet = wadouri.dataSetCacheManager.get(uri);
    return getStringTagValue(dataSet, 'x00080060').toUpperCase() === 'MG';
  } catch {
    return false;
  }
}

function getMammographyOrientationMarkers(
  imageId: string | null,
  patientMarkers: { top: string; bottom: string; left: string; right: string } | null,
  seriesDescription: string,
): { top: string; bottom: string; left: string; right: string } | null {
  if (!imageId) return null;

  try {
    const uri = toWadouriUri(imageId);
    const dataSet = wadouri.dataSetCacheManager.get(uri);
    const modality = getStringTagValue(dataSet, 'x00080060').toUpperCase();
    if (modality !== 'MG') return null;

    const viewPosition = getStringTagValue(dataSet, 'x00185101').toUpperCase();
    const normalizedSeriesDescription = seriesDescription.trim().toUpperCase();
    const isCcView =
      viewPosition === 'CC'
      || /\bCC\b/.test(normalizedSeriesDescription)
      || normalizedSeriesDescription.includes('CRANIO-CAUDAL')
      || normalizedSeriesDescription.includes('CRANIO CAUDAL');

    if (isCcView) {
      return getCcMammographyOrientationMarkers(patientMarkers);
    }

    return null;
  } catch {
    return null;
  }
}

function getPatientOrientationMarkers(imageId: string | null): { top: string; bottom: string; left: string; right: string } | null {
  if (!imageId) return null;
  if (PATIENT_ORIENTATION_CACHE.has(imageId)) {
    return PATIENT_ORIENTATION_CACHE.get(imageId) ?? null;
  }

  try {
    const instance = metaData.get('instance', imageId) as
      | { PatientOrientation?: unknown; patientOrientation?: unknown }
      | undefined;
    let raw = instance?.PatientOrientation ?? instance?.patientOrientation;
    if (Array.isArray(raw)) {
      raw = raw.join('\\');
    }
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      const uri = toWadouriUri(imageId);
      const dataSet = wadouri.dataSetCacheManager.get(uri);
      raw = dataSet?.string?.('x00200020');
    }
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      PATIENT_ORIENTATION_CACHE.set(imageId, null);
      return null;
    }

    const markers = getOrientationMarkersFromPatientOrientation(raw);
    if (!markers) {
      PATIENT_ORIENTATION_CACHE.set(imageId, null);
      return null;
    }
    PATIENT_ORIENTATION_CACHE.set(imageId, markers);
    return markers;
  } catch {
    PATIENT_ORIENTATION_CACHE.set(imageId, null);
    return null;
  }
}

function toPositiveNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function getPixelSpacingMm(imageId: string | null): { row: number; col: number } | null {
  if (!imageId) return null;
  if (PIXEL_SPACING_CACHE.has(imageId)) {
    return PIXEL_SPACING_CACHE.get(imageId) ?? null;
  }
  const imagePlane = metaData.get('imagePlaneModule', imageId) as
    | { pixelSpacing?: unknown; rowPixelSpacing?: unknown; columnPixelSpacing?: unknown }
    | undefined;

  let row = toPositiveNumber(imagePlane?.rowPixelSpacing);
  let col = toPositiveNumber(imagePlane?.columnPixelSpacing);

  const spacing = imagePlane?.pixelSpacing;
  if (Array.isArray(spacing)) {
    if (!row) row = toPositiveNumber(spacing[0]);
    if (!col) col = toPositiveNumber(spacing[1] ?? spacing[0]);
  } else {
    const parsed = toPositiveNumber(spacing);
    if (!row) row = parsed;
    if (!col) col = parsed;
  }

  if (!row && !col) {
    PIXEL_SPACING_CACHE.set(imageId, null);
    return null;
  }
  const resolvedSpacing = {
    row: row ?? col ?? 1,
    col: col ?? row ?? 1,
  };
  PIXEL_SPACING_CACHE.set(imageId, resolvedSpacing);
  return resolvedSpacing;
}

function pickNiceMm(rawMm: number): number {
  if (!Number.isFinite(rawMm) || rawMm <= 0) return 0;
  const exponent = Math.floor(Math.log10(rawMm));
  const base = 10 ** exponent;
  const normalized = rawMm / base;
  if (normalized <= 1) return 1 * base;
  if (normalized <= 2) return 2 * base;
  if (normalized <= 5) return 5 * base;
  return 10 * base;
}

function formatLengthMm(mm: number): string {
  if (!Number.isFinite(mm) || mm <= 0) return '';
  if (mm >= 100) return `${(mm / 10).toFixed(mm % 10 === 0 ? 0 : 1)} cm`;
  if (mm >= 10) return `${Math.round(mm)} mm`;
  return `${mm.toFixed(mm >= 1 ? 1 : 2)} mm`;
}

function buildRulerSpec(mmPerDisplayPx: number, maxLengthPx: number, targetLengthPx: number): {
  lengthPx: number;
  label: string;
  tickCount: number;
} | null {
  if (!Number.isFinite(mmPerDisplayPx) || mmPerDisplayPx <= 0) return null;
  if (!Number.isFinite(maxLengthPx) || maxLengthPx <= 30) return null;
  if (!Number.isFinite(targetLengthPx) || targetLengthPx <= 0) return null;

  let lengthMm = pickNiceMm(mmPerDisplayPx * targetLengthPx);
  if (lengthMm <= 0) lengthMm = 50;

  let lengthPx = lengthMm / mmPerDisplayPx;
  while (lengthPx > maxLengthPx && lengthMm > 0.01) {
    let nextLengthMm = pickNiceMm(lengthMm / 2);
    // Guard against non-decreasing "nice" rounding that can stall the loop.
    if (nextLengthMm >= lengthMm) {
      nextLengthMm = lengthMm / 2;
    }
    if (nextLengthMm <= 0) break;
    lengthMm = nextLengthMm;
    lengthPx = lengthMm / mmPerDisplayPx;
  }
  while (lengthPx < 44) {
    let grown = pickNiceMm(lengthMm * 2);
    if (grown <= lengthMm) {
      grown = lengthMm * 2;
    }
    if (!Number.isFinite(grown) || grown <= lengthMm) break;
    const grownPx = grown / mmPerDisplayPx;
    if (grownPx > maxLengthPx) break;
    lengthMm = grown;
    lengthPx = grownPx;
  }

  if (!Number.isFinite(lengthPx) || lengthPx <= 0) return null;

  const tickCount = lengthPx >= 220
    ? 10
    : lengthPx >= 170
      ? 8
      : lengthPx >= 120
        ? 6
        : 4;

  return {
    lengthPx,
    label: formatLengthMm(lengthMm),
    tickCount,
  };
}

export default function ViewportOverlay({ panelId }: ViewportOverlayProps) {
  const showContextOverlayFromLegacyStore = useSegmentationStore((s) => s.showViewportContextOverlay);
  const overlayPrefs = usePreferencesStore((s) => s.preferences.overlay);
  const viewport = useViewerStore((s) => s.viewports[panelId] ?? EMPTY_VP);
  const panelImageIds = useViewerStore((s) => s.panelImageIdsMap[panelId] ?? EMPTY_IMAGE_IDS);
  const panelOrientation = useViewerStore((s) => s.panelOrientationMap[panelId] ?? 'STACK');
  const nativeOrientation = useViewerStore((s) => s.panelNativeOrientationMap[panelId] ?? 'AXIAL');
  const setPanelOrientation = useViewerStore((s) => s.setPanelOrientation);
  const subjectLabel = useViewerStore(
    (s) => {
      // Prefer this panel's explicit label.
      if (s.panelSubjectLabelMap[panelId]) return s.panelSubjectLabelMap[panelId];
      // Fall back to the label from any other panel (same session = same subject).
      const labels = Object.values(s.panelSubjectLabelMap);
      if (labels.length > 0) return labels[0];
      return '';
    },
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
  const crosshairSourcePanelId = useViewerStore((s) => s.crosshairSourcePanelId);
  const crosshairSubjectMismatch = useViewerStore((s) => {
    if (!s.crosshairSourcePanelId || s.crosshairSourcePanelId === panelId) return false;
    const normalize = (v: string | undefined | null) => {
      if (typeof v !== 'string') return null;
      const t = v.trim().toLowerCase();
      return t.length > 0 ? t : null;
    };
    const getSubject = (pid: string) =>
      normalize((s.panelXnatContextMap?.[pid] as { subjectId?: string } | undefined)?.subjectId)
      ?? normalize(s.panelSubjectLabelMap?.[pid]);
    const source = getSubject(s.crosshairSourcePanelId);
    const target = getSubject(panelId);
    return source != null && target != null && source !== target;
  });
  const activeTool = useViewerStore((s) => s.activeTool);
  const displayOrientation: MPRPlane =
    (panelOrientation === 'STACK' ? nativeOrientation : panelOrientation) as MPRPlane;
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const showContextOverlay = overlayPrefs.showViewportContextOverlay && showContextOverlayFromLegacyStore;
  const showHorizontalRuler = overlayPrefs.showHorizontalRuler;
  const showVerticalRuler = overlayPrefs.showVerticalRuler;
  const showOrientationMarkers = overlayPrefs.showOrientationMarkers;
  const cornerFields = overlayPrefs.corners ?? DEFAULT_OVERLAY_CORNERS;

  const crosshairGuides =
    activeTool === ToolName.Crosshairs && crosshairPoint && !crosshairSubjectMismatch
      ? getCrosshairDisplayPoint(panelId, crosshairPoint)
      : null;
  const showCrosshairGuides = crosshairGuides !== null;

  const crosshairText =
    activeTool === ToolName.Crosshairs && crosshairPoint && !crosshairSubjectMismatch
      ? `${crosshairPoint[0].toFixed(1)}, ${crosshairPoint[1].toFixed(1)}, ${crosshairPoint[2].toFixed(1)}`
      : null;

  const currentImageId = useMemo(() => {
    if (panelImageIds.length === 0) return null;
    const requested = viewport.requestedImageIndex;
    const preferred = requested ?? viewport.imageIndex;
    const clamped = Math.max(0, Math.min(panelImageIds.length - 1, preferred));
    return panelImageIds[clamped] ?? null;
  }, [panelImageIds, viewport.imageIndex, viewport.requestedImageIndex]);
  const isMammographyView = useMemo(() => isMammographyImage(currentImageId), [currentImageId]);
  const effectiveShowOrientationMarkers = showOrientationMarkers && !isMammographyView;

  const shouldRenderOverlay =
    viewport.totalImages > 0
    && (
      showContextOverlay
      || showCrosshairGuides
      || showHorizontalRuler
      || showVerticalRuler
      || effectiveShowOrientationMarkers
    );

  useEffect(() => {
    if (!shouldRenderOverlay) return;
    const element = overlayRef.current;
    if (!element) return;
    const updateOverlaySize = () => {
      const nextWidth = element.clientWidth;
      const nextHeight = element.clientHeight;
      setOverlaySize((prev) => (
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight }
      ));
    };
    updateOverlaySize();
    const observer = new ResizeObserver(updateOverlaySize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldRenderOverlay]);

  const rulers = useMemo(() => {
    const showAnyRuler = showHorizontalRuler || showVerticalRuler;
    if (!showAnyRuler) {
      return { horizontal: null, vertical: null };
    }
    if (overlaySize.width <= 0 || overlaySize.height <= 0) {
      return { horizontal: null, vertical: null };
    }

    const imageHeight = viewport.imageHeight > 0
      ? viewport.imageHeight
      : (overlay.rows > 0 ? overlay.rows : overlaySize.height);
    const imageWidth = viewport.imageWidth > 0
      ? viewport.imageWidth
      : (overlay.columns > 0 ? overlay.columns : overlaySize.width);
    const imagePixelSpacing = getPixelSpacingMm(currentImageId) ?? { row: 1, col: 1 };

    const zoomScale = Math.max(0.01, viewport.zoomPercent / 100);
    const fitScale = Math.min(
      overlaySize.width / Math.max(1, imageWidth),
      overlaySize.height / Math.max(1, imageHeight),
    );
    const imageToDisplayScale = fitScale * zoomScale;
    if (!Number.isFinite(imageToDisplayScale) || imageToDisplayScale <= 0) {
      return { horizontal: null, vertical: null };
    }

    const mmPerDisplayPxHorizontal = imagePixelSpacing.col / imageToDisplayScale;
    const mmPerDisplayPxVertical = imagePixelSpacing.row / imageToDisplayScale;
    const maxHorizontal = Math.min(overlaySize.width * 0.38, 280);
    const maxVertical = Math.min(overlaySize.height * 0.38, 220);

    return {
      horizontal: showHorizontalRuler
        ? buildRulerSpec(mmPerDisplayPxHorizontal, maxHorizontal, 160)
        : null,
      vertical: showVerticalRuler
        ? buildRulerSpec(mmPerDisplayPxVertical, maxVertical, 130)
        : null,
    };
  }, [
    currentImageId,
    overlay.columns,
    overlay.rows,
    overlaySize.height,
    overlaySize.width,
    showHorizontalRuler,
    showVerticalRuler,
    viewport.imageHeight,
    viewport.imageWidth,
    viewport.zoomPercent,
  ]);

  const horizontalRuler = rulers.horizontal;
  const verticalRuler = rulers.vertical;
  const orientationMarkers = useMemo(() => {
    if (panelOrientation === 'STACK') {
      const patientMarkers = getPatientOrientationMarkers(currentImageId);
      return getMammographyOrientationMarkers(currentImageId, patientMarkers, overlay.seriesDescription || scanSeriesDescription)
        ?? patientMarkers
        ?? ORIENTATION_LABELS[displayOrientation];
    }
    return ORIENTATION_LABELS[displayOrientation];
  }, [currentImageId, displayOrientation, overlay.seriesDescription, panelOrientation, scanSeriesDescription]);

  const renderField = (field: OverlayFieldKey): React.ReactNode | null => {
    switch (field) {
      case 'orientationSelector':
        if (isMammographyView) return null;
        return (
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
        );
      case 'subjectLabel':
        return subjectLabel ? <span className="text-zinc-200">{subjectLabel}</span> : null;
      case 'sessionLabel':
        return sessionLabel ? <span className="text-zinc-400">{sessionLabel}</span> : null;
      case 'patientName':
        return overlay.patientName ? <span className="text-zinc-200">{overlay.patientName}</span> : null;
      case 'patientId':
        return overlay.patientId ? <span className="text-zinc-400">ID: {overlay.patientId}</span> : null;
      case 'studyDate':
        return overlay.studyDate ? <span className="text-zinc-400">{overlay.studyDate}</span> : null;
      case 'institutionName':
        return overlay.institutionName ? <span>{overlay.institutionName}</span> : null;
      case 'seriesDescription': {
        const value = overlay.seriesDescription || scanSeriesDescription;
        return value ? <span className="text-zinc-300">{value}</span> : null;
      }
      case 'scanId': {
        const value = overlay.seriesNumber || panelScanId;
        return value ? <span className="text-zinc-400">Scan: {value}</span> : null;
      }
      case 'imageIndex':
        return (
          <span>
            Image: {viewport.imageIndex + 1} / {viewport.totalImages}
          </span>
        );
      case 'sliceLocation':
        return overlay.sliceLocation ? <span className="text-zinc-300">Loc: {overlay.sliceLocation} mm</span> : null;
      case 'sliceThickness':
        return overlay.sliceThickness ? <span className="text-zinc-400">Thick: {overlay.sliceThickness} mm</span> : null;
      case 'windowLevel':
        return <span className="text-zinc-300">W: {viewport.windowWidth} L: {viewport.windowCenter}</span>;
      case 'zoom':
        return <span>Zoom: {viewport.zoomPercent}%</span>;
      case 'dimensions':
        return (overlay.rows > 0 || viewport.imageWidth > 0)
          ? (
            <span className="text-zinc-300">
              {overlay.rows || viewport.imageWidth} &times; {overlay.columns || viewport.imageHeight}
            </span>
          )
          : null;
      case 'rotation':
        return viewport.rotation !== 0 ? <span className="text-zinc-400">Rot: {viewport.rotation}&deg;</span> : null;
      case 'flip':
        return (viewport.flipH || viewport.flipV)
          ? (
            <span className="text-zinc-400">
              {viewport.flipH && 'FlipH'}
              {viewport.flipH && viewport.flipV && ' / '}
              {viewport.flipV && 'FlipV'}
            </span>
          )
          : null;
      case 'invert':
        return viewport.invert ? <span className="text-zinc-400">Inverted</span> : null;
      case 'crosshair':
        return crosshairText ? <span className="text-cyan-300">{crosshairText}</span> : null;
      default:
        return null;
    }
  };

  const renderCorner = (corner: OverlayCornerId): React.ReactNode[] => {
    const fields = cornerFields[corner] ?? [];
    const rendered: React.ReactNode[] = [];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const node = renderField(field);
      if (!node) continue;
      rendered.push(<div key={`${corner}:${field}:${i}`}>{node}</div>);
    }
    return rendered;
  };

  if (!shouldRenderOverlay) return null;

  return (
    <div
      ref={overlayRef}
      data-testid={`viewport-overlay:${panelId}`}
      className="absolute inset-0 pointer-events-none select-none"
    >
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
        <div
          data-testid={`viewport-overlay-context:${panelId}`}
          className="absolute inset-0 p-2 flex flex-col justify-between font-mono text-xs text-white [text-shadow:_0_1px_3px_rgb(0_0_0_/_80%)]"
        >
          {/* ─── Top Row ───────────────────────────────────────────── */}
          <div className="flex justify-between items-start">
            {/* Top-left */}
            <div data-testid={`viewport-overlay-corner:topLeft:${panelId}`} className="flex flex-col gap-0.5">
              {renderCorner('topLeft')}
            </div>

            {/* Top-right */}
            <div data-testid={`viewport-overlay-corner:topRight:${panelId}`} className="flex flex-col gap-0.5 items-end">
              {renderCorner('topRight')}
            </div>
          </div>

          {/* ─── Bottom Row ────────────────────────────────────────── */}
          <div className="flex justify-between items-end">
            {/* Bottom-left */}
            <div data-testid={`viewport-overlay-corner:bottomLeft:${panelId}`} className="flex flex-col gap-0.5">
              {renderCorner('bottomLeft')}
            </div>

            {/* Bottom-right */}
            <div data-testid={`viewport-overlay-corner:bottomRight:${panelId}`} className="flex flex-col gap-0.5 items-end">
              {renderCorner('bottomRight')}
            </div>
          </div>
        </div>
      )}

      {effectiveShowOrientationMarkers && (
        <div
          data-testid={`viewport-overlay-orientation:${panelId}`}
          className="absolute inset-0 text-[11px] font-bold text-zinc-300 [text-shadow:_0_1px_2px_rgb(0_0_0_/_80%)]"
        >
          <span className="absolute top-1.5 left-1/2 -translate-x-1/2">{orientationMarkers.top}</span>
          <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2">{orientationMarkers.bottom}</span>
          <span className="absolute left-1.5 top-1/2 -translate-y-1/2">{orientationMarkers.left}</span>
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{orientationMarkers.right}</span>
        </div>
      )}

      {showHorizontalRuler && horizontalRuler && (
        <div
          data-testid={`viewport-overlay-horizontal-ruler:${panelId}`}
          className="absolute left-1/2 -translate-x-1/2 bottom-6 z-20 flex items-center gap-2 text-[11px] text-zinc-200 [text-shadow:_0_1px_2px_rgb(0_0_0_/_85%)]"
        >
          <div className="relative h-3" style={{ width: `${horizontalRuler.lengthPx}px` }}>
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-zinc-200/90" />
            {Array.from({ length: horizontalRuler.tickCount + 1 }, (_, index) => {
              const ratio = horizontalRuler.tickCount > 0 ? (index / horizontalRuler.tickCount) : 0;
              const isMajor =
                index === 0
                || index === horizontalRuler.tickCount
                || index % 2 === 0;
              return (
                <div
                  key={`h-tick-${index}`}
                  className="absolute top-1/2 -translate-y-1/2 w-px bg-zinc-200/90"
                  style={{
                    left: `${ratio * 100}%`,
                    height: `${isMajor ? 9 : 6}px`,
                  }}
                />
              );
            })}
          </div>
          <span className="font-mono">{horizontalRuler.label}</span>
        </div>
      )}

      {showVerticalRuler && verticalRuler && (
        <div
          data-testid={`viewport-overlay-vertical-ruler:${panelId}`}
          className="absolute left-6 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1 text-[11px] text-zinc-200 [text-shadow:_0_1px_2px_rgb(0_0_0_/_85%)]"
        >
          <span className="font-mono">{verticalRuler.label}</span>
          <div className="relative w-3" style={{ height: `${verticalRuler.lengthPx}px` }}>
            <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px bg-zinc-200/90" />
            {Array.from({ length: verticalRuler.tickCount + 1 }, (_, index) => {
              const ratio = verticalRuler.tickCount > 0 ? (index / verticalRuler.tickCount) : 0;
              const isMajor =
                index === 0
                || index === verticalRuler.tickCount
                || index % 2 === 0;
              return (
                <div
                  key={`v-tick-${index}`}
                  className="absolute left-1/2 -translate-x-1/2 h-px bg-zinc-200/90"
                  style={{
                    top: `${ratio * 100}%`,
                    width: `${isMajor ? 9 : 6}px`,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
