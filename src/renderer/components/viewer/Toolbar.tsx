/**
 * Toolbar — horizontal toolbar for the viewer with icon+label tool buttons,
 * W/L presets, action buttons, cine controls, layout picker, and protocol picker.
 */
import { useViewerStore } from '../../stores/viewerStore';
import { useAnnotationStore } from '../../stores/annotationStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { ToolName, WL_PRESETS } from '@shared/types/viewer';
import type { LayoutType } from '@shared/types/viewer';
import { BUILT_IN_PROTOCOLS } from '@shared/types/hangingProtocol';
import AnnotationToolDropdown from './AnnotationToolDropdown';
import SegmentationToolDropdown from './SegmentationToolDropdown';
import ExportDropdown from './ExportDropdown';
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
  IconList,
  IconDocument,
  IconChevronDown,
  IconMPR,
  IconSegment,
} from '../icons';

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
}: {
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center justify-center p-1.5 rounded transition-colors ${
        active
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

/** Small layout grid icon button */
function LayoutButton({
  layout,
  active,
  onClick,
}: {
  layout: LayoutType;
  active: boolean;
  onClick: () => void;
}) {
  const grids: Record<LayoutType, [number, number]> = {
    '1x1': [1, 1],
    '1x2': [1, 2],
    '2x1': [2, 1],
    '2x2': [2, 2],
  };
  const [rows, cols] = grids[layout];

  return (
    <button
      onClick={onClick}
      title={`Layout: ${layout}`}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
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
          })
        )}
      </svg>
    </button>
  );
}

const LAYOUTS: LayoutType[] = ['1x1', '1x2', '2x1', '2x2'];

/** Stable fallback — must live outside the component to avoid infinite re-renders */
const DEFAULT_CINE = { isPlaying: false, fps: 15 } as const;

/** Toggle button for the annotation list panel */
function AnnotationPanelToggle() {
  const showPanel = useAnnotationStore((s) => s.showPanel);
  const togglePanel = useAnnotationStore((s) => s.togglePanel);
  const count = useAnnotationStore((s) => s.annotations.length);

  return (
    <button
      onClick={togglePanel}
      title={showPanel ? 'Hide annotation list' : 'Show annotation list'}
      className={`flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
        showPanel
          ? 'bg-blue-600 text-white'
          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
      }`}
    >
      <IconList className="w-3.5 h-3.5" />
      {count > 0 && <span>{count}</span>}
    </button>
  );
}

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

interface ToolbarProps {
  showDicomPanel?: boolean;
  onToggleDicomPanel?: () => void;
  onApplyProtocol?: (protocolId: string) => void;
  onToggleMPR?: () => void;
  hasImages?: boolean;
}

export default function Toolbar({ showDicomPanel = false, onToggleDicomPanel, onApplyProtocol, onToggleMPR, hasImages = false }: ToolbarProps) {
  const activeTool = useViewerStore((s) => s.activeTool);
  const layout = useViewerStore((s) => s.layout);
  const mprActive = useViewerStore((s) => s.mprActive);
  const cine = useViewerStore(
    (s) => s.cineStates[s.activeViewportId] ?? DEFAULT_CINE,
  );
  const currentProtocol = useViewerStore((s) => s.currentProtocol);
  const hasSessionData = useViewerStore((s) => s.sessionScans !== null);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const setLayout = useViewerStore((s) => s.setLayout);
  const applyWLPreset = useViewerStore((s) => s.applyWLPreset);
  const resetViewport = useViewerStore((s) => s.resetViewport);
  const toggleInvert = useViewerStore((s) => s.toggleInvert);
  const rotate90 = useViewerStore((s) => s.rotate90);
  const flipH = useViewerStore((s) => s.flipH);
  const flipV = useViewerStore((s) => s.flipV);
  const toggleCine = useViewerStore((s) => s.toggleCine);
  const setCineFps = useViewerStore((s) => s.setCineFps);

  return (
    <div className="h-10 bg-zinc-900 border-b border-zinc-800 flex items-center px-2 gap-1 shrink-0 overflow-x-auto">
      {/* ─── Layout Picker ──────────────────────────────── */}
      <div className={`flex items-center gap-0.5 ${mprActive ? 'opacity-40 pointer-events-none' : ''}`}>
        {LAYOUTS.map((l) => (
          <LayoutButton
            key={l}
            layout={l}
            active={layout === l && !mprActive}
            onClick={() => setLayout(l)}
          />
        ))}
      </div>

      {/* ─── Protocol Picker ──────────────────────────────── */}
      {hasSessionData && onApplyProtocol && !mprActive && (
        <>
          <Separator />
          <div className="relative">
            <select
              className="appearance-none bg-zinc-800 text-zinc-300 text-xs rounded px-2 py-1.5 pr-6 border border-zinc-700 cursor-pointer hover:bg-zinc-700 max-w-[160px] focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={currentProtocol?.id ?? ''}
              onChange={(e) => onApplyProtocol(e.target.value)}
              title="Hanging protocol"
            >
              <option value="" disabled>
                Protocol
              </option>
              {BUILT_IN_PROTOCOLS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <IconChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500" />
          </div>
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
      <div className="relative">
        <select
          className="appearance-none bg-zinc-800 text-zinc-300 text-xs rounded px-2 py-1.5 pr-6 border border-zinc-700 cursor-pointer hover:bg-zinc-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value=""
          onChange={(e) => {
            const preset = WL_PRESETS.find((p) => p.name === e.target.value);
            if (preset) {
              applyWLPreset(preset);
              setActiveTool(ToolName.WindowLevel);
            }
          }}
          title="Window/Level presets"
        >
          <option value="" disabled>
            Presets
          </option>
          {WL_PRESETS.map((preset) => (
            <option key={preset.name} value={preset.name}>
              {preset.name} (W:{preset.window} L:{preset.level})
            </option>
          ))}
        </select>
        <IconChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500" />
      </div>

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
      <ExportDropdown />

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
      <AnnotationPanelToggle />
      {!mprActive && <SegmentationPanelToggle />}
      {onToggleDicomPanel && (
        <DicomTagsToggle active={showDicomPanel} onToggle={onToggleDicomPanel} />
      )}
    </div>
  );
}
