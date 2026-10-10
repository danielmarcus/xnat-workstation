/**
 * Segmentation toolbox tabs + the open operation sheet (SegWorks parity D1/D2).
 *
 * The tab follows the active tool: choosing a tool from a hotkey or elsewhere shows the
 * tab it lives on, so the highlighted tool is never hidden. A tab the user picks by hand
 * stays until the active tool changes again. A sheet only exists for a Segmentation, so
 * it closes when the active container is not one.
 */
import { useEffect } from 'react';
import { segTabOf } from '../components/annotations/toolCatalog';
import { useOperationSheetStore, type SegToolboxTab } from '../stores/operationSheetStore';

export function useSegToolboxTabs(activeToolId: string | null, isSeg: boolean) {
  const segTab = useOperationSheetStore((s) => s.segTab);
  const openSheet = useOperationSheetStore((s) => s.openSheet);
  const setSegTab = useOperationSheetStore((s) => s.setSegTab);
  const openOperation = useOperationSheetStore((s) => s.openOperation);
  const closeSheet = useOperationSheetStore((s) => s.closeSheet);

  useEffect(() => {
    const tab = segTabOf(activeToolId);
    if (tab && useOperationSheetStore.getState().segTab !== 'process') setSegTab(tab);
    else if (tab && !useOperationSheetStore.getState().openSheet) setSegTab(tab);
  }, [activeToolId, setSegTab]);

  useEffect(() => {
    if (!isSeg && openSheet) closeSheet();
  }, [isSeg, openSheet, closeSheet]);

  return {
    segTab,
    onSelectSegTab: (tab: SegToolboxTab) => setSegTab(tab),
    openOperationId: openSheet,
    onOpenOperation: (id: 'cleanup') => openOperation(id),
  };
}
