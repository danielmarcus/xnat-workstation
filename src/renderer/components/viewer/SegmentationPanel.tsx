/**
 * SegmentationPanel — right-side panel for managing annotation objects and entries.
 */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { metaData } from '@cornerstonejs/core';
import type { XnatScan } from '@shared/types/xnat';
import { useSegmentationStore, type SegmentationDicomType } from '../../stores/segmentationStore';
import { useViewerStore } from '../../stores/viewerStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useSegmentationManagerStore } from '../../stores/segmentationManagerStore';
import {
  useSessionDerivedIndexStore,
  isDerivedScan,
  isSegScan,
  isRtStructScan,
} from '../../stores/sessionDerivedIndexStore';
import { segmentationService } from '../../lib/cornerstone/segmentationService';
import { rtStructService } from '../../lib/cornerstone/rtStructService';
import { toolService } from '../../lib/cornerstone/toolService';
import { segmentationManager } from '../../lib/segmentation/segmentationManagerSingleton';
import { dicomwebLoader } from '../../lib/cornerstone/dicomwebLoader';
import { ToolName, TOOL_DISPLAY_NAMES, SEGMENTATION_TOOLS } from '@shared/types/viewer';
import {
  IconPlus,
  IconSegmentationAnnotation,
  IconStructureAnnotation,
  IconClose,
  IconEye,
  IconEyeOff,
  IconLock,
  IconLockOpen,
  IconSave,
  IconUpload,
  IconBrush,
  IconEraser,
  IconFreehandContour,
  IconSplineContour,
  IconLivewireContour,
  IconCircleScissors,
  IconRectangleScissors,
  IconPaintFill,
  IconSphereScissors,
  IconRegionSegment,
  IconRegionSegmentPlus,
  IconRectangleROIThreshold,
  IconCircleROIThreshold,
  IconLabelmapEditContour,
  IconSculptor,
} from '../icons';

/** Brush-style tools that use brush size */
const BRUSH_SIZE_TOOLS = new Set<string>([
  ToolName.Brush,
  ToolName.Eraser,
  ToolName.ThresholdBrush,
]);

const SEG_PANEL_TOOLS: ToolName[] = [
  ToolName.Brush,
  ToolName.Eraser,
  ToolName.ThresholdBrush,
  ToolName.CircleScissors,
  ToolName.RectangleScissors,
  ToolName.SphereScissors,
  ToolName.PaintFill,
  ToolName.RegionSegment,
  ToolName.RegionSegmentPlus,
  ToolName.RectangleROIThreshold,
  ToolName.CircleROIThreshold,
];

const STRUCT_PANEL_TOOLS: ToolName[] = [
  ToolName.FreehandContour,
  ToolName.SplineContour,
  ToolName.LivewireContour,
  ToolName.Sculptor,
  ToolName.LabelmapEditWithContour,
];

function IconThresholdBrush({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'w-3 h-3 shrink-0'}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.5 2 L14 5.5 L7 12.5 L3.5 12.5 L3.5 9 Z" />
      <line x1="9" y1="3.5" x2="12.5" y2="7" />
      <line x1="5" y1="8" x2="8" y2="11" strokeDasharray="1.5 1.5" />
    </svg>
  );
}

function SegToolIcon({ tool }: { tool: ToolName }) {
  const cls = 'w-3 h-3 shrink-0';
  switch (tool) {
    case ToolName.Brush:
      return <IconBrush className={cls} />;
    case ToolName.Eraser:
      return <IconEraser className={cls} />;
    case ToolName.ThresholdBrush:
      return <IconThresholdBrush className={cls} />;
    case ToolName.FreehandContour:
      return <IconFreehandContour className={cls} />;
    case ToolName.SplineContour:
      return <IconSplineContour className={cls} />;
    case ToolName.LivewireContour:
      return <IconLivewireContour className={cls} />;
    case ToolName.CircleScissors:
      return <IconCircleScissors className={cls} />;
    case ToolName.RectangleScissors:
      return <IconRectangleScissors className={cls} />;
    case ToolName.PaintFill:
      return <IconPaintFill className={cls} />;
    case ToolName.SphereScissors:
      return <IconSphereScissors className={cls} />;
    case ToolName.RegionSegment:
      return <IconRegionSegment className={cls} />;
    case ToolName.RegionSegmentPlus:
      return <IconRegionSegmentPlus className={cls} />;
    case ToolName.RectangleROIThreshold:
      return <IconRectangleROIThreshold className={cls} />;
    case ToolName.CircleROIThreshold:
      return <IconCircleROIThreshold className={cls} />;
    case ToolName.Sculptor:
      return <IconSculptor className={cls} />;
    case ToolName.LabelmapEditWithContour:
      return <IconLabelmapEditContour className={cls} />;
    default:
      return <span className="w-3 h-3 shrink-0 text-[9px] text-center">?</span>;
  }
}

/** Color palette for quick segment color picking */
const COLOR_PALETTE: [number, number, number, number][] = [
  [220, 50, 50, 255],    // Red
  [50, 200, 50, 255],    // Green
  [50, 100, 220, 255],   // Blue
  [230, 200, 40, 255],   // Yellow
  [200, 50, 200, 255],   // Magenta
  [50, 200, 200, 255],   // Cyan
  [240, 140, 40, 255],   // Orange
  [150, 80, 200, 255],   // Purple
  [50, 220, 130, 255],   // Spring Green
  [255, 130, 130, 255],  // Light Red
];

/** Convert RGBA array to CSS rgba() string */
function rgbaStr(c: [number, number, number, number]): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
}

function isSegScanId(scanId: string): boolean {
  return /^3\d+$/.test(scanId);
}

function isRtStructScanId(scanId: string): boolean {
  return /^4\d+$/.test(scanId);
}

function isScanIdCompatibleWithType(scanId: string, type: SegmentationDicomType): boolean {
  return type === 'SEG' ? isSegScanId(scanId) : isRtStructScanId(scanId);
}

function nextVersionedLabel(rawLabel: string): string {
  const trimmed = rawLabel.trim() || 'Annotation';
  const match = trimmed.match(/^(.*?)(?:_(\d+))$/);
  if (!match) {
    return `${trimmed}_01`;
  }
  const stem = (match[1] ?? '').trim() || 'Annotation';
  const current = parseInt(match[2], 10);
  const width = Math.max(2, match[2]?.length ?? 0);
  const next = Number.isFinite(current) ? current + 1 : 1;
  return `${stem}_${String(next).padStart(width, '0')}`;
}

/** Props passed from ViewerPage */
interface SegmentationPanelProps {
  /** Source imageIds from the active viewport panel — needed to create segmentations */
  sourceImageIds: string[];
}

interface AvailableOverlayRow {
  type: 'SEG' | 'RTSTRUCT';
  scanId: string;
  label: string;
  loadedSegmentationId: string | null;
  loadStatus: 'idle' | 'loading' | 'loaded' | 'error';
}

type ExistingSaveDialogResult =
  | { action: 'overwrite' }
  | { action: 'create-new'; label: string }
  | { action: 'cancel' };

interface ExistingSaveDialogState {
  scanId: string;
  dicomType: SegmentationDicomType;
  suggestedLabel: string;
  newLabel: string;
  mode: 'choose' | 'name';
}

interface SegmentNamingDialogState {
  segmentationId: string;
  rowType: SegmentationDicomType;
  defaultName: string;
  value: string;
}

const TYPE_ACCENTS = {
  SEG: {
    text: 'text-purple-300 hover:text-purple-200',
    border: 'border-purple-900/35',
    bgHover: 'hover:bg-purple-900/20',
    badge: 'bg-purple-900/35 text-purple-300',
  },
  RTSTRUCT: {
    text: 'text-emerald-300 hover:text-emerald-200',
    border: 'border-emerald-900/35',
    bgHover: 'hover:bg-emerald-900/20',
    badge: 'bg-emerald-900/35 text-emerald-300',
  },
} as const;

export default function SegmentationPanel({ sourceImageIds }: SegmentationPanelProps) {
  const segmentations = useSegmentationStore((s) => s.segmentations);
  const activeSegId = useSegmentationStore((s) => s.activeSegmentationId);
  const activeSegIndex = useSegmentationStore((s) => s.activeSegmentIndex);
  const fillAlpha = useSegmentationStore((s) => s.fillAlpha);
  const renderOutline = useSegmentationStore((s) => s.renderOutline);
  const contourLineWidth = useSegmentationStore((s) => s.contourLineWidth);
  const contourOpacity = useSegmentationStore((s) => s.contourOpacity);
  const interpolationEnabled = useSegmentationStore((s) => s.interpolationEnabled);
  const brushSize = useSegmentationStore((s) => s.brushSize);
  const activeSegTool = useSegmentationStore((s) => s.activeSegTool);
  const thresholdRange = useSegmentationStore((s) => s.thresholdRange);
  const splineType = useSegmentationStore((s) => s.splineType);
  const setSplineType = useSegmentationStore((s) => s.setSplineType);
  const autoSaveEnabled = useSegmentationStore((s) => s.autoSaveEnabled);
  const autoSaveStatus = useSegmentationStore((s) => s.autoSaveStatus);
  const setAutoSaveEnabled = useSegmentationStore((s) => s.setAutoSaveEnabled);
  const showViewportContextOverlay = useSegmentationStore((s) => s.showViewportContextOverlay);
  const setShowViewportContextOverlay = useSegmentationStore((s) => s.setShowViewportContextOverlay);
  const autoLoadSegOnScanClick = useSegmentationStore((s) => s.autoLoadSegOnScanClick);
  const setAutoLoadSegOnScanClick = useSegmentationStore((s) => s.setAutoLoadSegOnScanClick);
  const xnatOriginMap = useSegmentationStore((s) => s.xnatOriginMap);
  const dicomTypeBySegmentationId = useSegmentationStore((s) => s.dicomTypeBySegmentationId);
  const setDicomType = useSegmentationStore((s) => s.setDicomType);
  const activeTool = useViewerStore((s) => s.activeTool);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const activeViewportId = useViewerStore((s) => s.activeViewportId);
  const panelScanMap = useViewerStore((s) => s.panelScanMap);
  const panelXnatContextMap = useViewerStore((s) => s.panelXnatContextMap);
  const xnatContext = useViewerStore((s) => s.xnatContext);
  const setSessionData = useViewerStore((s) => s.setSessionData);
  const sessionScans = useViewerStore((s) => s.sessionScans);
  const viewerSessionId = useViewerStore((s) => s.sessionId);
  const connectionStatus = useConnectionStore((s) => s.status);
  const sourceSeriesUidByScanId = useSessionDerivedIndexStore((s) => s.sourceSeriesUidByScanId);
  const derivedRefSeriesUidByScanId = useSessionDerivedIndexStore((s) => s.derivedRefSeriesUidByScanId);
  const resolveAssociationsForSession = useSessionDerivedIndexStore((s) => s.resolveAssociationsForSession);

  // Subscribe to manager store slices that affect panel filtering
  const loadedBySourceScan = useSegmentationManagerStore((s) => s.loadedBySourceScan);
  const localOriginBySegId = useSegmentationManagerStore((s) => s.localOriginBySegId);
  const loadStatusByDerivedScan = useSegmentationManagerStore((s) => s.loadStatus);
  const dirtySegIds = useSegmentationManagerStore((s) => s.dirtySegIds);

  const activeSourceScanId = panelScanMap[activeViewportId] ?? null;
  const activePanelXnatContext = panelXnatContextMap[activeViewportId] ?? xnatContext;

  // ─── Filter segmentations by active viewport's source scan ────
  const visibleSegmentationIds = useMemo<Set<string> | null>(() => {
    // No source scan on the active panel (e.g., local file workflows): show all.
    if (!activeSourceScanId) return null;

    const sourceScanId = activeSourceScanId;
    const projectId = activePanelXnatContext?.projectId;
    const sessionId = activePanelXnatContext?.sessionId;
    const allowed = new Set<string>();

    // If panel XNAT context is incomplete, do a conservative source-scan-only
    // fallback instead of session-wide "show all".
    if (!projectId || !sessionId) {
      for (const [segId, origin] of Object.entries(xnatOriginMap)) {
        if (origin.sourceScanId === sourceScanId) {
          allowed.add(segId);
        }
      }
      for (const [sourceKey, loaded] of Object.entries(loadedBySourceScan)) {
        if (!sourceKey.endsWith(`/${sourceScanId}`)) continue;
        for (const info of Object.values(loaded)) {
          allowed.add(info.segmentationId);
        }
      }
      return allowed;
    }

    const compositeKey = `${projectId}/${sessionId}/${sourceScanId}`;

    // 1) Locally created segmentations keyed by composite source key.
    for (const [segId, originKey] of Object.entries(localOriginBySegId)) {
      if (originKey === compositeKey) {
        allowed.add(segId);
      }
    }

    // 2) Loaded overlays tracked by source composite key.
    const loadedForSource = loadedBySourceScan[compositeKey];
    if (loadedForSource) {
      for (const info of Object.values(loadedForSource)) {
        allowed.add(info.segmentationId);
      }
    }

    // 3) Explicit XNAT origin map.
    for (const [segId, origin] of Object.entries(xnatOriginMap)) {
      if (
        origin.sourceScanId === sourceScanId &&
        origin.projectId === projectId &&
        origin.sessionId === sessionId
      ) {
        allowed.add(segId);
      }
    }

    return allowed;
  }, [activePanelXnatContext, activeSourceScanId, loadedBySourceScan, localOriginBySegId, xnatOriginMap]);

  const visibleSegmentations = useMemo(() => {
    if (!visibleSegmentationIds) return segmentations;
    return segmentations.filter((seg) => visibleSegmentationIds.has(seg.segmentationId));
  }, [segmentations, visibleSegmentationIds]);

  const resolveSegRowDicomType = useCallback((segmentationId: string): SegmentationDicomType => {
    const origin = xnatOriginMap[segmentationId];
    const originTypeFromScanId = origin?.scanId
      ? (isRtStructScanId(origin.scanId) ? 'RTSTRUCT' : (isSegScanId(origin.scanId) ? 'SEG' : undefined))
      : undefined;
    return (
      dicomTypeBySegmentationId[segmentationId]
      ?? originTypeFromScanId
      ?? segmentationService.getPreferredDicomType(segmentationId)
    );
  }, [dicomTypeBySegmentationId, xnatOriginMap]);

  const dirtyVisibleSegmentations = useMemo(
    () => visibleSegmentations.filter((seg) => !!dirtySegIds[seg.segmentationId]),
    [dirtySegIds, visibleSegmentations],
  );

  const activeSourceCompositeKey = useMemo(() => {
    if (!activeSourceScanId || !activePanelXnatContext?.projectId || !activePanelXnatContext?.sessionId) {
      return null;
    }
    return `${activePanelXnatContext.projectId}/${activePanelXnatContext.sessionId}/${activeSourceScanId}`;
  }, [activeSourceScanId, activePanelXnatContext]);

  const activeSessionId = activePanelXnatContext?.sessionId ?? null;

  const activeSourceSeriesUid = useMemo(() => {
    if (!activeSourceScanId || !activeSessionId) return null;
    const cached = sourceSeriesUidByScanId[`${activeSessionId}/${activeSourceScanId}`];
    if (cached) return cached;

    for (const imageId of sourceImageIds.slice(0, 3)) {
      const seriesMeta = metaData.get('generalSeriesModule', imageId) as
        | { seriesInstanceUID?: string }
        | undefined;
      if (seriesMeta?.seriesInstanceUID) {
        return seriesMeta.seriesInstanceUID;
      }
    }
    return null;
  }, [activeSourceScanId, activeSessionId, sourceSeriesUidByScanId, sourceImageIds]);

  const activeSessionScans = useMemo<XnatScan[]>(() => {
    if (!activeSessionId) return [];
    if (viewerSessionId !== activeSessionId) return [];
    return sessionScans ?? [];
  }, [activeSessionId, viewerSessionId, sessionScans]);

  const panelUidResolveInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!activeSessionId) return;
    if (!activeSessionScans.some(isDerivedScan)) return;
    if (panelUidResolveInFlightRef.current.has(activeSessionId)) return;

    panelUidResolveInFlightRef.current.add(activeSessionId);

    void resolveAssociationsForSession(
      activeSessionId,
      activeSessionScans,
      (sessionId, scanId) => dicomwebLoader.getScanImageIds(sessionId, scanId),
      async (sessionId, scanId) => {
        const result = await window.electronAPI.xnat.downloadScanFile(sessionId, scanId);
        if (!result.ok || !result.data) {
          throw new Error(result.error || 'Failed to download scan file');
        }
        const binaryString = atob(result.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
      },
    )
      .catch((err) => {
        console.warn(
          `[SegmentationPanel] Failed to resolve derived UID associations for session ${activeSessionId}:`,
          err,
        );
      })
      .finally(() => {
        panelUidResolveInFlightRef.current.delete(activeSessionId);
      });
  }, [activeSessionId, activeSessionScans, resolveAssociationsForSession]);

  const availableOverlays = useMemo<AvailableOverlayRow[]>(() => {
    if (!activeSourceScanId) return [];

    const seen = new Set<string>();
    const rows: AvailableOverlayRow[] = [];

    const loadedForSource = activeSourceCompositeKey
      ? (loadedBySourceScan[activeSourceCompositeKey] ?? {})
      : {};
    const knownSegIds = new Set(segmentations.map((s) => s.segmentationId));

    const pushOverlayRow = (scan: XnatScan, type: 'SEG' | 'RTSTRUCT') => {
      const rowKey = `${type}:${scan.id}`;
      if (seen.has(rowKey)) return;
      seen.add(rowKey);
      const loadedInfo = loadedForSource[scan.id];
      const loadedSegmentationId =
        loadedInfo && knownSegIds.has(loadedInfo.segmentationId)
          ? loadedInfo.segmentationId
          : null;
      rows.push({
        type,
        scanId: scan.id,
        label: scan.seriesDescription || `${type} #${scan.id}`,
        loadedSegmentationId,
        loadStatus: loadStatusByDerivedScan[scan.id] ?? 'idle',
      });
    };

    // Primary path: session-scoped UID matching (robust when scan IDs repeat across sessions).
    if (activeSessionId && activeSourceSeriesUid && activeSessionScans.length > 0) {
      for (const scan of activeSessionScans) {
        if (!isDerivedScan(scan)) continue;
        const refUid = derivedRefSeriesUidByScanId[`${activeSessionId}/${scan.id}`];
        if (!refUid || refUid !== activeSourceSeriesUid) continue;
        if (isSegScan(scan)) pushOverlayRow(scan, 'SEG');
        else if (isRtStructScan(scan)) pushOverlayRow(scan, 'RTSTRUCT');
      }
    }

    return rows;
  }, [
    activeSessionId,
    activeSessionScans,
    activeSourceCompositeKey,
    activeSourceScanId,
    activeSourceSeriesUid,
    derivedRefSeriesUidByScanId,
    loadedBySourceScan,
    loadStatusByDerivedScan,
    segmentations,
  ]);

  const unloadedAvailableOverlays = useMemo(
    () => availableOverlays.filter((overlay) => !overlay.loadedSegmentationId),
    [availableOverlays],
  );

  const setFillAlpha = useSegmentationStore((s) => s.setFillAlpha);
  const setContourLineWidth = useSegmentationStore((s) => s.setContourLineWidth);
  const setContourOpacity = useSegmentationStore((s) => s.setContourOpacity);
  const toggleOutline = useSegmentationStore((s) => s.toggleOutline);
  const setBrushSize = useSegmentationStore((s) => s.setBrushSize);
  const setThresholdRange = useSegmentationStore((s) => s.setThresholdRange);

  // Track which segmentations are expanded
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Color picker state: which segment is being color-picked
  const [colorPickerTarget, setColorPickerTarget] = useState<{
    segmentationId: string;
    segmentIndex: number;
  } | null>(null);

  // Inline label editing state
  const [editingLabel, setEditingLabel] = useState<{
    type: 'segmentation' | 'segment';
    segmentationId: string;
    segmentIndex?: number;
  } | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  // Focus the edit input when it appears
  useEffect(() => {
    if (editingLabel && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingLabel]);

  // Naming dialog state (for creating a new annotation)
  const [namingDialog, setNamingDialog] = useState(false);
  const [namingValue, setNamingValue] = useState('Annotation');
  const [pendingCreateType, setPendingCreateType] = useState<SegmentationDicomType>('SEG');
  const namingInputRef = useRef<HTMLInputElement>(null);
  const [segmentNamingDialog, setSegmentNamingDialog] = useState<SegmentNamingDialogState | null>(null);
  const segmentNamingInputRef = useRef<HTMLInputElement>(null);
  const segmentNamingDialogWasOpenRef = useRef(false);

  // Focus the naming input when it appears
  useEffect(() => {
    if (namingDialog && namingInputRef.current) {
      namingInputRef.current.focus();
      namingInputRef.current.select();
    }
  }, [namingDialog]);

  useEffect(() => {
    const isOpen = segmentNamingDialog !== null;
    if (isOpen && !segmentNamingDialogWasOpenRef.current && segmentNamingInputRef.current) {
      segmentNamingInputRef.current.focus();
      segmentNamingInputRef.current.select();
    }
    segmentNamingDialogWasOpenRef.current = isOpen;
  }, [segmentNamingDialog]);

  // Save menu state
  const [saveMenuOpen, setSaveMenuOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const [existingSaveDialog, setExistingSaveDialog] = useState<ExistingSaveDialogState | null>(null);
  const existingSaveDialogResolverRef = useRef<((result: ExistingSaveDialogResult) => void) | null>(null);
  const existingSaveInputRef = useRef<HTMLInputElement>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Auto-dismiss auto-save "saved" / "error" status after a few seconds
  useEffect(() => {
    if (autoSaveStatus !== 'saved' && autoSaveStatus !== 'error') return;
    const delay = autoSaveStatus === 'saved' ? 3000 : 5000;
    const timer = setTimeout(() => {
      useSegmentationStore.getState()._setAutoSaveStatus('idle');
    }, delay);
    return () => clearTimeout(timer);
  }, [autoSaveStatus]);

  // Close save menu on outside click
  useEffect(() => {
    if (!saveMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target as Node)) {
        setSaveMenuOpen(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [saveMenuOpen]);

  useEffect(() => {
    return () => {
      if (existingSaveDialogResolverRef.current) {
        existingSaveDialogResolverRef.current({ action: 'cancel' });
        existingSaveDialogResolverRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (existingSaveDialog?.mode === 'name' && existingSaveInputRef.current) {
      existingSaveInputRef.current.focus();
      existingSaveInputRef.current.select();
    }
  }, [existingSaveDialog?.mode]);

  useEffect(() => {
    segmentationService.updateContourStyle(contourLineWidth);
  }, [contourLineWidth, contourOpacity]);

  // ─── Handlers ─────────────────────────────────────────────────

  const openAddAnnotationDialog = useCallback((type: SegmentationDicomType) => {
    if (sourceImageIds.length === 0) return;
    setPendingCreateType(type);
    setNamingValue(type === 'RTSTRUCT' ? 'Structure' : 'Segmentation');
    setNamingDialog(true);
  }, [sourceImageIds]);

  const confirmAddAnnotation = useCallback(async () => {
    const name = namingValue.trim();
    if (!name) return;
    setNamingDialog(false);
    try {
      const segId = pendingCreateType === 'RTSTRUCT'
        ? await segmentationManager.createNewStructure(activeViewportId, sourceImageIds, name)
        : await segmentationManager.createNewSegmentation(activeViewportId, sourceImageIds, name);
      setDicomType(segId, pendingCreateType);
      // Auto-expand the new segmentation
      setExpandedIds((prev) => new Set(prev).add(segId));
      // Track the source scan ID so auto-save targets the correct scan even
      // if the user switches panels/scans before the auto-save fires.
      // scanId='' means "not yet saved to XNAT" (distinguished from loaded SEGs).
      const currentScanId = panelScanMap[activeViewportId] ?? activePanelXnatContext?.scanId;
      if (currentScanId && activePanelXnatContext?.projectId && activePanelXnatContext?.sessionId) {
        useSegmentationStore.getState().setXnatOrigin(segId, {
          scanId: '',
          sourceScanId: currentScanId,
          projectId: activePanelXnatContext.projectId,
          sessionId: activePanelXnatContext.sessionId,
        });
      }
    } catch (err) {
      console.error('[SegmentationPanel] Failed to create annotation:', err);
      setToast({ message: `Failed to create annotation: ${err instanceof Error ? err.message : 'Unknown error'}`, type: 'error' });
    }
  }, [namingValue, sourceImageIds, activeViewportId, xnatContext, activePanelXnatContext, panelScanMap, setDicomType, pendingCreateType]);

  const cancelAddAnnotation = useCallback(() => {
    setNamingDialog(false);
  }, []);

  const handleAddSegment = useCallback((segmentationId: string, rowType: SegmentationDicomType) => {
    const storeType = useSegmentationStore.getState().dicomTypeBySegmentationId[segmentationId];
    if (!storeType || storeType !== rowType) {
      useSegmentationStore.getState().setDicomType(segmentationId, rowType);
    }

    const segSummary = useSegmentationStore.getState().segmentations.find((s) => s.segmentationId === segmentationId);
    const nextIndex = ((segSummary?.segments.reduce((m, s) => Math.max(m, s.segmentIndex), 0) ?? 0) + 1);
    const defaultName = rowType === 'RTSTRUCT'
      ? `Structure ${nextIndex}`
      : `Segment ${nextIndex}`;
    setSegmentNamingDialog({
      segmentationId,
      rowType,
      defaultName,
      value: defaultName,
    });
  }, []);

  const confirmAddSegment = useCallback(() => {
    if (!segmentNamingDialog) return;
    const finalName = segmentNamingDialog.value.trim();
    if (!finalName) {
      setToast({ message: 'Name is required', type: 'error' });
      return;
    }
    segmentationManager.addSegment(segmentNamingDialog.segmentationId, finalName);
    setSegmentNamingDialog(null);
  }, [segmentNamingDialog]);

  const cancelAddSegment = useCallback(() => {
    setSegmentNamingDialog(null);
  }, []);

  const handleRemoveSegmentation = useCallback((segId: string) => {
    segmentationManager.removeSegmentation(segId);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(segId);
      return next;
    });
  }, []);

  const handleToggleExpand = useCallback((segId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(segId)) next.delete(segId);
      else next.add(segId);
      return next;
    });
  }, []);

  const handleSelectSegmentationRow = useCallback((segmentationId: string) => {
    const segSummary = useSegmentationStore
      .getState()
      .segmentations
      .find((s) => s.segmentationId === segmentationId);
    const firstSegmentIndex = segSummary?.segments.find((s) => Number.isInteger(s.segmentIndex) && s.segmentIndex > 0)?.segmentIndex ?? 0;
    setColorPickerTarget(null);
    segmentationManager.userSelectedSegmentation(activeViewportId, segmentationId, firstSegmentIndex);
    setExpandedIds((prev) => new Set(prev).add(segmentationId));
  }, [activeViewportId]);

  const handleSelectSegment = useCallback((segmentationId: string, segmentIndex: number) => {
    if (!Number.isFinite(segmentIndex) || !Number.isInteger(segmentIndex) || segmentIndex < 0) return;
    segmentationManager.userSelectedSegmentation(activeViewportId, segmentationId, segmentIndex);
  }, [activeViewportId]);

  const handleFillAlphaChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      setFillAlpha(val);
      segmentationService.updateStyle(val, useSegmentationStore.getState().renderOutline);
    },
    [setFillAlpha],
  );

  const handleBrushSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      setBrushSize(val);
      segmentationService.setBrushSize(val);
    },
    [setBrushSize],
  );

  const handleOutlineToggle = useCallback(() => {
    const store = useSegmentationStore.getState();
    const nextOutline = !store.renderOutline;
    toggleOutline();
    segmentationService.updateStyle(store.fillAlpha, nextOutline);
  }, [toggleOutline]);

  const handleContourLineWidthChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseInt(e.target.value, 10);
      const width = Number.isFinite(val) ? Math.max(1, Math.min(8, val)) : 2;
      setContourLineWidth(width);
      segmentationService.updateContourStyle(width);
    },
    [setContourLineWidth],
  );

  const handleContourOpacityChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value);
      const opacity = Number.isFinite(val) ? Math.max(0.05, Math.min(1, val)) : 1;
      setContourOpacity(opacity);
      segmentationService.updateContourStyle();
    },
    [setContourOpacity],
  );

  const handleInterpolationToggle = useCallback((enabled: boolean) => {
    toolService.setInterpolationEnabled(enabled);
  }, []);

  const handleColorSelect = useCallback(
    (color: [number, number, number, number]) => {
      if (!colorPickerTarget) return;
      // Use manager to update color + persist in presentation cache
      segmentationManager.userChangedSegmentColor(
        colorPickerTarget.segmentationId,
        colorPickerTarget.segmentIndex,
        color,
      );
      setColorPickerTarget(null);
    },
    [colorPickerTarget],
  );

  // ─── Inline label editing ──────────────────────────────────

  const startEditLabel = useCallback(
    (type: 'segmentation' | 'segment', segmentationId: string, currentLabel: string, segmentIndex?: number) => {
      setEditingLabel({ type, segmentationId, segmentIndex });
      setEditingValue(currentLabel);
    },
    [],
  );

  const commitEditLabel = useCallback(() => {
    if (!editingLabel) return;
    const trimmed = editingValue.trim();
    if (trimmed.length === 0) {
      // Don't allow empty labels — cancel edit
      setEditingLabel(null);
      return;
    }
    if (editingLabel.type === 'segmentation') {
      segmentationManager.renameSegmentation(editingLabel.segmentationId, trimmed);
    } else if (editingLabel.type === 'segment' && editingLabel.segmentIndex != null) {
      segmentationManager.renameSegment(editingLabel.segmentationId, editingLabel.segmentIndex, trimmed);
    }
    setEditingLabel(null);
  }, [editingLabel, editingValue]);

  const cancelEditLabel = useCallback(() => {
    setEditingLabel(null);
  }, []);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEditLabel();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEditLabel();
      }
    },
    [commitEditLabel, cancelEditLabel],
  );

  // ─── Save / Export Handlers ──────────────────────────────────

  const exportDicomByType = useCallback(
    async (segmentationId: string, dicomType: SegmentationDicomType): Promise<string> => {
      return dicomType === 'RTSTRUCT'
        ? rtStructService.exportToRtStruct(segmentationId)
        : segmentationManager.exportToDicomSeg(segmentationId);
    },
    [],
  );

  const saveDicomByType = useCallback(
    async (dicomType: SegmentationDicomType, base64: string, defaultName: string) => {
      return dicomType === 'RTSTRUCT'
        ? window.electronAPI.export.saveDicomRtStruct(base64, defaultName)
        : window.electronAPI.export.saveDicomSeg(base64, defaultName);
    },
    [],
  );

  const getErrorMessage = useCallback((err: unknown, fallback: string): string => {
    if (err instanceof Error && typeof err.message === 'string' && err.message.length > 0) {
      return err.message;
    }
    if (typeof err === 'string' && err.length > 0) {
      return err;
    }
    if (err && typeof err === 'object') {
      const anyErr = err as { message?: unknown; error?: { message?: unknown } };
      if (typeof anyErr.message === 'string' && anyErr.message.length > 0) {
        return anyErr.message;
      }
      if (typeof anyErr.error?.message === 'string' && anyErr.error.message.length > 0) {
        return anyErr.error.message;
      }
      try {
        const json = JSON.stringify(err);
        if (json && json !== '{}') return json;
      } catch {
        // no-op
      }
    }
    return fallback;
  }, []);

  const suggestNextAnnotationLabel = useCallback(async (
    sessionId: string,
    baseLabel: string,
  ): Promise<string> => {
    const scans = await window.electronAPI.xnat.getScans(sessionId);
    const existing = new Set(
      scans
        .map((s) => s.seriesDescription?.trim().toLowerCase())
        .filter((label): label is string => !!label),
    );
    let candidate = nextVersionedLabel(baseLabel);
    let guard = 0;
    while (existing.has(candidate.toLowerCase()) && guard < 1000) {
      candidate = nextVersionedLabel(candidate);
      guard++;
    }
    return candidate;
  }, []);

  const resolveExistingSaveDialog = useCallback((result: ExistingSaveDialogResult) => {
    const resolver = existingSaveDialogResolverRef.current;
    existingSaveDialogResolverRef.current = null;
    setExistingSaveDialog(null);
    resolver?.(result);
  }, []);

  const promptExistingSaveDialog = useCallback(
    (
      scanId: string,
      dicomType: SegmentationDicomType,
      suggestedLabel: string,
    ): Promise<ExistingSaveDialogResult> => {
      return new Promise((resolve) => {
        existingSaveDialogResolverRef.current = resolve;
        setExistingSaveDialog({
          scanId,
          dicomType,
          suggestedLabel,
          newLabel: suggestedLabel,
          mode: 'choose',
        });
      });
    },
    [],
  );

  const handleSaveLocal = useCallback(async (
    segmentationId: string,
    dicomType: SegmentationDicomType,
  ) => {
    setSaveMenuOpen(null);
    setSaving(true);
    try {
      if (!segmentationService.hasExportableContent(segmentationId, dicomType)) {
        setToast({
          message: dicomType === 'RTSTRUCT'
            ? 'Add at least one structure contour before saving.'
            : 'Add at least one painted segment before saving.',
          type: 'error',
        });
        return;
      }
      const base64 = await exportDicomByType(segmentationId, dicomType);
      const defaultName = dicomType === 'RTSTRUCT' ? 'rtstruct.dcm' : 'segmentation.dcm';
      const result = await saveDicomByType(dicomType, base64, defaultName);
      if (result.ok && result.path) {
        setToast({ message: `Saved to ${result.path.split('/').pop()}`, type: 'success' });
      } else if (result.error) {
        setToast({ message: `Save failed: ${result.error}`, type: 'error' });
      }
      // If !ok and no error, user cancelled
    } catch (err) {
      const msg = getErrorMessage(err, `${dicomType} export failed`);
      setToast({ message: msg, type: 'error' });
      console.error('[SegmentationPanel] saveLocal error:', err);
    } finally {
      setSaving(false);
    }
  }, [exportDicomByType, getErrorMessage, saveDicomByType]);

  const handleUploadXnat = useCallback(async (
    segmentationId: string,
    dicomType: SegmentationDicomType,
  ): Promise<'saved' | 'cancelled' | 'failed'> => {
    setSaveMenuOpen(null);
    const panelCtx = panelXnatContextMap[activeViewportId] ?? xnatContext;
    if (!panelCtx) {
      setToast({ message: 'No XNAT session context — load images from XNAT first', type: 'error' });
      return 'failed';
    }
    if (!segmentationService.hasExportableContent(segmentationId, dicomType)) {
      setToast({
        message: dicomType === 'RTSTRUCT'
          ? 'Add at least one structure contour before upload.'
          : 'Add at least one painted segment before upload.',
        type: 'error',
      });
      return 'failed';
    }

    // Block auto-save during the entire manual save operation so a brush stroke
    // between cancelAutoSave and export completion can't trigger a competing save.
    segmentationManager.beginManualSave();
    try {
      const segStoreSnapshot = useSegmentationStore.getState();
      const origin = segStoreSnapshot.xnatOriginMap[segmentationId];
      const segLabel = segStoreSnapshot.segmentations.find(
        (s) => s.segmentationId === segmentationId,
      )?.label?.trim() || (dicomType === 'RTSTRUCT' ? 'Structure' : 'Segmentation');
      const sourceScanId = origin?.sourceScanId ?? panelCtx.scanId;

      let result: { ok: boolean; url?: string; scanId?: string; error?: string };
      const canOverwriteSeg =
        dicomType === 'SEG'
        && !!origin?.scanId
        && isScanIdCompatibleWithType(origin.scanId, 'SEG');
      const canOverwriteRtStruct =
        dicomType === 'RTSTRUCT'
        && !!origin?.scanId
        && isScanIdCompatibleWithType(origin.scanId, 'RTSTRUCT');
      const canOverwriteExisting = canOverwriteSeg || canOverwriteRtStruct;

      let uploadLabel = segLabel;
      let createNewScan = false;
      if (canOverwriteExisting && origin?.scanId) {
        const suggested = await suggestNextAnnotationLabel(panelCtx.sessionId, segLabel);
        const decision = await promptExistingSaveDialog(origin.scanId, dicomType, suggested);
        if (decision.action === 'cancel') return 'cancelled';
        if (decision.action === 'create-new') {
          uploadLabel = decision.label.trim() || suggested;
          createNewScan = true;
        }
      }

      setSaving(true);
      const base64 = await exportDicomByType(segmentationId, dicomType);

      if (canOverwriteSeg && origin?.scanId && !createNewScan) {
        result = await window.electronAPI.xnat.overwriteDicomSeg(
          panelCtx.sessionId,
          origin.scanId,
          base64,
          uploadLabel,
        );
      } else if (canOverwriteRtStruct && origin?.scanId && !createNewScan) {
        result = await window.electronAPI.xnat.overwriteDicomRtStruct(
          panelCtx.sessionId,
          origin.scanId,
          base64,
          uploadLabel,
        );
      } else if (dicomType === 'SEG') {
        result = await window.electronAPI.xnat.uploadDicomSeg(
          panelCtx.projectId,
          panelCtx.subjectId,
          panelCtx.sessionId,
          panelCtx.sessionLabel,
          sourceScanId,
          base64,
          uploadLabel,
        );
      } else {
        result = await window.electronAPI.xnat.uploadDicomRtStruct(
          panelCtx.projectId,
          panelCtx.subjectId,
          panelCtx.sessionId,
          panelCtx.sessionLabel,
          sourceScanId,
          base64,
          uploadLabel,
        );
      }

      if (!result.ok) {
        setToast({ message: `Upload failed: ${result.error}`, type: 'error' });
        return 'failed';
      } else {
        if (result.ok && result.scanId) {
          const isCreateNewFromExisting = createNewScan && canOverwriteExisting;
          if (!isCreateNewFromExisting) {
            // Overwrite or first-time upload: current in-memory annotation now
            // corresponds to the returned scan.
            useSegmentationStore.getState().setXnatOrigin(segmentationId, {
              scanId: result.scanId,
              sourceScanId,
              projectId: panelCtx.projectId,
              sessionId: panelCtx.sessionId,
            });
            useSegmentationStore.getState().setDicomType(segmentationId, dicomType);
            if (sourceScanId) {
              const compositeKey = `${panelCtx.projectId}/${panelCtx.sessionId}/${sourceScanId}`;
              const mgr = useSegmentationManagerStore.getState();
              mgr.recordLoaded(compositeKey, result.scanId, {
                segmentationId,
                loadedAt: Date.now(),
              });
              mgr.setLoadStatus(result.scanId, 'loaded');
            }
          }
          // Refresh session scans + UID associations so the new annotation scan
          // appears immediately in the annotation browser state.
          try {
            const refreshedScans = await window.electronAPI.xnat.getScans(panelCtx.sessionId);
            setSessionData(panelCtx.sessionId, refreshedScans);
            const idxStore = useSessionDerivedIndexStore.getState();
            idxStore.buildDerivedIndex(refreshedScans);
            void idxStore.resolveAssociationsForSession(
              panelCtx.sessionId,
              refreshedScans,
              (sessionId, scanId) => dicomwebLoader.getScanImageIds(sessionId, scanId),
              async (sessionId, scanId) => {
                const dl = await window.electronAPI.xnat.downloadScanFile(sessionId, scanId);
                if (!dl.ok || !dl.data) {
                  throw new Error(dl.error || 'Failed to download scan file');
                }
                const binary = atob(dl.data);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                return bytes.buffer;
              },
            ).catch((err) => {
              console.warn('[SegmentationPanel] Post-upload UID refresh failed:', err);
            });
          } catch (err) {
            console.warn('[SegmentationPanel] Failed to refresh scans after upload:', err);
          }
          setToast({
            message: isCreateNewFromExisting
              ? `Created new ${dicomType} scan ${result.scanId}`
              : `Uploaded ${dicomType} as scan ${result.scanId}`,
            type: 'success',
          });
        } else if ((canOverwriteSeg || canOverwriteRtStruct) && origin?.scanId) {
          setToast({ message: `Saved ${dicomType} to scan ${origin.scanId}`, type: 'success' });
        }

        const mgrStore = useSegmentationManagerStore.getState();
        mgrStore.clearDirty(segmentationId);
        if (!mgrStore.hasDirtySegmentations()) {
          useSegmentationStore.getState()._markClean();
        }
        try {
          const files = await window.electronAPI.xnat.listTempFiles(panelCtx.sessionId);
          const pattern = new RegExp(`^autosave_(?:seg|rtstruct)_${sourceScanId}(?:_\\d{14})?\\.dcm$`);
          for (const f of files.files ?? []) {
            if (pattern.test(f.name)) {
              window.electronAPI.xnat.deleteTempFile(panelCtx.sessionId, f.name).catch(() => {});
            }
          }
        } catch { /* ignore cleanup errors */ }
        return 'saved';
      }
    } catch (err) {
      const msg = getErrorMessage(err, `${dicomType} upload failed`);
      const normalized = msg.toLowerCase();
      if (
        normalized.includes('no painted segment data found')
        || normalized.includes('no painted segment data')
        || normalized.includes('nothing to export')
      ) {
        setToast({
          message: dicomType === 'RTSTRUCT'
            ? 'No structure content to save. Add a contour first.'
            : 'No painted segment data to save. Paint at least one slice first.',
          type: 'error',
        });
        return 'failed';
      }
      setToast({ message: msg, type: 'error' });
      console.error('[SegmentationPanel] uploadXnat error:', err);
      return 'failed';
    } finally {
      segmentationManager.endManualSave();
      setSaving(false);
    }
  }, [
    xnatContext,
    panelXnatContextMap,
    activeViewportId,
    exportDicomByType,
    getErrorMessage,
    suggestNextAnnotationLabel,
    promptExistingSaveDialog,
    setSessionData,
  ]);

  const isXnatConnected = connectionStatus === 'connected';
  const listItemCount = visibleSegmentations.length + unloadedAvailableOverlays.length;
  const overlaysLoading = availableOverlays.some((overlay) => overlay.loadStatus === 'loading');

  const handleSaveAllModified = useCallback(async () => {
    if (saving) return;
    if (!isXnatConnected || !activePanelXnatContext) {
      setToast({ message: 'Connect to XNAT and load a session first.', type: 'error' });
      return;
    }
    const targets = dirtyVisibleSegmentations;
    if (targets.length === 0) {
      setToast({ message: 'No modified annotations to save.', type: 'success' });
      return;
    }
    for (const seg of targets) {
      const dicomType = resolveSegRowDicomType(seg.segmentationId);
      if (!segmentationService.hasExportableContent(seg.segmentationId, dicomType)) {
        continue;
      }
      const status = await handleUploadXnat(seg.segmentationId, dicomType);
      if (status === 'cancelled') {
        setToast({ message: 'Save-all cancelled.', type: 'error' });
        break;
      }
    }
  }, [
    saving,
    isXnatConnected,
    activePanelXnatContext,
    dirtyVisibleSegmentations,
    resolveSegRowDicomType,
    handleUploadXnat,
  ]);

  const handleLoadAvailableOverlay = useCallback(async (overlay: AvailableOverlayRow) => {
    const panelCtx = panelXnatContextMap[activeViewportId] ?? xnatContext;
    if (!activeSourceScanId || !panelCtx?.projectId || !panelCtx?.sessionId) {
      setToast({ message: 'Load a source scan from XNAT first', type: 'error' });
      return;
    }
    try {
      await segmentationManager.requestShowOverlaysForSourceScan(
        activeViewportId,
        activeSourceScanId,
        [
          {
            type: overlay.type,
            scanId: overlay.scanId,
            sessionId: panelCtx.sessionId,
            label: overlay.label,
          },
        ],
        { defaultVisibility: 'visible' },
      );

      const compositeKey = `${panelCtx.projectId}/${panelCtx.sessionId}/${activeSourceScanId}`;
      const loaded = useSegmentationManagerStore.getState().loadedBySourceScan[compositeKey]?.[overlay.scanId];
      if (!loaded?.segmentationId) return;

      useSegmentationStore.getState().setXnatOrigin(loaded.segmentationId, {
        scanId: overlay.scanId,
        sourceScanId: activeSourceScanId,
        projectId: panelCtx.projectId,
        sessionId: panelCtx.sessionId,
      });
      useSegmentationStore.getState().setDicomType(loaded.segmentationId, overlay.type);
      useSegmentationStore.getState().setActiveSegmentation(loaded.segmentationId);
      segmentationManager.userSelectedSegmentation(activeViewportId, loaded.segmentationId, 1);
      setExpandedIds((prev) => new Set(prev).add(loaded.segmentationId));
    } catch (err) {
      console.error(`[SegmentationPanel] Failed to load ${overlay.type} overlay #${overlay.scanId}:`, err);
      setToast({ message: `Failed to load ${overlay.type} #${overlay.scanId}`, type: 'error' });
    }
  }, [activeSourceScanId, activeViewportId, xnatContext, panelXnatContextMap]);

  // Reset local panel UI state and clear active annotation/tool context when scan changes.
  // Existing overlays can still be displayed, but editing context stays neutral until
  // the user explicitly selects an annotation row.
  useEffect(() => {
    setExpandedIds(new Set());
    setColorPickerTarget(null);
    setSaveMenuOpen(null);
    setEditingLabel(null);
    setSegmentNamingDialog(null);

    const segStore = useSegmentationStore.getState();
    segStore.setActiveSegmentation(null);
    segStore.setActiveSegTool(null);

    const viewer = useViewerStore.getState();
    if (SEGMENTATION_TOOLS.has(viewer.activeTool)) {
      viewer.setActiveTool(ToolName.WindowLevel);
    }
  }, [activeSourceCompositeKey]);

  const activeAnnotationType = useMemo<SegmentationDicomType | null>(() => {
    if (!activeSegId) return null;
    return (
      dicomTypeBySegmentationId[activeSegId]
      ?? segmentationService.getPreferredDicomType(activeSegId)
    );
  }, [activeSegId, dicomTypeBySegmentationId]);

  const activeAnnotationTools = useMemo<ToolName[]>(() => {
    if (activeAnnotationType === 'RTSTRUCT') return STRUCT_PANEL_TOOLS;
    if (activeAnnotationType === 'SEG') return SEG_PANEL_TOOLS;
    return [];
  }, [activeAnnotationType]);
  const toolPanelAnnotationType = overlaysLoading ? null : activeAnnotationType;
  const toolPanelTools = overlaysLoading ? [] : activeAnnotationTools;

  const handleToolSelect = useCallback((tool: ToolName) => {
    if (!activeSegId || !activeAnnotationType) return;
    setActiveTool(tool);
  }, [activeAnnotationType, activeSegId, setActiveTool]);

  return (
    <div className="w-64 shrink-0 min-h-0 border-l border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden relative">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between min-h-[36px]">
        <h3 className="text-xs font-semibold text-zinc-300">
          Annotations
          <span className="text-zinc-500 font-normal ml-1.5">{listItemCount}</span>
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => openAddAnnotationDialog('SEG')}
            disabled={sourceImageIds.length === 0}
            className={`flex items-center justify-center gap-0.5 transition-colors px-1 py-1 rounded border ${TYPE_ACCENTS.SEG.text} ${TYPE_ACCENTS.SEG.border} ${TYPE_ACCENTS.SEG.bgHover} disabled:opacity-30 disabled:cursor-not-allowed`}
            title="Create a segmentation annotation"
            aria-label="Add segmentation"
          >
            <IconPlus className="w-2.5 h-2.5" />
            <IconSegmentationAnnotation className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => openAddAnnotationDialog('RTSTRUCT')}
            disabled={sourceImageIds.length === 0}
            className={`flex items-center justify-center gap-0.5 transition-colors px-1 py-1 rounded border ${TYPE_ACCENTS.RTSTRUCT.text} ${TYPE_ACCENTS.RTSTRUCT.border} ${TYPE_ACCENTS.RTSTRUCT.bgHover} disabled:opacity-30 disabled:cursor-not-allowed`}
            title="Create a structure annotation"
            aria-label="Add structure"
          >
            <IconPlus className="w-2.5 h-2.5" />
            <IconStructureAnnotation className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => { void handleSaveAllModified(); }}
            disabled={
              saving
              || dirtyVisibleSegmentations.length === 0
              || !isXnatConnected
              || !activePanelXnatContext
            }
            className="flex items-center justify-center transition-colors px-1 py-1 rounded border border-blue-900/35 text-blue-300 hover:text-blue-200 hover:bg-blue-900/20 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Save all modified annotations"
            aria-label="Save all modified annotations"
          >
            <IconSave className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Segmentation list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {overlaysLoading ? (
          <div className="p-4 text-xs text-zinc-500 text-center leading-relaxed">
            Loading annotations...
          </div>
        ) : null}
        {!overlaysLoading && unloadedAvailableOverlays.length > 0 && (
          <div className="px-2 py-1.5 border-b border-zinc-800/70">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide px-1 pb-1">
              Available Annotations
            </div>
            <div className="space-y-0.5">
              {unloadedAvailableOverlays.map((overlay) => {
                const isLoading = overlay.loadStatus === 'loading';
                const isError = overlay.loadStatus === 'error';
                return (
                  <button
                    key={`${overlay.type}-${overlay.scanId}`}
                    onClick={() => { void handleLoadAvailableOverlay(overlay); }}
                    disabled={isLoading}
                    className="w-full text-left px-1.5 py-1.5 rounded hover:bg-zinc-800/50 disabled:opacity-50 disabled:cursor-wait transition-colors"
                    title={isLoading ? 'Loading annotation...' : 'Click to display annotation'}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-zinc-300 truncate">
                        {overlay.label}
                      </span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${TYPE_ACCENTS[overlay.type].badge}`}
                      >
                        {overlay.type}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">
                      #{overlay.scanId}
                      {isLoading && ' · Loading...'}
                      {isError && ' · Retry load'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {!overlaysLoading && visibleSegmentations.length === 0 && unloadedAvailableOverlays.length === 0 ? (
          <div className="p-4 text-xs text-zinc-600 text-center leading-relaxed">
            No annotations yet.
            <br />
            <span className="text-zinc-700">Use Add annotation to create a segmentation or structure.</span>
          </div>
        ) : !overlaysLoading && visibleSegmentations.length > 0 ? (
          <div className="py-0.5">
            {visibleSegmentations.map((seg) => {
              const isExpanded = expandedIds.has(seg.segmentationId);
              const isActiveSeg = seg.segmentationId === activeSegId;
              const origin = xnatOriginMap[seg.segmentationId];
              const rowDicomType = resolveSegRowDicomType(seg.segmentationId);
              const displayDicomType = rowDicomType;
              const suffix = origin?.scanId ? `#${origin.scanId}` : 'unsaved';

              return (
                <div key={seg.segmentationId}>
                  {/* Segmentation row */}
                  <div
                    className={`group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors ${
                      isActiveSeg ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/40'
                    }`}
                    onClick={() => handleSelectSegmentationRow(seg.segmentationId)}
                  >
                    {/* Expand/collapse chevron */}
                    <svg
                      className={`w-3 h-3 text-zinc-500 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleExpand(seg.segmentationId);
                      }}
                    >
                      <polyline points="4,2 8,6 4,10" />
                    </svg>

                    {/* Segmentation label — double-click to rename */}
                    {editingLabel?.type === 'segmentation' && editingLabel.segmentationId === seg.segmentationId ? (
                      <input
                        ref={editInputRef}
                        className="text-xs text-zinc-300 bg-zinc-800 border border-blue-500 rounded px-1 py-0 flex-1 min-w-0 outline-none"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onBlur={commitEditLabel}
                        onKeyDown={handleEditKeyDown}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        className="text-xs text-zinc-300 truncate flex-1"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          startEditLabel('segmentation', seg.segmentationId, seg.label);
                        }}
                        title="Double-click to rename"
                      >
                        {seg.label}
                        <span className="text-zinc-500 text-[10px] ml-1">({suffix})</span>
                      </span>
                    )}

                    {/* Annotation object type */}
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${TYPE_ACCENTS[displayDicomType].badge}`}
                      title={displayDicomType === 'SEG' ? 'Segmentation object' : 'RT Structure Set object'}
                    >
                      {displayDicomType === 'SEG' ? 'SEG' : 'STRUCT'}
                    </span>

                    {/* Save segmentation */}
                    <div className="relative shrink-0" ref={saveMenuOpen === seg.segmentationId ? saveMenuRef : undefined}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSaveMenuOpen(saveMenuOpen === seg.segmentationId ? null : seg.segmentationId);
                        }}
                        disabled={saving}
                        className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-blue-400 transition-all p-0.5 rounded hover:bg-blue-900/20 disabled:opacity-30"
                        title="Save segmentation"
                      >
                        <IconSave className="w-3.5 h-3.5" />
                      </button>

                      {/* Save dropdown menu */}
                      {saveMenuOpen === seg.segmentationId && (
                        <div className="absolute right-0 top-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 min-w-[190px] py-1 text-xs">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleSaveLocal(seg.segmentationId, displayDicomType);
                            }}
                            disabled={saving}
                            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-2 disabled:opacity-40"
                          >
                            <IconSave className="w-3.5 h-3.5 text-zinc-400" />
                            Save file
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleUploadXnat(seg.segmentationId, displayDicomType).catch((err) => {
                                const msg = getErrorMessage(err, `${displayDicomType} upload failed`);
                                setToast({ message: msg, type: 'error' });
                                console.error('[SegmentationPanel] Unexpected upload rejection:', err);
                              });
                            }}
                            disabled={saving || !isXnatConnected || !activePanelXnatContext}
                            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <IconUpload className="w-3.5 h-3.5 text-zinc-400" />
                            Upload to XNAT
                            {(!isXnatConnected || !activePanelXnatContext) && (
                              <span className="text-[9px] text-zinc-600 ml-auto">
                                {!isXnatConnected ? 'Not connected' : 'No session'}
                              </span>
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Remove segmentation */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveSegmentation(seg.segmentationId);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-all p-0.5 shrink-0 rounded hover:bg-red-900/20"
                      title="Remove segmentation"
                    >
                      <IconClose className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Expanded segment list */}
                  {isExpanded && (
                    <div className="pl-4 pb-1">
                      {seg.segments.map((segment) => {
                        const isActiveSegment =
                          isActiveSeg && activeSegIndex === segment.segmentIndex;

                        return (
                          <div
                            key={segment.segmentIndex}
                            className={`group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors ${
                              isActiveSegment
                                ? 'bg-blue-900/25 border-l-2 border-blue-500'
                                : 'hover:bg-zinc-800/30 border-l-2 border-transparent'
                            }`}
                            onClick={() => {
                              setColorPickerTarget(null);
                              handleSelectSegment(seg.segmentationId, segment.segmentIndex);
                            }}
                          >
                            {/* Color swatch */}
                            <button
                              className="w-3.5 h-3.5 rounded-sm shrink-0 border border-zinc-600 hover:border-zinc-400 transition-colors"
                              style={{ backgroundColor: rgbaStr(segment.color) }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setColorPickerTarget(
                                  colorPickerTarget?.segmentIndex === segment.segmentIndex &&
                                    colorPickerTarget?.segmentationId === seg.segmentationId
                                    ? null
                                    : {
                                        segmentationId: seg.segmentationId,
                                        segmentIndex: segment.segmentIndex,
                                      },
                                );
                              }}
                              title="Change color"
                            />

                            {/* Label — double-click to rename */}
                            {editingLabel?.type === 'segment' &&
                              editingLabel.segmentationId === seg.segmentationId &&
                              editingLabel.segmentIndex === segment.segmentIndex ? (
                              <input
                                ref={editInputRef}
                                className="text-[11px] text-zinc-400 bg-zinc-800 border border-blue-500 rounded px-1 py-0 flex-1 min-w-0 outline-none"
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onBlur={commitEditLabel}
                                onKeyDown={handleEditKeyDown}
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span
                                className="text-[11px] text-zinc-400 truncate flex-1"
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  startEditLabel('segment', seg.segmentationId, segment.label, segment.segmentIndex);
                                }}
                                title="Double-click to rename"
                              >
                                {segment.label}
                              </span>
                            )}

                            {/* Visibility toggle */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                segmentationManager.userToggledVisibility(
                                  activeViewportId,
                                  seg.segmentationId,
                                  segment.segmentIndex,
                                );
                              }}
                              className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5 shrink-0"
                              title={segment.visible ? 'Hide segment' : 'Show segment'}
                            >
                              {segment.visible ? (
                                <IconEye className="w-3 h-3" />
                              ) : (
                                <IconEyeOff className="w-3 h-3" />
                              )}
                            </button>

                            {/* Lock toggle */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                segmentationManager.userToggledLock(
                                  seg.segmentationId,
                                  segment.segmentIndex,
                                );
                              }}
                              className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5 shrink-0"
                              title={segment.locked ? 'Unlock segment' : 'Lock segment'}
                            >
                              {segment.locked ? (
                                <IconLock className="w-3 h-3" />
                              ) : (
                                <IconLockOpen className="w-3 h-3" />
                              )}
                            </button>

                            {/* Delete component */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const removedSelectedComponent =
                                  segmentationManager.removeSelectedContourComponents(
                                    seg.segmentationId,
                                    segment.segmentIndex,
                                  );
                                if (!removedSelectedComponent) {
                                  segmentationManager.removeSegment(
                                    seg.segmentationId,
                                    segment.segmentIndex,
                                  );
                                }
                              }}
                              className={`${isActiveSegment ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} text-zinc-500 hover:text-red-400 transition-all p-0.5 shrink-0`}
                              title={displayDicomType === 'RTSTRUCT' ? 'Delete contour component' : 'Delete segment'}
                            >
                              <IconClose className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        );
                      })}

                      {/* Inline color picker */}
                      {colorPickerTarget?.segmentationId === seg.segmentationId && (
                        <div className="flex flex-wrap gap-1 px-2 py-1.5 mt-0.5">
                          {COLOR_PALETTE.map((color, i) => (
                            <button
                              key={i}
                              className="w-4 h-4 rounded-sm border border-zinc-600 hover:border-white transition-colors"
                              style={{ backgroundColor: rgbaStr(color) }}
                              onClick={() => handleColorSelect(color)}
                              title={`Color ${i + 1}`}
                            />
                          ))}
                        </div>
                      )}

                      {/* Add segment button */}
                      <button
                        onClick={() => handleAddSegment(seg.segmentationId, displayDicomType)}
                        className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 mt-0.5"
                      >
                        <IconPlus className="w-2.5 h-2.5" />
                        {displayDicomType === 'RTSTRUCT' ? 'Add Structure' : 'Add Segment'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Tool options section */}
      <div className="border-t border-zinc-800 px-3 py-2 shrink-0 space-y-1.5">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-zinc-500 uppercase tracking-wide">Tools</label>
            {toolPanelAnnotationType && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded ${TYPE_ACCENTS[toolPanelAnnotationType].badge}`}>
                {toolPanelAnnotationType === 'SEG' ? 'SEG' : 'STRUCT'}
              </span>
            )}
          </div>
          <div className="pr-0.5">
            {overlaysLoading ? (
              <div className="text-[10px] text-zinc-600 leading-relaxed pt-1">
                Loading annotations...
              </div>
            ) : !toolPanelAnnotationType ? (
              <div className="text-[10px] text-zinc-600 leading-relaxed pt-1">
                Select an annotation row to enable tools.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1">
                {toolPanelTools.map((tool) => {
                  const isActive = activeTool === tool;
                  return (
                    <button
                      key={tool}
                      onClick={() => handleToolSelect(tool)}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] transition-colors ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
                      }`}
                      title={TOOL_DISPLAY_NAMES[tool]}
                    >
                      <SegToolIcon tool={tool} />
                      <span className="truncate">{TOOL_DISPLAY_NAMES[tool]}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Brush size — only show for brush-style tools */}
        {toolPanelAnnotationType === 'SEG' && (!activeSegTool || BRUSH_SIZE_TOOLS.has(activeSegTool)) && (
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label className="text-[10px] text-zinc-500">Brush Size</label>
              <span className="text-[10px] text-zinc-400 tabular-nums">{brushSize}px</span>
            </div>
            <input
              type="range"
              min={1}
              max={50}
              value={brushSize}
              onChange={handleBrushSizeChange}
              className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        )}

        {/* Contour line thickness (RTSTRUCT only) */}
        {toolPanelAnnotationType === 'RTSTRUCT' && (
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label className="text-[10px] text-zinc-500">Contour Thickness</label>
              <span className="text-[10px] text-zinc-400 tabular-nums">{contourLineWidth}px</span>
            </div>
            <input
              type="range"
              min={1}
              max={8}
              value={contourLineWidth}
              onChange={handleContourLineWidthChange}
              className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-emerald-500"
            />
          </div>
        )}

        {/* Labelmap opacity (SEG only) */}
        {toolPanelAnnotationType === 'SEG' && (
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label className="text-[10px] text-zinc-500">Labelmap Opacity</label>
              <span className="text-[10px] text-zinc-400 tabular-nums">
                {Math.round(fillAlpha * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={fillAlpha}
              onChange={handleFillAlphaChange}
              className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        )}

        {/* Contour opacity (RTSTRUCT only) */}
        {toolPanelAnnotationType === 'RTSTRUCT' && (
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label className="text-[10px] text-zinc-500">Contour Opacity</label>
              <span className="text-[10px] text-zinc-400 tabular-nums">
                {Math.round(contourOpacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={contourOpacity}
              onChange={handleContourOpacityChange}
              className="w-full h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-emerald-500"
            />
          </div>
        )}

        {/* Show Outline (SEG only) */}
        {toolPanelAnnotationType === 'SEG' && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={renderOutline}
              onChange={handleOutlineToggle}
              className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
            />
            <span className="text-[10px] text-zinc-400">Show Outline</span>
          </label>
        )}

        {toolPanelAnnotationType && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={interpolationEnabled}
              onChange={(e) => handleInterpolationToggle(e.target.checked)}
              className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
            />
            <span className="text-[10px] text-zinc-400">
              Interpolate between slices
            </span>
          </label>
        )}

        {/* Threshold range (only when ThresholdBrush is active) */}
        {toolPanelAnnotationType === 'SEG' && activeSegTool === 'ThresholdBrush' && (
          <div>
            <label className="text-[10px] text-zinc-500 block mb-0.5">Threshold Range (HU)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={thresholdRange[0]}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10) || 0;
                  setThresholdRange([val, thresholdRange[1]]);
                }}
                className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-300"
              />
              <span className="text-[10px] text-zinc-600">to</span>
              <input
                type="number"
                value={thresholdRange[1]}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10) || 0;
                  setThresholdRange([thresholdRange[0], val]);
                }}
                className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-300"
              />
            </div>
          </div>
        )}

        {/* Spline type selector (only when SplineContour is active) */}
        {toolPanelAnnotationType === 'RTSTRUCT' && activeSegTool === ToolName.SplineContour && (
          <div>
            <label className="text-[10px] text-zinc-500 block mb-0.5">Spline Type</label>
            <select
              value={splineType}
              onChange={(e) => setSplineType(e.target.value as any)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[10px] text-zinc-300 cursor-pointer"
            >
              <option value="CATMULLROM">Catmull-Rom</option>
              <option value="CARDINAL">Cardinal</option>
              <option value="BSPLINE">B-Spline</option>
              <option value="LINEAR">Linear</option>
            </select>
          </div>
        )}
      </div>

      {/* Shared annotation options (outside fixed-size tool section) */}
      <div className="border-t border-zinc-800 px-3 py-2 space-y-2 shrink-0">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoLoadSegOnScanClick}
            onChange={(e) => setAutoLoadSegOnScanClick(e.target.checked)}
            className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
          />
          <span className="text-[10px] text-zinc-400">Automatically display annotations</span>
        </label>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSaveEnabled}
                onChange={(e) => setAutoSaveEnabled(e.target.checked)}
                disabled={!isXnatConnected || !activePanelXnatContext}
                className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <span className="text-[10px] text-zinc-400">Auto-Save</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showViewportContextOverlay}
                onChange={(e) => setShowViewportContextOverlay(e.target.checked)}
                className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
              />
              <span className="text-[10px] text-zinc-400">Display context info</span>
            </label>
          </div>
          {autoSaveEnabled && (
            <span className="text-[9px] flex items-center gap-1">
              {autoSaveStatus === 'saving' && (
                <>
                  <svg className="animate-spin h-2.5 w-2.5 text-blue-400" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                  </svg>
                  <span className="text-blue-400">Saving...</span>
                </>
              )}
              {autoSaveStatus === 'saved' && (
                <>
                  <svg className="h-2.5 w-2.5 text-green-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3,8 7,12 13,4" />
                  </svg>
                  <span className="text-green-400">Saved</span>
                </>
              )}
              {autoSaveStatus === 'error' && (
                <>
                  <svg className="h-2.5 w-2.5 text-red-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="8" cy="8" r="6" />
                    <line x1="8" y1="5" x2="8" y2="9" />
                    <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
                  </svg>
                  <span className="text-red-400">Failed</span>
                </>
              )}
            </span>
          )}
        </div>
        {!isXnatConnected || !activePanelXnatContext ? (
          <div className="text-[9px] text-zinc-600 -mt-1">
            Auto-save is available after loading an XNAT scan.
          </div>
        ) : null}
      </div>

      {/* Toast notification */}
      {toast && (
        <div
          className={`absolute top-2 left-2 right-2 z-[100] px-3 py-2 rounded-lg shadow-lg text-[11px] font-medium transition-opacity ${
            toast.type === 'success'
              ? 'bg-green-800/90 text-green-100'
              : 'bg-red-800/90 text-red-100'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Existing-scan save decision dialog */}
      {existingSaveDialog && (
        <div className="absolute inset-0 z-50 bg-zinc-950/70 flex items-center justify-center">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-4 mx-4 w-full max-w-[260px]">
            {existingSaveDialog.mode === 'choose' ? (
              <>
                <div className="text-xs text-zinc-300 leading-relaxed">
                  This annotation already exists on XNAT as scan <span className="font-semibold text-zinc-100">#{existingSaveDialog.scanId}</span>.
                </div>
                <div className="text-[11px] text-zinc-500 mt-1.5">
                  Choose how you want to save this update:
                </div>
                <div className="grid gap-2 mt-3">
                  <button
                    onClick={() => resolveExistingSaveDialog({ action: 'overwrite' })}
                    className="text-[11px] text-zinc-100 px-3 py-1.5 rounded bg-blue-900/35 hover:bg-blue-900/50 transition-colors text-left"
                  >
                    Overwrite
                  </button>
                  <button
                    onClick={() => {
                      setExistingSaveDialog((prev) => prev ? { ...prev, mode: 'name' } : prev);
                    }}
                    className="text-[11px] text-zinc-200 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors text-left"
                  >
                    Create New
                  </button>
                  <button
                    onClick={() => resolveExistingSaveDialog({ action: 'cancel' })}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded hover:bg-zinc-800 transition-colors text-left"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  {existingSaveDialog.dicomType === 'RTSTRUCT' ? 'Structure name' : 'Segmentation name'}
                </label>
                <input
                  ref={existingSaveInputRef}
                  className="w-full text-xs text-zinc-200 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 outline-none focus:border-blue-500 transition-colors"
                  value={existingSaveDialog.newLabel}
                  onChange={(e) => {
                    const value = e.target.value;
                    setExistingSaveDialog((prev) => prev ? { ...prev, newLabel: value } : prev);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const finalLabel = existingSaveDialog.newLabel.trim();
                      if (finalLabel) {
                        resolveExistingSaveDialog({ action: 'create-new', label: finalLabel });
                      }
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      resolveExistingSaveDialog({ action: 'cancel' });
                    }
                  }}
                  placeholder={existingSaveDialog.suggestedLabel}
                />
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    onClick={() => {
                      setExistingSaveDialog((prev) => prev ? { ...prev, mode: 'choose' } : prev);
                    }}
                    className="text-[10px] text-zinc-400 hover:text-zinc-200 px-2.5 py-1 rounded hover:bg-zinc-800 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => resolveExistingSaveDialog({ action: 'cancel' })}
                    className="text-[10px] text-zinc-400 hover:text-zinc-200 px-2.5 py-1 rounded hover:bg-zinc-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      const finalLabel = existingSaveDialog.newLabel.trim();
                      if (!finalLabel) return;
                      resolveExistingSaveDialog({ action: 'create-new', label: finalLabel });
                    }}
                    disabled={!existingSaveDialog.newLabel.trim()}
                    className="text-[10px] text-blue-400 hover:text-blue-300 px-2.5 py-1 rounded bg-blue-900/30 hover:bg-blue-900/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Create
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Naming dialog overlay */}
      {namingDialog && (
        <div className="absolute inset-0 z-50 bg-zinc-950/70 flex items-center justify-center">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-4 mx-4 w-full max-w-[220px]">
            <label className="block text-xs text-zinc-400 mb-1.5">
              {pendingCreateType === 'RTSTRUCT' ? 'Structure name' : 'Segmentation name'}
            </label>
            <input
              ref={namingInputRef}
              className="w-full text-xs text-zinc-200 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 outline-none focus:border-blue-500 transition-colors"
              value={namingValue}
              onChange={(e) => setNamingValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirmAddAnnotation();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelAddAnnotation();
                }
              }}
              placeholder={pendingCreateType === 'RTSTRUCT' ? 'Enter structure name...' : 'Enter segmentation name...'}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={cancelAddAnnotation}
                className="text-[10px] text-zinc-400 hover:text-zinc-200 px-2.5 py-1 rounded hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmAddAnnotation}
                disabled={!namingValue.trim()}
                className="text-[10px] text-blue-400 hover:text-blue-300 px-2.5 py-1 rounded bg-blue-900/30 hover:bg-blue-900/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Segment/structure naming dialog */}
      {segmentNamingDialog && (
        <div className="absolute inset-0 z-50 bg-zinc-950/70 flex items-center justify-center">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-4 mx-4 w-full max-w-[220px]">
            <label className="block text-xs text-zinc-400 mb-1.5">
              {segmentNamingDialog.rowType === 'RTSTRUCT' ? 'Structure name' : 'Segment name'}
            </label>
            <input
              ref={segmentNamingInputRef}
              className="w-full text-xs text-zinc-200 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 outline-none focus:border-blue-500 transition-colors"
              value={segmentNamingDialog.value}
              onChange={(e) => {
                const value = e.target.value;
                setSegmentNamingDialog((prev) => (prev ? { ...prev, value } : prev));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirmAddSegment();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelAddSegment();
                }
              }}
              placeholder={segmentNamingDialog.defaultName}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={cancelAddSegment}
                className="text-[10px] text-zinc-400 hover:text-zinc-200 px-2.5 py-1 rounded hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmAddSegment}
                disabled={!segmentNamingDialog.value.trim()}
                className="text-[10px] text-blue-400 hover:text-blue-300 px-2.5 py-1 rounded bg-blue-900/30 hover:bg-blue-900/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Saving overlay */}
      {saving && (
        <div className="absolute inset-0 z-50 bg-zinc-950/60 flex items-center justify-center">
          <div className="flex items-center gap-2 text-xs text-zinc-300">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
            </svg>
            Exporting...
          </div>
        </div>
      )}
    </div>
  );
}
