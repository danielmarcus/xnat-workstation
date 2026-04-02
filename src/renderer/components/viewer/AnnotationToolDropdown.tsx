/**
 * AnnotationToolDropdown — dropdown button that exposes all 9 annotation/measurement
 * tools in a compact 2-column grid. Replaces the standalone Length button in the toolbar.
 *
 * The trigger button shows the currently active annotation tool name and is highlighted
 * (blue) when any annotation tool is the active left-click tool.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useViewerStore } from '../../stores/viewerStore';
import { ToolName, ANNOTATION_TOOLS, TOOL_DISPLAY_NAMES } from '@shared/types/viewer';

/** Ordered list of annotation tools for the dropdown grid */
const ANNOTATION_TOOL_LIST: ToolName[] = [
  ToolName.Length,
  ToolName.Angle,
  ToolName.Bidirectional,
  ToolName.Probe,
  ToolName.EllipticalROI,
  ToolName.RectangleROI,
  ToolName.CircleROI,
  ToolName.PlanarFreehandROI,
  ToolName.ArrowAnnotate,
];

/** Simple 16x16 inline SVG icons for each annotation tool */
function ToolIcon({ tool }: { tool: ToolName }) {
  const cls = 'w-4 h-4 shrink-0';

  switch (tool) {
    case ToolName.Length:
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="2" y1="14" x2="14" y2="2" />
          <line x1="2" y1="14" x2="2" y2="10" />
          <line x1="2" y1="14" x2="6" y2="14" />
          <line x1="14" y1="2" x2="14" y2="6" />
          <line x1="14" y1="2" x2="10" y2="2" />
        </svg>
      );
    case ToolName.Angle:
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polyline points="2,13 8,5 14,13" />
          <path d="M5.5 9.5 Q8 8 10.5 9.5" />
        </svg>
      );
    case ToolName.Bidirectional:
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="2" y1="8" x2="14" y2="8" />
          <line x1="8" y1="4" x2="8" y2="12" />
          <circle cx="2" cy="8" r="1" fill="currentColor" />
          <circle cx="14" cy="8" r="1" fill="currentColor" />
        </svg>
      );
    case ToolName.EllipticalROI:
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <ellipse cx="8" cy="8" rx="6" ry="4" />
        </svg>
      );
    case ToolName.RectangleROI:
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="3" width="12" height="10" rx="1" />
        </svg>
      );
    case ToolName.CircleROI:
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="6" />
        </svg>
      );
    case ToolName.Probe:
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="2" fill="currentColor" />
          <line x1="8" y1="2" x2="8" y2="5" />
          <line x1="8" y1="11" x2="8" y2="14" />
          <line x1="2" y1="8" x2="5" y2="8" />
          <line x1="11" y1="8" x2="14" y2="8" />
        </svg>
      );
    case ToolName.ArrowAnnotate:
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="3" y1="13" x2="12" y2="4" />
          <polyline points="8,3 12,4 13,8" fill="none" />
        </svg>
      );
    case ToolName.PlanarFreehandROI:
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 12 Q2 8 4 5 Q6 2 9 4 Q12 6 13 9 Q14 12 10 13 Q7 14 4 12 Z" />
        </svg>
      );
    default:
      return <span className="w-4 h-4 text-[10px] text-center">?</span>;
  }
}

export default function AnnotationToolDropdown({ hideLabel = false }: { hideLabel?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const activeTool = useViewerStore((s) => s.activeTool);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);

  const isAnnotationActive = ANNOTATION_TOOLS.has(activeTool);

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
      setActiveTool(tool);
      setOpen(false);
    },
    [setActiveTool],
  );

  return (
    <>
      {/* Trigger button — shows icon + "Measure" text when a tool is active, or just "Measure" when inactive */}
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className={`flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
          isAnnotationActive
            ? 'bg-blue-600 text-white'
            : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
        }`}
        title={isAnnotationActive ? `Measure: ${TOOL_DISPLAY_NAMES[activeTool]}` : 'Annotation & measurement tools'}
      >
        {isAnnotationActive && <ToolIcon tool={activeTool} />}
        {!hideLabel && 'Measure'}
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
          className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-2 min-w-[280px]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <div className="grid grid-cols-2 gap-1">
            {ANNOTATION_TOOL_LIST.map((tool) => {
              const isActive = activeTool === tool;
              return (
                <button
                  key={tool}
                  onClick={() => handleSelect(tool)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded text-xs transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
                  }`}
                >
                  <ToolIcon tool={tool} />
                  {TOOL_DISPLAY_NAMES[tool]}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
