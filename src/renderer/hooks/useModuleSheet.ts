/**
 * A module's operation (branch 9, M4): its parameters (from the manifest), scope, estimate, Run
 * → preview → ⏎, Cancel, and its log (Copy, Download — #280–282). Built like the built-in
 * operations, from the same pieces.
 */
import { useEffect, useMemo, useState } from 'react';
import { cancelModuleOperation, describeModuleResult, moduleDomain, runModuleOperation, type ModuleScopeChoice } from '../lib/cornerstone/moduleOperationService';
import { clearStaleNotice, commitPreview, discardPreview } from '../lib/cornerstone/maskPreview';
import { closeOperation, confirmCloseOperation, STALE_PREVIEW_MESSAGE } from './operationLifecycle';
import { hotkeyService } from '../lib/hotkeys/hotkeyService';
import type { ModuleLogLine } from '../lib/modules/moduleRunner';
import { useComputeStore } from '../stores/computeStore';
import { useMaskPreviewStore } from '../stores/maskPreviewStore';
import { useModuleCatalogStore } from '../stores/moduleCatalogStore';
import { useOperationSheetStore } from '../stores/operationSheetStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useSemiAutoStore } from '../stores/semiAutoStore';
import { useViewerStore } from '../stores/viewerStore';

const rgb = (c: ArrayLike<number>) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const SCOPE_LABEL = { slice: 'Slice', range: 'Range', volume: 'Volume', roi: 'ROI limit' } as const;

export function useModuleSheet() {
  const sheet = useOperationSheetStore();
  const openId = sheet.openSheet;
  const moduleId = openId?.startsWith('module:') ? openId.slice('module:'.length) : null;
  const summary = useModuleCatalogStore((s) => s.modules.find((m) => m.id === moduleId) ?? null);
  const manifest = summary?.manifest ?? null;
  const previewActive = useMaskPreviewStore((st) => st.active);
  const previewReadOnly = useMaskPreviewStore((st) => st.readOnly);
  const discardedStale = useMaskPreviewStore((st) => st.discardedStale);
  const job = useComputeStore((st) => st.job);
  const activeViewportId = useViewerStore((st) => st.activeViewportId);
  const roi = useSemiAutoStore((st) => st.roi);
  const containerId = useSegmentationStore((st) => st.activeSegmentationId);
  const activeIndex = useSegmentationStore((st) => st.activeSegmentIndex);
  const segmentations = useSegmentationStore((st) => st.segmentations);
  const seg = segmentations.find((c) => c.segmentationId === containerId)?.segments.find((m) => m.segmentIndex === activeIndex);
  const target = seg ? { name: seg.label, color: rgb(seg.color), locked: seg.locked } : null;
  const [logs, setLogs] = useState<ModuleLogLine[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [table, setTable] = useState<{ columns: string[]; rows: unknown[][] } | null>(null);
  useEffect(() => { setLogs([]); setTable(null); }, [moduleId]);

  const values = useMemo(() => {
    const stored = moduleId ? sheet.moduleParams[moduleId] ?? {} : {};
    return Object.fromEntries((manifest?.params ?? []).map((p) => [p.key, stored[p.key] ?? p.default]));
  }, [manifest, moduleId, sheet.moduleParams]);
  const scope: ModuleScopeChoice = (moduleId && sheet.moduleScopes[moduleId]) || { kind: manifest?.scopes[0] ?? 'slice' };
  const domain = useMemo(
    () => (manifest ? moduleDomain(manifest, scope, activeViewportId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the scope, viewport, ROI and target
    [manifest, scope.kind, scope.from, scope.to, activeViewportId, roi, containerId, activeIndex, segmentations],
  );
  const running = !!job && !!manifest && job.label === manifest.name;

  const run = (commit: boolean) => {
    if (!manifest) return;
    clearStaleNotice();
    sheet.setMessage(null);
    setTable(null);
    setLogs([]);
    void runModuleOperation({ manifest, params: values, scope, viewportId: activeViewportId, commit, onLog: (l) => setLogs((x) => [...x, l]) })
      .then((r) => {
        useOperationSheetStore.getState().setMessage(describeModuleResult(r));
        if (r.ok && r.table) setTable(r.table);
      });
    hotkeyService.focusActiveViewport();
  };
  const changing = () => { if (useMaskPreviewStore.getState().active) discardPreview(); clearStaleNotice(); };
  const logText = () => logs.map((l) => `${l.level.toUpperCase().padEnd(5)} ${l.text}`).join('\n');

  return {
    open: !!manifest,
    summary,
    manifest,
    target,
    values,
    scope,
    scopes: (manifest?.scopes ?? []).map((k) => ({ value: k, label: SCOPE_LABEL[k] })),
    estimate: domain?.ok ? domain.estimate : null,
    domainProblem: domain && !domain.ok ? describeModuleResult({ ok: false, reason: domain.reason }) : null,
    running,
    logs,
    logOpen,
    table,
    message: sheet.message ?? (discardedStale ? STALE_PREVIEW_MESSAGE : target?.locked ? `${target.name} is locked — preview only` : null),
    summaryLine: running ? 'Running…' : previewActive ? 'Preview pending' : manifest?.name ?? '',
    previewActive,
    previewReadOnly,
    confirmingLeave: sheet.confirmingLeave,
    advancedOpen: !!(moduleId && sheet.advancedOpen[`module:${moduleId}`]),
    toggleAdvanced: () => moduleId && sheet.toggleAdvanced(`module:${moduleId}`),
    setParam: (key: string, v: number | string | boolean) => { if (!moduleId) return; changing(); sheet.setModuleParam(moduleId, key, v); },
    setScope: (s: ModuleScopeChoice) => { if (!moduleId) return; changing(); sheet.setModuleScope(moduleId, s); },
    toggleLog: () => setLogOpen((v) => !v),
    copyLog: () => { void navigator.clipboard.writeText(logText()); },
    downloadLog: () => { void window.electronAPI?.modules?.saveLog(logText(), manifest?.name ?? 'module'); },
    preview: () => run(false),
    commit: () => {
      if (useMaskPreviewStore.getState().active) { commitPreview(); hotkeyService.focusActiveViewport(); return; }
      run(true);
    },
    cancel: () => cancelModuleOperation(),
    discard: () => { discardPreview(); hotkeyService.focusActiveViewport(); },
    close: closeOperation,
    confirmLeave: confirmCloseOperation,
    cancelLeave: () => sheet.setConfirmingLeave(false),
  };
}

export type ModuleSheetModel = ReturnType<typeof useModuleSheet>;
