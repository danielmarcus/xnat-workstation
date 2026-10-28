/**
 * The Operations section (SegWorks parity D1, amended 2026-10-12): which operation is open,
 * whether it is collapsed, and the picker that opens one. Operations exist only for a
 * Segmentation, so the open one closes when the active container is not one.
 *
 * The picker lists ONE registry (branch 9, M4): the built-in operations, then the enabled
 * modules — each module is an operation, `module:<id>`, built the way a built-in one is.
 */
import { useEffect } from 'react';
import { SEG_OPERATIONS, type OperationDescriptor } from '../components/annotations/toolCatalog';
import { hotkeyService } from '../lib/hotkeys/hotkeyService';
import { refreshModuleCatalog } from '../lib/modules/moduleCatalog';
import { useModuleCatalogStore } from '../stores/moduleCatalogStore';
import { useOperationSheetStore, type OperationSheetId } from '../stores/operationSheetStore';

export interface OperationsSectionModel {
  operations: OperationDescriptor[];
  openId: OperationSheetId | null;
  collapsed: boolean;
  /** The drawer's height (session), dragged from its band's top edge. */
  height: number;
  setHeight(height: number): void;
  open(id: OperationSheetId): void;
  toggleCollapsed(): void;
}

export function useOperationsSection(isSeg: boolean): OperationsSectionModel {
  const openId = useOperationSheetStore((s) => s.openSheet);
  const collapsed = useOperationSheetStore((s) => s.collapsed);
  const openOperation = useOperationSheetStore((s) => s.openOperation);
  const closeSheet = useOperationSheetStore((s) => s.closeSheet);
  const setCollapsed = useOperationSheetStore((s) => s.setCollapsed);
  const modules = useModuleCatalogStore((s) => s.modules);
  const height = useOperationSheetStore((s) => s.drawerHeight);
  const setHeight = useOperationSheetStore((s) => s.setDrawerHeight);

  useEffect(() => { void refreshModuleCatalog(); }, []);
  useEffect(() => {
    if (!isSeg && openId) closeSheet();
  }, [isSeg, openId, closeSheet]);
  // A module disabled or removed while its operation is open: the operation goes with it.
  useEffect(() => {
    if (openId?.startsWith('module:') && !modules.some((m) => `module:${m.id}` === openId)) closeSheet();
  }, [openId, modules, closeSheet]);

  return {
    operations: [
      ...SEG_OPERATIONS,
      ...modules.map((m) => ({ id: `module:${m.id}`, label: m.name, title: m.description, group: 'Modules' as const })),
    ],
    openId,
    collapsed,
    height,
    setHeight,
    open: (id) => {
      openOperation(id);
      hotkeyService.focusActiveViewport();
    },
    toggleCollapsed: () => setCollapsed(!collapsed),
  };
}
