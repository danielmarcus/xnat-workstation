/**
 * The Operations section (SegWorks parity D1, amended 2026-10-12): which operation is open,
 * whether it is collapsed, and the picker that opens one. Operations exist only for a
 * Segmentation, so the open one closes when the active container is not one.
 */
import { useEffect } from 'react';
import { SEG_OPERATIONS } from '../components/annotations/toolCatalog';
import { hotkeyService } from '../lib/hotkeys/hotkeyService';
import { useOperationSheetStore, type OperationSheetId } from '../stores/operationSheetStore';

export interface OperationsSectionModel {
  operations: typeof SEG_OPERATIONS;
  openId: OperationSheetId | null;
  collapsed: boolean;
  open(id: OperationSheetId): void;
  toggleCollapsed(): void;
}

export function useOperationsSection(isSeg: boolean): OperationsSectionModel {
  const openId = useOperationSheetStore((s) => s.openSheet);
  const collapsed = useOperationSheetStore((s) => s.collapsed);
  const openOperation = useOperationSheetStore((s) => s.openOperation);
  const closeSheet = useOperationSheetStore((s) => s.closeSheet);
  const setCollapsed = useOperationSheetStore((s) => s.setCollapsed);

  useEffect(() => {
    if (!isSeg && openId) closeSheet();
  }, [isSeg, openId, closeSheet]);

  return {
    operations: SEG_OPERATIONS,
    openId,
    collapsed,
    open: (id) => {
      openOperation(id);
      hotkeyService.focusActiveViewport();
    },
    toggleCollapsed: () => setCollapsed(!collapsed),
  };
}
