/**
 * ViewerPage — composes Toolbar + the unified viewport grid + side panels into a
 * full-height viewer layout. The unified viewport path (Cornerstone3D) is the
 * only path; the legacy stack/MPR viewport components were removed in P1.8d.
 */
import { useEffect, useState, useCallback } from 'react';
import Toolbar from '../components/viewer/Toolbar';
import UnifiedViewportGrid from '../components/viewer/UnifiedViewportGrid';
import AnnotationListPanel from '../components/viewer/AnnotationListPanel';
import SegmentationPanel from '../components/viewer/SegmentationPanel';
import AnnotationsPanel from '../components/annotations/AnnotationsPanel';
import DicomHeaderPanel from '../components/viewer/DicomHeaderPanel';

/**
 * Rebuild Phase 3 (R3.8): mount the rebuilt Annotations side panel on the existing
 * "Segment" toggle. Flag kept so the legacy SegmentationPanel is one flip away
 * during visual sign-off; R3.8b deletes the legacy panel and removes this flag.
 */
const REBUILT_ANNOTATIONS_PANEL = true;
import { toolService } from '../lib/cornerstone/toolService';
import { annotationService } from '../lib/cornerstone/annotationService';
import { segmentationService } from '../lib/cornerstone/segmentationService';
import { containerService } from '../lib/cornerstone/containerService';
import { undoService } from '../lib/cornerstone/undoService';
import { unifiedToolService } from '../lib/cornerstone/unifiedToolService';
import { viewportLayoutService } from '../lib/cornerstone/viewportLayoutService';
import { useHotkeys } from '../hooks/useHotkeys';
import { useXnatAutosaveOptIn } from '../hooks/useXnatAutosaveOptIn';
import { useAnnotationStore } from '../stores/annotationStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useViewerStore } from '../stores/viewerStore';
import { usePreferencesStore } from '../stores/preferencesStore';

interface ViewerPageProps {
  panelImageIds: Record<string, string[]>;
  onApplyProtocol?: (protocolId: string) => void;
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
  leftSlot,
  browserSlot,
  onRecoverBackup,
  settingsInitialTabRequest,
  onSettingsInitialTabRequestConsumed,
}: ViewerPageProps) {
  const showAnnotationPanel = useAnnotationStore((s) => s.showPanel);
  const showSegPanel = useSegmentationStore((s) => s.showPanel);
  const [showDicomPanel, setShowDicomPanel] = useState(false);

  const toggleDicomPanel = useCallback(() => setShowDicomPanel((v) => !v), []);
  const closeDicomPanel = useCallback(() => setShowDicomPanel(false), []);

  const activeViewportId = useViewerStore((s) => s.activeViewportId);

  // Install global keyboard shortcuts.
  useHotkeys();
  // XNAT-autosave opt-in (default OFF — composes the real transport only when the
  // user enables it in Settings; inert + no server writes otherwise).
  useXnatAutosaveOptIn();

  // Initialize the unified viewport + annotation services once on mount.
  useEffect(() => {
    annotationService.initialize();
    segmentationService.initialize();
    containerService.initialize();
    undoService.initialize();
    unifiedToolService.initialize();
    viewportLayoutService.initialize();
    return () => {
      viewportLayoutService.dispose();
      unifiedToolService.destroy();
      undoService.dispose();
      containerService.dispose();
      segmentationService.dispose();
      annotationService.dispose();
      toolService.destroy();
    };
  }, []);

  // Propagate the inter-slice interpolation preference to the unified tool group live
  // (signal 13). The unified contour tools default to interpolation OFF, so this is what
  // actually enables it (and lets the Settings toggle disable it).
  const interpolationEnabled = usePreferencesStore((s) => s.preferences.interpolation.enabled);
  useEffect(() => {
    unifiedToolService.setInterpolationEnabled(interpolationEnabled);
  }, [interpolationEnabled]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <Toolbar
        showDicomPanel={showDicomPanel}
        onToggleDicomPanel={toggleDicomPanel}
        onApplyProtocol={onApplyProtocol}
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
            <UnifiedViewportGrid panelImageIds={panelImageIds} />
          </div>
          {showAnnotationPanel && <AnnotationListPanel />}
          {showSegPanel && (
            REBUILT_ANNOTATIONS_PANEL ? (
              <AnnotationsPanel activeViewportId={activeViewportId} sourceImageIds={panelImageIds[activeViewportId] ?? []} />
            ) : (
              <SegmentationPanel sourceImageIds={panelImageIds[activeViewportId] ?? []} />
            )
          )}
          {showDicomPanel && <DicomHeaderPanel onClose={closeDicomPanel} />}
        </div>
      </div>
    </div>
  );
}
