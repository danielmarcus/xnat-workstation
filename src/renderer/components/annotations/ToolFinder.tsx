/**
 * The ⌘K finder (R4-A, annotation-panel-modes): type to find any tool, mode or operation of
 * the active annotation type, by today's name or the one it had before tools were grouped;
 * ↑↓ move, ⏎ picks, ⎋ closes. A modal dialog, so it is a keyboard surface of its own (its
 * field holds the keyboard while it is open); closing returns the keyboard to the viewport.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { findEntries, type FinderEntry } from './finder';

export default function ToolFinder({ entries, onPick, onClose }: { entries: FinderEntry[]; onPick: (e: FinderEntry) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const shown = useMemo(() => findEntries(entries, query), [entries, query]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setIndex(0); }, [query]);
  const pick = (e: FinderEntry | undefined) => { if (e) onPick(e); };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/40" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Find a tool or operation"
        data-testid="tool-finder"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[26rem] max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a tool or operation…"
          aria-label="Find a tool or operation"
          aria-controls="tool-finder-results"
          aria-activedescendant={shown[index] ? `finder-${shown[index].id}` : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(shown.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); pick(shown[index]); }
          }}
          className="w-full px-3 py-2 bg-zinc-900 text-zinc-100 text-[12px] border-b border-zinc-700 outline-none"
        />
        <div id="tool-finder-results" role="listbox" aria-label="Results" className="max-h-72 overflow-y-auto py-1">
          {shown.length === 0 && <div className="px-3 py-2 text-[11px] text-zinc-500">Nothing matches</div>}
          {shown.map((e, i) => (
            <div
              key={e.id}
              id={`finder-${e.id}`}
              role="option"
              aria-selected={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={() => pick(e)}
              className={`flex items-center gap-2 px-3 py-1 text-[11px] cursor-default ${i === index ? 'bg-blue-600 text-white' : 'text-zinc-200'}`}
            >
              <span className="flex-1 truncate">{e.label}</span>
              <span className={`text-[10px] ${i === index ? 'text-blue-100' : 'text-zinc-500'}`}>{e.hint}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
