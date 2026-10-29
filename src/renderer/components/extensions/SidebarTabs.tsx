/**
 * The sidebar's tabs (extension framework X2, wireframe E1): Browse, then one tab per extension
 * that adds one. With no extension tab the strip is not drawn and the sidebar is the browser,
 * exactly as before. Extra tabs past the second extension go into a ⋯ menu. The chosen tab is
 * remembered; if its extension is gone, Browse opens. The browser stays mounted (hidden) while
 * another tab shows, so its place in the XNAT tree is kept.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useExtensionUiStore, visible } from '../../lib/extensions/uiRegistry';
import ExtensionSlot from './ExtensionSlot';

const STORAGE_KEY = 'xnat.sidebar.tab';
const BROWSE = 'browse';
/** Tabs shown inline beside Browse; the rest go into ⋯. */
const INLINE_TABS = 2;

function remembered(): string {
  try { return localStorage.getItem(STORAGE_KEY) ?? BROWSE; } catch { return BROWSE; }
}

export default function SidebarTabs({ browser }: { browser: ReactNode }) {
  // Only the tabs their extensions' gates allow (X6): a locked tab is absent.
  const tabs = useExtensionUiStore(useShallow((s) => visible(s, s.sidebarTabs)));
  const [selected, setSelected] = useState(remembered);
  const [moreOpen, setMoreOpen] = useState(false);
  const current = tabs.find((t) => t.extId === selected);
  const active = current ? selected : BROWSE;

  useEffect(() => { setMoreOpen(false); }, [active]);

  const choose = (id: string) => {
    setSelected(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* not remembered */ }
  };

  if (tabs.length === 0) return <>{browser}</>;

  const inline = tabs.slice(0, INLINE_TABS);
  const more = tabs.slice(INLINE_TABS);
  const tabClass = (on: boolean) =>
    `flex-1 min-w-0 truncate px-2 py-1 rounded text-[11px] transition-colors ${on ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-800/70 text-zinc-400 hover:text-zinc-200'}`;

  return (
    <div className="h-full flex flex-col">
      <div role="tablist" aria-label="Sidebar" className="shrink-0 flex gap-0.5 px-1.5 py-1.5 border-b border-zinc-800 relative">
        <button type="button" role="tab" aria-selected={active === BROWSE} className={tabClass(active === BROWSE)} onClick={() => choose(BROWSE)}>Browse</button>
        {inline.map((t) => (
          <button key={t.extId} type="button" role="tab" aria-selected={active === t.extId} title={`${t.title} · ${t.extName}`} className={tabClass(active === t.extId)} onClick={() => choose(t.extId)}>
            {t.title}
          </button>
        ))}
        {more.length > 0 && (
          <>
            <button
              type="button"
              aria-label="More sidebar tabs"
              className={`shrink-0 w-6 rounded text-[11px] ${more.some((t) => t.extId === active) ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-800/70 text-zinc-400 hover:text-zinc-200'}`}
              onClick={() => setMoreOpen((v) => !v)}
            >
              ⋯
            </button>
            {moreOpen && (
              <div role="menu" className="absolute right-1.5 top-full mt-1 z-20 min-w-[140px] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
                {more.map((t) => (
                  <button key={t.extId} type="button" role="menuitem" className="block w-full text-left px-3 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800" onClick={() => choose(t.extId)}>
                    {t.title}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 relative">
        <div className={active === BROWSE ? 'h-full' : 'hidden'}>{browser}</div>
        {current && (
          <div className="h-full overflow-auto" role="tabpanel" aria-label={current.title} data-testid={`extension-sidebar-tab-${current.extId}`}>
            <ExtensionSlot extId={current.extId} extName={current.extName} component={current.component} />
          </div>
        )}
      </div>
    </div>
  );
}
