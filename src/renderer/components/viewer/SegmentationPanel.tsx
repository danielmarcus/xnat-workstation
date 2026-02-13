/**
 * SegmentationPanel — right-side panel for managing segmentations and segments.
 *
 * Layout:
 * ┌─────────────────────────────┐
 * │ Segments         [+ Seg]    │  ← Header + "Add Segmentation" button
 * ├─────────────────────────────┤
 * │ ▸ Segmentation 1  [×]      │  ← Segmentation row (collapsible)
 * │   ■ Segment 1    👁 🔓 [×]  │  ← Segment: color, label, vis, lock, delete
 * │   ■ Segment 2    👁 🔓 [×]  │
 * │   [+ Add Segment]           │
 * ├─────────────────────────────┤
 * │ Brush Size: ─────○── 15px   │  ← Tool options
 * │ Opacity:    ─────○── 50%    │
 * │ ☑ Show Outline              │
 * └─────────────────────────────┘
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useViewerStore } from '../../stores/viewerStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { segmentationService } from '../../lib/cornerstone/segmentationService';
import { rtStructService } from '../../lib/cornerstone/rtStructService';
import { segmentationManager } from '../../lib/segmentation/segmentationManagerSingleton';
import { ToolName, LABELMAP_SEG_TOOLS } from '@shared/types/viewer';
import {
  IconPlus,
  IconClose,
  IconEye,
  IconEyeOff,
  IconLock,
  IconLockOpen,
  IconSave,
  IconUpload,
} from '../icons';

/** Brush-style tools that use brush size */
const BRUSH_SIZE_TOOLS = new Set<string>([
  ToolName.Brush,
  ToolName.Eraser,
  ToolName.ThresholdBrush,
]);

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

/** Props passed from ViewerPage */
interface SegmentationPanelProps {
  /** Source imageIds from the active viewport panel — needed to create segmentations */
  sourceImageIds: string[];
}

export default function SegmentationPanel({ sourceImageIds }: SegmentationPanelProps) {
  const segmentations = useSegmentationStore((s) => s.segmentations);
  const activeSegId = useSegmentationStore((s) => s.activeSegmentationId);
  const activeSegIndex = useSegmentationStore((s) => s.activeSegmentIndex);
  const fillAlpha = useSegmentationStore((s) => s.fillAlpha);
  const renderOutline = useSegmentationStore((s) => s.renderOutline);
  const brushSize = useSegmentationStore((s) => s.brushSize);
  const activeSegTool = useSegmentationStore((s) => s.activeSegTool);
  const thresholdRange = useSegmentationStore((s) => s.thresholdRange);
  const splineType = useSegmentationStore((s) => s.splineType);
  const setSplineType = useSegmentationStore((s) => s.setSplineType);
  const autoSaveEnabled = useSegmentationStore((s) => s.autoSaveEnabled);
  const autoSaveStatus = useSegmentationStore((s) => s.autoSaveStatus);
  const setAutoSaveEnabled = useSegmentationStore((s) => s.setAutoSaveEnabled);
  const autoLoadSegOnScanClick = useSegmentationStore((s) => s.autoLoadSegOnScanClick);
  const setAutoLoadSegOnScanClick = useSegmentationStore((s) => s.setAutoLoadSegOnScanClick);
  const xnatOriginMap = useSegmentationStore((s) => s.xnatOriginMap);
  const activeViewportId = useViewerStore((s) => s.activeViewportId);
  const xnatContext = useViewerStore((s) => s.xnatContext);
  const connectionStatus = useConnectionStore((s) => s.status);

  const setFillAlpha = useSegmentationStore((s) => s.setFillAlpha);
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

  // Naming dialog state (for creating a new segmentation)
  const [namingDialog, setNamingDialog] = useState(false);
  const [namingValue, setNamingValue] = useState('Segmentation');
  const namingInputRef = useRef<HTMLInputElement>(null);

  // Focus the naming input when it appears
  useEffect(() => {
    if (namingDialog && namingInputRef.current) {
      namingInputRef.current.focus();
      namingInputRef.current.select();
    }
  }, [namingDialog]);

  // Save menu state
  const [saveMenuOpen, setSaveMenuOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const saveMenuRef = useRef<HTMLDivElement>(null);

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

  // ─── Handlers ─────────────────────────────────────────────────

  const handleAddSegmentation = useCallback(() => {
    if (sourceImageIds.length === 0) return;
    setNamingValue('Segmentation');
    setNamingDialog(true);
  }, [sourceImageIds]);

  const confirmAddSegmentation = useCallback(async () => {
    const name = namingValue.trim();
    if (!name) return;
    setNamingDialog(false);
    try {
      const segId = await segmentationManager.createNewSegmentation(activeViewportId, sourceImageIds, name);
      // Auto-expand the new segmentation
      setExpandedIds((prev) => new Set(prev).add(segId));
      // Track the source scan ID so auto-save targets the correct scan even
      // if the user switches panels/scans before the auto-save fires.
      // scanId='' means "not yet saved to XNAT" (distinguished from loaded SEGs).
      const currentScanId = xnatContext?.scanId;
      if (currentScanId) {
        useSegmentationStore.getState().setXnatOrigin(segId, {
          scanId: '',
          sourceScanId: currentScanId,
        });
      }
    } catch (err) {
      console.error('[SegmentationPanel] Failed to create segmentation:', err);
      setToast({ message: `Failed to create segmentation: ${err instanceof Error ? err.message : 'Unknown error'}`, type: 'error' });
    }
  }, [namingValue, sourceImageIds, activeViewportId, xnatContext]);

  const cancelAddSegmentation = useCallback(() => {
    setNamingDialog(false);
  }, []);

  const handleAddSegment = useCallback((segmentationId: string) => {
    segmentationManager.addSegment(segmentationId, '');
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

  const handleSelectSegment = useCallback((segmentationId: string, segmentIndex: number) => {
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
    toggleOutline();
    const store = useSegmentationStore.getState();
    segmentationService.updateStyle(store.fillAlpha, !store.renderOutline);
  }, [toggleOutline]);

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

  const handleSaveLocal = useCallback(async (segmentationId: string) => {
    setSaveMenuOpen(null);
    setSaving(true);
    try {
      const base64 = await segmentationManager.exportToDicomSeg(segmentationId);
      const result = await window.electronAPI.export.saveDicomSeg(base64, 'segmentation.dcm');
      if (result.ok && result.path) {
        setToast({ message: `Saved to ${result.path.split('/').pop()}`, type: 'success' });
      } else if (result.error) {
        setToast({ message: `Save failed: ${result.error}`, type: 'error' });
      }
      // If !ok and no error, user cancelled
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      setToast({ message: msg, type: 'error' });
      console.error('[SegmentationPanel] saveLocal error:', err);
    } finally {
      setSaving(false);
    }
  }, []);

  const handleUploadXnat = useCallback(async (segmentationId: string) => {
    setSaveMenuOpen(null);
    if (!xnatContext) {
      setToast({ message: 'No XNAT session context — load images from XNAT first', type: 'error' });
      return;
    }

    // Block auto-save during the entire manual save operation so a brush stroke
    // between cancelAutoSave and export completion can't trigger a competing save.
    segmentationManager.beginManualSave();

    setSaving(true);
    try {
      const base64 = await segmentationManager.exportToDicomSeg(segmentationId);
      const segStoreSnapshot = useSegmentationStore.getState();
      const origin = segStoreSnapshot.xnatOriginMap[segmentationId];
      const segLabel = segStoreSnapshot.segmentations.find(
        (s) => s.segmentationId === segmentationId,
      )?.label;

      let result: { ok: boolean; url?: string; scanId?: string; error?: string };

      if (origin && origin.scanId) {
        // Overwrite existing scan (origin.scanId is non-empty for previously saved segmentations)
        result = await window.electronAPI.xnat.overwriteDicomSeg(
          xnatContext.sessionId,
          origin.scanId,
          base64,
        );
        if (result.ok) {
          setToast({ message: `Saved to scan ${origin.scanId}`, type: 'success' });
        }
      } else {
        // First save: create new 30xx scan.
        // Use origin.sourceScanId if available (tracked at creation time),
        // otherwise fall back to xnatContext.scanId.
        const sourceScanId = origin?.sourceScanId ?? xnatContext.scanId;
        result = await window.electronAPI.xnat.uploadDicomSeg(
          xnatContext.projectId,
          xnatContext.subjectId,
          xnatContext.sessionId,
          xnatContext.sessionLabel,
          sourceScanId,
          base64,
          segLabel,
        );
        if (result.ok && result.scanId) {
          // Track origin for future overwrites
          useSegmentationStore.getState().setXnatOrigin(segmentationId, {
            scanId: result.scanId,
            sourceScanId,
          });
          setToast({ message: `Uploaded to XNAT as scan ${result.scanId}`, type: 'success' });
        }
      }

      if (!result.ok) {
        setToast({ message: `Upload failed: ${result.error}`, type: 'error' });
      } else {
        // Mark as saved
        useSegmentationStore.getState()._markClean();
        // Clean up all auto-save temp files for this source scan (pattern-based for timestamped filenames)
        const sourceScanId = origin?.sourceScanId ?? xnatContext.scanId;
        try {
          const files = await window.electronAPI.xnat.listTempFiles(xnatContext.sessionId);
          const pattern = new RegExp(`^autosave_(?:seg|rtstruct)_${sourceScanId}(?:_\\d{14})?\\.dcm$`);
          for (const f of files.files ?? []) {
            if (pattern.test(f.name)) {
              window.electronAPI.xnat.deleteTempFile(xnatContext.sessionId, f.name).catch(() => {});
            }
          }
        } catch { /* ignore cleanup errors */ }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setToast({ message: msg, type: 'error' });
      console.error('[SegmentationPanel] uploadXnat error:', err);
    } finally {
      segmentationManager.endManualSave();
      setSaving(false);
    }
  }, [xnatContext]);

  const handleSaveRtStructLocal = useCallback(async (segmentationId: string) => {
    setSaveMenuOpen(null);
    setSaving(true);
    try {
      const base64 = await rtStructService.exportToRtStruct(segmentationId);
      const result = await window.electronAPI.export.saveDicomRtStruct(base64, 'rtstruct.dcm');
      if (result.ok && result.path) {
        setToast({ message: `Saved RTSTRUCT to ${result.path.split('/').pop()}`, type: 'success' });
      } else if (result.error) {
        setToast({ message: `Save failed: ${result.error}`, type: 'error' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'RTSTRUCT export failed';
      setToast({ message: msg, type: 'error' });
      console.error('[SegmentationPanel] saveRtStructLocal error:', err);
    } finally {
      setSaving(false);
    }
  }, []);

  const handleUploadRtStructXnat = useCallback(async (segmentationId: string) => {
    setSaveMenuOpen(null);
    if (!xnatContext) {
      setToast({ message: 'No XNAT session context — load images from XNAT first', type: 'error' });
      return;
    }

    // Block auto-save during the entire manual save operation
    segmentationManager.beginManualSave();

    setSaving(true);
    try {
      const base64 = await rtStructService.exportToRtStruct(segmentationId);
      // Use origin.sourceScanId if available (tracked at creation time),
      // otherwise fall back to xnatContext.scanId.
      const segStoreSnapshot = useSegmentationStore.getState();
      const origin = segStoreSnapshot.xnatOriginMap[segmentationId];
      const sourceScanId = origin?.sourceScanId ?? xnatContext.scanId;
      const result = await window.electronAPI.xnat.uploadDicomRtStruct(
        xnatContext.projectId,
        xnatContext.subjectId,
        xnatContext.sessionId,
        xnatContext.sessionLabel,
        sourceScanId,
        base64,
      );
      if (result.ok) {
        useSegmentationStore.getState()._markClean();
        // Track origin for future overwrites (if first save)
        if (result.scanId) {
          useSegmentationStore.getState().setXnatOrigin(segmentationId, {
            scanId: result.scanId,
            sourceScanId,
          });
        }
        // Clean up all auto-save temp files for this source scan (pattern-based for timestamped filenames)
        try {
          const files = await window.electronAPI.xnat.listTempFiles(xnatContext.sessionId);
          const pattern = new RegExp(`^autosave_(?:seg|rtstruct)_${sourceScanId}(?:_\\d{14})?\\.dcm$`);
          for (const f of files.files ?? []) {
            if (pattern.test(f.name)) {
              window.electronAPI.xnat.deleteTempFile(xnatContext.sessionId, f.name).catch(() => {});
            }
          }
        } catch { /* ignore cleanup errors */ }
        setToast({ message: 'Uploaded RTSTRUCT to XNAT successfully', type: 'success' });
      } else {
        setToast({ message: `Upload failed: ${result.error}`, type: 'error' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'RTSTRUCT upload failed';
      setToast({ message: msg, type: 'error' });
      console.error('[SegmentationPanel] uploadRtStructXnat error:', err);
    } finally {
      segmentationManager.endManualSave();
      setSaving(false);
    }
  }, [xnatContext]);

  const isXnatConnected = connectionStatus === 'connected';

  return (
    <div className="w-64 shrink-0 border-l border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden relative">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between min-h-[36px]">
        <h3 className="text-xs font-semibold text-zinc-300">
          Segments
          <span className="text-zinc-500 font-normal ml-1.5">{segmentations.length}</span>
        </h3>
        <button
          onClick={handleAddSegmentation}
          disabled={sourceImageIds.length === 0}
          className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors px-1.5 py-0.5 rounded hover:bg-blue-900/20 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Add a new segmentation"
        >
          <IconPlus className="w-3 h-3" />
          Add Seg
        </button>
      </div>

      {/* Segmentation list */}
      <div className="flex-1 overflow-y-auto">
        {segmentations.length === 0 ? (
          <div className="p-4 text-xs text-zinc-600 text-center leading-relaxed">
            No segmentations yet.
            <br />
            <span className="text-zinc-700">Click "Add Seg" to create one, then use the Brush tool.</span>
          </div>
        ) : (
          <div className="py-0.5">
            {segmentations.map((seg) => {
              const isExpanded = expandedIds.has(seg.segmentationId);
              const isActiveSeg = seg.segmentationId === activeSegId;

              return (
                <div key={seg.segmentationId}>
                  {/* Segmentation row */}
                  <div
                    className={`group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors ${
                      isActiveSeg ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/40'
                    }`}
                    onClick={() => handleToggleExpand(seg.segmentationId)}
                  >
                    {/* Expand/collapse chevron */}
                    <svg
                      className={`w-3 h-3 text-zinc-500 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
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
                    ) : (() => {
                      const origin = xnatOriginMap[seg.segmentationId];
                      const suffix = origin ? `#${origin.scanId}` : 'unsaved';
                      return (
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
                      );
                    })()}

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
                              handleSaveLocal(seg.segmentationId);
                            }}
                            disabled={saving}
                            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-2 disabled:opacity-40"
                          >
                            <IconSave className="w-3.5 h-3.5 text-zinc-400" />
                            Save DICOM SEG to file...
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUploadXnat(seg.segmentationId);
                            }}
                            disabled={saving || !isXnatConnected || !xnatContext}
                            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <IconUpload className="w-3.5 h-3.5 text-zinc-400" />
                            Upload SEG to XNAT
                            {(!isXnatConnected || !xnatContext) && (
                              <span className="text-[9px] text-zinc-600 ml-auto">
                                {!isXnatConnected ? 'Not connected' : 'No session'}
                              </span>
                            )}
                          </button>
                          <div className="border-t border-zinc-700 my-1" />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSaveRtStructLocal(seg.segmentationId);
                            }}
                            disabled={saving}
                            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-2 disabled:opacity-40"
                          >
                            <IconSave className="w-3.5 h-3.5 text-green-400" />
                            Save DICOM RTSTRUCT to file...
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUploadRtStructXnat(seg.segmentationId);
                            }}
                            disabled={saving || !isXnatConnected || !xnatContext}
                            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <IconUpload className="w-3.5 h-3.5 text-green-400" />
                            Upload RTSTRUCT to XNAT
                            {(!isXnatConnected || !xnatContext) && (
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
                            onClick={() =>
                              handleSelectSegment(seg.segmentationId, segment.segmentIndex)
                            }
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

                            {/* Delete segment */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                segmentationManager.removeSegment(
                                  seg.segmentationId,
                                  segment.segmentIndex,
                                );
                              }}
                              className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-all p-0.5 shrink-0"
                              title="Delete segment"
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
                        onClick={() => handleAddSegment(seg.segmentationId)}
                        className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 mt-0.5"
                      >
                        <IconPlus className="w-2.5 h-2.5" />
                        Add Segment
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tool options section */}
      <div className="border-t border-zinc-800 px-3 py-2 space-y-2">
        {/* Brush size — only show for brush-style tools */}
        {(!activeSegTool || BRUSH_SIZE_TOOLS.has(activeSegTool)) && (
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

        {/* Opacity */}
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <label className="text-[10px] text-zinc-500">Opacity</label>
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

        {/* Show Outline */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={renderOutline}
            onChange={handleOutlineToggle}
            className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
          />
          <span className="text-[10px] text-zinc-400">Show Outline</span>
        </label>

        {/* Auto-load associated SEG when clicking a scan */}
        {isXnatConnected && xnatContext && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoLoadSegOnScanClick}
              onChange={(e) => setAutoLoadSegOnScanClick(e.target.checked)}
              className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
            />
            <span className="text-[10px] text-zinc-400">Auto-load SEG from scan</span>
          </label>
        )}

        {/* Auto-save toggle + status (only when connected to XNAT) */}
        {isXnatConnected && xnatContext && (
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSaveEnabled}
                onChange={(e) => setAutoSaveEnabled(e.target.checked)}
                className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
              />
              <span className="text-[10px] text-zinc-400">Auto-Save</span>
            </label>
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
        )}

        {/* Threshold range (only when ThresholdBrush is active) */}
        {activeSegTool === 'ThresholdBrush' && (
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
        {activeSegTool === ToolName.SplineContour && (
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

      {/* Naming dialog overlay */}
      {namingDialog && (
        <div className="absolute inset-0 z-50 bg-zinc-950/70 flex items-center justify-center">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-4 mx-4 w-full max-w-[220px]">
            <label className="block text-xs text-zinc-400 mb-1.5">Segmentation name</label>
            <input
              ref={namingInputRef}
              className="w-full text-xs text-zinc-200 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 outline-none focus:border-blue-500 transition-colors"
              value={namingValue}
              onChange={(e) => setNamingValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirmAddSegmentation();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelAddSegmentation();
                }
              }}
              placeholder="Enter name..."
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={cancelAddSegmentation}
                className="text-[10px] text-zinc-400 hover:text-zinc-200 px-2.5 py-1 rounded hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmAddSegmentation}
                disabled={!namingValue.trim()}
                className="text-[10px] text-blue-400 hover:text-blue-300 px-2.5 py-1 rounded bg-blue-900/30 hover:bg-blue-900/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Create
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
