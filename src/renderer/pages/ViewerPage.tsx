/**
 * ViewerPage — composes Toolbar + ViewportGrid + AnnotationListPanel
 * into a full-height viewer layout.
 * Supports multi-panel layouts (1×1, 1×2, 2×1, 2×2).
 * Conditionally renders MPRViewportGrid when MPR mode is active.
 */
import { useEffect, useState, useCallback } from 'react';
import Toolbar from '../components/viewer/Toolbar';
import ViewportGrid from '../components/viewer/ViewportGrid';
import MPRViewportGrid from '../components/viewer/MPRViewportGrid';
import AnnotationListPanel from '../components/viewer/AnnotationListPanel';
import SegmentationPanel from '../components/viewer/SegmentationPanel';
import DicomHeaderPanel from '../components/viewer/DicomHeaderPanel';
import AiFindingsPanel from '../components/viewer/AiFindingsPanel';
import { toolService } from '../lib/cornerstone/toolService';
import { annotationService } from '../lib/cornerstone/annotationService';
import { segmentationService } from '../lib/cornerstone/segmentationService';
import { useHotkeys } from '../hooks/useHotkeys';
import { useAnnotationStore } from '../stores/annotationStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useAiFindingsStore } from '../stores/aiFindingsStore';
import { useViewerStore } from '../stores/viewerStore';

interface ViewerPageProps {
  panelImageIds: Record<string, string[]>;
  onApplyProtocol?: (protocolId: string) => void;
  onToggleMPR?: () => void;
  mprSourceImageIds?: string[];
  /** Content rendered at the far left of the toolbar (XNAT logo, connection, etc.) */
  leftSlot?: React.ReactNode;
  /** Browser sidebar rendered below toolbar, left of viewport grid */
  browserSlot?: React.ReactNode;
}

export default function ViewerPage({ panelImageIds, onApplyProtocol, onToggleMPR, mprSourceImageIds, leftSlot, browserSlot }: ViewerPageProps) {
  const showAnnotationPanel = useAnnotationStore((s) => s.showPanel);
  const showSegPanel = useSegmentationStore((s) => s.showPanel);
  const showAiPanel = useAiFindingsStore((s) => s.showPanel);
  const [showDicomPanel, setShowDicomPanel] = useState(false);

  const mprActive = useViewerStore((s) => s.mprActive);
  const mprVolumeId = useViewerStore((s) => s.mprVolumeId);

  const toggleDicomPanel = useCallback(() => setShowDicomPanel((v) => !v), []);
  const closeDicomPanel = useCallback(() => setShowDicomPanel(false), []);

  // Check if the active panel has images loaded (for MPR button enable state)
  const activeViewportId = useViewerStore((s) => s.activeViewportId);
  const hasImages = (panelImageIds[activeViewportId]?.length ?? 0) > 1;

  // Install global keyboard shortcuts.
  useHotkeys();

  // Initialize the shared tool group and annotation service once on mount.
  // Individual CornerstoneViewport instances add/remove themselves.
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
    <div className="flex flex-col h-full">
      <Toolbar
        showDicomPanel={showDicomPanel}
        onToggleDicomPanel={toggleDicomPanel}
        onApplyProtocol={onApplyProtocol}
        onToggleMPR={onToggleMPR}
        hasImages={hasImages}
        leftSlot={leftSlot}
      />
      <div className="flex-1 min-h-0 flex relative">
        {/* Optional browser sidebar (rendered by App) */}
        {browserSlot}
        <div className="flex-1 min-w-0 relative flex">
          <div className="flex-1 min-w-0 relative">
            {mprActive && mprVolumeId ? (
              <MPRViewportGrid
                volumeId={mprVolumeId}
                sourceImageIds={mprSourceImageIds ?? []}
              />
            ) : (
              <ViewportGrid panelImageIds={panelImageIds} />
            )}
          </div>
          {!mprActive && showAnnotationPanel && <AnnotationListPanel />}
          {!mprActive && showSegPanel && (
            <SegmentationPanel
              sourceImageIds={panelImageIds[activeViewportId] ?? []}
            />
          )}
          {!mprActive && showDicomPanel && <DicomHeaderPanel onClose={closeDicomPanel} />}
          {!mprActive && showAiPanel && (
            <AiFindingsPanel
              sourceImageIds={panelImageIds[activeViewportId] ?? []}
            />
          )}
        </div>
      </div>
    </div>
  );
}
