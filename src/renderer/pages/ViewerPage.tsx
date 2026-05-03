/**
 * ViewerPage — composes Toolbar + ViewportGrid + side panels into a
 * full-height viewer layout. Supports 1×1, 1×2, 2×1, 2×2 layouts and
 * the mpr-2x2 preset (axial/sagittal/coronal panels backed by a shared
 * volume) routed through the standard ViewportGrid.
 *
 * After Phase 6 / Stage 2B.4 ContainerListPanel is the sole side
 * surface for managing annotations; the legacy SegmentationPanel and
 * AnnotationListPanel are gone. The annotations panel toggles on/off
 * via `useSegmentationStore.showPanel` (preserved name, repurposed
 * meaning).
 */
import { useEffect, useState, useCallback } from 'react';
import Toolbar from '../components/viewer/Toolbar';
import ViewportGrid from '../components/viewer/ViewportGrid';
import ContainerListPanel from '../components/viewer/ContainerListPanel';
import DicomHeaderPanel from '../components/viewer/DicomHeaderPanel';
import { toolService } from '../lib/cornerstone/toolService';
import { annotationService } from '../lib/cornerstone/annotationService';
import { segmentationService } from '../lib/cornerstone/segmentationService';
import { useHotkeys } from '../hooks/useHotkeys';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useViewerStore } from '../stores/viewerStore';

interface ViewerPageProps {
  panelImageIds: Record<string, string[]>;
  onApplyProtocol?: (protocolId: string) => void;
  onToggleMPR?: () => void;
  /** Content rendered at the far left of the toolbar (XNAT logo, connection, etc.) */
  leftSlot?: React.ReactNode;
  /** Browser sidebar rendered below toolbar, left of viewport grid */
  browserSlot?: React.ReactNode;
  /** Called when the user clicks "Recover" for a backup session in Settings. */
  onRecoverBackup?: (sessionId: string) => Promise<void> | void;
  /** When set, the Settings modal should open to the requested tab. */
  settingsInitialTabRequest?: string;
  /** Called after a Settings-tab request has been consumed. */
  onSettingsInitialTabRequestConsumed?: () => void;
}

export default function ViewerPage({
  panelImageIds,
  onApplyProtocol,
  onToggleMPR,
  leftSlot,
  browserSlot,
  onRecoverBackup,
  settingsInitialTabRequest,
  onSettingsInitialTabRequestConsumed,
}: ViewerPageProps) {
  const showAnnotationsPanel = useSegmentationStore((s) => s.showPanel);
  const [showDicomPanel, setShowDicomPanel] = useState(false);

  const toggleDicomPanel = useCallback(() => setShowDicomPanel((v) => !v), []);
  const closeDicomPanel = useCallback(() => setShowDicomPanel(false), []);

  // Check if the active panel has images loaded (for MPR button enable state)
  const activeViewportId = useViewerStore((s) => s.activeViewportId);
  const hasImages = (panelImageIds[activeViewportId]?.length ?? 0) > 1;

  // Install global keyboard shortcuts.
  useHotkeys();

  // Initialize the shared tool group and annotation service once on mount.
  // Individual viewport instances add/remove themselves.
  useEffect(() => {
    toolService.initialize();
    annotationService.initialize();
    segmentationService.initialize();
    return () => {
      segmentationService.dispose();
      annotationService.dispose();
      toolService.destroy();
    };
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Toolbar
        showDicomPanel={showDicomPanel}
        onToggleDicomPanel={toggleDicomPanel}
        onApplyProtocol={onApplyProtocol}
        onToggleMPR={onToggleMPR}
        hasImages={hasImages}
        leftSlot={leftSlot}
        onRecoverBackup={onRecoverBackup}
        settingsInitialTabRequest={settingsInitialTabRequest}
        onSettingsInitialTabRequestConsumed={onSettingsInitialTabRequestConsumed}
      />
      <div className="flex-1 min-h-0 flex relative">
        {/* Optional browser sidebar (rendered by App) */}
        {browserSlot}
        <div className="flex-1 min-w-0 relative flex">
          <div className="flex-1 min-w-0 relative">
            <ViewportGrid panelImageIds={panelImageIds} />
          </div>
          {showAnnotationsPanel && <ContainerListPanel />}
          {showDicomPanel && <DicomHeaderPanel onClose={closeDicomPanel} />}
        </div>
      </div>
    </div>
  );
}
