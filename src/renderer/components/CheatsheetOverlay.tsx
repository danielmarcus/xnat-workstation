/**
 * CheatsheetOverlay — `?` modal listing every hotkey binding.
 * Spec §6.3.
 *
 * Renders a single dialog with a 3-column responsive layout that
 * groups bindings by category (Tools · Editing tools · Viewport ·
 * Layout · Slice · Brush · Panels · W/L presets · Edit · App).
 * Reads the live merged hotkey map via `useHotkeyMap()` so remaps
 * propagate without a refresh.
 *
 * Open / close is owned by the parent — `Toolbar` listens for the
 * `?` keypress globally (with the input-focus guard) and toggles
 * the `open` flag. Inside the overlay, Esc / `?` / clicking the ✕
 * (or the scrim) call `onClose`.
 */
import { useEffect } from 'react';
import { useHotkeyMap } from '../lib/hotkeys/useBindingLabel';
import {
  ACTION_LABEL,
  CATEGORY_ORDER,
  actionsByCategory,
  type ActionCategory,
} from '../lib/hotkeys/actionCatalog';
import { formatBinding } from '../lib/hotkeys/format';
import type { HotkeyAction } from '@shared/types/hotkeys';

export interface CheatsheetOverlayProps {
  open: boolean;
  onClose: () => void;
}

export default function CheatsheetOverlay({ open, onClose }: CheatsheetOverlayProps) {
  const map = useHotkeyMap();

  // Global key handling — Esc and `?` both close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === '?') {
        // Re-pressing `?` toggles closed.
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [open, onClose]);

  if (!open) return null;

  const grouped = actionsByCategory();
  // Drop empty categories so the grid doesn't render dead headings.
  const renderedCategories = CATEGORY_ORDER.filter(
    (c) => (grouped.get(c) ?? []).some((action) => map[action] && map[action]!.length > 0),
  );

  return (
    <div
      data-testid="cheatsheet-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cheatsheet-title"
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
    >
      <button
        type="button"
        aria-label="Close cheatsheet"
        data-testid="cheatsheet-scrim"
        className="absolute inset-0 bg-zinc-950/75"
        onClick={onClose}
      />

      <div className="relative w-full max-w-4xl max-h-[80vh] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h3 id="cheatsheet-title" className="text-sm font-semibold text-zinc-100">
            Keyboard shortcuts
          </h3>
          <button
            type="button"
            aria-label="Close"
            data-testid="cheatsheet-close"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 px-2 py-0.5 rounded hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {renderedCategories.map((category) => (
            <CategorySection
              key={category}
              category={category}
              actions={(grouped.get(category) ?? []).filter(
                (a) => map[a] && map[a]!.length > 0,
              )}
              map={map}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CategorySection({
  category,
  actions,
  map,
}: {
  category: ActionCategory;
  actions: ReadonlyArray<HotkeyAction>;
  map: ReturnType<typeof useHotkeyMap>;
}) {
  return (
    <section
      data-testid={`cheatsheet-section:${category}`}
      className="rounded border border-zinc-800 bg-zinc-900/60"
    >
      <h4 className="text-[10px] uppercase tracking-wider text-zinc-500 px-3 pt-2 pb-1">
        {category}
      </h4>
      <ul className="divide-y divide-zinc-800/60">
        {actions.map((action) => (
          <BindingRow key={action} action={action} bindings={map[action] ?? []} />
        ))}
      </ul>
    </section>
  );
}

function BindingRow({
  action,
  bindings,
}: {
  action: HotkeyAction;
  bindings: ReadonlyArray<{ key: string; modifiers?: object }>;
}) {
  return (
    <li
      data-testid={`cheatsheet-row:${action}`}
      className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs"
    >
      <span className="text-zinc-300 truncate">{ACTION_LABEL[action]}</span>
      <span className="flex items-center gap-1 shrink-0">
        {bindings.map((b, i) => (
          <kbd
            key={i}
            data-testid={`cheatsheet-binding:${action}:${i}`}
            className="text-[10px] font-mono text-zinc-200 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5"
          >
            {formatBinding(b)}
          </kbd>
        ))}
      </span>
    </li>
  );
}
