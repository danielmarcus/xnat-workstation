/**
 * Session notes — the renderer part: the extension framework's worked example
 * (docs/extension-framework.md). It fills every UI slot an extension has (wireframes E1–E7):
 *
 * - a sidebar tab listing the notes, with Add note;
 * - a toolbar item (📝 n notes) with a popover;
 * - a full-window view, All notes;
 * - a page in Settings › Extensions;
 * - commands for the ⌘K finder and Settings › Hotkeys: next / previous note (N, ⇧N) and open
 *   All notes.
 *
 * It is built like any extension: TSX bundled with `react` aliased to the SDK's, so it renders
 * with the app's React (scripts/build-extensions.mjs). Notes are kept in memory for now; storing
 * them in an XNAT resource arrives with the XNAT and storage APIs (X3, X5).
 */
import { useState, useSyncExternalStore } from 'react';
import type { RendererExtensionContext, ToolbarItemHandle } from '@nrgxnat/workstation-extension-api';

interface Note { id: number; text: string; at: Date }

// ─── State: the notes, the selected one, and whether the toolbar shows the count ───

let notes: Note[] = [];
let selected: number | null = null;
let showCount = true;
let nextId = 1;
const listeners = new Set<() => void>();
let snapshot: { notes: Note[]; selected: number | null; showCount: boolean } = { notes, selected, showCount };
function changed() {
  snapshot = { notes, selected, showCount };
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const useNotes = () => useSyncExternalStore(subscribe, () => snapshot);

function addNote(text: string) {
  const note = { id: nextId++, text, at: new Date() };
  notes = [note, ...notes];
  selected = note.id;
  changed();
}

function step(by: 1 | -1) {
  if (notes.length === 0) return;
  const i = notes.findIndex((n) => n.id === selected);
  const next = i < 0 ? 0 : Math.min(notes.length - 1, Math.max(0, i + by));
  selected = notes[next].id;
  changed();
}

const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

let current: RendererExtensionContext | null = null;

export function activate(ext: RendererExtensionContext) {
  current = ext;
  const { Button, Dialog } = ext.ui.components;

  function AddNoteDialog({ onClose }: { onClose: () => void }) {
    const [text, setText] = useState('');
    return (
      <Dialog title="Add note" onClose={onClose}>
        <textarea
          aria-label="Note"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full h-24 bg-zinc-800 border border-zinc-700 rounded p-2 text-xs text-zinc-100"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button primary disabled={!text.trim()} onClick={() => { addNote(text.trim()); onClose(); }}>Add</Button>
        </div>
      </Dialog>
    );
  }

  function NotesTab() {
    const s = useNotes();
    const [adding, setAdding] = useState(false);
    return (
      <div className="text-xs">
        <div className="px-2.5 py-2 text-[11px] text-zinc-400">{s.notes.length === 0 ? 'No notes yet.' : `${s.notes.length} note${s.notes.length === 1 ? '' : 's'}`}</div>
        <ul>
          {s.notes.map((n) => (
            <li
              key={n.id}
              data-note-selected={n.id === s.selected ? 'true' : undefined}
              className={`px-2.5 py-1.5 border-b border-zinc-800 ${n.id === s.selected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300'}`}
            >
              <div className="text-[10px] text-zinc-500">{time(n.at)}</div>
              <div>{n.text}</div>
            </li>
          ))}
        </ul>
        <div className="p-2.5"><Button onClick={() => setAdding(true)}>+ Add note</Button></div>
        {adding && <AddNoteDialog onClose={() => setAdding(false)} />}
      </div>
    );
  }

  function CountPopover() {
    const s = useNotes();
    return (
      <div className="space-y-2">
        <div className="font-medium">Session notes</div>
        <div className="text-[11px] text-zinc-400">{s.notes.length} note{s.notes.length === 1 ? '' : 's'}{s.notes[0] ? ` · newest ${time(s.notes[0].at)}` : ''}</div>
        <Button onClick={() => ext.ui.openView('all')}>All notes…</Button>
      </div>
    );
  }

  function AllNotesView() {
    const s = useNotes();
    return (
      <table className="w-full text-xs">
        <thead><tr className="text-left text-zinc-500"><th className="px-3 py-2 font-medium">Time</th><th className="px-3 py-2 font-medium">Note</th></tr></thead>
        <tbody>
          {s.notes.map((n) => (
            <tr key={n.id} className="border-t border-zinc-800 text-zinc-200"><td className="px-3 py-1.5 w-24">{time(n.at)}</td><td className="px-3 py-1.5">{n.text}</td></tr>
          ))}
        </tbody>
      </table>
    );
  }

  function SettingsPage() {
    const s = useNotes();
    return (
      <label className="flex items-center gap-2 text-xs text-zinc-300">
        <input type="checkbox" checked={s.showCount} onChange={(e) => { showCount = e.target.checked; changed(); }} />
        Show the note count in the toolbar
      </label>
    );
  }

  ext.ui.sidebarTab({ title: 'Notes', component: NotesTab });
  const item: ToolbarItemHandle = ext.ui.toolbarItem({ icon: '📝', label: '0 notes', title: 'Notes on this session', popover: CountPopover, visible: showCount });
  ext.ui.view({ id: 'all', title: 'All notes', component: AllNotesView });
  ext.ui.settingsPage({ component: SettingsPage });
  ext.commands.register({ id: 'next', title: 'Next note', run: () => step(1), keys: [{ key: 'n' }] });
  ext.commands.register({ id: 'previous', title: 'Previous note', run: () => step(-1), keys: [{ key: 'n', modifiers: { shift: true } }] });
  ext.commands.register({ id: 'all', title: 'Open All notes', run: () => ext.ui.openView('all') });

  // The toolbar item follows the notes and the setting.
  const sync = () => item.update({ label: `${notes.length} note${notes.length === 1 ? '' : 's'}`, visible: showCount });
  listeners.add(sync);
  sync();
  ext.log(`renderer part started (API ${ext.apiVersion})`);
}

/** Everything registered through `ext` is removed by the host; only our own state is ours to clear. */
export function deactivate() {
  listeners.clear();
  current?.log('renderer part stopped');
  current = null;
}
