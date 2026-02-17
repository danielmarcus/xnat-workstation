/**
 * SegmentationToolDropdown — dropdown button that exposes all segmentation tools
 * organized into three groups: Paint, Contour, and Fill.
 *
 * Follows the same pattern as AnnotationToolDropdown:
 * - Trigger button shows active seg tool name or "Segment"
 * - Blue highlight when any segmentation tool is the active left-click tool
 * - Fixed-position dropdown portal (escapes toolbar overflow)
 * - Outside-click-to-close
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useViewerStore } from '../../stores/viewerStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import {
  ToolName,
  SEGMENTATION_TOOLS,
  TOOL_DISPLAY_NAMES,
  LABELMAP_SEG_TOOLS,
  CONTOUR_SEG_TOOLS,
} from '@shared/types/viewer';
import { segmentationService } from '../../lib/cornerstone/segmentationService';
import {
  IconBrush,
  IconEraser,
  IconFreehandContour,
  IconSplineContour,
  IconLivewireContour,
  IconCircleScissors,
  IconRectangleScissors,
  IconSphereScissors,
  IconPaintFill,
  IconSculptor,
  IconSegmentSelect,
  IconRegionSegment,
  IconRegionSegmentPlus,
  IconSegmentBidirectional,
  IconRectangleROIThreshold,
  IconCircleROIThreshold,
  IconLabelmapEditContour,
} from '../icons';

/** Tool group definition for structured dropdown */
interface ToolGroup {
  label: string;
  tools: ToolName[];
}

/** Ordered groups of segmentation tools */
const SEG_TOOL_GROUPS: ToolGroup[] = [
  {
    label: 'Paint Tools',
    tools: [ToolName.Brush, ToolName.Eraser, ToolName.ThresholdBrush],
  },
  {
    label: 'Contour Tools',
    tools: [
      ToolName.FreehandContour,
      ToolName.SplineContour,
      ToolName.LivewireContour,
      ToolName.Sculptor,
      ToolName.LabelmapEditWithContour,
    ],
  },
  {
    label: 'Fill Tools',
    tools: [
      ToolName.CircleScissors,
      ToolName.RectangleScissors,
      ToolName.SphereScissors,
      ToolName.PaintFill,
    ],
  },
  {
    label: 'Smart Tools',
    tools: [
      ToolName.RegionSegment,
      ToolName.RegionSegmentPlus,
      ToolName.RectangleROIThreshold,
      ToolName.CircleROIThreshold,
    ],
  },
  {
    label: 'Utility',
    tools: [ToolName.SegmentSelect, ToolName.SegmentBidirectional],
  },
];

/** Inline icon for threshold brush */
function IconThresholdBrush({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'w-4 h-4'}
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

/** Icon map for all segmentation tools */
function SegToolIcon({ tool }: { tool: ToolName }) {
  const cls = 'w-4 h-4 shrink-0';
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
    case ToolName.Sculptor:
      return <IconSculptor className={cls} />;
    case ToolName.SphereScissors:
      return <IconSphereScissors className={cls} />;
    case ToolName.SegmentSelect:
      return <IconSegmentSelect className={cls} />;
    case ToolName.RegionSegment:
      return <IconRegionSegment className={cls} />;
    case ToolName.RegionSegmentPlus:
      return <IconRegionSegmentPlus className={cls} />;
    case ToolName.SegmentBidirectional:
      return <IconSegmentBidirectional className={cls} />;
    case ToolName.RectangleROIThreshold:
      return <IconRectangleROIThreshold className={cls} />;
    case ToolName.CircleROIThreshold:
      return <IconCircleROIThreshold className={cls} />;
    case ToolName.LabelmapEditWithContour:
      return <IconLabelmapEditContour className={cls} />;
    default:
      return <span className="w-4 h-4 text-[10px] text-center">?</span>;
  }
}

export default function SegmentationToolDropdown() {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const activeTool = useViewerStore((s) => s.activeTool);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const activeSegmentationId = useSegmentationStore((s) => s.activeSegmentationId);
  const dicomTypeBySegmentationId = useSegmentationStore((s) => s.dicomTypeBySegmentationId);

  const isSegActive = SEGMENTATION_TOOLS.has(activeTool);
  const activeAnnotationType = activeSegmentationId
    ? (dicomTypeBySegmentationId[activeSegmentationId]
      ?? segmentationService.getPreferredDicomType(activeSegmentationId))
    : null;
  const disableLabelmapTools = activeAnnotationType === 'RTSTRUCT';
  const disableContourTools = activeAnnotationType === 'SEG';

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        buttonRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleToggle = useCallback(() => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((v) => !v);
  }, [open]);

  const handleSelect = useCallback(
    (tool: ToolName) => {
      const isLabelmapTool = LABELMAP_SEG_TOOLS.has(tool);
      const isContourTool = CONTOUR_SEG_TOOLS.has(tool);
      if ((disableLabelmapTools && isLabelmapTool) || (disableContourTools && isContourTool)) {
        return;
      }
      setActiveTool(tool);
      setOpen(false);
    },
    [setActiveTool, disableLabelmapTools, disableContourTools],
  );

  return (
    <>
      {/* Trigger button — shows icon + "Annotate" text when a tool is active, or just "Annotate" when inactive */}
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className={`flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
          isSegActive
            ? 'bg-blue-600 text-white'
            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
        }`}
        title={isSegActive ? `Annotate: ${TOOL_DISPLAY_NAMES[activeTool]}` : 'Segmentation/structure annotation tools'}
      >
        {isSegActive && <SegToolIcon tool={activeTool} />}
        Annotate
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="2,4 6,8 10,4" />
        </svg>
      </button>

      {/* Dropdown panel — fixed position to escape toolbar overflow clipping */}
      {open && (
        <div
          ref={dropdownRef}
          className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-2 min-w-[200px]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          {SEG_TOOL_GROUPS.map((group, groupIdx) => (
            <div key={group.label}>
              {/* Section divider (not before first group) */}
              {groupIdx > 0 && <div className="border-t border-zinc-700/60 my-1" />}

              {/* Section header */}
              <div className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                {group.label}
              </div>

              {/* Tool items */}
              <div className="flex flex-col gap-0.5">
                {group.tools.map((tool) => {
                  const isActive = activeTool === tool;
                  const isLabelmapTool = LABELMAP_SEG_TOOLS.has(tool);
                  const isContourTool = CONTOUR_SEG_TOOLS.has(tool);
                  const disabled =
                    (disableLabelmapTools && isLabelmapTool) ||
                    (disableContourTools && isContourTool);
                  return (
                    <button
                      key={tool}
                      onClick={() => handleSelect(tool)}
                      disabled={disabled}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded text-xs transition-colors ${
                        disabled
                          ? 'text-zinc-600 bg-zinc-900/60 cursor-not-allowed'
                          : isActive
                          ? 'bg-blue-600 text-white'
                          : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
                      }`}
                      title={
                        disabled
                          ? (activeAnnotationType === 'RTSTRUCT'
                            ? 'Disabled for structure annotation mode'
                            : 'Disabled for segmentation annotation mode')
                          : undefined
                      }
                    >
                      <SegToolIcon tool={tool} />
                      {TOOL_DISPLAY_NAMES[tool]}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
