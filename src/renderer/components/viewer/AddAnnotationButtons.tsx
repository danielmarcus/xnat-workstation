/**
 * AddAnnotationButtons — toolbar surface for creating new SEGs and RTSTRUCTs.
 *
 * Lifted out of `SegmentationPanel` in Phase 6 / Stage 2B.1 so the
 * creation entry-point lives at the toolbar level (where every other
 * "open new artifact" action lives) and the panel can shrink to a list-
 * management surface.
 *
 * Owns its own naming dialog so the toolbar mount is fully self-
 * contained — no parent prop wiring needed beyond the active panel's
 * source imageIds (which the toolbar already needs to compute the MPR
 * disable state).
 */
import { useCallback, useRef, useState } from 'react';
import { useViewerStore } from '../../stores/viewerStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { segmentationManager } from '../../lib/segmentation/segmentationManagerSingleton';
import { IconPlus, IconSegmentationAnnotation, IconStructureAnnotation } from '../icons';
import NameEntryDialog from './segmentation/NameEntryDialog';

type DicomType = 'SEG' | 'RTSTRUCT';

const TYPE_ACCENTS: Record<DicomType, { text: string; border: string; bgHover: string }> = {
  SEG: {
    text: 'text-purple-300 hover:text-purple-200',
    border: 'border-purple-900/35',
    bgHover: 'hover:bg-purple-900/20',
  },
  RTSTRUCT: {
    text: 'text-emerald-300 hover:text-emerald-200',
    border: 'border-emerald-900/35',
    bgHover: 'hover:bg-emerald-900/20',
  },
};

export default function AddAnnotationButtons() {
  const activeViewportId = useViewerStore((s) => s.activeViewportId);
  const panelImageIdsMap = useViewerStore((s) => s.panelImageIdsMap);
  const sourceImageIds = panelImageIdsMap[activeViewportId] ?? [];
  const panelScanMap = useViewerStore((s) => s.panelScanMap);
  const xnatContext = useViewerStore((s) => s.xnatContext);
  const panelXnatContextMap = useViewerStore((s) => s.panelXnatContextMap);
  const activePanelXnatContext = panelXnatContextMap[activeViewportId] ?? xnatContext;
  const setDicomType = useSegmentationStore((s) => s.setDicomType);

  const [pendingType, setPendingType] = useState<DicomType | null>(null);
  const [namingValue, setNamingValue] = useState('');
  const namingInputRef = useRef<HTMLInputElement>(null);

  const openDialog = useCallback((type: DicomType) => {
    if (sourceImageIds.length === 0) return;
    setPendingType(type);
    setNamingValue(type === 'RTSTRUCT' ? 'Structure' : 'Segmentation');
  }, [sourceImageIds]);

  const cancel = useCallback(() => {
    setPendingType(null);
  }, []);

  const confirm = useCallback(async () => {
    const name = namingValue.trim();
    const type = pendingType;
    if (!name || !type) return;
    setPendingType(null);
    try {
      const segId = type === 'RTSTRUCT'
        ? await segmentationManager.createNewStructure(activeViewportId, sourceImageIds, name)
        // createDefaultSegment=true so brush / paint-fill / scissors can
        // target an immediate sub-segmentation. Mirrors the toolService
        // auto-create-on-brush-activate path.
        : await segmentationManager.createNewSegmentation(activeViewportId, sourceImageIds, name, true);
      setDicomType(segId, type);
      useSegmentationStore.getState().setActiveSegmentation(segId);
      // Track the source scan ID so auto-save targets the correct scan
      // even if the user switches panels/scans before save fires.
      // scanId='' means "not yet saved to XNAT".
      const currentScanId = panelScanMap[activeViewportId] ?? activePanelXnatContext?.scanId;
      if (currentScanId && activePanelXnatContext?.projectId && activePanelXnatContext?.sessionId) {
        useSegmentationStore.getState().setXnatOrigin(segId, {
          scanId: '',
          sourceScanId: currentScanId,
          projectId: activePanelXnatContext.projectId,
          sessionId: activePanelXnatContext.sessionId,
        });
      }
    } catch (err) {
      console.error('[AddAnnotationButtons] Failed to create annotation:', err);
    }
  }, [namingValue, pendingType, activeViewportId, sourceImageIds, panelScanMap, activePanelXnatContext, setDicomType]);

  const disabled = sourceImageIds.length === 0;

  return (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => openDialog('SEG')}
          disabled={disabled}
          title="Create a segmentation annotation"
          aria-label="Add segmentation"
          data-testid="add-segmentation-btn"
          className={`flex items-center justify-center gap-0.5 transition-colors px-1.5 py-1.5 rounded border ${TYPE_ACCENTS.SEG.text} ${TYPE_ACCENTS.SEG.border} ${TYPE_ACCENTS.SEG.bgHover} disabled:opacity-30 disabled:cursor-not-allowed`}
        >
          <IconPlus className="w-2.5 h-2.5" />
          <IconSegmentationAnnotation className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => openDialog('RTSTRUCT')}
          disabled={disabled}
          title="Create a structure annotation"
          aria-label="Add structure"
          data-testid="add-structure-btn"
          className={`flex items-center justify-center gap-0.5 transition-colors px-1.5 py-1.5 rounded border ${TYPE_ACCENTS.RTSTRUCT.text} ${TYPE_ACCENTS.RTSTRUCT.border} ${TYPE_ACCENTS.RTSTRUCT.bgHover} disabled:opacity-30 disabled:cursor-not-allowed`}
        >
          <IconPlus className="w-2.5 h-2.5" />
          <IconStructureAnnotation className="w-3.5 h-3.5" />
        </button>
      </div>

      <NameEntryDialog
        open={pendingType !== null}
        title={pendingType === 'RTSTRUCT' ? 'Structure name' : 'Segmentation name'}
        value={namingValue}
        placeholder={pendingType === 'RTSTRUCT' ? 'Enter structure name...' : 'Enter segmentation name...'}
        confirmLabel="Create"
        inputRef={namingInputRef}
        onChange={setNamingValue}
        onConfirm={() => { void confirm(); }}
        onCancel={cancel}
      />
    </>
  );
}
