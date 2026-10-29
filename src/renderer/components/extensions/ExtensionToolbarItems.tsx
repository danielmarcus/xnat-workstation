/**
 * Extensions' toolbar items (extension framework X2, wireframe E2), left of Annotate · Tags ·
 * Settings. The host draws each button, so it looks like the toolbar's own and collapses with it
 * (its text moves into the tooltip as the toolbar narrows); a click runs the extension's command
 * or opens the popover it draws. An item the extension has hidden takes no room.
 */
import { useEffect, useRef, useState } from 'react';
import { executeExtensionCommand, useExtensionUiStore, type ToolbarItemEntry } from '../../lib/extensions/uiRegistry';
import ExtensionSlot from './ExtensionSlot';

function Item({ item, textCollapsed }: { item: ToolbarItemEntry; textCollapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { spec } = item;

  // Opening a full-window view (say from the popover) closes the popover.
  const viewOpen = useExtensionUiStore((st) => st.openView !== null);
  useEffect(() => { if (viewOpen) setOpen(false); }, [viewOpen]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const showLabel = !textCollapsed || !spec.icon;
  const tip = [textCollapsed && spec.icon ? spec.label : null, spec.title, item.extName].filter(Boolean).join(' · ');
  const onClick = () => {
    if (spec.popover) setOpen((v) => !v);
    else if (spec.command) executeExtensionCommand(item.extId, spec.command);
  };
  return (
    <div ref={ref} className="relative" data-testid={`extension-toolbar-item-${item.extId}`}>
      <button
        type="button"
        title={tip}
        aria-label={`${spec.label} (${item.extName})`}
        aria-expanded={spec.popover ? open : undefined}
        onClick={onClick}
        className={`flex items-center gap-1 h-7 px-1.5 rounded text-xs max-w-[180px] transition-colors ${open ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'}`}
      >
        {spec.icon && <span aria-hidden className="shrink-0">{spec.icon}</span>}
        {showLabel && <span className="truncate">{spec.label}</span>}
      </button>
      {open && spec.popover && (
        <div className="absolute right-0 top-full mt-1 z-40 min-w-[200px] max-w-[320px] rounded-md border border-zinc-700 bg-zinc-900 p-2 shadow-xl text-xs text-zinc-200" data-testid="extension-toolbar-popover">
          <ExtensionSlot extId={item.extId} extName={item.extName} component={spec.popover} />
        </div>
      )}
    </div>
  );
}

export default function ExtensionToolbarItems({ textCollapsed }: { textCollapsed: boolean }) {
  const items = useExtensionUiStore((s) => s.toolbarItems).filter((i) => i.spec.visible !== false);
  if (items.length === 0) return null;
  return (
    <div className="shrink-0 flex items-center gap-1 px-1" data-testid="extension-toolbar-items">
      {items.map((i) => <Item key={i.key} item={i} textCollapsed={textCollapsed} />)}
    </div>
  );
}
