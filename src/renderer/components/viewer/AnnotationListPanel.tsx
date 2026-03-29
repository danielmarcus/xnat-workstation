/**
 * AnnotationListPanel — collapsible right-side panel listing all annotations
 * with their measurements. Supports select (highlight on viewport), delete,
 * and clear-all functionality.
 */
import { useAnnotationStore } from '../../stores/annotationStore';
import { annotationService } from '../../lib/cornerstone/annotationService';
import { IconTrash, IconClose } from '../icons';

export default function AnnotationListPanel() {
  const annotations = useAnnotationStore((s) => s.annotations);
  const selectedUID = useAnnotationStore((s) => s.selectedUID);

  return (
    <div data-testid="annotation-panel" className="w-64 shrink-0 border-l border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between min-h-[36px]">
        <h3 className="text-xs font-semibold text-zinc-300">
          Annotations
          <span data-testid="annotation-count" className="text-zinc-500 font-normal ml-1.5">{annotations.length}</span>
        </h3>
        {annotations.length > 0 && (
          <button
            onClick={() => annotationService.removeAllAnnotations()}
            className="flex items-center gap-1 text-[10px] text-red-400/80 hover:text-red-300 transition-colors px-1.5 py-0.5 rounded hover:bg-red-900/20"
            title="Remove all annotations"
          >
            <IconTrash className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      {/* Annotation list */}
      <div className="flex-1 overflow-y-auto">
        {annotations.length === 0 ? (
          <div className="p-4 text-xs text-zinc-600 text-center leading-relaxed">
            No annotations yet.
            <br />
            <span className="text-zinc-700">Select a measurement tool and draw on the viewport.</span>
          </div>
        ) : (
          <ul className="py-0.5">
            {annotations.map((ann) => {
              const isSelected = selectedUID === ann.annotationUID;
              return (
                <li
                  key={ann.annotationUID}
                  onClick={() =>
                    annotationService.selectAnnotation(
                      isSelected ? null : ann.annotationUID,
                    )
                  }
                  className={`group flex items-start gap-2 px-3 py-2 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-900/30 border-l-2 border-blue-500'
                      : 'hover:bg-zinc-800/50 border-l-2 border-transparent'
                  }`}
                >
                  {/* Tool name + measurement */}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-zinc-300 truncate">
                      {ann.displayName}
                      {ann.label ? `: ${ann.label}` : ''}
                    </div>
                    {ann.displayText && (
                      <div className="text-[11px] text-zinc-500 truncate mt-0.5 tabular-nums">
                        {ann.displayText}
                      </div>
                    )}
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      annotationService.removeAnnotation(ann.annotationUID);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-all p-0.5 shrink-0 rounded hover:bg-red-900/20"
                    title="Delete annotation"
                  >
                    <IconClose className="w-3 h-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
