/**
 * AnnotationsPanel (Rebuild Phase 3, R3.8) — the connected, mountable panel.
 * Wires useAnnotationsPanel into the presentational shell + list + toolbox. This
 * is what ViewerPage mounts (replacing the legacy SegmentationPanel on the Segment
 * toggle). The frozen-mockup visual contract is verified against this live render.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import AnnotationsSidePanel from './AnnotationsSidePanel';
import ContainerList from './ContainerList';
import ContextToolbox from './ContextToolbox';
import { ConfirmDialog, ConflictDialog, ReviewUnsavedDialog } from './dialogs';
import { useAnnotationsPanel } from '../../hooks/useAnnotationsPanel';
import { usePreferencesStore } from '../../stores/preferencesStore';
import {
  ANNOTATION_PANEL_MIN_WIDTH,
  ANNOTATION_PANEL_MAX_WIDTH,
  ANNOTATION_PANEL_COMPACT_TOOLS_WIDTH,
  clampAnnotationPanelWidth,
} from '@shared/types/preferences';

export interface AnnotationsPanelProps {
  activeViewportId: string;
  sourceImageIds: string[];
}

export default function AnnotationsPanel({ activeViewportId, sourceImageIds }: AnnotationsPanelProps) {
  const panel = useAnnotationsPanel(activeViewportId, sourceImageIds);

  // Resizable width (spec §4.1). The persisted value survives reloads; `dragWidth`
  // holds the in-flight value so the store isn't written on every pointermove.
  const persistedWidth = usePreferencesStore((s) => s.preferences.annotationPanel.width);
  const setAnnotationPanelWidth = usePreferencesStore((s) => s.setAnnotationPanelWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const panelWidth = clampAnnotationPanelWidth(dragWidth ?? persistedWidth);
  const panelRootRef = useRef<HTMLDivElement | null>(null);

  // Below this width the toolbox drops labels and shows icons only; between here and
  // the default width the labels simply ellipsize.
  const compactTools = panelWidth < ANNOTATION_PANEL_COMPACT_TOOLS_WIDTH;

  // Drag handle on the LEFT edge: the panel's right edge is anchored to the window, so
  // width = rightEdge - cursorX.
  const onResizeHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    // setPointerCapture is absent in jsdom; guard for tests and for safety.
    if (typeof target.setPointerCapture === 'function') {
      try { target.setPointerCapture(e.pointerId); } catch { /* noop */ }
    }
    const panelEl = panelRootRef.current;
    if (!panelEl) return;
    const rightEdge = panelEl.getBoundingClientRect().right;
    const handleMove = (ev: PointerEvent) => setDragWidth(clampAnnotationPanelWidth(rightEdge - ev.clientX));
    const handleUp = (ev: PointerEvent) => {
      if (typeof target.releasePointerCapture === 'function') {
        try { target.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      }
      target.removeEventListener('pointermove', handleMove);
      target.removeEventListener('pointerup', handleUp);
      target.removeEventListener('pointercancel', handleUp);
      setDragWidth(null);
      setAnnotationPanelWidth(clampAnnotationPanelWidth(rightEdge - ev.clientX));
    };
    target.addEventListener('pointermove', handleMove);
    target.addEventListener('pointerup', handleUp);
    target.addEventListener('pointercancel', handleUp);
  };

  const toolbox = panel.toolbox ? (
    <ContextToolbox
      kind={panel.toolbox.kind}
      activeMemberName={panel.toolbox.activeMemberName}
      activeMemberColor={panel.toolbox.activeMemberColor}
      activeToolId={panel.toolbox.activeToolId}
      onSelectTool={panel.toolbox.onSelectTool}
      controls={panel.toolbox.controls}
      backupStatus={panel.backupStatus?.text}
      backupStatusKind={panel.backupStatus?.kind}
      compact={compactTools}
    />
  ) : undefined;

  return (
    <div
      ref={panelRootRef}
      data-testid="annotations-panel-root"
      data-panel-width={panelWidth}
      style={{ width: `${panelWidth}px` }}
      className="shrink-0 h-full relative"
    >
      {/* Left-edge drag handle (spec §4.1): 4px hit area, 1px accent on hover. */}
      <div
        data-testid="annotations-panel-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize annotations panel"
        aria-valuemin={ANNOTATION_PANEL_MIN_WIDTH}
        aria-valuemax={ANNOTATION_PANEL_MAX_WIDTH}
        aria-valuenow={panelWidth}
        onPointerDown={onResizeHandlePointerDown}
        className="absolute left-0 top-0 h-full w-1 -ml-0.5 z-10 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors"
      />
      <AnnotationsSidePanel
        containerCount={panel.containerCount}
        canCreate={panel.canCreate}
        unsavedCount={panel.unsavedCount}
        onCreate={panel.onCreate}
        onReviewUnsaved={panel.onReviewUnsaved}
        toolbox={toolbox}
      >
        <ContainerList
          containers={panel.containers}
          handlers={panel.handlers}
          isExpanded={panel.isExpanded}
          isActive={panel.isActive}
          isSelected={panel.isSelected}
          metricOf={panel.metricOf}
          provenanceOf={panel.provenanceOf}
          emptyOf={panel.emptyOf}
          palette={panel.palette}
          transportOf={panel.transportOf}
          autoEditContainerId={panel.autoEditContainerId}
          autoEditMemberKey={panel.autoEditMemberKey}
          onEditConsumed={panel.onEditConsumed}
        />
      </AnnotationsSidePanel>
      {panel.reviewDialog && (
        <ReviewUnsavedDialog
          entries={panel.reviewDialog.entries}
          onSaveOne={panel.reviewDialog.onSaveOne}
          onSaveAll={panel.reviewDialog.onSaveAll}
          onClose={panel.reviewDialog.onClose}
        />
      )}
      {panel.conflictDialog && (
        <ConflictDialog
          containerLabel={panel.conflictDialog.containerLabel}
          onKeepLocal={panel.conflictDialog.onKeepLocal}
          onDiscardLocal={panel.conflictDialog.onDiscardLocal}
          onInspect={panel.conflictDialog.onInspect}
          onCancel={panel.conflictDialog.onCancel}
        />
      )}
      {panel.approvalDialog && (
        <ConfirmDialog
          title={panel.approvalDialog.title}
          body={panel.approvalDialog.body}
          confirmLabel={panel.approvalDialog.confirmLabel}
          variant={panel.approvalDialog.variant}
          onConfirm={panel.approvalDialog.onConfirm}
          onCancel={panel.approvalDialog.onCancel}
        />
      )}
      {panel.deleteFromServerDialog && (
        <ConfirmDialog
          title={panel.deleteFromServerDialog.title}
          body={
            panel.deleteFromServerDialog.toTrash
              ? `Scan ${panel.deleteFromServerDialog.scanId} will be moved to the server trash resource (recoverable) and removed from the workstation.`
              : `Scan ${panel.deleteFromServerDialog.scanId} will be permanently deleted from the server and removed from the workstation. This cannot be undone.`
          }
          confirmLabel="Delete from XNAT"
          busyLabel="Deleting…"
          variant="danger"
          busy={panel.deleteFromServerDialog.busy}
          error={panel.deleteFromServerDialog.error}
          onConfirm={panel.deleteFromServerDialog.onConfirm}
          onCancel={panel.deleteFromServerDialog.onCancel}
        />
      )}
    </div>
  );
}
