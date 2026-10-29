/**
 * The open full-window view (extension framework X2, wireframe E3): over the viewer, the sidebar
 * and the side panels, under the toolbar. The viewer stays mounted beneath it, so going back is
 * instant and nothing is lost. "← Back to viewer", or Esc when no text field has the keyboard,
 * closes it.
 */
import { useEffect } from 'react';
import { allows, closeExtensionView, useExtensionUiStore } from '../../lib/extensions/uiRegistry';
import { hotkeyService } from '../../lib/hotkeys/hotkeyService';
import ExtensionSlot from './ExtensionSlot';

export default function ExtensionViewHost() {
  const open = useExtensionUiStore((s) => s.openView);
  const view = useExtensionUiStore((s) => {
    const v = s.openView ? s.views.find((x) => x.extId === s.openView!.extId && x.id === s.openView!.id) : undefined;
    return v && allows(s.gates, v.extId, v.feature) ? v : undefined; // locked (X6): not shown
  });

  useEffect(() => {
    if (!view) return;
    // Escape belongs to the view while it is open (W/L would act on a viewer that is hidden).
    return hotkeyService.pushKeyLayer({ onKeyDown: (e) => (e.key === 'Escape' ? (closeExtensionView(), true) : false) });
  }, [view]);

  useEffect(() => { if (open && !view) closeExtensionView(); }, [open, view]);

  if (!view) return null;
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-zinc-950" data-testid="extension-view" aria-label={view.title}>
      <div className="h-9 shrink-0 flex items-center gap-2 px-3 bg-zinc-900 border-b border-zinc-800">
        <button type="button" onClick={closeExtensionView} className="px-2 py-1 rounded text-[11px] bg-zinc-800 text-zinc-200 hover:bg-zinc-700">← Back to viewer</button>
        <span className="text-xs font-medium text-zinc-100">{view.title}</span>
        <span className="text-[11px] text-zinc-500">· {view.extName}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <ExtensionSlot extId={view.extId} extName={view.extName} component={view.component} />
      </div>
    </div>
  );
}
