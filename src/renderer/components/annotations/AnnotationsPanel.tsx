/**
 * AnnotationsPanel (Rebuild Phase 3, R3.8) — the connected, mountable panel.
 * Wires useAnnotationsPanel into the presentational shell + list + toolbox. This
 * is what ViewerPage mounts (replacing the legacy SegmentationPanel on the Segment
 * toggle). The frozen-mockup visual contract is verified against this live render.
 */
import AnnotationsSidePanel from './AnnotationsSidePanel';
import ContainerList from './ContainerList';
import ContextToolbox from './ContextToolbox';
import { ConflictDialog, ReviewUnsavedDialog } from './dialogs';
import { useAnnotationsPanel } from '../../hooks/useAnnotationsPanel';

export interface AnnotationsPanelProps {
  activeViewportId: string;
  sourceImageIds: string[];
}

export default function AnnotationsPanel({ activeViewportId, sourceImageIds }: AnnotationsPanelProps) {
  const panel = useAnnotationsPanel(activeViewportId, sourceImageIds);

  const toolbox = panel.toolbox ? (
    <ContextToolbox
      kind={panel.toolbox.kind}
      activeMemberName={panel.toolbox.activeMemberName}
      activeMemberColor={panel.toolbox.activeMemberColor}
      activeToolId={panel.toolbox.activeToolId}
      onSelectTool={panel.toolbox.onSelectTool}
    />
  ) : undefined;

  return (
    <div className="w-72 shrink-0 h-full">
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
    </div>
  );
}
