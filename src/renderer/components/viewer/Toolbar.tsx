/**
 * Toolbar — horizontal toolbar for the viewer with icon+label tool buttons,
 * W/L presets, action buttons, cine controls, layout picker, and protocol picker.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useViewerStore } from '../../stores/viewerStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { ToolName, WL_PRESETS } from '@shared/types/viewer';
import type { LayoutType } from '@shared/types/viewer';
import { BUILT_IN_PROTOCOLS } from '@shared/types/hangingProtocol';
import AnnotationToolDropdown from './AnnotationToolDropdown';
import SegmentationToolDropdown from './SegmentationToolDropdown';
import {
  IconWindowLevel,
  IconPan,
  IconZoom,
  IconReset,
  IconInvert,
  IconRotate90,
  IconFlipH,
  IconFlipV,
  IconPlay,
  IconStop,
  IconDocument,
  IconChevronDown,
  IconMPR,
  IconSegment,
  IconProtocol,
  IconUndo,
  IconRedo,
} from '../icons';
import { segmentationService } from '../../lib/cornerstone/segmentationService';

// ─── Shared Button Components ─────────────────────────────────────

/** Icon + optional label toolbar button */
function ToolButton({
  icon,
  label,
  active,
  onClick,
  title,
}: {
  icon?: React.ReactNode;
  label?: string;
  active?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className={`flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
      }`}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

/** Icon-only toolbar button (smaller padding) */
function IconButton({
  icon,
  active,
  onClick,
  title,
  disabled,
}: {
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`flex items-center justify-center p-1.5 rounded transition-colors ${
        disabled
          ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-40'
          : active
            ? 'bg-blue-600 text-white'
            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
      }`}
    >
      {icon}
    </button>
  );
}

/** Separator line between toolbar groups */
function Separator() {
  return <div className="w-px h-6 bg-zinc-700 mx-0.5" />;
}

function LayoutGridIcon({ rows, cols, className = '' }: { rows: number; cols: number; className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none">
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => {
          const gap = 1.5;
          const cellW = (16 - (cols - 1) * gap) / cols;
          const cellH = (16 - (rows - 1) * gap) / rows;
          return (
            <rect
              key={`${r}-${c}`}
              x={c * (cellW + gap)}
              y={r * (cellH + gap)}
              width={cellW}
              height={cellH}
              rx={1.5}
              fill="currentColor"
              opacity={0.8}
            />
          );
        }),
      )}
    </svg>
  );
}

const LAYOUT_PRESETS: { id: LayoutType; label: string; rows: number; cols: number }[] = [
  { id: '1x1', label: '1 x 1', rows: 1, cols: 1 },
  { id: '1x2', label: '1 x 2', rows: 1, cols: 2 },
  { id: '2x1', label: '2 x 1', rows: 2, cols: 1 },
  { id: '2x2', label: '2 x 2', rows: 2, cols: 2 },
];

function LayoutDropdown({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [customRows, setCustomRows] = useState(2);
  const [customCols, setCustomCols] = useState(2);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const layout = useViewerStore((s) => s.layout);
  const layoutConfig = useViewerStore((s) => s.layoutConfig);
  const setLayout = useViewerStore((s) => s.setLayout);
  const setCustomLayout = useViewerStore((s) => s.setCustomLayout);

  useEffect(() => {
    if (!open) return;
    setCustomRows(layoutConfig.rows);
    setCustomCols(layoutConfig.cols);
  }, [open, layoutConfig.rows, layoutConfig.cols]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        buttonRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleToggle = useCallback(() => {
    if (disabled) return;
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = 240;
      const maxLeft = window.innerWidth - dropdownWidth - 8;
      setDropdownPos({ top: rect.bottom + 4, left: Math.min(rect.left, maxLeft) });
    }
    setOpen((v) => !v);
  }, [disabled, open]);

  const applyCustomLayout = useCallback(() => {
    setCustomLayout(customRows, customCols);
    setOpen(false);
  }, [customCols, customRows, setCustomLayout]);

  const currentLabel = layout === 'custom' ? `Custom ${layoutConfig.rows} x ${layoutConfig.cols}` : layout;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleToggle}
        title={`Viewport layout (${currentLabel})`}
        disabled={disabled}
        className={`flex items-center gap-1 px-2 py-1.5 rounded transition-colors ${
          disabled
            ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
            : open
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
        }`}
      >
        <LayoutGridIcon rows={2} cols={2} />
        <IconChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div
          ref={dropdownRef}
          className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-2 min-w-[240px]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <p className="px-1 pb-1 text-[10px] uppercase tracking-wide text-zinc-500">Presets</p>
          <div className="space-y-1 mb-2">
            {LAYOUT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  setLayout(preset.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-xs transition-colors ${
                  layout === preset.id
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                }`}
              >
                <span>{preset.label}</span>
                <LayoutGridIcon rows={preset.rows} cols={preset.cols} className="text-zinc-400" />
              </button>
            ))}
          </div>

          <div className="border-t border-zinc-700 pt-2">
            <p className="px-1 pb-1 text-[10px] uppercase tracking-wide text-zinc-500">Custom Grid</p>
            <div className="flex items-center gap-2 px-1">
              <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                <span>R</span>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={customRows}
                  onChange={(e) => setCustomRows(parseInt(e.target.value || '1', 10))}
                  className="w-12 px-1.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                <span>C</span>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={customCols}
                  onChange={(e) => setCustomCols(parseInt(e.target.value || '1', 10))}
                  className="w-12 px-1.5 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs"
                />
              </label>
              <button
                onClick={applyCustomLayout}
                className="ml-auto px-2.5 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-500 transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Stable fallback — must live outside the component to avoid infinite re-renders */
const DEFAULT_CINE = { isPlaying: false, fps: 15 } as const;

/** Toggle button for the segmentation panel */
function SegmentationPanelToggle() {
  const showPanel = useSegmentationStore((s) => s.showPanel);
  const togglePanel = useSegmentationStore((s) => s.togglePanel);
  const count = useSegmentationStore((s) => s.segmentations.length);

  return (
    <button
      onClick={togglePanel}
      title={showPanel ? 'Hide segmentation panel' : 'Show segmentation panel'}
      className={`flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
        showPanel
          ? 'bg-blue-600 text-white'
          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
      }`}
    >
      <IconSegment className="w-3.5 h-3.5" />
      {count > 0 && <span>{count}</span>}
    </button>
  );
}

/** Toggle button for the DICOM tags inspector panel */
function DicomTagsToggle({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      title={active ? 'Hide DICOM tags' : 'Show DICOM tags'}
      className={`flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
      }`}
    >
      <IconDocument className="w-3.5 h-3.5" />
      <span>Tags</span>
    </button>
  );
}

/** Custom W/L presets dropdown — matches the styling of other toolbar dropdowns */
function WLPresetsDropdown() {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const applyWLPreset = useViewerStore((s) => s.applyWLPreset);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        buttonRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleToggle = useCallback(() => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = 200;
      const maxLeft = window.innerWidth - dropdownWidth - 8;
      setDropdownPos({ top: rect.bottom + 4, left: Math.min(rect.left, maxLeft) });
    }
    setOpen((v) => !v);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className={`flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded transition-colors ${
          open
            ? 'bg-blue-600 text-white'
            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
        }`}
        title="Window/Level presets"
      >
        <IconWindowLevel className="w-3.5 h-3.5" />
        <span>Presets</span>
        <IconChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div
          ref={dropdownRef}
          className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-1.5 min-w-[200px]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {WL_PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => {
                applyWLPreset(preset);
                setActiveTool(ToolName.WindowLevel);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white rounded transition-colors"
            >
              <span>{preset.name}</span>
              <span className="text-zinc-500 text-[10px] tabular-nums">
                W:{preset.window} L:{preset.level}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Custom protocol picker dropdown — matches the styling of other toolbar dropdowns */
function ProtocolPickerDropdown({
  onApplyProtocol,
  currentProtocolId,
}: {
  onApplyProtocol: (protocolId: string) => void;
  currentProtocolId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        buttonRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleToggle = useCallback(() => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = 220;
      const maxLeft = window.innerWidth - dropdownWidth - 8;
      setDropdownPos({ top: rect.bottom + 4, left: Math.min(rect.left, maxLeft) });
    }
    setOpen((v) => !v);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className={`flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded transition-colors ${
          open
            ? 'bg-blue-600 text-white'
            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
        }`}
        title="Hanging protocol"
      >
        <IconProtocol className="w-3.5 h-3.5" />
        <span>Protocol</span>
        <IconChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div
          ref={dropdownRef}
          className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-1.5 min-w-[220px]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {BUILT_IN_PROTOCOLS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onApplyProtocol(p.id);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded transition-colors ${
                currentProtocolId === p.id
                  ? 'bg-blue-600/20 text-blue-300'
                  : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <span>{p.name}</span>
              <span className="text-zinc-500 text-[10px]">{p.layout}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ToolbarProps {
  showDicomPanel?: boolean;
  onToggleDicomPanel?: () => void;
  onApplyProtocol?: (protocolId: string) => void;
  onToggleMPR?: () => void;
  hasImages?: boolean;
  /** Optional content rendered at the far left of the toolbar (e.g. XNAT logo, connection status) */
  leftSlot?: React.ReactNode;
}

export default function Toolbar({ showDicomPanel = false, onToggleDicomPanel, onApplyProtocol, onToggleMPR, hasImages = false, leftSlot }: ToolbarProps) {
  const activeTool = useViewerStore((s) => s.activeTool);
  const mprActive = useViewerStore((s) => s.mprActive);
  const cine = useViewerStore(
    (s) => s.cineStates[s.activeViewportId] ?? DEFAULT_CINE,
  );
  const currentProtocol = useViewerStore((s) => s.currentProtocol);
  const hasSessionData = useViewerStore((s) => s.sessionScans !== null);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const resetViewport = useViewerStore((s) => s.resetViewport);
  const toggleInvert = useViewerStore((s) => s.toggleInvert);
  const rotate90 = useViewerStore((s) => s.rotate90);
  const flipH = useViewerStore((s) => s.flipH);
  const flipV = useViewerStore((s) => s.flipV);
  const toggleCine = useViewerStore((s) => s.toggleCine);
  const setCineFps = useViewerStore((s) => s.setCineFps);
  const canUndo = useSegmentationStore((s) => s.canUndo);
  const canRedo = useSegmentationStore((s) => s.canRedo);

  return (
    <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center px-2 gap-1 shrink-0">
      {/* ─── Left Slot (XNAT logo, connection, etc.) ─── */}
      {leftSlot && (
        <>
          {leftSlot}
          <Separator />
        </>
      )}

      {/* ─── Layout Picker ──────────────────────────────── */}
      <div className={`flex items-center gap-0.5 ${mprActive ? 'opacity-40 pointer-events-none' : ''}`}>
        <LayoutDropdown disabled={mprActive} />
      </div>

      {/* ─── Protocol Picker ──────────────────────────────── */}
      {hasSessionData && onApplyProtocol && !mprActive && (
        <>
          <Separator />
          <ProtocolPickerDropdown
            onApplyProtocol={onApplyProtocol}
            currentProtocolId={currentProtocol?.id ?? null}
          />
        </>
      )}

      <Separator />

      {/* ─── MPR Toggle ──────────────────────────────────── */}
      {onToggleMPR && (
        <>
          <button
            onClick={onToggleMPR}
            disabled={!hasImages && !mprActive}
            title={mprActive ? 'Exit MPR mode' : 'Enter MPR mode'}
            className={`flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
              mprActive
                ? 'bg-blue-600 text-white'
                : !hasImages
                  ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
            }`}
          >
            <IconMPR className="w-3.5 h-3.5" />
            <span>MPR</span>
          </button>
          <Separator />
        </>
      )}

      {/* ─── Interaction Tools ──────────────────────────── */}
      {!mprActive && (
        <>
          <ToolButton
            icon={<IconWindowLevel className="w-3.5 h-3.5" />}
            label="W/L"
            active={activeTool === ToolName.WindowLevel}
            onClick={() => setActiveTool(ToolName.WindowLevel)}
            title="Window/Level (left-click drag)"
          />
          <ToolButton
            icon={<IconPan className="w-3.5 h-3.5" />}
            label="Pan"
            active={activeTool === ToolName.Pan}
            onClick={() => setActiveTool(ToolName.Pan)}
            title="Pan (left-click drag)"
          />
          <ToolButton
            icon={<IconZoom className="w-3.5 h-3.5" />}
            label="Zoom"
            active={activeTool === ToolName.Zoom}
            onClick={() => setActiveTool(ToolName.Zoom)}
            title="Zoom (left-click drag)"
          />
          <AnnotationToolDropdown />
          <SegmentationToolDropdown />
        </>
      )}
      {mprActive && (
        <span className="text-[11px] text-zinc-500 px-1">
          Crosshairs: left-click &middot; Pan: middle-click &middot; Zoom: right-click
        </span>
      )}

      <Separator />

      {/* ─── W/L Presets ──────────────────────────────── */}
      <WLPresetsDropdown />

      <Separator />

      {/* ─── Action Buttons ──────────────────────────── */}
      <IconButton
        icon={<IconReset className="w-3.5 h-3.5" />}
        onClick={resetViewport}
        title="Reset viewport"
      />
      <IconButton
        icon={<IconInvert className="w-3.5 h-3.5" />}
        onClick={toggleInvert}
        title="Toggle invert"
      />
      <IconButton
        icon={<IconRotate90 className="w-3.5 h-3.5" />}
        onClick={rotate90}
        title="Rotate 90°"
      />
      <IconButton
        icon={<IconFlipH className="w-3.5 h-3.5" />}
        onClick={flipH}
        title="Flip horizontal"
      />
      <IconButton
        icon={<IconFlipV className="w-3.5 h-3.5" />}
        onClick={flipV}
        title="Flip vertical"
      />

      {/* ─── Undo / Redo ──────────────────────────────── */}
      <Separator />
      <IconButton
        icon={<IconUndo className="w-3.5 h-3.5" />}
        onClick={() => segmentationService.undo()}
        title="Undo (Ctrl+Z)"
        disabled={!canUndo}
      />
      <IconButton
        icon={<IconRedo className="w-3.5 h-3.5" />}
        onClick={() => segmentationService.redo()}
        title="Redo (Ctrl+Shift+Z)"
        disabled={!canRedo}
      />

      {/* ─── Cine Controls (hidden in MPR mode) ──────── */}
      {!mprActive && (
        <>
          <Separator />
          <IconButton
            icon={cine.isPlaying ? <IconStop className="w-3.5 h-3.5" /> : <IconPlay className="w-3.5 h-3.5" />}
            active={cine.isPlaying}
            onClick={toggleCine}
            title={cine.isPlaying ? 'Stop cine' : 'Play cine'}
          />
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <input
              type="range"
              min={1}
              max={60}
              value={cine.fps}
              onChange={(e) => setCineFps(parseInt(e.target.value, 10))}
              className="w-14 h-1 accent-blue-500 cursor-pointer"
              title={`${cine.fps} FPS`}
            />
            <span className="w-8 text-right tabular-nums text-[11px]">{cine.fps} fps</span>
          </div>
        </>
      )}

      <Separator />

      {/* ─── Panel Toggles ─────────────────────────── */}
      {!mprActive && <SegmentationPanelToggle />}
      {onToggleDicomPanel && (
        <DicomTagsToggle active={showDicomPanel} onToggle={onToggleDicomPanel} />
      )}
    </div>
  );
}
