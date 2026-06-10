/**
 * AnnotationsSidePanel (Rebuild Phase 3, R3.3) — the side-panel shell.
 *
 * Presentational. Composes the frozen-mockup layout: PanelHeader on top, then
 * either the empty state (§1a no-scan / §1b scan-loaded-no-annotations, each with
 * the three create-CTA buttons) or the scrollable container list (filled by
 * ContainerRow in R3.4/R3.5 via the `children` slot) + the ContextToolbox (R3.6).
 * Behaviour is injected; the connected wrapper + hook land at mount (R3.8).
 */
import type { ReactNode } from 'react';
import type { ContainerKind } from '@shared/types/annotation';
import PanelHeader from './PanelHeader';
import { KindGlyph, PlusGlyph } from './icons';

export interface AnnotationsSidePanelProps {
  /** Number of containers currently listed (drives empty vs. populated). */
  containerCount: number;
  canCreate: boolean;
  /** Count of unsaved containers (drives the in-panel indicator). */
  unsavedCount: number;
  onCreate: (kind: ContainerKind) => void;
  /** Open the review-&-save dialog for unsaved annotations. */
  onReviewUnsaved: () => void;
  /** The container list (ContainerRow rows) — rendered when containerCount > 0. */
  children?: ReactNode;
  /** The context toolbox — rendered below the list when present. */
  toolbox?: ReactNode;
}

const CTA: { kind: ContainerKind; color: string; label: string }[] = [
  { kind: 'RTSTRUCT', color: '#34d399', label: 'Structure' },
  { kind: 'SEG', color: '#c084fc', label: 'Segmentation' },
  { kind: 'SR', color: '#fb923c', label: 'Measurement' },
];

function CreateCtaGrid({ canCreate, onCreate }: { canCreate: boolean; onCreate: (k: ContainerKind) => void }) {
  return (
    <div className="border-t border-zinc-800 p-2 grid grid-cols-3 gap-1.5">
      {CTA.map(({ kind, color, label }) => (
        <button
          key={kind}
          type="button"
          disabled={!canCreate}
          onClick={() => onCreate(kind)}
          aria-label={`New ${label}`}
          className={`flex flex-col items-center gap-1 py-2 rounded ${
            canCreate ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300' : 'bg-zinc-850 text-zinc-700 cursor-not-allowed'
          }`}
        >
          <span className="flex items-center gap-0.5" style={canCreate ? { color } : undefined}>
            <PlusGlyph size={11} />
            <KindGlyph kind={kind} size={16} />
          </span>
          <span className="text-[9px]">{label}</span>
        </button>
      ))}
    </div>
  );
}

function EmptyBody({ canCreate }: { canCreate: boolean }) {
  if (!canCreate) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <svg viewBox="0 0 16 16" width={28} height={28} fill="none" stroke="#3f3f46" strokeWidth={1.25}>
          <rect x="2" y="3" width="12" height="10" rx="1" />
          <path d="M2 11l3.5-3 2.5 2 3-3.5 3 4.5" />
        </svg>
        <p className="text-zinc-500 text-xs mt-3">No scan loaded</p>
        <p className="text-zinc-600 text-[10px] mt-1 max-w-[210px]">
          Open a scan in the XNAT Browser to start. Creating an annotation needs an active viewport to tag it to.
        </p>
      </div>
    );
  }
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
      <svg viewBox="0 0 16 16" width={28} height={28} fill="none" stroke="#52525b" strokeWidth={1.25}>
        <path d="M3 2h7l3 3v9H3z" />
        <path d="M10 2v3h3" />
      </svg>
      <p className="text-zinc-400 text-xs mt-3">No annotations yet</p>
      <p className="text-zinc-600 text-[10px] mt-1 max-w-[210px]">
        Create a new annotation below. Saved annotations load here automatically when you open a scan in the XNAT Browser.
      </p>
    </div>
  );
}

export default function AnnotationsSidePanel(props: AnnotationsSidePanelProps) {
  const { containerCount, canCreate, unsavedCount, onCreate, onReviewUnsaved, children, toolbox } = props;
  const isEmpty = containerCount === 0;

  return (
    <div className="h-full w-full bg-zinc-900 border-l border-zinc-800 flex flex-col overflow-hidden" data-testid="annotations-side-panel">
      <PanelHeader canCreate={canCreate} unsavedCount={unsavedCount} onCreate={onCreate} onReviewUnsaved={onReviewUnsaved} />

      {isEmpty ? (
        <>
          <EmptyBody canCreate={canCreate} />
          <CreateCtaGrid canCreate={canCreate} onCreate={onCreate} />
        </>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto">{children}</div>
          {toolbox}
        </>
      )}
    </div>
  );
}
