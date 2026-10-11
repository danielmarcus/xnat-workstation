/**
 * The 3D QC sheet (SegWorks parity branch 7, D9). Opening it switches to the “2D + 3D QC”
 * layout — the active viewport beside a 3D view of its scan — and builds the surfaces;
 * closing it puts the user's layout back. Changing a build setting rebuilds; display
 * settings apply to the built surfaces directly.
 */
import { useEffect, useMemo } from 'react';
import { applyQcDisplay, qc3dService } from '../lib/cornerstone/qc3dService';
import { classifyComponents, type ComponentBand } from '../lib/segmentation/qc3d/components';
import { hotkeyService } from '../lib/hotkeys/hotkeyService';
import { useOperationSheetStore } from '../stores/operationSheetStore';
import { useQc3dStore, type Qc3dComponentRow, type Qc3dSettings } from '../stores/qc3dStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useUnifiedLayoutStore } from '../stores/unifiedLayoutStore';
import { useViewerStore } from '../stores/viewerStore';

export interface Qc3dRow extends Qc3dComponentRow {
  segmentIndex: number;
  label: string;
  color: string;
  band: ComponentBand;
  /** Slices as the 2D viewport numbers them, e.g. [12, 15]. */
  slices: [number, number] | null;
  selected: boolean;
}

const BUILD_KEYS: Array<keyof Qc3dSettings> = ['resolution', 'renderer', 'smoothIterations', 'thinBoost'];

export function useQc3dSheet() {
  const open = useOperationSheetStore((s) => s.openSheet === 'qc3d');
  const closeSheet = useOperationSheetStore((s) => s.closeSheet);
  const st = useQc3dStore();
  const containerId = useSegmentationStore((s) => s.activeSegmentationId);
  const summary = useSegmentationStore((s) => s.segmentations.find((c) => c.segmentationId === s.activeSegmentationId));

  // Open: switch layout, watch for edits, build. Close: undo all of it.
  useEffect(() => {
    if (!open) return;
    const layoutStore = useUnifiedLayoutStore.getState();
    const before = layoutStore.layout;
    const source = useViewerStore.getState().activeViewportId;
    if (before.kind !== 'qc-3d') {
      useQc3dStore.getState().set({ restoreLayout: before });
      layoutStore.setLayout({ kind: 'qc-3d', source });
    }
    qc3dService.start();
    void qc3dService.build();
    return () => {
      qc3dService.stop();
      const restore = useQc3dStore.getState().restoreLayout;
      useQc3dStore.getState().set({ restoreLayout: null });
      if (restore && useUnifiedLayoutStore.getState().layout.kind === 'qc-3d') useUnifiedLayoutStore.getState().setLayout(restore);
    };
  }, [open]);

  // Leaving the QC layout some other way (the Layout menu) closes the sheet.
  const layoutKind = useUnifiedLayoutStore((s) => s.layout.kind);
  useEffect(() => {
    // Read the store, not the render-time value: the open effect above may have just
    // switched to qc-3d in this same commit.
    if (open && useUnifiedLayoutStore.getState().layout.kind !== 'qc-3d' && useQc3dStore.getState().restoreLayout) {
      useQc3dStore.getState().set({ restoreLayout: null });
      closeSheet();
    }
  }, [open, layoutKind, closeSheet]);

  // Build settings rebuild (debounced so a slider drag builds once).
  const buildKey = BUILD_KEYS.map((k) => String(st.settings[k])).join('|');
  useEffect(() => {
    if (!open || !useQc3dStore.getState().containerId) return;
    const t = setTimeout(() => { void qc3dService.build(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildKey]);

  // Display settings apply in place.
  useEffect(() => {
    if (open) applyQcDisplay();
  }, [open, st.settings, st.hiddenSegments, st.selected, st.report]);

  useEffect(() => {
    if (!open) return;
    qc3dService.setAutoRotate(st.settings.autoRotate);
    return () => qc3dService.setAutoRotate(false);
  }, [open, st.settings.autoRotate]);

  const rows = useMemo<Qc3dRow[]>(() => st.report.flatMap((r) => {
    const bands = classifyComponents(r.components.map((c) => ({ ...c, centroid: [0, 0, 0] as [number, number, number] })), {
      strayVoxels: st.settings.strayVoxels, speckVoxels: st.settings.speckVoxels,
    });
    return r.components.map((c, i) => ({
      ...c, segmentIndex: r.segmentIndex, label: r.label, color: `rgb(${r.color.join(', ')})`, band: bands[i],
      slices: qc3dService.sliceRange(r.segmentIndex, c.bbox),
      selected: st.selected?.segmentIndex === r.segmentIndex && st.selected.componentId === c.id,
    }));
  }), [st.report, st.settings.strayVoxels, st.settings.speckVoxels, st.selected]);

  const selectedRow = rows.find((r) => r.selected) ?? null;
  const selectedLocked = !!selectedRow && !!summary?.segments.find((m) => m.segmentIndex === selectedRow.segmentIndex)?.locked;
  const deleteSelected = async () => {
    const sel = useQc3dStore.getState().selected;
    if (!sel) return;
    const r = await qc3dService.deleteComponent(sel.segmentIndex, sel.componentId);
    if (r === 'locked') useQc3dStore.getState().set({ message: 'The segment is locked — unlock it to delete' });
  };

  // Sheet-scoped key: Delete / Backspace removes the selected component.
  useEffect(() => {
    if (!open) return;
    return hotkeyService.pushKeyLayer({
      onKeyDown: (e) => {
        if ((e.key !== 'Delete' && e.key !== 'Backspace') || e.ctrlKey || e.metaKey || e.altKey) return false;
        if (!useQc3dStore.getState().selected) return false;
        void deleteSelected();
        return true;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const counts = rows.reduce((acc, r) => ({ ...acc, [r.band]: (acc[r.band] ?? 0) + 1 }), {} as Partial<Record<ComponentBand, number>>);
  const labels = (summary?.segments ?? []).map((m) => ({
    segmentIndex: m.segmentIndex,
    label: m.label,
    color: `rgb(${m.color[0]}, ${m.color[1]}, ${m.color[2]})`,
    hidden: st.hiddenSegments.includes(m.segmentIndex),
  }));

  return {
    open,
    target: summary ? { name: summary.label, color: 'rgb(161, 161, 170)' } : null,
    containerId,
    settings: st.settings,
    set: (p: Partial<Qc3dSettings>) => st.setSettings(p),
    building: st.building,
    stale: st.stale,
    message: st.message,
    rows,
    counts,
    labels,
    toggleLabel: (segmentIndex: number) => st.set({
      hiddenSegments: st.hiddenSegments.includes(segmentIndex) ? st.hiddenSegments.filter((x) => x !== segmentIndex) : [...st.hiddenSegments, segmentIndex],
    }),
    setAllHidden: (hidden: boolean) => st.set({ hiddenSegments: hidden ? labels.map((l) => l.segmentIndex) : [] }),
    rebuild: () => { void qc3dService.build(); },
    select: (segmentIndex: number, componentId: number) => qc3dService.select(segmentIndex, componentId),
    selectedRow,
    selectedLocked,
    deleteSelected: () => { void deleteSelected(); },
    expanded: useUnifiedLayoutStore((s) => s.layout.kind === 'qc-3d' && !!s.layout.expanded),
    toggleExpanded: () => {
      const l = useUnifiedLayoutStore.getState().layout;
      if (l.kind === 'qc-3d') useUnifiedLayoutStore.getState().setLayout({ ...l, expanded: !l.expanded });
    },
    resetView: () => qc3dService.resetView(),
    releaseFocus: () => hotkeyService.focusActiveViewport(),
    back: () => closeSheet(),
  };
}

export type Qc3dSheetModel = ReturnType<typeof useQc3dSheet>;
