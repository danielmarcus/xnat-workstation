/**
 * PanelHeader (Rebuild Phase 3, R3.3) — the Annotations side-panel header.
 *
 * Presentational. Matches the frozen mockup §1b/§2: an "ANNOTATIONS" label and a
 * control cluster — three type-colored create buttons (Structure = emerald,
 * Segmentation = purple, Measurement = orange; each a colored "+" beside the kind
 * glyph) + a separator + a Save-all icon (amber dirty dot when ≥1 container is
 * unsaved). Create buttons disable when no scan is loaded in the active viewport
 * (D7.6 — create tags to the active viewport's series); Save-all disables when
 * nothing is dirty. Behaviour is injected via callbacks (wired by the panel hook).
 */
import type { ContainerKind } from '@shared/types/annotation';
import { KindGlyph, PlusGlyph, SaveGlyph } from './icons';

export interface PanelHeaderProps {
  /** A FoR-matched scan is loaded in the active viewport ⇒ create is allowed (D7.6). */
  canCreate: boolean;
  /** At least one container has unsaved changes ⇒ Save-all enabled. */
  anyDirty: boolean;
  onCreate: (kind: ContainerKind) => void;
  onSaveAll: () => void;
}

const CREATE_BUTTONS: { kind: ContainerKind; enabledClass: string; title: string }[] = [
  { kind: 'RTSTRUCT', enabledClass: 'text-emerald-400 hover:text-emerald-300', title: 'New Structure (RTSTRUCT)' },
  { kind: 'SEG', enabledClass: 'text-purple-400 hover:text-purple-300', title: 'New Segmentation (SEG)' },
  { kind: 'SR', enabledClass: 'text-orange-400 hover:text-orange-300', title: 'New Measurement (SR)' },
];

export default function PanelHeader({ canCreate, anyDirty, onCreate, onSaveAll }: PanelHeaderProps) {
  return (
    <div className="px-3 py-2.5 border-b border-zinc-800 flex items-center justify-between">
      <span className="text-zinc-200 text-xs font-medium tracking-wide">ANNOTATIONS</span>
      <div className="flex items-center gap-1">
        {CREATE_BUTTONS.map(({ kind, enabledClass, title }) => (
          <button
            key={kind}
            type="button"
            disabled={!canCreate}
            onClick={() => onCreate(kind)}
            aria-label={title}
            title={canCreate ? title : `${title} — load a scan in the active viewport first (D7.6)`}
            className={`px-1 flex items-center gap-0.5 ${canCreate ? enabledClass : 'text-zinc-700 cursor-not-allowed'}`}
          >
            <PlusGlyph size={9} />
            <KindGlyph kind={kind} size={15} />
          </button>
        ))}
        <span className="w-px h-4 bg-zinc-700 mx-0.5" aria-hidden="true" />
        <button
          type="button"
          disabled={!anyDirty}
          onClick={onSaveAll}
          aria-label="Save all annotations"
          title={anyDirty ? 'Save all annotations' : 'Save all — nothing to save'}
          className={`relative ${anyDirty ? 'text-zinc-300 hover:text-white' : 'text-zinc-700 cursor-not-allowed'}`}
        >
          <SaveGlyph size={15} />
          {anyDirty && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
